"""Truncated LLM output, v1 miner resilience and yt-dlp info sanitising (all mocked, no hardware)."""

from __future__ import annotations

import datetime as dt
import json
from typing import Any

import pytest

from app.application.runtime_service import OperationCancelledError, ServiceContainer
from app.core import config as core_config
from app.core.config import CUTS_RESPONSE_JSON_SCHEMA, SYSTEM_PROMPT_TEMPLATE, config
from app.domain.analysis import narrative_miner as nm
from app.domain.analysis.narrative_miner import analyze_job, mine_narrative_cuts
from app.domain.ingest.service import build_source_video_info
from app.infrastructure.llm import (
    InvalidLLMJsonResponseError,
    LLMContextOverflowError,
    LLMEmptyResponseError,
    LLMOutputTruncatedError,
    LocalLLMUnavailableError,
    ProviderResolution,
    UnifiedLocalLLMAdapter,
)
from app.infrastructure.llm.unified_adapter import estimate_prompt_tokens
from app.models.domain import JobStatus, SemanticBlock, TopicSegment

LMS = ProviderResolution(provider="lmstudio", base_url="http://127.0.0.1:1234/v1", model="qwen/qwen3-14b")
OLLAMA = ProviderResolution(provider="ollama", base_url="http://127.0.0.1:11434", model="qwen2.5:14b")

TRUNCATED_TEXT = '{"cuts": [{"title": "Jogo um", "start_block_id": "b1", "end_block_id": "b3", "cut_type": "ite'


def _adapter(fetcher: Any) -> UnifiedLocalLLMAdapter:
    return UnifiedLocalLLMAdapter(http_fetcher=fetcher)


def _chat(adapter: UnifiedLocalLLMAdapter, resolution: ProviderResolution, user_prompt: str = "oi") -> Any:
    return adapter._execute_chat_json_with_repair(
        resolution,
        "system",
        user_prompt,
        json_schema=CUTS_RESPONSE_JSON_SCHEMA,
        schema_name="narrative_cuts",
        temperature=0.0,
        max_tokens=None,
        cancel_token=None,
    )


def _recording_fetcher(payloads: list[Any]) -> tuple[Any, list[dict[str, Any]]]:
    calls: list[dict[str, Any]] = []

    async def fetcher(method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        calls.append({"url": url, "body": body})
        return 200, payloads[min(len(calls) - 1, len(payloads) - 1)]

    return fetcher, calls


def _lms_payload(content: str, finish: str | None, usage: dict[str, int] | None = None) -> dict[str, Any]:
    choice: dict[str, Any] = {"message": {"content": content}}
    if finish is not None:
        choice["finish_reason"] = finish
    payload: dict[str, Any] = {"choices": [choice]}
    if usage is not None:
        payload["usage"] = usage
    return payload


# --- FIX 1: truncation is its own error --------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_lmstudio_length_is_truncation_and_not_retried() -> None:
    fetcher, calls = _recording_fetcher(
        [_lms_payload(TRUNCATED_TEXT, "length", {"prompt_tokens": 3246, "completion_tokens": 3072})]
    )
    with pytest.raises(LLMOutputTruncatedError) as info:
        await _chat(_adapter(fetcher), LMS)
    assert len(calls) == 1
    err = info.value
    assert not isinstance(err, InvalidLLMJsonResponseError)
    assert err.finish_reason == "length"
    assert err.completion_tokens == 3072
    assert err.prompt_tokens == 3246
    assert err.max_tokens == config.LLM_MAX_TOKENS_MINER
    assert err.raw_text == TRUNCATED_TEXT
    assert f"max_tokens={config.LLM_MAX_TOKENS_MINER}" in str(err)
    assert "limite de saída" in str(err)


@pytest.mark.asyncio
async def test_ollama_done_reason_length_is_truncation_and_not_retried() -> None:
    fetcher, calls = _recording_fetcher(
        [
            {
                "message": {"content": TRUNCATED_TEXT},
                "done": True,
                "done_reason": "length",
                "prompt_eval_count": 3000,
                "eval_count": 2999,
            }
        ]
    )
    with pytest.raises(LLMOutputTruncatedError) as info:
        await _chat(_adapter(fetcher), OLLAMA)
    assert len(calls) == 1
    assert info.value.finish_reason == "length"
    assert info.value.completion_tokens == 2999
    assert info.value.prompt_tokens == 3000
    assert info.value.max_tokens == config.LLM_MAX_TOKENS_MINER


@pytest.mark.asyncio
async def test_truncation_without_usage_still_detected() -> None:
    fetcher, calls = _recording_fetcher([_lms_payload(TRUNCATED_TEXT, "length")])
    with pytest.raises(LLMOutputTruncatedError) as info:
        await _chat(_adapter(fetcher), LMS)
    assert len(calls) == 1
    assert info.value.completion_tokens is None
    assert "não informados" in str(info.value)


@pytest.mark.asyncio
async def test_length_with_complete_document_is_accepted() -> None:
    """Stop reason 'length' alone is not truncation: a document that parses as a whole is complete."""
    doc = json.dumps({"cuts": []})
    fetcher, calls = _recording_fetcher([_lms_payload(doc, "length", {"completion_tokens": 3072})])
    parsed, raw = await _chat(_adapter(fetcher), LMS)
    assert parsed == {"cuts": []}
    assert raw == doc
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_length_does_not_salvage_an_inner_array_of_a_cut_off_document() -> None:
    """The lenient extractor would return the closed `cuts` array of this text; under 'length' that loses data."""
    text = '{"cuts": [{"title": "a"}], "extra": "cut off here'
    fetcher, calls = _recording_fetcher([_lms_payload(text, "length")])
    with pytest.raises(LLMOutputTruncatedError):
        await _chat(_adapter(fetcher), LMS)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_normal_stop_with_invalid_json_is_retried_once_and_keeps_diagnostics() -> None:
    raw = "x" * 900 + " {broken " + "y" * 900 + "TAIL-MARKER"
    fetcher, calls = _recording_fetcher(
        [_lms_payload(raw, "stop", {"prompt_tokens": 100, "completion_tokens": 50})]
    )
    with pytest.raises(InvalidLLMJsonResponseError) as info:
        await _chat(_adapter(fetcher), LMS)
    assert len(calls) == 2  # original + exactly one repair retry
    err = info.value
    assert not isinstance(err, LLMOutputTruncatedError)
    assert err.finish_reason == "stop"
    assert err.prompt_tokens == 100
    assert err.completion_tokens == 50
    assert err.max_tokens == config.LLM_MAX_TOKENS_MINER
    text = err.diagnostic()
    assert "finish_reason=stop" in text and "completion_tokens=50" in text
    assert "TAIL-MARKER" in text  # the tail, not only the head
    assert len(text) < 1000  # bounded: 300 head + 300 tail + numbers


@pytest.mark.asyncio
async def test_invalid_json_then_valid_repair_succeeds() -> None:
    fetcher, calls = _recording_fetcher(
        [_lms_payload("not json at all", "stop"), _lms_payload(json.dumps({"cuts": []}), "stop")]
    )
    parsed, _raw = await _chat(_adapter(fetcher), LMS)
    assert parsed == {"cuts": []}
    assert len(calls) == 2


def test_truncation_diagnostic_is_bounded_and_has_both_ends() -> None:
    err = LLMOutputTruncatedError(
        raw_text="HEAD" + "m" * 5000 + "TAIL", finish_reason="length", max_tokens=10, completion_tokens=10
    )
    text = err.diagnostic()
    assert "HEAD" in text and "TAIL" in text
    assert "finish_reason=length" in text and "completion_tokens=10" in text
    assert len(text) < 1000


# --- FIX 2: schema bound, token budget, miner resilience --------------------------------------------------------


def _worst_case_header_and_blocks() -> tuple[str, list[SemanticBlock], list[SemanticBlock]]:
    """Largest v1 prompt: a window of ~8000 chars plus a header with 20 chapters, 20 topics and a long title."""
    blocks = [
        SemanticBlock(block_id=f"b{i + 1}", start=i * 10.0, end=i * 10.0 + 9.5, text="x" * 60, speaker="SPEAKER_00")
        for i in range(400)
    ]
    topics = [
        TopicSegment(
            topic_id=f"t{i + 1}", start=i * 60.0, end=i * 60.0 + 60, block_ids=[f"b{j + 1}" for j in range(5)], title="T" * 40
        )
        for i in range(20)
    ]
    chapters = [{"start_time": i * 60, "end_time": i * 60 + 60, "title": "C" * 60} for i in range(20)]
    header = nm.build_global_context_header(
        video_title="V" * 100, video_duration_seconds=3600, chapters=chapters, topics=topics, blocks=blocks
    )
    windows = nm.build_overlapping_windows(blocks, max_window_chars=nm.MAX_WINDOW_CHARS)
    biggest = max(windows, key=lambda w: sum(len(nm.format_block_line(b)) + 1 for b in w))
    return header, blocks, biggest


def test_schema_bounds_cuts_per_window() -> None:
    assert CUTS_RESPONSE_JSON_SCHEMA["properties"]["cuts"]["maxItems"] == core_config.MAX_CUTS_PER_WINDOW
    assert core_config.MAX_CUTS_PER_WINDOW <= config.MAX_SUGGESTED_CUTS
    # ~450 output tokens per cut, with margin under the cap.
    assert core_config.MAX_CUTS_PER_WINDOW * 450 < config.LLM_MAX_TOKENS_MINER


@pytest.mark.asyncio
async def test_token_budget_passes_the_context_guard_for_the_largest_window_including_repair() -> None:
    header, _blocks, window = _worst_case_header_and_blocks()
    body = "\n".join(nm.format_block_line(b) for b in window)
    assert len(body) <= nm.MAX_WINDOW_CHARS
    user_prompt = f"{header}\n\n=== TRANSCRIPT WINDOW 7/7 ===\n{body}"

    context = int(config.LMSTUDIO_CONTEXT_LENGTH)
    est = estimate_prompt_tokens(SYSTEM_PROMPT_TEMPLATE, user_prompt + "\n\n/no_think")
    assert est + config.LLM_MAX_TOKENS_MINER <= context

    # Drive the real adapter: an invalid answer of >1200 chars makes the repair prompt carry its full snippet.
    # Neither the first request nor the repair request may trip LLMContextOverflowError.
    fetcher, calls = _recording_fetcher([_lms_payload("{" + "z" * 1500, "stop")])
    adapter = _adapter(fetcher)
    with pytest.raises(InvalidLLMJsonResponseError):
        await adapter._execute_chat_json_with_repair(
            LMS,
            SYSTEM_PROMPT_TEMPLATE,
            user_prompt,
            json_schema=CUTS_RESPONSE_JSON_SCHEMA,
            schema_name="narrative_cuts",
            temperature=0.0,
            max_tokens=config.LLM_MAX_TOKENS_MINER,
            cancel_token=None,
        )
    assert len(calls) == 2
    repair_user = calls[1]["body"]["messages"][1]["content"]
    repair_est = estimate_prompt_tokens(SYSTEM_PROMPT_TEMPLATE, repair_user)
    assert repair_est + config.LLM_MAX_TOKENS_MINER <= context


def _cut(start: str, end: str, title: str, score: float = 80.0) -> dict[str, Any]:
    return {
        "title": title,
        "start_block_id": start,
        "end_block_id": end,
        "cut_type": "item",
        "opening_evidence": "abertura",
        "closing_evidence": "fechamento",
        "self_contained_start": True,
        "complete_resolution": True,
        "no_topic_drift": True,
        "novel_punchline": True,
        "beginning_hook": "gancho",
        "middle_development": "meio",
        "end_conclusion": "fim",
        "hook_reason": "r1",
        "content_reason": "r2",
        "score": score,
    }


def _make_blocks(n: int = 60) -> list[SemanticBlock]:
    return [
        SemanticBlock(
            block_id=f"b{i + 1}",
            start=i * 10.0,
            end=i * 10.0 + 9.5,
            text=f"Frase numero {i + 1}. " + ("palavra " * 48).strip() + ".",
        )
        for i in range(n)
    ]


class _ScriptedAdapter(UnifiedLocalLLMAdapter):
    """Answers narrative_cuts window k with `script[k]` (a dict payload or an exception to raise)."""

    def __init__(self, blocks: list[SemanticBlock], script: dict[int, Any], default: Any = "ok") -> None:
        super().__init__()
        self.blocks = blocks
        self.script = script
        self.default = default
        self.miner_calls = 0
        self.user_prompts: list[str] = []

    async def chat_json(self, system_prompt: str, user_prompt: str, **kwargs: Any) -> tuple[Any, str]:
        if kwargs.get("schema_name") != "narrative_cuts":
            return {"adjustments": []}, "{}"
        k = self.miner_calls
        self.miner_calls += 1
        self.user_prompts.append(user_prompt)
        outcome = self.script.get(k, self.default)
        if isinstance(outcome, Exception):
            raise outcome
        if outcome == "ok":
            first_id = user_prompt.split("\n=== TRANSCRIPT WINDOW")[1].split("\n")[1].split(" ")[0]
            idx = int(first_id[1:])
            return {"cuts": [_cut(first_id, f"b{idx + 3}", f"Corte da janela {k + 1}", 70.0 + k)]}, "{}"
        return outcome, "{}"


def _truncation() -> LLMOutputTruncatedError:
    return LLMOutputTruncatedError(
        raw_text=TRUNCATED_TEXT, finish_reason="length", max_tokens=3072, completion_tokens=3072, prompt_tokens=3246
    )


def _prepare_job(container: ServiceContainer, *, video_name: str | None, job_id: str | None = None) -> tuple[str, list[SemanticBlock]]:
    blocks = _make_blocks()
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=trunc",
        status=JobStatus.BUILDING_BLOCKS,
        job_id=job_id,
        video_duration_seconds=620.0,
        video_name=video_name,
    )
    container.jobs.save_semantic_blocks(job.job_id, blocks)
    container.jobs.save_topic_segments(
        job.job_id,
        [TopicSegment(topic_id="t1", start=0.0, end=620.0, block_ids=[b.block_id for b in blocks])],
    )
    assert len(nm.build_overlapping_windows(blocks)) >= 3
    return job.job_id, blocks


def _capture_warnings(container: ServiceContainer, monkeypatch: pytest.MonkeyPatch) -> list[tuple[str, str]]:
    captured: list[tuple[str, str]] = []
    original = container.runtime.log_warning

    def spy(job_id: str, task: str, message: str, **kw: Any) -> None:
        captured.append((task, message))
        original(job_id, task, message, **kw)

    monkeypatch.setattr(container.runtime, "log_warning", spy)
    return captured


@pytest.mark.asyncio
async def test_truncated_middle_window_keeps_other_windows_and_warns_once(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id, blocks = _prepare_job(container, video_name="Meu video")
    n_windows = len(nm.build_overlapping_windows(blocks))
    adapter = _ScriptedAdapter(blocks, {1: _truncation()})
    warnings = _capture_warnings(container, monkeypatch)

    result = await analyze_job(job_id, llm_adapter=adapter, container=container)

    assert adapter.miner_calls == n_windows  # window 3.. was still sent
    titles = {c.title for c in result["cuts"]}
    assert "Corte da janela 1" in titles
    assert "Corte da janela 3" in titles
    assert "Corte da janela 2" not in titles
    assert container.jobs.load_job(job_id).status == JobStatus.WAITING_APPROVAL
    assert container.jobs.load_cuts(job_id)

    window_warnings = [m for t, m in warnings if t == "analysis" and "Janela 2/" in m]
    assert len(window_warnings) == 1
    msg = window_warnings[0]
    assert "falhou e foi ignorada" in msg
    assert "limite de saída" in msg
    assert "finish_reason=length" in msg and "completion_tokens=3072" in msg and "prompt_tokens=3246" in msg
    assert "blocos b" in msg
    assert len([m for _t, m in warnings if "falhou e foi ignorada" in m]) == 1


@pytest.mark.asyncio
async def test_invalid_json_window_is_also_skipped(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id, blocks = _prepare_job(container, video_name="Meu video")
    bad = InvalidLLMJsonResponseError("{ nope")
    adapter = _ScriptedAdapter(blocks, {0: bad})
    warnings = _capture_warnings(container, monkeypatch)
    result = await analyze_job(job_id, llm_adapter=adapter, container=container)
    assert result["cuts"]
    assert container.jobs.load_job(job_id).status == JobStatus.WAITING_APPROVAL
    assert sum("falhou e foi ignorada" in m for _t, m in warnings) == 1


@pytest.mark.asyncio
async def test_all_windows_failing_ends_in_error_without_cuts(
    container: ServiceContainer, monkeypatch: pytest.MonkeyPatch
) -> None:
    job_id, blocks = _prepare_job(container, video_name="Meu video")
    n_windows = len(nm.build_overlapping_windows(blocks))
    adapter = _ScriptedAdapter(blocks, {}, default=_truncation())
    warnings = _capture_warnings(container, monkeypatch)

    with pytest.raises(LLMOutputTruncatedError):
        await analyze_job(job_id, llm_adapter=adapter, container=container)

    assert adapter.miner_calls == n_windows
    assert container.jobs.load_job(job_id).status == JobStatus.ERROR
    assert not container.jobs.cuts_path(job_id).exists()
    assert sum("falhou e foi ignorada" in m for _t, m in warnings) == n_windows


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error",
    [
        OperationCancelledError(),
        LocalLLMUnavailableError(),
        LLMContextOverflowError("prompt grande demais"),
        LLMEmptyResponseError("vazio"),
    ],
)
async def test_fatal_errors_abort_immediately(error: Exception) -> None:
    blocks = _make_blocks()
    adapter = _ScriptedAdapter(blocks, {1: error})
    with pytest.raises(type(error)):
        await mine_narrative_cuts(blocks, llm_adapter=adapter, topics=None)
    assert adapter.miner_calls == 2  # window 1 ok, window 2 aborted, window 3 never sent


@pytest.mark.asyncio
async def test_mine_records_failed_windows_in_stats() -> None:
    blocks = _make_blocks()
    adapter = _ScriptedAdapter(blocks, {1: _truncation()})
    stats: dict[str, Any] = {}
    cuts, _raw = await mine_narrative_cuts(blocks, llm_adapter=adapter, stats=stats)
    assert cuts
    failed = stats["failed_windows"]
    assert len(failed) == 1
    assert failed[0]["window"] == 2 and failed[0]["kind"] == "truncated"
    assert failed[0]["first_block"].startswith("b") and failed[0]["last_block"].startswith("b")


# --- FIX 2: titles ----------------------------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("", None),
        (None, None),
        ("   ", None),
        ("0123456789abcdef0123456789ABCDEF", None),
        ("Meu video real", "Meu video real"),
        ("0123456789abcdef0123456789abcde", "0123456789abcdef0123456789abcde"),  # 31 chars: not an id
    ],
)
def test_usable_video_title(raw: Any, expected: str | None) -> None:
    assert nm._usable_video_title(raw, "someid") == expected


def test_usable_video_title_rejects_the_job_id_itself() -> None:
    assert nm._usable_video_title("job-id-1", "job-id-1") is None


@pytest.mark.asyncio
async def test_hash_title_is_not_sent_to_the_model(container: ServiceContainer) -> None:
    hash_name = "a" * 8 + "0123456789abcdef01234567"
    assert len(hash_name) == 32
    job_id, blocks = _prepare_job(container, video_name=hash_name)
    adapter = _ScriptedAdapter(blocks, {})
    await analyze_job(job_id, llm_adapter=adapter, container=container)
    assert adapter.user_prompts
    assert all("Title:" not in p for p in adapter.user_prompts)
    assert all(hash_name not in p for p in adapter.user_prompts)


@pytest.mark.asyncio
async def test_real_title_is_sent_to_the_model(container: ServiceContainer) -> None:
    job_id, blocks = _prepare_job(container, video_name="20 jogos incriveis")
    adapter = _ScriptedAdapter(blocks, {})
    await analyze_job(job_id, llm_adapter=adapter, container=container)
    assert all("Title: 20 jogos incriveis" in p for p in adapter.user_prompts)


# --- FIX 3: yt-dlp info sanitising ------------------------------------------------------------------------------


class _FFmpegMergerPP:
    """Stands in for a live yt-dlp postprocessor object."""


def test_source_info_is_json_serialisable_with_nested_objects() -> None:
    info = {
        "id": "abc",
        "title": "Um titulo",
        "duration": 120.5,
        "webpage_url": "https://youtu.be/abc",
        "requested_downloads": [
            {"filepath": "x.mp4", "__postprocessors": [_FFmpegMergerPP(), {"deep": {"pp": _FFmpegMergerPP(), "ok": 1}}]}
        ],
        "tags_set": {"b", "a"},
        "blob": b"bytes\xff",
        "upload_moment": dt.datetime(2024, 5, 6, 7, 8, 9),
        "upload_day": dt.date(2024, 5, 6),
        "nested": {"when": dt.datetime(2020, 1, 2), "tuple": (1, 2, _FFmpegMergerPP())},
        "nan": float("nan"),
        "_private": "dropped",
        "formats": [{"id": 1}],
        "heatmap": [{"start_time": 0.0, "end_time": 10.0, "value": 0.5}],
        "live_object": _FFmpegMergerPP(),
    }
    payload = build_source_video_info(info)

    text = json.dumps(payload)  # must not raise
    data = json.loads(text)
    raw = data["raw_info"]
    assert raw["requested_downloads"][0]["filepath"] == "x.mp4"
    assert raw["requested_downloads"][0]["__postprocessors"] == [{"deep": {"ok": 1}}]
    assert raw["tags_set"] == ["a", "b"]
    assert raw["blob"].startswith("bytes")
    assert raw["upload_moment"] == "2024-05-06T07:08:09"
    assert raw["upload_day"] == "2024-05-06"
    assert raw["nested"] == {"when": "2020-01-02T00:00:00", "tuple": [1, 2]}
    assert raw["nan"] is None
    assert "live_object" not in raw
    assert "_private" not in raw and "formats" not in raw
    assert data["title"] == "Um titulo"
    assert data["duration"] == 120.5


def test_source_info_keeps_heatmap_handling() -> None:
    info = {
        "id": "abc",
        "title": "t",
        "duration": 60,
        "heatmap": [
            {"start_time": 10.0, "end_time": 20.0, "value": 2.0},
            {"start_time": 0.0, "end_time": 10.0, "value": 0.25},
            {"start_time": "x"},
        ],
        "requested_downloads": [{"__postprocessors": [_FFmpegMergerPP()]}],
    }
    payload = build_source_video_info(info)
    json.dumps(payload)
    assert payload["heatmap"] == [
        {"start_time": 0.0, "end_time": 10.0, "value": 0.25},
        {"start_time": 10.0, "end_time": 20.0, "value": 1.0},
    ]
    assert build_source_video_info({"id": "x", "title": "t"}).get("heatmap") is None


def test_source_info_survives_a_self_referencing_structure() -> None:
    loop: dict[str, Any] = {"a": 1}
    loop["self"] = loop
    payload = build_source_video_info({"id": "x", "title": "t", "loop": loop})
    json.dumps(payload)
