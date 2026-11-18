"""Phase 0 (analysis v2) sanitation tests: determinism, reasoning-off, duration guard,
no test-only production paths, context guard, schema order and LM Studio load parameters.

100% mocked: no GPU, no network, no real models.
"""

from __future__ import annotations

import json
import math
from typing import Any

import pytest

from app.application.runtime_service import ServiceContainer
from app.core import tool_configs
from app.core.config import CUTS_RESPONSE_JSON_SCHEMA, config
from app.domain.analysis.narrative_miner import (
    analyze_job,
    parse_candidate_cuts_from_llm_payload,
)
from app.infrastructure.llm.unified_adapter import (
    InvalidLLMJsonResponseError,
    LLMContextOverflowError,
    LLMEmptyResponseError,
    UnifiedLocalLLMAdapter,
    estimate_prompt_tokens,
)
from app.models.domain import JobStatus, SemanticBlock, TopicSegment

PROVIDERS = ["lmstudio", "ollama"]
MODELS = {"lmstudio": "qwen/qwen3-14b", "ollama": "qwen3:14b"}


def _make_adapter(container: ServiceContainer, provider: str) -> UnifiedLocalLLMAdapter:
    return UnifiedLocalLLMAdapter(container=container, provider=provider, model=MODELS[provider])


def _install_fetcher(
    container: ServiceContainer,
    provider: str,
    responses: list[Any] | None = None,
) -> list[dict[str, Any]]:
    """Install a provider-shaped fake. Returns the list of chat request bodies seen."""
    chat_bodies: list[dict[str, Any]] = []
    queue = list(responses or [])

    async def _fetch(method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        if url.endswith("/models"):
            return 200, {"data": [{"id": MODELS["lmstudio"]}]}
        if url.endswith("/api/tags") or url.endswith("/api/ps"):
            return 200, {"models": [{"name": MODELS["ollama"]}]}
        if url.endswith("/chat/completions") or url.endswith("/api/chat"):
            chat_bodies.append(body or {})
            content = queue.pop(0) if queue else '{"cuts": []}'
            if provider == "ollama":
                return 200, {"message": {"content": content}}
            return 200, {"choices": [{"message": {"content": content}}]}
        return 404, {}

    container.llm_http_fetcher = _fetch
    return chat_bodies


def _seed_of(body: dict[str, Any], provider: str) -> Any:
    return body["seed"] if provider == "lmstudio" else body["options"]["seed"]


def _temp_of(body: dict[str, Any], provider: str) -> Any:
    return body["temperature"] if provider == "lmstudio" else body["options"]["temperature"]


# --- determinism: seed + temperature -------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
async def test_chat_json_sends_default_seed_and_zero_temperature(
    container: ServiceContainer, provider: str
) -> None:
    bodies = _install_fetcher(container, provider)
    await _make_adapter(container, provider).chat_json("sys", "user")
    assert len(bodies) == 1
    assert _seed_of(bodies[0], provider) == config.ANALYSIS_SEED
    assert _temp_of(bodies[0], provider) == 0.0


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
@pytest.mark.parametrize("cfg_seed", [0, 7, 123456])
async def test_chat_json_seed_from_llm_config_and_explicit_override(
    container: ServiceContainer, provider: str, cfg_seed: int
) -> None:
    container.update_tool_configs({"llm": {"analysis_seed": cfg_seed}})
    bodies = _install_fetcher(container, provider)
    adapter = _make_adapter(container, provider)

    await adapter.chat_json("sys", "user")
    await adapter.chat_json("sys", "user", seed=999)

    assert _seed_of(bodies[0], provider) == cfg_seed
    assert _seed_of(bodies[1], provider) == 999


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
async def test_json_repair_retry_keeps_seed_and_zero_temperature(
    container: ServiceContainer, provider: str
) -> None:
    bodies = _install_fetcher(container, provider, ["{broken", '{"cuts": []}'])
    adapter = _make_adapter(container, provider)
    parsed, _ = await adapter.chat_json("sys", "user", seed=31337, temperature=0.7)
    assert parsed == {"cuts": []}
    assert len(bodies) == 2
    assert _seed_of(bodies[0], provider) == _seed_of(bodies[1], provider) == 31337
    assert _temp_of(bodies[1], provider) == 0.0


@pytest.mark.asyncio
async def test_chat_json_ok_response_is_not_special_cased(container: ServiceContainer) -> None:
    """A bare "ok" is an ordinary invalid response: repair retry runs, then it raises."""
    bodies = _install_fetcher(container, "lmstudio", ["ok", "ok"])
    with pytest.raises(InvalidLLMJsonResponseError):
        await _make_adapter(container, "lmstudio").chat_json("sys", "user")
    assert len(bodies) == 2


# --- reasoning off ------------------------------------------------------------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
@pytest.mark.parametrize("cfg", [None, True, False])
async def test_reasoning_off_mechanism_follows_disable_reasoning(
    container: ServiceContainer, provider: str, cfg: bool | None
) -> None:
    if cfg is not None:
        container.update_tool_configs({"llm": {"disable_reasoning": cfg}})
    bodies = _install_fetcher(container, provider)
    await _make_adapter(container, provider).chat_json("sys", "texto do usuario")
    body = bodies[0]
    enabled = cfg is not False  # absent -> default True

    if provider == "ollama":
        assert ("think" in body and body["think"] is False) == enabled
    else:
        user_content = body["messages"][-1]["content"]
        assert user_content.startswith("texto do usuario")
        assert ("/no_think" in user_content) == enabled
        assert "think" not in body


# --- context guard & empty content --------------------------------------------------------


def test_estimate_prompt_tokens_formula() -> None:
    for n in (0, 1, 2, 3, 100, 1001):
        assert estimate_prompt_tokens("a" * n, "") == math.ceil(n / 3.0) + 64


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
async def test_prompt_larger_than_context_raises_without_http_call(
    container: ServiceContainer, provider: str
) -> None:
    bodies = _install_fetcher(container, provider)
    big_prompt = "palavra " * 5000  # ~40k chars, far beyond 8192 tokens
    with pytest.raises(LLMContextOverflowError) as ei:
        await _make_adapter(container, provider).chat_json("sys", big_prompt, max_tokens=2560)
    assert bodies == []
    msg = str(ei.value)
    assert "2560" in msg and str(config.LMSTUDIO_CONTEXT_LENGTH) in msg
    assert not isinstance(ei.value, InvalidLLMJsonResponseError)


@pytest.mark.asyncio
async def test_context_guard_boundary_and_configured_context(container: ServiceContainer) -> None:
    bodies = _install_fetcher(container, "ollama")
    adapter = _make_adapter(container, "ollama")
    ctx = config.LMSTUDIO_CONTEXT_LENGTH
    max_tokens = 1000
    # Ollama has no /no_think suffix, so the estimate is exactly len(sys + user).
    budget_chars = int((ctx - max_tokens - 64) * 3.0) - len("sys")
    await adapter.chat_json("sys", "x" * (budget_chars - 3), max_tokens=max_tokens)
    assert len(bodies) == 1
    with pytest.raises(LLMContextOverflowError):
        await adapter.chat_json("sys", "x" * (budget_chars + 30), max_tokens=max_tokens)
    assert len(bodies) == 1

    # An explicit context_length in config is honoured (small context -> small prompt overflows).
    container.update_tool_configs({"llm": {"context_length": 1024}})
    with pytest.raises(LLMContextOverflowError):
        await adapter.chat_json("sys", "x" * 2000, max_tokens=500)
    assert len(bodies) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
@pytest.mark.parametrize("empty", ["", "   \n"])
async def test_empty_content_raises_empty_error_without_repair_retry(
    container: ServiceContainer, provider: str, empty: str
) -> None:
    bodies = _install_fetcher(container, provider, [empty, '{"cuts": []}'])
    with pytest.raises(LLMEmptyResponseError) as ei:
        await _make_adapter(container, provider).chat_json("sys", "user")
    assert len(bodies) == 1  # no repair retry
    assert "context" in str(ei.value).lower()
    assert not isinstance(ei.value, InvalidLLMJsonResponseError)


# --- chat_json_with_images (phase 6; request shapes written from documentation, never run) ----------------


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
async def test_text_chat_body_has_plain_string_messages_and_no_images(
    container: ServiceContainer, provider: str
) -> None:
    bodies = _install_fetcher(container, provider)
    await _make_adapter(container, provider).chat_json("sys", "user")
    msgs = bodies[0]["messages"]
    assert [m["role"] for m in msgs] == ["system", "user"]
    assert isinstance(msgs[1]["content"], str) and "images" not in msgs[1]
    assert not any("image" in json.dumps(m) for m in msgs)


@pytest.mark.asyncio
async def test_lmstudio_image_body_uses_openai_content_parts_with_data_uris(container: ServiceContainer) -> None:
    import base64

    bodies = _install_fetcher(container, "lmstudio", ['{"ok": true}'])
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
    parsed, _raw = await _make_adapter(container, "lmstudio").chat_json_with_images(
        "sys", "describe", [b"\xff\xd8one", b"\xff\xd8two"], json_schema=schema, schema_name="s", max_tokens=100
    )
    assert parsed == {"ok": True}
    body = bodies[0]
    assert body["messages"][0] == {"role": "system", "content": "sys"}
    parts = body["messages"][1]["content"]
    assert parts[0]["type"] == "text" and parts[0]["text"].startswith("describe")
    urls = [p["image_url"]["url"] for p in parts[1:]]
    assert [p["type"] for p in parts[1:]] == ["image_url", "image_url"]
    assert urls == ["data:image/jpeg;base64," + base64.b64encode(x).decode() for x in (b"\xff\xd8one", b"\xff\xd8two")]
    assert body["response_format"]["json_schema"]["schema"] == schema
    assert body["temperature"] == 0.0 and body["seed"] == 42 and body["max_tokens"] == 100


@pytest.mark.asyncio
async def test_ollama_image_body_uses_base64_images_on_the_user_message(container: ServiceContainer) -> None:
    import base64

    bodies = _install_fetcher(container, "ollama", ['{"ok": true}'])
    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}}
    await _make_adapter(container, "ollama").chat_json_with_images(
        "sys", "describe", [b"\xff\xd8one"], json_schema=schema, schema_name="s", max_tokens=100
    )
    body = bodies[0]
    assert body["messages"][1]["content"].startswith("describe")
    assert body["messages"][1]["images"] == [base64.b64encode(b"\xff\xd8one").decode()]
    assert "images" not in body["messages"][0]
    assert body["format"] == schema and body["options"]["seed"] == 42 and body["think"] is False


@pytest.mark.asyncio
async def test_image_call_without_images_is_rejected_and_repair_keeps_the_images(container: ServiceContainer) -> None:
    adapter = _make_adapter(container, "ollama")
    bodies = _install_fetcher(container, "ollama", ["not json at all", '{"ok": true}'])
    with pytest.raises(ValueError):
        await adapter.chat_json_with_images("sys", "u", [], json_schema={}, schema_name="s")
    parsed, _ = await adapter.chat_json_with_images(
        "sys", "u", [b"x"], json_schema={"type": "object"}, schema_name="s", seed=7
    )
    assert parsed == {"ok": True} and len(bodies) == 2
    assert all(b["messages"][1]["images"] for b in bodies)
    assert bodies[1]["messages"][1]["content"].startswith("u") and "JSON REPAIR" in bodies[1]["messages"][1]["content"]
    assert all(b["options"]["seed"] == 7 for b in bodies)


# --- schema order, config preservation ----------------------------------------------------


def test_cuts_schema_lists_score_last() -> None:
    item = CUTS_RESPONSE_JSON_SCHEMA["properties"]["cuts"]["items"]
    assert list(item["properties"])[-1] == "score"
    assert item["required"][-1] == "score"
    assert list(item["properties"])[-2] == "content_reason"
    assert item["required"][-2] == "content_reason"
    assert set(item["required"]) == set(item["properties"])


def test_normalize_llm_config_preserves_optional_keys_when_present() -> None:
    out = tool_configs.normalize_llm_config({"analysis_seed": 7, "disable_reasoning": False})
    assert out["analysis_seed"] == 7
    assert out["disable_reasoning"] is False
    out2 = tool_configs.normalize_llm_config({"analysis_seed": 0, "disable_reasoning": True})
    assert out2["analysis_seed"] == 0 and out2["disable_reasoning"] is True


def test_normalize_llm_config_does_not_invent_optional_keys() -> None:
    out = tool_configs.normalize_llm_config({"model": "qwen/qwen3-14b"})
    assert "analysis_seed" not in out
    assert "disable_reasoning" not in out
    assert "analysis_seed" not in tool_configs.default_tool_configs()["llm"]
    assert "disable_reasoning" not in tool_configs.default_tool_configs()["llm"]


# --- duration guard -----------------------------------------------------------------------

_NON_PT_EN_TEXTS = [
    "Ceci est une phrase complète en français.",
    "これは完全な日本語の文です。",
    "Dies ist ein vollständiger deutscher Satz.",
    "Это полное предложение на русском языке.",
]


def _blocks_for_spans(spans: list[tuple[str, float, float]]) -> list[SemanticBlock]:
    return [
        SemanticBlock(block_id=bid, start=s, end=e, text=_NON_PT_EN_TEXTS[i % len(_NON_PT_EN_TEXTS)])
        for i, (bid, s, e) in enumerate(spans)
    ]


def _cut_item(start_id: str, end_id: str, title: str) -> dict[str, Any]:
    return {"title": title, "start_block_id": start_id, "end_block_id": end_id, "score": 80.0}


@pytest.mark.parametrize(
    "duration, kept",
    [(4.0, False), (9.9, False), (60.0, True), (180.0, True), (180.5, False), (300.0, False)],
)
def test_duration_guard_property(duration: float, kept: bool) -> None:
    blocks = _blocks_for_spans([("b1", 0.0, duration)])
    stats: dict[str, int] = {}
    out = parse_candidate_cuts_from_llm_payload(
        {"cuts": [_cut_item("b1", "b1", "t")]}, blocks, stats=stats
    )
    assert (len(out) == 1) == kept
    assert stats.get("discarded_duration", 0) == (0 if kept else 1)


_MIXED_SPANS = [("b1", 0.0, 300.0), ("b2", 300.0, 304.0), ("b3", 304.0, 364.0), ("b4", 364.0, 370.0)]


def test_duration_guard_mixed_batch_non_pt_en_text() -> None:
    blocks = _blocks_for_spans(_MIXED_SPANS)
    stats: dict[str, int] = {}
    out = parse_candidate_cuts_from_llm_payload(
        {
            "cuts": [
                _cut_item("b1", "b1", "long"),
                _cut_item("b2", "b2", "short"),
                _cut_item("b3", "b3", "keep"),
            ]
        },
        blocks,
        stats=stats,
    )
    assert [c.title for c in out] == ["keep"]
    assert stats["discarded_duration"] == 2


def _seed_job(container: ServiceContainer, blocks: list[SemanticBlock]) -> str:
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=phase0",
        status=JobStatus.BUILDING_TOPICS,
        video_duration_seconds=blocks[-1].end,
        video_name="Phase0",
    )
    container.jobs.save_semantic_blocks(job.job_id, blocks)
    container.jobs.save_topic_segments(
        job.job_id,
        [
            TopicSegment(
                topic_id="t1",
                start=blocks[0].start,
                end=blocks[-1].end,
                block_ids=[b.block_id for b in blocks],
                blockCount=len(blocks),
                durationSeconds=blocks[-1].end - blocks[0].start,
            )
        ],
    )
    return job.job_id


@pytest.mark.asyncio
async def test_analyze_job_logs_discard_warning_with_count(container: ServiceContainer) -> None:
    blocks = _blocks_for_spans(_MIXED_SPANS)
    job_id = _seed_job(container, blocks)
    payload = {
        "cuts": [
            _cut_item("b1", "b1", "long"),
            _cut_item("b2", "b2", "short"),
            _cut_item("b3", "b3", "keep"),
        ]
    }

    async def _fetch(method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        if url.endswith("/api/tags") or url.endswith("/api/ps"):
            return 200, {"models": [{"name": "qwen3:14b"}]}
        if url.endswith("/chat/completions") or url.endswith("/api/chat"):
            fmt = (body or {}).get("format") or {}
            if "adjustments" in (fmt.get("properties") or {}):
                return 200, {"message": {"content": '{"adjustments": []}'}}
            return 200, {"message": {"content": json.dumps(payload)}}
        return 404, {}

    container.llm_http_fetcher = _fetch
    container.update_tool_configs({"llm": {"provider": "ollama", "model": "qwen3:14b"}})

    result = await analyze_job(job_id, container=container)
    assert [c.title for c in result["cuts"]] == ["keep"]
    logs = "\n".join(container.runtime.get_task_logs(job_id, "analysis"))
    assert "WARNING" in logs
    assert "2 candidate cut(s) discarded" in logs


@pytest.mark.asyncio
async def test_analyze_job_warns_when_model_registered_as_cloud(container: ServiceContainer) -> None:
    blocks = _blocks_for_spans(
        [("b1", 0.0, 40.0), ("b2", 40.0, 80.0), ("b3", 80.0, 120.0), ("b4", 120.0, 140.0)]
    )
    job_id = _seed_job(container, blocks)
    _install_fetcher(container, "ollama")
    container.update_tool_configs(
        {
            "llm": {
                "provider": "ollama",
                "model": "remote-model:cloud",
                "registered_models": [{"name": "remote-model:cloud", "source": "cloud"}],
            }
        }
    )
    await analyze_job(job_id, container=container)  # not blocked
    logs = "\n".join(container.runtime.get_task_logs(job_id, "analysis"))
    assert "registered as cloud" in logs


@pytest.mark.asyncio
@pytest.mark.parametrize("bad", ["ok", "not json at all", "{broken"])
async def test_invalid_llm_response_ends_job_in_error_and_saves_no_cuts(
    container: ServiceContainer, bad: str
) -> None:
    blocks = _blocks_for_spans(
        [("b1", 0.0, 40.0), ("b2", 40.0, 80.0), ("b3", 80.0, 120.0), ("b4", 120.0, 140.0)]
    )
    job_id = _seed_job(container, blocks)
    _install_fetcher(container, "ollama", [bad, bad])
    container.update_tool_configs({"llm": {"provider": "ollama", "model": "qwen3:14b"}})

    with pytest.raises(InvalidLLMJsonResponseError):
        await analyze_job(job_id, container=container)

    assert container.jobs.load_job(job_id).status == JobStatus.ERROR
    assert container.jobs.load_cuts(job_id) == []
    assert not container.jobs.cuts_path(job_id).exists()


# --- LM Studio CLI load parameters (D18) --------------------------------------------------


def _fake_lms_runner(
    commands: list[list[str]], model_entry: dict[str, Any], ps_entries: list[dict[str, Any]] | None = None
):
    async def _runner(args: list[str], timeout: float) -> tuple[int, str, str]:
        commands.append(list(args))
        if args[:3] == ["server", "status", "--json"]:
            return 0, json.dumps({"running": True}), ""
        if args[:2] == ["ls", "--json"]:
            return 0, json.dumps([model_entry]), ""
        if args[:2] == ["ps", "--json"]:
            return 0, json.dumps(ps_entries or []), ""
        return 0, "", ""

    return _runner


@pytest.mark.asyncio
async def test_lmstudio_llm_load_requests_context_8192_full_gpu_single_slot(
    container: ServiceContainer,
) -> None:
    commands: list[list[str]] = []
    container.lms_command_runner = _fake_lms_runner(
        commands, {"modelKey": "qwen/qwen3-14b", "type": "llm"}
    )
    async with container.lmstudio.stage(model_type="llm", preferred_model="qwen/qwen3-14b") as key:
        assert key == "qwen/qwen3-14b"

    loads = [c for c in commands if c and c[0] == "load"]
    assert len(loads) == 1
    cmd = loads[0]
    assert cmd[1] == "qwen/qwen3-14b"
    assert cmd[cmd.index("-c") + 1] == "8192"
    assert cmd[cmd.index("--gpu") + 1] == "max"
    assert cmd[cmd.index("--parallel") + 1] == "1"


_QWEN_ENTRY = {"modelKey": "qwen/qwen3-14b", "type": "llm"}


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "loaded",
    [
        {"modelKey": "qwen/qwen3-14b", "contextLength": 16384, "parallel": 4, "gpu": "max"},
        {"modelKey": "qwen/qwen3-14b", "contextLength": 8192, "parallel": 4, "gpu": "max"},
        {"modelKey": "qwen/qwen3-14b", "contextLength": 8192, "parallel": 1, "gpu": "0.5"},
        {"modelKey": "qwen/qwen3-14b", "contextLength": 12288, "parallel": 1, "gpu": "max"},
        {"modelKey": "qwen/qwen3-14b"},
    ],
)
async def test_lmstudio_preloaded_model_with_wrong_params_is_reloaded(
    container: ServiceContainer, loaded: dict[str, Any]
) -> None:
    commands: list[list[str]] = []
    container.lms_command_runner = _fake_lms_runner(commands, _QWEN_ENTRY, [loaded])
    async with container.lmstudio.stage(model_type="llm", preferred_model="qwen/qwen3-14b"):
        pass
    assert any(c[:2] == ["unload", "--all"] for c in commands)
    loads = [c for c in commands if c and c[0] == "load"]
    assert len(loads) == 1
    assert loads[0][loads[0].index("-c") + 1] == "8192"
    assert loads[0][loads[0].index("--parallel") + 1] == "1"


@pytest.mark.asyncio
async def test_lmstudio_preloaded_model_with_exact_params_is_reused(
    container: ServiceContainer,
) -> None:
    commands: list[list[str]] = []
    good = {"modelKey": "qwen/qwen3-14b", "contextLength": 8192, "parallel": 1, "gpu": "max"}
    container.lms_command_runner = _fake_lms_runner(commands, _QWEN_ENTRY, [good])
    async with container.lmstudio.stage(model_type="llm", preferred_model="qwen/qwen3-14b"):
        pass
    assert not [c for c in commands if c and c[0] == "load"]


@pytest.mark.asyncio
async def test_lmstudio_load_readback_reports_ps_values(container: ServiceContainer) -> None:
    logs: list[str] = []
    container.lmstudio._log = lambda job_id, task, msg: logs.append(msg)  # type: ignore[method-assign]
    entry = {"modelKey": "qwen/qwen3-14b", "contextLength": 8192, "parallel": 1, "gpu": "max"}
    container.lms_command_runner = _fake_lms_runner([], _QWEN_ENTRY, [entry])
    await container.lmstudio._log_load_readback("j", "analysis", "qwen/qwen3-14b", 8192, "max")
    assert any("contextLength=8192" in m and "parallel=1" in m and "gpu=max" in m for m in logs)


@pytest.mark.asyncio
async def test_lmstudio_embedding_load_unchanged_cpu_no_context_flags(
    container: ServiceContainer,
) -> None:
    commands: list[list[str]] = []
    container.lms_command_runner = _fake_lms_runner(
        commands, {"modelKey": "text-embedding-nomic-embed-text-v1.5", "type": "embedding"}
    )
    async with container.lmstudio.stage(model_type="embedding", gpu="off"):
        pass
    cmd = next(c for c in commands if c and c[0] == "load")
    assert cmd[cmd.index("--gpu") + 1] == "off"
    assert "--parallel" not in cmd and "-c" not in cmd


# --- default conftest stub answers valid JSON for the requested schema ---------------------


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
async def test_default_stub_returns_valid_json_for_requested_schema(
    container: ServiceContainer, provider: str
) -> None:
    from app.infrastructure.llm.unified_adapter import BOUNDARY_LOOKAROUND_JSON_SCHEMA

    adapter = _make_adapter(container, provider)
    cuts, _ = await adapter.chat_json("sys", "user")
    assert cuts == {"cuts": []}
    adj, _ = await adapter.chat_json(
        "sys",
        "user",
        json_schema=BOUNDARY_LOOKAROUND_JSON_SCHEMA,
        schema_name="boundary_lookaround",
    )
    assert adj == {"adjustments": []}


# --- per-call reasoning override (D16) ------------------------------------------------------


def _reasoning_on_in(body: dict[str, Any], provider: str) -> bool:
    if provider == "ollama":
        return not ("think" in body and body["think"] is False)
    return "/no_think" not in body["messages"][-1]["content"]


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
@pytest.mark.parametrize("cfg", [None, True, False])
@pytest.mark.parametrize("override", [None, True, False])
async def test_reasoning_override_wins_over_config_in_both_providers(
    container: ServiceContainer, provider: str, cfg: bool | None, override: bool | None
) -> None:
    if cfg is not None:
        container.update_tool_configs({"llm": {"disable_reasoning": cfg}})
    bodies = _install_fetcher(container, provider)
    await _make_adapter(container, provider).chat_json("sys", "user", reasoning=override)
    expected_on = (cfg is False) if override is None else override
    assert _reasoning_on_in(bodies[0], provider) == expected_on


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", PROVIDERS)
@pytest.mark.parametrize("override", [None, True, False])
async def test_reasoning_override_survives_the_json_repair_retry(
    container: ServiceContainer, provider: str, override: bool | None
) -> None:
    bodies = _install_fetcher(container, provider, ["{broken", '{"cuts": []}'])
    await _make_adapter(container, provider).chat_json("sys", "user", reasoning=override)
    assert len(bodies) == 2
    expected_on = False if override is None else override  # config absent -> reasoning off by default
    assert [_reasoning_on_in(b, provider) for b in bodies] == [expected_on, expected_on]
