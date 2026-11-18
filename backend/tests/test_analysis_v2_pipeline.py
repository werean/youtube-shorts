"""Analysis v2 pipeline (phase 2) end-to-end tests.

100% mocked: the LLM HTTP layer is a fake that answers per requested JSON schema. No GPU, no network.
Transcriptions are synthetic: one in Turkish with punctuation and one in Indonesian without any.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

import pytest

from app.application.runtime_service import ServiceContainer
from app.core import tool_configs
from app.domain.analysis.narrative_miner import analyze_job
from app.domain.analysis.v2.models import Sentence
from app.domain.analysis.v2.prompts import SCORING_SYSTEM_PROMPT
from app.domain.analysis.v2.provisional import provisional_brief, units_from_topics
from app.domain.analysis.v2.sentences import build_sentences
from app.models.domain import Cut, JobStatus, SemanticBlock, TopicSegment, WordTiming

MODEL = "qwen3:14b"

# Phase-2 slice: provisional brief, topic units, no boundary refinement. Tests about phase-2 behaviour set it explicitly.
P2 = {"brief": "provisional", "units": "topics", "refine_boundaries": False}

TURKISH = (
    "bugun hava cok guzel ve herkes disarida yuruyus yapiyor cunku ilkbahar geldi "
    "kitap okumak icin sessiz bir yer ariyorum ama sehir cok kalabalik"
).split()
INDONESIAN = (
    "hari ini kami membahas cara memasak nasi goreng yang enak dengan bumbu sederhana "
    "pertama siapkan bawang putih dan cabai lalu tumis sampai harum"
).split()

SENTENCE_PERIOD = 5.25  # 6 words of 0.5 s, 0.25 s gaps, 1.0 s pause after each sentence (exact in binary)
N_SENTENCES = 68

# Topic layout over the 68 sentences (12 + 12 + 12 + 32): content, ad_span, content, long content.
TOPIC_SPANS = [
    ("t1", 0.0, 63.0, "content"),
    ("t2", 63.0, 126.0, "ad_span"),
    ("t3", 126.0, 189.0, "content"),
    ("t4", 189.0, 357.0, "content"),
]


def make_words(vocab: list[str], *, punctuate: bool, n_sentences: int = N_SENTENCES) -> list[WordTiming]:
    words: list[WordTiming] = []
    t = 0.0
    for i in range(n_sentences):
        for j in range(6):
            token = vocab[(i * 6 + j) % len(vocab)]
            if punctuate and j == 5:
                token += "."
            words.append(WordTiming(word=token, start=t, end=t + 0.5))
            t += 0.5 + (0.25 if j < 5 else 1.0)
    return words


def seed_job(
    container: ServiceContainer,
    words: list[WordTiming],
    topics: list[tuple[str, float, float, str]] = TOPIC_SPANS,
) -> str:
    duration = words[-1].end
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=v2pipeline",
        status=JobStatus.BUILDING_TOPICS,
        video_duration_seconds=duration,
        video_name="V2Pipeline",
    )
    jid = job.job_id
    container.jobs.save_transcription_words(jid, words)
    blocks = []
    t, n = 0.0, 1
    while t < duration:
        end = min(t + 30.0, duration)
        blocks.append(SemanticBlock(block_id=f"b{n}", start=t, end=end, text=f"blok {n}"))
        t, n = end, n + 1
    container.jobs.save_semantic_blocks(jid, blocks)
    container.jobs.save_topic_segments(
        jid,
        [
            TopicSegment(
                topic_id=tid,
                start=a,
                end=b,
                block_ids=[bl.block_id for bl in blocks if bl.start < b and bl.end > a],
                topic_type=ttype,
            )
            for tid, a, b, ttype in topics
        ],
    )
    return jid


def good_answers(**overrides: Any) -> dict[str, Any]:
    base = {
        "premise": "konu kendi icinde tamamlanir",
        "missing_context": "",
        "understandable_alone": True,
        "has_payoff": True,
        "ends_complete": True,
        "depends_on_visuals": False,
        "is_non_content": False,
        "interest": 4,
        "title": "baslik",
    }
    base.update(overrides)
    return base


def default_brief_answer() -> dict[str, Any]:
    return {
        "language": "tr",
        "format_description": "tek konusmaci anlatiyor",
        "speakers": "bir konusmaci",
        "unit_definition": "bir konunun baslayip bittigi yer",
        "good_cut_criteria": ["kendi icinde tamam", "net bir sonuc"],
        "non_content": "reklam",
        "unit_seconds": {"min": 20, "typical": 60, "max": 120},
    }


def default_unit_marks(ids: list[str]) -> list[dict[str, str]]:
    """Mark the first sentence of the window and every sentence whose number is 1 modulo 12 (window independent)."""
    marks = [i for i in ids if int(i[1:]) % 12 == 1]
    if ids[0] not in marks:
        marks.insert(0, ids[0])
    return [{"start_sentence_id": i, "label": f"bolum {i}", "kind": "content"} for i in marks]


class FakeLLM:
    """Fake HTTP layer for the Ollama chat endpoint that answers per requested schema.

    Hooks (all optional) receive what the call needs and return the answer (dict) or a raw string:
    brief_map(body), brief(body), units(ids), refine_start(options, current), refine_end(options, current).
    """

    def __init__(
        self,
        container: ServiceContainer,
        *,
        scoring: Callable[[list[str]], Any] | None = None,
        brief_map: Callable[[dict[str, Any]], Any] | None = None,
        brief: Callable[[dict[str, Any]], Any] | None = None,
        units: Callable[[list[str]], Any] | None = None,
        refine_start: Callable[[list[str], str], Any] | None = None,
        refine_end: Callable[[list[str], str], Any] | None = None,
        unavailable: bool = False,
    ) -> None:
        self.scoring = scoring or (lambda ids: good_answers())
        self.brief_map = brief_map or (lambda body: {"summary": "konu anlatiliyor", "kind": "content"})
        self.brief = brief or (lambda body: default_brief_answer())
        self.units = units or (lambda ids: {"units": default_unit_marks(ids)})
        self.refine_start = refine_start or (lambda options, current: {"reason": "ok", "start_sentence_id": current})
        self.refine_end = refine_end or (lambda options, current: {"reason": "ok", "end_sentence_id": current})
        self.unavailable = unavailable
        self.bodies: list[dict[str, Any]] = []
        container.llm_http_fetcher = self._fetch

    async def _fetch(self, method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        if self.unavailable:
            return 404, {}
        if url.endswith("/api/tags") or url.endswith("/api/ps"):
            return 200, {"models": [{"name": MODEL}]}
        if url.endswith("/api/chat"):
            body = body or {}
            self.bodies.append(body)
            schema = body.get("format") or {}
            props = schema.get("properties") or {}
            if "spans" in props:
                ids = props["spans"]["items"]["properties"]["start_sentence_id"]["enum"]
                answer: Any = {
                    "spans": [
                        {"start_sentence_id": ids[0], "end_sentence_id": ids[7]},
                        {"start_sentence_id": ids[10], "end_sentence_id": ids[19]},
                    ]
                }
            elif "premise" in props:
                answer = self.scoring(cut_ids(body))
            elif "unit_seconds" in props:
                answer = self.brief(body)
            elif "kind" in props and "summary" in props:
                answer = self.brief_map(body)
            elif "units" in props:
                answer = self.units(props["units"]["items"]["properties"]["start_sentence_id"]["enum"])
            elif "start_sentence_id" in props and "reason" in props:
                answer = self.refine_start(props["start_sentence_id"]["enum"], current_border(body, "begins"))
            elif "end_sentence_id" in props and "reason" in props:
                answer = self.refine_end(props["end_sentence_id"]["enum"], current_border(body, "ends"))
            else:
                answer = {}
            content = answer if isinstance(answer, str) else json.dumps(answer)
            return 200, {"message": {"content": content}}
        return 404, {}

    def calls(self, key: str) -> list[dict[str, Any]]:
        return [b for b in self.bodies if key in ((b.get("format") or {}).get("properties") or {})]

    def refine_calls(self, field: str) -> list[dict[str, Any]]:
        return [b for b in self.calls(field) if "reason" in b["format"]["properties"]]


def user_text(body: dict[str, Any]) -> str:
    return next(m["content"] for m in body["messages"] if m["role"] == "user")


def system_text(body: dict[str, Any]) -> str:
    return next(m["content"] for m in body["messages"] if m["role"] == "system")


def current_border(body: dict[str, Any], verb: str) -> str:
    m = re.search(rf"The stretch {verb} now at sentence (s\d+)", user_text(body))
    assert m, "refine prompt without the current border"
    return m.group(1)


def cut_ids(body: dict[str, Any]) -> list[str]:
    block = re.search(r"<<<CUT>>>\n(.*?)\n<<<END CUT>>>", user_text(body), re.S)
    assert block, "scoring prompt without CUT block"
    return [line.split(" ", 1)[0].rstrip(":") for line in block.group(1).splitlines() if line.strip()]


def configure(container: ServiceContainer, **llm: Any) -> None:
    container.update_tool_configs({"llm": {"provider": "ollama", "model": MODEL, **llm}})


def load_artifact(container: ServiceContainer, jid: str, name: str) -> dict[str, Any]:
    return json.loads((container.jobs.job_dir_path(jid) / name).read_text(encoding="utf-8"))


# --- end to end ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_v2_end_to_end_turkish_punctuated(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container)
    configure(container, analysis_v2=P2, analysis_pipeline="v2")

    result = await analyze_job(jid, container=container)

    assert container.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL
    for name in ("sentences.json", "video.brief.json", "units.json", "candidates.scored.json", "cuts.suggested.json"):
        assert (container.jobs.job_dir_path(jid) / name).exists(), name
    assert not list(container.jobs.job_dir_path(jid).glob("*.tmp"))

    cuts = container.jobs.load_cuts(jid)  # validates against the Cut model
    assert cuts and [c.cut_id for c in cuts] == [f"c{i}" for i in range(1, len(cuts) + 1)]
    assert all(isinstance(c, Cut) and c.pipeline == "v2" for c in cuts)
    assert [c.cut_id for c in result["cuts"]] == [c.cut_id for c in cuts]
    summary = json.loads(result["raw_response"])
    assert summary["cuts"] == len(cuts) and summary["pipeline"] == "v2"
    assert summary["outcomes"].get("selected") == len(cuts)

    # ad_span topic became a non_content unit and never reached a prompt as CUT or a cut.
    units = load_artifact(container, jid, "units.json")["units"]
    assert [u["kind"] for u in units] == ["content", "non_content", "content", "content"]
    sentences = load_artifact(container, jid, "sentences.json")["sentences"]
    ad_ids = {
        s["sentence_id"]
        for s in sentences
        if units[1]["start"] <= s["start"] and s["end"] <= units[1]["end"]
    }
    assert ad_ids
    assert all(set(cut_ids(b)) <= {x["sentence_id"] for x in sentences} for b in fake.calls("premise"))
    for body in fake.calls("premise"):
        assert not (set(cut_ids(body)) & ad_ids)
    for cut in cuts:
        assert not (set(cut.sentence_ids) & ad_ids)

    # Before the snap every candidate starts and ends on a sentence boundary.
    starts = {s["start"] for s in sentences}
    ends = {s["end"] for s in sentences}
    scored = load_artifact(container, jid, "candidates.scored.json")
    assert scored["discarded_units"] == []
    assert scored["seed"] == 42 and scored["model"] == MODEL and scored["prompts_version"]
    assert scored["prompt_hashes"]["all"]
    for cand in scored["candidates"]:
        assert cand["start"] in starts and cand["end"] in ends
        assert cand["answers"] is not None and cand["outcome"] != "pending"
    selected = [c for c in scored["candidates"] if c["outcome"] == "selected"]
    assert sorted(c["cut_id"] for c in selected) == sorted(c.cut_id for c in cuts)
    # The long unit went through the sub-span call: 2 spans from t4 plus the two content unit candidates (the ad unit is skipped).
    assert sorted(c["origin"] for c in scored["candidates"]) == ["subspan", "subspan", "unit", "unit"]
    for cut in cuts:
        assert cut.block_ids


@pytest.mark.asyncio
async def test_subspan_schema_enum_equals_unit_sentence_ids(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container)
    configure(container, analysis_v2=P2, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    sentences = load_artifact(container, jid, "sentences.json")["sentences"]
    units = load_artifact(container, jid, "units.json")["units"]
    long_unit = units[3]
    a = next(i for i, s in enumerate(sentences) if s["sentence_id"] == long_unit["start_sentence_id"])
    b = next(i for i, s in enumerate(sentences) if s["sentence_id"] == long_unit["end_sentence_id"])
    expected = [s["sentence_id"] for s in sentences[a : b + 1]]

    calls = fake.calls("spans")
    assert len(calls) == 1
    item_props = calls[0]["format"]["properties"]["spans"]["items"]["properties"]
    assert item_props["start_sentence_id"]["enum"] == expected
    assert item_props["end_sentence_id"]["enum"] == expected


@pytest.mark.asyncio
async def test_scoring_system_prompt_identical_across_calls(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container)
    configure(container, analysis_v2=P2, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    calls = fake.calls("premise")
    assert len(calls) >= 4
    systems = {system_text(b) for b in calls}
    assert len(systems) == 1
    assert next(iter(systems)).startswith(SCORING_SYSTEM_PROMPT)
    # The variable part is the user message and differs between candidates.
    assert len({user_text(b) for b in calls}) == len(calls)
    # Schema enum for interest is the closed 1..5 range on every call.
    for b in calls:
        assert b["format"]["properties"]["interest"]["enum"] == [1, 2, 3, 4, 5]


@pytest.mark.asyncio
async def test_v2_without_punctuation_other_language(container: ServiceContainer) -> None:
    words = make_words(INDONESIAN, punctuate=False)
    jid = seed_job(container, words)
    FakeLLM(container)
    configure(container, analysis_v2=P2, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    s0 = load_artifact(container, jid, "sentences.json")
    assert s0["source"] == "words" and s0["low_punctuation"] is True
    assert len(s0["sentences"]) == N_SENTENCES
    cuts = container.jobs.load_cuts(jid)
    assert cuts
    ids = {s["sentence_id"] for s in s0["sentences"]}
    assert all(set(c.sentence_ids) <= ids for c in cuts)
    assert container.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL


@pytest.mark.asyncio
async def test_progress_messages_published_inside_analyzing(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container)
    configure(container, analysis_v2=P2, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    logs = "\n".join(container.runtime.get_task_logs(jid, "analysis"))
    assert "S0:" in logs and "S3:" in logs and "S6:" in logs
    assert re.search(r"S4: pontuando candidato 1/\d+", logs)
    assert re.search(r"S4: pontuando candidato 4/4", logs)


# --- dispatch -----------------------------------------------------------------------------

V2_ARTIFACTS = ("sentences.json", "video.brief.json", "units.json", "candidates.scored.json")


async def _run_v1_once(container: ServiceContainer, choice: str | None) -> tuple[str, list[dict[str, Any]], list[dict[str, Any]]]:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container, scoring=lambda ids: pytest.fail("v2 scoring must not run"))
    if choice is None:
        configure(container)
    else:
        configure(container, analysis_pipeline=choice)
    result = await analyze_job(jid, container=container)
    assert container.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL
    for name in V2_ARTIFACTS:
        assert not (container.jobs.job_dir_path(jid) / name).exists(), name
    cuts = [c.model_dump(mode="json") for c in container.jobs.load_cuts(jid)]
    return result["raw_response"], cuts, fake.bodies


@pytest.mark.asyncio
async def test_v1_path_runs_when_key_absent_or_v1(container: ServiceContainer) -> None:
    raw_a, cuts_a, bodies_a = await _run_v1_once(container, None)
    raw_b, cuts_b, bodies_b = await _run_v1_once(container, "v1")
    assert '"pipeline": "v2"' not in raw_a and '"pipeline": "v2"' not in raw_b
    # Absent key and "v1" must be indistinguishable: same cuts, same LLM requests.
    assert cuts_a == cuts_b
    assert bodies_a == bodies_b
    assert raw_a == raw_b


@pytest.mark.asyncio
async def test_unknown_pipeline_value_warns_and_uses_v1(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container, scoring=lambda ids: pytest.fail("v2 scoring must not run"))
    configure(container, analysis_pipeline="v9")

    await analyze_job(jid, container=container)

    logs = "\n".join(container.runtime.get_task_logs(jid, "analysis"))
    assert "WARNING" in logs and "v9" in logs
    for name in V2_ARTIFACTS:
        assert not (container.jobs.job_dir_path(jid) / name).exists()


# --- stage toggles and the full default pipeline -----------------------------------------


def _log_text(container: ServiceContainer, jid: str) -> str:
    return "\n".join(container.runtime.get_task_logs(jid, "analysis"))


def _scored(container: ServiceContainer, jid: str) -> dict[str, Any]:
    return load_artifact(container, jid, "candidates.scored.json")


DEFAULT_TOGGLES = {"brief": "llm", "units": "llm", "refine_boundaries": True, "topic_embeddings": True}


@pytest.mark.asyncio
async def test_full_default_pipeline_runs_every_stage_and_writes_final_artifacts(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container)
    configure(container, analysis_pipeline="v2")  # no analysis_v2 key: every stage on its default

    result = await analyze_job(jid, container=container)

    assert container.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL
    assert len(fake.calls("unit_seconds")) == 1  # S1 reduce
    assert len(fake.calls("summary")) == 1  # S1 map: one chunk
    assert len(fake.calls("units")) == 1  # S2: 68 sentences fit one window
    assert fake.refine_calls("start_sentence_id") and fake.refine_calls("end_sentence_id")  # S5
    assert not list(container.jobs.job_dir_path(jid).glob("*.tmp"))

    # video.brief.json: brief + outline in the final shape, not marked provisional.
    doc = load_artifact(container, jid, "video.brief.json")
    assert set(doc) == {"version", "brief", "outline"} and doc["version"] == 1
    assert doc["brief"]["format_description"] == "tek konusmaci anlatiyor"
    assert doc["brief"]["unit_seconds"] == {"min": 20.0, "typical": 60.0, "max": 120.0}
    assert len(doc["outline"]) == 1
    entry = doc["outline"][0]
    assert set(entry) == {"start_sentence_id", "end_sentence_id", "start", "end", "summary", "kind"}
    assert (entry["start_sentence_id"], entry["end_sentence_id"], entry["start"]) == ("s1", "s68", 0.0)
    assert entry["summary"] == "konu anlatiliyor" and entry["kind"] == "content"

    # units.json: units from the LLM windows, final shape.
    units_doc = load_artifact(container, jid, "units.json")
    assert set(units_doc) == {"version", "units"}
    units = units_doc["units"]
    assert [u["start_sentence_id"] for u in units] == ["s1", "s13", "s25", "s37", "s49", "s61"]
    for u in units:
        assert set(u) == {"unit_id", "start_sentence_id", "end_sentence_id", "start", "end", "label", "kind"}
    assert units[0]["label"] == "bolum s1" and units[-1]["end_sentence_id"] == "s68"

    # candidates.scored.json records the toggles and the S1/S2 meta.
    scored = _scored(container, jid)
    assert scored["stage_toggles"] == DEFAULT_TOGGLES
    assert scored["s1_meta"] == {"mode": "map_reduce", "map_calls": 1, "failed_map_chunks": 0, "fallback": False}
    assert scored["s2_meta"] == {"windows": 1, "window_size": 80, "fallback_windows": 0, "split_units": 0}
    assert scored["s5_meta"]["preselected"] >= 1
    assert scored["prompts_version"] == "v2-draft-3"
    assert result["cuts"] and json.loads(result["raw_response"])["units"] == 6


@pytest.mark.asyncio
async def test_progress_messages_cover_s1_s2_s5(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container)
    configure(container, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    logs = _log_text(container, jid)
    assert "S1: 1/2" in logs and "S1: 2/2" in logs  # one map chunk + the reduce
    assert "S2: 1/1" in logs
    assert re.search(r"S5: 1/\d+", logs)
    order = [logs.index(f"] {tag}:") for tag in ("S1", "S2", "S3", "S4", "S5", "S6")]
    assert order == sorted(order)


@pytest.mark.asyncio
async def test_toggle_brief_provisional(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container)
    configure(container, analysis_pipeline="v2", analysis_v2={"brief": "provisional"})
    await analyze_job(jid, container=container)

    assert fake.calls("unit_seconds") == [] and fake.calls("summary") == []
    assert fake.calls("units")  # units stay on the LLM default
    doc = load_artifact(container, jid, "video.brief.json")
    assert doc["provisional"] is True and doc["outline"] == [] and doc["brief"]["format_description"] == ""
    scored = _scored(container, jid)
    assert scored["s1_meta"] is None and scored["stage_toggles"]["brief"] == "provisional"
    assert "provisional" not in load_artifact(container, jid, "units.json")


@pytest.mark.asyncio
async def test_toggle_units_topics(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container)
    configure(container, analysis_pipeline="v2", analysis_v2={"units": "topics"})
    await analyze_job(jid, container=container)

    assert fake.calls("units") == []
    assert fake.calls("unit_seconds")  # brief stays on the LLM default
    doc = load_artifact(container, jid, "units.json")
    assert doc["provisional"] is True
    assert [u["kind"] for u in doc["units"]] == ["content", "non_content", "content", "content"]
    scored = _scored(container, jid)
    assert scored["s2_meta"] is None and scored["stage_toggles"]["units"] == "topics"
    assert load_artifact(container, jid, "video.brief.json")["outline"]


@pytest.mark.asyncio
async def test_toggle_refine_boundaries_false_leaves_candidate_borders_untouched(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    # Refine hooks that would move every border if they were ever called.
    fake = FakeLLM(
        container,
        refine_start=lambda options, current: {"reason": "x", "start_sentence_id": options[0]},
        refine_end=lambda options, current: {"reason": "x", "end_sentence_id": options[-1]},
    )
    configure(container, analysis_pipeline="v2", analysis_v2={"refine_boundaries": False})
    await analyze_job(jid, container=container)

    assert fake.refine_calls("start_sentence_id") == [] and fake.refine_calls("end_sentence_id") == []
    scored = _scored(container, jid)
    assert scored["s5_meta"] is None and scored["stage_toggles"]["refine_boundaries"] is False
    units = {u["start_sentence_id"]: u for u in load_artifact(container, jid, "units.json")["units"]}
    assert scored["candidates"]
    for cand in scored["candidates"]:
        assert "refined_from" not in cand and cand["origin"] in ("unit", "subspan")
        if cand["origin"] == "unit":
            assert cand["start_sentence_id"] in units
            assert cand["end_sentence_id"] == units[cand["start_sentence_id"]]["end_sentence_id"]


@pytest.mark.asyncio
async def test_refine_boundaries_moves_a_border_and_rescores(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))

    def earlier(options: list[str], current: str) -> Any:
        i = options.index(current)
        return {"reason": "precisa do contexto", "start_sentence_id": options[i - 2] if i >= 2 else current}

    fake = FakeLLM(container, refine_start=earlier)
    configure(container, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    scored = _scored(container, jid)
    refined = [c for c in scored["candidates"] if c["origin"] == "refined"]
    assert refined and scored["s5_meta"]["refined"] == len(refined)
    sentences = {s["sentence_id"]: s for s in load_artifact(container, jid, "sentences.json")["sentences"]}
    for cand in refined:
        assert cand["refined_from"]["start_sentence_id"] != cand["start_sentence_id"]
        assert cand["start"] == sentences[cand["start_sentence_id"]]["start"]
        assert cand["refine_start_reason"] == "precisa do contexto"
        assert cand["gates_ok"] and cand["answers"] is not None
    # Every candidate was scored once by S4 and every refined one once more by the S5 rescore.
    assert len(fake.calls("premise")) == len(scored["candidates"]) + len(refined)
    assert container.jobs.load_cuts(jid)


@pytest.mark.asyncio
async def test_topic_embeddings_toggle_reaches_topic_builder(container: ServiceContainer, monkeypatch) -> None:
    from app.domain.analysis.v2 import pipeline as pipeline_mod

    seen: list[dict[str, Any]] = []

    async def fake_build_topics(job_id: str, **kwargs: Any) -> list[TopicSegment]:
        seen.append(kwargs)
        topics = [TopicSegment(topic_id="t1", start=0.0, end=357.0)]
        container.jobs.save_topic_segments(job_id, topics)
        return topics

    monkeypatch.setattr(pipeline_mod, "build_topic_segments", fake_build_topics)
    for value, expected in ((None, True), (False, False), (True, True)):
        jid = seed_job(container, make_words(TURKISH, punctuate=True))
        container.jobs.topic_segments_path(jid).unlink()
        FakeLLM(container)
        cfg = {} if value is None else {"analysis_v2": {"topic_embeddings": value}}
        configure(container, analysis_pipeline="v2", **cfg)
        await analyze_job(jid, container=container)
        assert seen[-1]["use_embeddings"] is expected
        assert container.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL
        assert _scored(container, jid)["stage_toggles"]["topic_embeddings"] is expected


@pytest.mark.asyncio
async def test_unknown_toggle_values_warn_and_use_defaults(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container)
    configure(
        container,
        analysis_pipeline="v2",
        analysis_v2={"brief": "bogus", "units": 7, "refine_boundaries": "yes", "topic_embeddings": 1, "mystery": True},
    )
    await analyze_job(jid, container=container)

    logs = _log_text(container, jid)
    for needle in (
        "analysis_v2.brief='bogus'",
        "analysis_v2.units=7",
        "analysis_v2.refine_boundaries='yes'",
        "analysis_v2.topic_embeddings=1",
        "analysis_v2.mystery",
    ):
        assert needle in logs, needle
    assert logs.count("WARNING") >= 5
    assert _scored(container, jid)["stage_toggles"] == DEFAULT_TOGGLES
    assert fake.calls("unit_seconds") and fake.calls("units") and fake.refine_calls("start_sentence_id")


def test_resolve_stage_toggles_unit() -> None:
    from app.domain.analysis.v2.pipeline import resolve_stage_toggles

    warnings: list[str] = []
    assert resolve_stage_toggles(None, warnings.append) == DEFAULT_TOGGLES and warnings == []
    assert resolve_stage_toggles({}, warnings.append) == DEFAULT_TOGGLES and warnings == []
    explicit = {"brief": "provisional", "units": "topics", "refine_boundaries": False, "topic_embeddings": False}
    assert resolve_stage_toggles(explicit, warnings.append) == explicit
    assert warnings == []
    # 0 and 1 are not booleans; a non-object is ignored as a whole.
    assert resolve_stage_toggles({"refine_boundaries": 0, "topic_embeddings": 1}, warnings.append) == DEFAULT_TOGGLES
    assert len(warnings) == 2
    assert resolve_stage_toggles("x", warnings.append) == DEFAULT_TOGGLES and len(warnings) == 3
    assert resolve_stage_toggles({"brief": "bogus"}) == DEFAULT_TOGGLES  # no warn callable is fine


@pytest.mark.asyncio
async def test_s1_reduce_failure_falls_back_to_provisional_brief_and_still_yields_cuts(
    container: ServiceContainer,
) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container, brief=lambda body: "this is not json")
    configure(container, analysis_pipeline="v2")
    result = await analyze_job(jid, container=container)

    assert result["cuts"] and container.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL
    doc = load_artifact(container, jid, "video.brief.json")
    assert doc["provisional"] is True and doc["brief"]["format_description"] == ""
    assert len(doc["outline"]) == 1 and doc["outline"][0]["summary"] == "konu anlatiliyor"  # the outline built so far
    scored = _scored(container, jid)
    assert scored["s1_meta"]["fallback"] is True and scored["s1_meta"]["map_calls"] == 1
    assert "S1:" in _log_text(container, jid) and "WARNING" in _log_text(container, jid)
    assert fake.calls("units")  # S2 still ran, with the provisional brief
    assert load_artifact(container, jid, "units.json")["units"]


@pytest.mark.asyncio
async def test_s2_window_failure_uses_topic_units_for_that_window_only(container: ServiceContainer) -> None:
    n = 100  # two windows: sentences 1-80 and 66-100
    topics = [("t1", 0.0, 420.0, "content"), ("t2", 420.0, 525.0, "ad_span")]
    jid = seed_job(container, make_words(TURKISH, punctuate=True, n_sentences=n), topics)
    fake = FakeLLM(
        container,
        units=lambda ids: "garbage" if ids[0] == "s66" else {"units": default_unit_marks(ids)},
    )
    configure(container, analysis_pipeline="v2", analysis_v2={"refine_boundaries": False})
    await analyze_job(jid, container=container)

    scored = _scored(container, jid)
    assert scored["s2_meta"] == {"windows": 2, "window_size": 80, "fallback_windows": 1, "split_units": 0}
    assert "S2: window 2/2" in _log_text(container, jid)
    units = load_artifact(container, jid, "units.json")["units"]
    # Window 1 came from the LLM, window 2 from the topic units (the ad topic starts at s81).
    assert units[0]["label"] == "bolum s1"
    tail = [u for u in units if u["kind"] == "non_content"]
    assert [(u["start_sentence_id"], u["label"]) for u in tail] == [("s81", "t2")]
    assert all(u["label"].startswith("bolum") for u in units if u["kind"] == "content")
    assert [u["unit_id"] for u in units] == [f"u{i}" for i in range(1, len(units) + 1)]
    assert units[-1]["end_sentence_id"] == f"s{n}"
    assert len(fake.calls("units")) >= 2
    for cut in container.jobs.load_cuts(jid):
        assert all(int(sid[1:]) <= 80 for sid in cut.sentence_ids)


@pytest.mark.asyncio
async def test_multi_chunk_video_runs_map_per_chunk(container: ServiceContainer) -> None:
    n = 300  # about 15k characters of sentence lines: several map chunks and five S2 windows
    topics = [("t1", 0.0, n * SENTENCE_PERIOD, "content")]
    jid = seed_job(container, make_words(TURKISH, punctuate=True, n_sentences=n), topics)
    fake = FakeLLM(container)
    configure(container, analysis_pipeline="v2", analysis_v2={"refine_boundaries": False})
    await analyze_job(jid, container=container)

    scored = _scored(container, jid)
    maps = len(fake.calls("summary"))
    assert maps >= 2 and scored["s1_meta"] == {
        "mode": "map_reduce",
        "map_calls": maps,
        "failed_map_chunks": 0,
        "fallback": False,
    }
    assert len(load_artifact(container, jid, "video.brief.json")["outline"]) == maps
    assert scored["s2_meta"]["windows"] == len(fake.calls("units")) == 5
    logs = _log_text(container, jid)
    assert f"S1: {maps + 1}/{maps + 1}" in logs and "S2: 5/5" in logs


@pytest.mark.asyncio
async def test_short_video_uses_a_single_brief_call(container: ServiceContainer) -> None:
    n = 20  # 105 s: short video
    jid = seed_job(
        container,
        make_words(TURKISH, punctuate=True, n_sentences=n),
        [("t1", 0.0, n * SENTENCE_PERIOD, "content")],
    )
    fake = FakeLLM(container)
    configure(container, analysis_pipeline="v2", analysis_v2={"refine_boundaries": False})
    await analyze_job(jid, container=container)

    assert len(fake.calls("unit_seconds")) == 1 and fake.calls("summary") == []
    assert _scored(container, jid)["s1_meta"] == {"mode": "short", "map_calls": 0, "fallback": False}
    assert len(load_artifact(container, jid, "video.brief.json")["outline"]) == 1


@pytest.mark.asyncio
async def test_full_pipeline_non_pt_en_without_punctuation(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(INDONESIAN, punctuate=False))
    fake = FakeLLM(container)
    configure(container, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    s0 = load_artifact(container, jid, "sentences.json")
    assert s0["low_punctuation"] is True and len(s0["sentences"]) == N_SENTENCES
    assert container.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL
    assert fake.calls("unit_seconds") and fake.calls("units") and fake.refine_calls("end_sentence_id")
    assert any("nasi goreng" in user_text(b) for b in fake.calls("summary"))
    cuts = container.jobs.load_cuts(jid)
    assert cuts
    ids = {s["sentence_id"] for s in s0["sentences"]}
    assert all(set(c.sentence_ids) <= ids for c in cuts)


@pytest.mark.asyncio
async def test_every_llm_schema_enum_is_the_valid_ids_of_the_call(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container)
    configure(container, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    sentence_ids = [s["sentence_id"] for s in load_artifact(container, jid, "sentences.json")["sentences"]]
    (units_call,) = fake.calls("units")
    enum = units_call["format"]["properties"]["units"]["items"]["properties"]["start_sentence_id"]["enum"]
    assert enum == sentence_ids
    for field in ("start_sentence_id", "end_sentence_id"):
        bodies = fake.refine_calls(field)
        assert bodies
        for body in bodies:
            enum = body["format"]["properties"][field]["enum"]
            options_block = user_text(body).split("<<<OPTIONS>>>")[1].split("<<<END OPTIONS>>>")[0]
            shown = re.findall(r"^(s\d+)", options_block, re.M)
            assert enum == shown and len(enum) >= 2


@pytest.mark.asyncio
async def test_llm_unavailable_in_s1_ends_in_error(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container, unavailable=True)
    configure(container, analysis_pipeline="v2")
    with pytest.raises(Exception):
        await analyze_job(jid, container=container)
    assert container.jobs.load_job(jid).status == JobStatus.ERROR
    assert not (container.jobs.job_dir_path(jid) / "candidates.scored.json").exists()


def test_v2_modules_do_not_import_v1_segmentation_beyond_compatibility() -> None:
    import ast
    from pathlib import Path

    from app.domain.analysis import v2

    for path in sorted(Path(v2.__file__).parent.glob("*.py")):
        imported: dict[str, set[str]] = {}
        for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
            if isinstance(node, ast.ImportFrom) and node.module:
                imported.setdefault(node.module, set()).update(a.name for a in node.names)
            elif isinstance(node, ast.Import):
                for a in node.names:
                    imported.setdefault(a.name, set())
        hits = {
            m: names
            for m, names in imported.items()
            if any(f in m for f in ("semantic_blocks", "topic_segmentation", "lookaround", "segmentation"))
        }
        if path.name == "pipeline.py":
            # Phase-2 compatibility: the canonical blocks/topics artifacts are still built by the v1 builders.
            assert hits == {
                "app.domain.segmentation.semantic_blocks": {"build_semantic_blocks"},
                "app.domain.segmentation.topic_segmentation": {"build_topic_segments"},
            }
        elif path.name == "selection.py":
            assert hits == {"app.domain.analysis.lookaround": {"compute_temporal_iou"}}
        else:
            assert hits == {}, path.name


def test_redoing_the_transcription_removes_the_four_v2_artifacts(container: ServiceContainer) -> None:
    job = container.jobs.create_job("https://www.youtube.com/watch?v=redo", status=JobStatus.WAITING_APPROVAL)
    jid = job.job_id
    container.jobs.save_sentences(jid, {"version": 1, "sentences": []})
    container.jobs.save_video_brief(jid, {"version": 1, "brief": {}, "outline": []})
    container.jobs.save_units(jid, {"version": 1, "units": []})
    container.jobs.save_scored_candidates(jid, {"version": 1, "candidates": []})
    container.jobs.save_cuts(jid, [])
    paths = [
        container.jobs.sentences_path(jid),
        container.jobs.video_brief_path(jid),
        container.jobs.units_path(jid),
        container.jobs.scored_candidates_path(jid),
        container.jobs.cuts_path(jid),
    ]
    assert all(p.exists() for p in paths)

    container.jobs.invalidate_downstream_from_transcription(jid, remove_analysis_artifacts=True)

    assert not any(p.exists() for p in paths)
    assert container.jobs.load_job(jid).status == JobStatus.DOWNLOADED


# --- failures and selection ---------------------------------------------------------------


@pytest.mark.asyncio
async def test_every_scoring_call_failing_completes_with_zero_cuts(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container, scoring=lambda ids: "this is not json")
    configure(container, analysis_v2=P2, analysis_pipeline="v2")

    result = await analyze_job(jid, container=container)

    assert result["cuts"] == []
    assert container.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL
    assert container.jobs.load_cuts(jid) == []
    scored = load_artifact(container, jid, "candidates.scored.json")["candidates"]
    assert scored and {c["outcome"] for c in scored} == {"error"}
    assert all(c["outcome_reason"] for c in scored)


@pytest.mark.asyncio
async def test_one_failed_candidate_does_not_stop_the_others(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))

    def scoring(ids: list[str]) -> Any:
        # Keyed by candidate (the adapter retries a bad answer once with the same prompt).
        return "garbage" if ids[0] == "s1" else good_answers()

    FakeLLM(container, scoring=scoring)
    configure(container, analysis_v2=P2, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    scored = load_artifact(container, jid, "candidates.scored.json")["candidates"]
    outcomes = sorted(c["outcome"] for c in scored)
    assert outcomes.count("error") == 1 and outcomes.count("selected") == len(scored) - 1


@pytest.mark.asyncio
async def test_d14_fallback_when_nothing_reaches_min_interest(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container, scoring=lambda ids: good_answers(interest=3))
    configure(container, analysis_v2=P2, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    cuts = container.jobs.load_cuts(jid)
    assert 1 <= len(cuts) <= 3
    assert all(c.status == "pending" for c in cuts)
    logs = "\n".join(container.runtime.get_task_logs(jid, "analysis"))
    assert "WARNING" in logs and "No candidate reached interest 4" in logs


@pytest.mark.asyncio
async def test_never_fabricates_cuts_when_everything_is_weak(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container, scoring=lambda ids: good_answers(interest=2))
    configure(container, analysis_v2=P2, analysis_pipeline="v2")
    result = await analyze_job(jid, container=container)

    assert result["cuts"] == [] and container.jobs.load_cuts(jid) == []
    scored = load_artifact(container, jid, "candidates.scored.json")["candidates"]
    assert {c["outcome"] for c in scored} == {"below_min_interest"}


@pytest.mark.asyncio
async def test_min_interest_and_max_cuts_come_from_config(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container, scoring=lambda ids: good_answers(interest=3))
    configure(container, analysis_v2=P2, analysis_pipeline="v2", analysis_min_interest=3, max_suggested_cuts=2)
    await analyze_job(jid, container=container)

    assert len(container.jobs.load_cuts(jid)) == 2
    scored = load_artifact(container, jid, "candidates.scored.json")
    assert scored["min_interest"] == 3
    assert sorted(c["outcome"] for c in scored["candidates"]).count("over_cap") >= 1


@pytest.mark.asyncio
async def test_llm_unavailable_ends_in_error_and_keeps_existing_cuts(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    previous = [Cut(cut_id="c1", start=1.0, end=40.0, title="anterior", status="approved")]
    container.jobs.save_cuts(jid, previous)
    before = container.jobs.cuts_path(jid).read_bytes()
    FakeLLM(container, unavailable=True)
    configure(container, analysis_v2=P2, analysis_pipeline="v2")

    with pytest.raises(Exception):
        await analyze_job(jid, container=container)

    assert container.jobs.load_job(jid).status == JobStatus.ERROR
    assert container.jobs.cuts_path(jid).read_bytes() == before
    assert not (container.jobs.job_dir_path(jid) / "candidates.scored.json").exists()


@pytest.mark.asyncio
async def test_empty_transcription_yields_no_cuts_without_llm(container: ServiceContainer) -> None:
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=empty", status=JobStatus.BUILDING_TOPICS, video_duration_seconds=60.0
    )
    container.jobs.save_semantic_blocks(job.job_id, [SemanticBlock(block_id="b1", start=0, end=60, text="x")])
    container.jobs.save_topic_segments(job.job_id, [TopicSegment(topic_id="t1", start=0, end=60)])
    fake = FakeLLM(container)
    configure(container, analysis_v2=P2, analysis_pipeline="v2")

    result = await analyze_job(job.job_id, container=container)

    assert result["cuts"] == [] and fake.bodies == []
    assert container.jobs.load_job(job.job_id).status == JobStatus.WAITING_APPROVAL


# --- provisional stand-ins ----------------------------------------------------------------


def _sentences(n: int = 20) -> list[Sentence]:
    return build_sentences(make_words(TURKISH, punctuate=True, n_sentences=n))[0]


def _assert_cover(units: list[Any], sentences: list[Sentence]) -> None:
    ids = [s.sentence_id for s in sentences]
    pos = {sid: i for i, sid in enumerate(ids)}
    expected = 0
    for u in units:
        assert pos[u.start_sentence_id] == expected
        assert pos[u.end_sentence_id] >= expected
        expected = pos[u.end_sentence_id] + 1
    assert expected == len(ids)
    assert [u.unit_id for u in units] == [f"u{i}" for i in range(1, len(units) + 1)]


def test_provisional_brief_uses_default_unit_seconds_and_empty_text() -> None:
    b = provisional_brief()
    assert (b.unit_seconds.min, b.unit_seconds.typical, b.unit_seconds.max) == (20.0, 60.0, 120.0)
    assert b.format_description == b.non_content == b.unit_definition == ""
    assert b.good_cut_criteria == []


def test_units_cover_sentences_when_topic_boundary_falls_inside_a_sentence() -> None:
    sentences = _sentences(20)
    mid_sentence = (sentences[5].start + sentences[5].end) / 2
    topics = [
        TopicSegment(topic_id="t1", start=0.0, end=mid_sentence),
        TopicSegment(topic_id="t2", start=mid_sentence, end=sentences[-1].end, topic_type="ad_span"),
    ]
    units = units_from_topics(topics, sentences)
    _assert_cover(units, sentences)
    assert [u.kind for u in units] == ["content", "non_content"]
    assert units[0].start == sentences[0].start and units[-1].end == sentences[-1].end


def test_units_cover_sentences_when_topics_do_not_cover_everything_or_overlap() -> None:
    sentences = _sentences(20)
    topics = [
        TopicSegment(topic_id="t2", start=sentences[8].start, end=sentences[12].end, topic_type="ad_span"),
        TopicSegment(topic_id="t1", start=sentences[3].start, end=sentences[9].end),  # unsorted + overlapping t2
    ]
    units = units_from_topics(topics, sentences)
    _assert_cover(units, sentences)
    assert units[0].kind == "content" and units[0].label == ""  # before every topic
    assert units[-1].kind == "content"  # after every topic
    assert any(u.kind == "non_content" for u in units)


def test_units_without_topics_is_one_content_unit() -> None:
    sentences = _sentences(10)
    units = units_from_topics([], sentences)
    _assert_cover(units, sentences)
    assert len(units) == 1 and units[0].kind == "content"
    assert units_from_topics([], []) == []


# --- config and evals ---------------------------------------------------------------------


def test_normalize_llm_config_preserves_new_keys_and_does_not_invent_them() -> None:
    plain = tool_configs.normalize_llm_config({})
    for key in ("analysis_pipeline", "analysis_min_interest", "analysis_v2"):
        assert key not in plain

    kept = tool_configs.normalize_llm_config(
        {"analysis_pipeline": "v2", "analysis_min_interest": 3, "analysis_v2": {"brief": "provisional"}}
    )
    assert kept["analysis_pipeline"] == "v2"
    assert kept["analysis_min_interest"] == 3
    assert kept["analysis_v2"] == {"brief": "provisional"}

    junk = tool_configs.normalize_llm_config(
        {"analysis_pipeline": 2, "analysis_min_interest": True, "analysis_v2": "x"}
    )
    for key in ("analysis_pipeline", "analysis_min_interest", "analysis_v2"):
        assert key not in junk


def test_evals_report_reference_sentences_come_from_v2_s0(tmp_path, monkeypatch) -> None:
    from evals import report as rep

    words = make_words(INDONESIAN, punctuate=False, n_sentences=10)
    vid = tmp_path / "vid"
    vid.mkdir()
    (vid / "transcription.words.json").write_text(json.dumps([w.model_dump() for w in words]), encoding="utf-8")
    # Segments disagree on purpose: they must be ignored while words exist.
    (vid / "transcription.segments.json").write_text(
        json.dumps([{"start": 0, "end": 50, "text": "a"}]), encoding="utf-8"
    )
    monkeypatch.setattr(rep, "corpus_dir", lambda slug, root=None: tmp_path / slug)

    starts, ends, spoken = rep._reference_sentences("vid")
    expected, _meta = build_sentences(words)
    assert starts == [s.start for s in expected] and ends == [s.end for s in expected]
    assert len(starts) == 10 and spoken == pytest.approx(sum(s.end - s.start for s in expected))


def test_evals_report_reference_sentences_fall_back_to_segments(tmp_path, monkeypatch) -> None:
    from evals import report as rep

    vid = tmp_path / "vid"
    vid.mkdir()
    (vid / "transcription.segments.json").write_text(
        json.dumps([{"start": 0, "end": 10, "text": "a"}, {"start": 10, "end": 20, "text": "b"}]),
        encoding="utf-8",
    )
    monkeypatch.setattr(rep, "corpus_dir", lambda slug, root=None: tmp_path / slug)
    starts, ends, spoken = rep._reference_sentences("vid")
    assert starts == [0.0, 10.0] and ends == [10.0, 20.0] and spoken == 20.0
    assert rep._reference_sentences("missing") == ([], [], 0.0)


@pytest.mark.asyncio
async def test_s1_result_reaches_s2_s3_and_s4(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    brief_answer = {
        **default_brief_answer(),
        "format_description": "UNIQUEFORMAT",
        "unit_definition": "UNIQUEDEF",
        "unit_seconds": {"min": 30, "typical": 50, "max": 90},
    }
    fake = FakeLLM(
        container,
        brief=lambda body: brief_answer,
        brief_map=lambda body: {"summary": "UNIQUESUMMARY", "kind": "content"},
    )
    configure(container, analysis_pipeline="v2")
    await analyze_job(jid, container=container)

    assert fake.calls("units"), "S2 never ran"
    for body in fake.calls("units"):
        text = user_text(body)
        assert "UNIQUEFORMAT" in text and "UNIQUEDEF" in text and "UNIQUESUMMARY" in text
    for body in fake.calls("premise"):
        assert "UNIQUEFORMAT" in system_text(body)
    scored = _scored(container, jid)
    assert scored["candidates"]
    for cand in scored["candidates"]:
        assert cand["end"] - cand["start"] <= 90.0 + 1e-6  # the brief's max, not the provisional one
    assert scored["s5_meta"]["fallbacks"] >= 0 and "outcomes" in scored["s5_meta"]


@pytest.mark.asyncio
async def test_no_topics_means_s2_falls_back_to_typical_duration_units(
    container: ServiceContainer, monkeypatch
) -> None:
    from app.domain.analysis.v2 import pipeline as pipeline_mod

    async def no_topics(job_id: str, **kwargs: Any) -> list[TopicSegment]:
        return []

    monkeypatch.setattr(pipeline_mod, "build_topic_segments", no_topics)
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    container.jobs.topic_segments_path(jid).unlink()
    FakeLLM(container, units=lambda ids: "garbage")
    configure(container, analysis_pipeline="v2", analysis_v2={"refine_boundaries": False})
    await analyze_job(jid, container=container)
    scored = _scored(container, jid)
    assert scored["s2_meta"]["fallback_windows"] == scored["s2_meta"]["windows"] >= 1
    units = load_artifact(container, jid, "units.json")["units"]
    assert len(units) > 1  # typical-duration units, not one unit for the whole window


@pytest.mark.asyncio
async def test_topic_embeddings_false_warns_when_topics_already_existed(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container)
    configure(container, analysis_pipeline="v2", analysis_v2={"topic_embeddings": False})
    await analyze_job(jid, container=container)
    assert "topic_embeddings=false has no effect" in _log_text(container, jid)
    assert _scored(container, jid)["topic_segments_built_here"] is False


# --- cooperative cancellation and per-stage reasoning (phase 4, code-only part) -------------------------

from app.application.runtime_service import CancelToken, OperationCancelledError  # noqa: E402
from app.domain.analysis.v2 import constants as V2C  # noqa: E402
from app.domain.analysis.v2.pipeline import analyze_job_v2, resolve_reasoning_stages  # noqa: E402

FULL = {"brief": "llm", "units": "llm", "refine_boundaries": True}
# Spans need a unit longer than max: topic units give t4 (168 s > 120 s); the other stages run as usual.
WITH_SUBSPAN = {"brief": "llm", "units": "topics", "refine_boundaries": True}


class CancellingLLM(FakeLLM):
    """FakeLLM that flips a cancel token while answering the Nth call that carries `key` in its schema."""

    def __init__(self, container: ServiceContainer, token: Any, key: str, nth: int = 1, **kw: Any) -> None:
        super().__init__(container, **kw)
        self.token, self.key, self.nth, self.seen = token, key, nth, 0
        self.after_cancel = 0

    async def _fetch(self, method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        if url.endswith("/api/chat"):
            if self.token.is_set():
                self.after_cancel += 1
            props = ((body or {}).get("format") or {}).get("properties") or {}
            if self.key in props:
                self.seen += 1
                if self.seen == self.nth:
                    self.token.set()
        return await super()._fetch(method, url, body)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("key", "nth", "toggles"),
    [
        ("summary", 1, FULL),  # S1 map chunk
        ("unit_seconds", 1, FULL),  # S1 reduce
        ("units", 1, FULL),  # S2 window
        ("spans", 1, WITH_SUBSPAN),  # S3 sub-span call
        ("premise", 1, FULL),  # S4, first candidate
        ("premise", 3, FULL),  # S4, in the middle of the loop
        ("start_sentence_id", 1, FULL),  # S5 border call
    ],
)
async def test_cancel_stops_within_one_call_and_leaves_state_clean(
    container: ServiceContainer, key: str, nth: int, toggles: dict[str, Any]
) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    configure(container, analysis_pipeline="v2", analysis_v2=toggles)
    cuts_file = container.jobs.job_dir_path(jid) / "cuts.suggested.json"
    cuts_file.write_text('[{"sentinel": true}]\n', encoding="utf-8")
    token = container.runtime.create_cancel_token(jid, "analysis")
    fake = CancellingLLM(container, token, key, nth)

    with pytest.raises(OperationCancelledError):
        await analyze_job_v2(jid, container=container)

    assert fake.seen == nth
    assert fake.after_cancel == 0  # no LLM call was sent after the token was set
    assert cuts_file.read_text(encoding="utf-8") == '[{"sentinel": true}]\n'
    assert not (container.jobs.job_dir_path(jid) / "candidates.scored.json").exists()
    assert container.jobs.load_job(jid).status == JobStatus.DOWNLOADED  # not stuck in ANALYZING, not ERROR
    assert "cancelada" in _log_text(container, jid)
    assert not container.scheduler.gpu_mutex.locked  # gpu slot released


@pytest.mark.asyncio
async def test_cancel_token_passed_as_argument_and_checked_before_the_first_call(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    configure(container, analysis_pipeline="v2")
    fake = FakeLLM(container)
    token = CancelToken(jid, "analysis")
    token.set()
    with pytest.raises(OperationCancelledError):
        await analyze_job_v2(jid, container=container, cancel_token=token)
    assert fake.bodies == []
    assert container.jobs.load_job(jid).status == JobStatus.DOWNLOADED


@pytest.mark.asyncio
async def test_orchestrator_token_cancels_the_analysis_too(container: ServiceContainer) -> None:
    """The single-job orchestrator creates no analysis token: a cancel on the job (any task) must still stop it."""
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    configure(container, analysis_pipeline="v2")
    orch = container.runtime.create_cancel_token(jid, "orchestrator")
    fake = CancellingLLM(container, orch, "units")

    with pytest.raises(OperationCancelledError):
        await analyze_job_v2(jid, container=container)
    assert fake.after_cancel == 0 and fake.seen == 1


@pytest.mark.asyncio
async def test_no_cancel_request_runs_normally_with_a_token_present(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    configure(container, analysis_pipeline="v2")
    container.runtime.create_cancel_token(jid, "analysis")
    FakeLLM(container)
    result = await analyze_job_v2(jid, container=container)
    assert result["cuts"]
    assert container.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL


def _num_predict(body: dict[str, Any]) -> int:
    return body["options"]["num_predict"]


def _thinks(body: dict[str, Any]) -> bool:
    return not ("think" in body and body["think"] is False)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("stages", "scoring_on", "refine_on"),
    [
        (None, False, False),
        ([], False, False),
        (["scoring"], True, False),
        (["refine"], False, True),
        (["scoring", "refine"], True, True),
    ],
)
async def test_reasoning_stages_affect_only_the_named_stages(
    container: ServiceContainer, stages: list[str] | None, scoring_on: bool, refine_on: bool
) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    v2cfg: dict[str, Any] = dict(FULL)
    if stages is not None:
        v2cfg["reasoning_stages"] = stages
    configure(container, analysis_pipeline="v2", analysis_v2=v2cfg)
    # A refine that moves a border, so the re-score (a scoring call) also happens.
    fake = FakeLLM(container, refine_start=lambda options, current: {"reason": "ok", "start_sentence_id": options[0]})
    await analyze_job_v2(jid, container=container)

    mult = V2C.REASONING_MAX_TOKENS_MULTIPLIER
    scoring = fake.calls("premise")
    refine = fake.refine_calls("start_sentence_id") + fake.refine_calls("end_sentence_id")
    assert scoring and refine
    assert all(_thinks(b) == scoring_on for b in scoring)
    assert all(_num_predict(b) == V2C.MAX_TOKENS_SCORING * (mult if scoring_on else 1) for b in scoring)
    assert all(_thinks(b) == refine_on for b in refine)
    assert all(_num_predict(b) == V2C.MAX_TOKENS_REFINE * (mult if refine_on else 1) for b in refine)
    others = [b for b in fake.bodies if not any(b is x for x in scoring + refine)]
    assert others and all(not _thinks(b) for b in others)  # S1, S2, S3 never reason
    budgets = {V2C.MAX_TOKENS_BRIEF_MAP, V2C.MAX_TOKENS_BRIEF_REDUCE, V2C.MAX_TOKENS_UNITS, V2C.MAX_TOKENS_SUBSPAN}
    assert all(_num_predict(b) in budgets for b in others)
    assert _scored(container, jid)["reasoning_stages"] == sorted(stages or [])


@pytest.mark.asyncio
async def test_unknown_reasoning_stage_values_warn_and_are_ignored(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    configure(container, analysis_pipeline="v2", analysis_v2={**FULL, "reasoning_stages": ["refine", "units", 3]})
    fake = FakeLLM(container)
    await analyze_job_v2(jid, container=container)
    logs = _log_text(container, jid)
    assert "'units'" in logs and "entry 3" in logs and "reasoning_stages" in logs
    assert "not a known stage toggle" not in logs
    assert all(not _thinks(b) for b in fake.calls("premise"))
    assert all(_thinks(b) for b in fake.refine_calls("start_sentence_id"))


def test_resolve_reasoning_stages_unit() -> None:
    warnings: list[str] = []
    assert resolve_reasoning_stages(None, warnings.append) == frozenset()
    assert resolve_reasoning_stages({"brief": "llm"}, warnings.append) == frozenset()
    assert resolve_reasoning_stages({"reasoning_stages": ["scoring"]}, warnings.append) == {"scoring"}
    assert warnings == []
    assert resolve_reasoning_stages({"reasoning_stages": "scoring"}, warnings.append) == frozenset()
    assert resolve_reasoning_stages({"reasoning_stages": ["x", ["scoring"]]}, warnings.append) == frozenset()
    assert len(warnings) == 3


@pytest.mark.asyncio
async def test_v1_path_request_bodies_keep_the_config_driven_reasoning_and_budget(container: ServiceContainer) -> None:
    """v1 never sets the per-call flag: its bodies keep following disable_reasoning (default off)."""
    _raw, _cuts, bodies = await _run_v1_once(container, None)
    assert bodies and all(not _thinks(b) for b in bodies)


# --- derived legacy artifacts (phase 4, code-only part) -------------------------------------------------

from app.domain.analysis.v2 import pipeline as _pipeline_mod  # noqa: E402


def _forbid_v1_builders(monkeypatch) -> None:
    def boom(*args: Any, **kwargs: Any) -> Any:
        raise AssertionError("a v1 block/topic builder was called")

    monkeypatch.setattr(_pipeline_mod, "build_semantic_blocks", boom)
    monkeypatch.setattr(_pipeline_mod, "build_topic_segments", boom)


def _read_bytes(container: ServiceContainer, jid: str) -> tuple[bytes, bytes]:
    return (
        container.jobs.semantic_blocks_path(jid).read_bytes(),
        container.jobs.topic_segments_path(jid).read_bytes(),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("punctuate,vocab", [(True, TURKISH), (False, INDONESIAN)])
async def test_derive_legacy_artifacts_writes_both_and_never_calls_v1_builders(
    container: ServiceContainer, monkeypatch, punctuate: bool, vocab: list[str]
) -> None:
    jid = seed_job(container, make_words(vocab, punctuate=punctuate))
    before = _read_bytes(container, jid)
    container.jobs.topic_segments_path(jid).unlink()  # even without topics nothing may be rebuilt by v1
    _forbid_v1_builders(monkeypatch)
    FakeLLM(container)
    configure(container, analysis_pipeline="v2", analysis_v2={**FULL, "derive_legacy_artifacts": True})
    await analyze_job_v2(jid, container=container)

    blocks = container.jobs.load_semantic_blocks(jid)
    topics = container.jobs.load_topic_segments(jid)
    units = load_artifact(container, jid, "units.json")["units"]
    assert blocks and [b.block_id for b in blocks] == [f"b{i}" for i in range(1, len(blocks) + 1)]
    assert before[0] != container.jobs.semantic_blocks_path(jid).read_bytes()  # overwritten
    assert len(topics) == len(units) and [t.topic_id for t in topics] == [f"t{i}" for i in range(1, len(units) + 1)]
    assert all(t.embedding_backend == "none" for t in topics)
    ids = {b.block_id for b in blocks}
    cuts = container.jobs.load_cuts(jid)
    assert cuts
    for cut in cuts:
        assert cut.block_ids and set(cut.block_ids) <= ids
    scored = _scored(container, jid)
    assert scored["derive_legacy_artifacts"] is True and scored["topic_segments_built_here"] is False
    assert "has no effect" not in _log_text(container, jid)


@pytest.mark.asyncio
async def test_derive_legacy_artifacts_runs_s2_with_the_typical_duration_fallback(
    container: ServiceContainer, monkeypatch
) -> None:
    _forbid_v1_builders(monkeypatch)
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container, units=lambda ids: "garbage")
    configure(container, analysis_pipeline="v2", analysis_v2={**FULL, "derive_legacy_artifacts": True})
    await analyze_job_v2(jid, container=container)
    scored = _scored(container, jid)
    assert scored["s2_meta"]["fallback_windows"] == scored["s2_meta"]["windows"] >= 1
    assert len(load_artifact(container, jid, "units.json")["units"]) > 1
    units = load_artifact(container, jid, "units.json")["units"]
    assert all(u["kind"] == "content" for u in units)  # typical-duration units, not topic-built ones
    blocks = container.jobs.load_semantic_blocks(jid)
    topics = container.jobs.load_topic_segments(jid)
    flat = [bid for tp in topics for bid in tp.block_ids]
    assert flat == [b.block_id for b in blocks]  # partition: every block in exactly one topic
    for b in blocks:  # never crosses a unit
        assert sum(1 for u in units if u["start"] <= b.start and b.end <= u["end"] + 1e-6) >= 1


@pytest.mark.asyncio
async def test_cancel_after_the_last_llm_call_is_honored_and_writes_nothing(
    container: ServiceContainer, monkeypatch
) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    configure(container, analysis_pipeline="v2", analysis_v2={**FULL, "derive_legacy_artifacts": True})
    FakeLLM(container)
    before = _read_bytes(container, jid)
    cuts_file = container.jobs.job_dir_path(jid) / "cuts.suggested.json"
    cuts_file.write_text('[{"sentinel": true}]\n', encoding="utf-8")
    token = container.runtime.create_cancel_token(jid, "analysis")
    real_select = _pipeline_mod.select

    def select_then_cancel(*args: Any, **kwargs: Any) -> Any:
        out = real_select(*args, **kwargs)
        token.set()  # arrives after the last LLM call
        return out

    monkeypatch.setattr(_pipeline_mod, "select", select_then_cancel)
    with pytest.raises(OperationCancelledError):
        await analyze_job_v2(jid, container=container)
    assert cuts_file.read_text(encoding="utf-8") == '[{"sentinel": true}]\n'
    assert _read_bytes(container, jid) == before  # derived artifacts are not written either
    assert not (container.jobs.job_dir_path(jid) / "candidates.scored.json").exists()
    assert container.jobs.load_job(jid).status == JobStatus.DOWNLOADED


@pytest.mark.asyncio
async def test_derive_legacy_artifacts_not_written_when_a_later_stage_fails(
    container: ServiceContainer, monkeypatch
) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    configure(container, analysis_pipeline="v2", analysis_v2={**FULL, "derive_legacy_artifacts": True})
    FakeLLM(container)
    before = _read_bytes(container, jid)

    def boom(*args: Any, **kwargs: Any) -> Any:
        raise RuntimeError("scoring blew up")

    monkeypatch.setattr(_pipeline_mod, "score_all", boom)
    with pytest.raises(RuntimeError):
        await analyze_job_v2(jid, container=container)
    assert _read_bytes(container, jid) == before


@pytest.mark.asyncio
async def test_toggle_off_keeps_the_legacy_artifacts_byte_identical(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    before = _read_bytes(container, jid)
    FakeLLM(container)
    configure(container, analysis_pipeline="v2", analysis_v2={**FULL, "derive_legacy_artifacts": False})
    await analyze_job_v2(jid, container=container)
    assert _read_bytes(container, jid) == before
    assert "derive_legacy_artifacts" not in _scored(container, jid)
    assert "derive_legacy_artifacts" not in _log_text(container, jid)


@pytest.mark.asyncio
async def test_derive_with_units_topics_is_contradictory_warns_and_acts_as_false(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    before = _read_bytes(container, jid)
    FakeLLM(container)
    configure(
        container,
        analysis_pipeline="v2",
        analysis_v2={"brief": "llm", "units": "topics", "refine_boundaries": True, "derive_legacy_artifacts": True},
    )
    await analyze_job_v2(jid, container=container)
    assert "contradicts units='topics'" in _log_text(container, jid)
    assert _read_bytes(container, jid) == before
    assert "derive_legacy_artifacts" not in _scored(container, jid)


@pytest.mark.asyncio
async def test_non_boolean_derive_value_warns_and_is_false(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    before = _read_bytes(container, jid)
    FakeLLM(container)
    configure(container, analysis_pipeline="v2", analysis_v2={**FULL, "derive_legacy_artifacts": "yes"})
    await analyze_job_v2(jid, container=container)
    assert "is not a boolean" in _log_text(container, jid)
    assert _read_bytes(container, jid) == before


def test_resolve_derive_legacy_unit() -> None:
    from app.domain.analysis.v2.pipeline import resolve_derive_legacy, resolve_stage_toggles

    warnings: list[str] = []
    assert resolve_derive_legacy(None) is False and resolve_derive_legacy({}) is False
    assert resolve_derive_legacy({"derive_legacy_artifacts": True}) is True
    assert resolve_derive_legacy({"derive_legacy_artifacts": 1}, warnings.append) is False and warnings
    stage_warnings: list[str] = []
    resolved = resolve_stage_toggles({"derive_legacy_artifacts": True}, stage_warnings.append)
    assert stage_warnings == [] and resolved == DEFAULT_TOGGLES
