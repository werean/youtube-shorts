"""S1 - brief and outline (100% mocked LLM)."""

from __future__ import annotations

import re

import pytest

from app.application.runtime_service import OperationCancelledError
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2 import prompts as P
from app.domain.analysis.v2.brief import _chunk_sentences, build_brief, clamp_unit_seconds
from app.domain.analysis.v2.models import Sentence
from app.domain.analysis.v2.provisional import provisional_brief
from app.infrastructure.llm.unified_adapter import (
    LLMContextOverflowError,
    LLMEmptyResponseError,
    LocalLLMUnavailableError,
)

TURKISH = "Merhaba arkadaşlar, bugün size önemli bir hikaye anlatacağım ve her şeyi açıklayacağım"
NO_PUNCT = "entao pessoal hoje a gente vai falar sobre uma coisa bem interessante e importante mesmo"
TEXTS = [TURKISH, NO_PUNCT, "Selamlar dostlar, bugün güzel bir gün."]


def make_sentences(n: int, step: float = 5.0, text_len: int | None = None) -> list[Sentence]:
    out = []
    for i in range(1, n + 1):
        text = TEXTS[i % 3]
        if text_len:
            text = (text * (text_len // len(text) + 1))[:text_len]
        out.append(
            Sentence(
                sentence_id=f"s{i}",
                start=(i - 1) * step,
                end=i * step,
                text=text,
                speaker="SPEAKER_00" if i % 2 else None,
            )
        )
    return out


BRIEF_ANSWER = {
    "language": "tr",
    "format_description": "FORMAT TEXT <b>kept</b>  as is ",
    "speakers": "one",
    "unit_definition": "UNIT DEF",
    "good_cut_criteria": ["a", "b"],
    "non_content": "NC",
    "unit_seconds": {"min": 25, "typical": 70, "max": 130},
}


class FakeLLM:
    def __init__(self, *, brief=None, map_answers=None, fail_map=(), fail_brief=None, raise_map=None):
        self.brief = BRIEF_ANSWER if brief is None else brief
        self.map_answers = map_answers
        self.fail_map = set(fail_map)
        self.fail_brief = fail_brief
        self.raise_map = raise_map
        self.calls: list[dict] = []
        self.map_count = 0

    async def __call__(self, system, user, **kw):
        self.calls.append({"system": system, "user": user, **kw})
        if kw["schema_name"] == P.BRIEF_MAP_SCHEMA_NAME:
            self.map_count += 1
            if self.raise_map is not None:
                raise self.raise_map
            if self.map_count in self.fail_map:
                raise ValueError("boom")
            if self.map_answers is not None:
                return self.map_answers[self.map_count - 1], "{}"
            return {"summary": f"part {self.map_count}", "kind": "content"}, "{}"
        if self.fail_brief is not None:
            raise self.fail_brief
        return self.brief, "{}"


# --- clamp_unit_seconds -------------------------------------------------------


def us(lo, typ, hi):
    return clamp_unit_seconds({"min": lo, "typical": typ, "max": hi})


def triple(u):
    return (u.min, u.typical, u.max)


DEFAULTS = (C.DEFAULT_UNIT_SECONDS_MIN, C.DEFAULT_UNIT_SECONDS_TYPICAL, C.DEFAULT_UNIT_SECONDS_MAX)


def test_clamp_normal_values_unchanged():
    assert triple(us(25, 70, 130)) == (25, 70, 130)


def test_clamp_absurd_values_are_clamped_then_checked():
    assert triple(us(1, 30, 9999)) == (10, 30, 180)
    assert triple(us(500, 50, 100)) == DEFAULTS  # min clamps to 60 > typical 50
    assert triple(us(5, 20, 60)) == (10, 20, 60)


def test_clamp_boundaries():
    assert triple(us(10, 11, 45.0)) == (10, 11, 45)
    assert triple(us(60, 61, 180)) == (60, 61, 180)
    assert triple(us(10, 10, 100)) == DEFAULTS  # typical == min is not strictly greater
    assert triple(us(10, 100, 100)) == DEFAULTS
    assert triple(us(30, 50, 30)) == DEFAULTS


def test_clamp_inverted_and_incoherent():
    assert triple(us(100, 60, 20)) == DEFAULTS
    assert triple(us(20, 200, 120)) == DEFAULTS


@pytest.mark.parametrize(
    "raw",
    [
        None,
        {},
        "x",
        [1, 2, 3],
        {"min": 20, "typical": 60},
        {"min": "20", "typical": 60, "max": 120},
        {"min": None, "typical": 60, "max": 120},
        {"min": True, "typical": 60, "max": 120},
        {"min": float("nan"), "typical": 60, "max": 120},
        {"min": 20, "typical": float("inf"), "max": 120},
    ],
)
def test_clamp_missing_or_non_numeric_gives_defaults(raw):
    assert triple(clamp_unit_seconds(raw)) == DEFAULTS


# --- chunking -----------------------------------------------------------------


def test_chunks_cover_all_sentences_in_order_without_splitting():
    sents = make_sentences(200, text_len=300)
    chunks = _chunk_sentences(sents)
    assert len(chunks) > 1
    flat = [s.sentence_id for c in chunks for s in c]
    assert flat == [s.sentence_id for s in sents]
    from app.domain.analysis.v2.sentences import format_sentence_line

    for c in chunks:
        assert sum(len(format_sentence_line(s)) + 1 for s in c) <= C.BRIEF_MAP_CHUNK_CHARS


def test_oversized_sentence_is_its_own_chunk():
    sents = make_sentences(3)
    sents[1] = sents[1].model_copy(update={"text": "x" * (C.BRIEF_MAP_CHUNK_CHARS + 50)})
    chunks = _chunk_sentences(sents)
    assert [[s.sentence_id for s in c] for c in chunks] == [["s1"], ["s2"], ["s3"]]


def test_single_chunk_when_small():
    assert len(_chunk_sentences(make_sentences(10))) == 1


# --- short video ----------------------------------------------------------------


async def test_short_video_one_call_one_entry():
    sents = make_sentences(10)  # 50 s
    llm = FakeLLM()
    brief, outline, meta = await build_brief(sents, title="t", duration_seconds=50.0, chapters=None, llm=llm)
    assert len(llm.calls) == 1
    call = llm.calls[0]
    assert call["schema_name"] == P.BRIEF_SCHEMA_NAME
    assert call["json_schema"] == P.BRIEF_JSON_SCHEMA
    assert call["max_tokens"] == C.MAX_TOKENS_BRIEF_REDUCE
    assert call["acquire_gpu_slot"] is False
    assert call["system"] == P.BRIEF_SHORT_SYSTEM_PROMPT
    assert meta == {"mode": "short", "map_calls": 0, "fallback": False}
    assert len(outline) == 1
    e = outline[0]
    assert (e.start_sentence_id, e.end_sentence_id, e.start, e.end) == ("s1", "s10", 0.0, 50.0)
    assert brief.unit_seconds.typical == 70


async def test_short_video_threshold_is_exclusive():
    sents = make_sentences(40, step=4.5)  # 180 s
    llm = FakeLLM()
    _, _, meta = await build_brief(sents, title=None, duration_seconds=C.SHORT_VIDEO_SECONDS, chapters=None, llm=llm)
    assert meta["mode"] == "map_reduce"


async def test_short_video_duration_none_derived_from_sentences():
    llm = FakeLLM()
    _, _, meta = await build_brief(make_sentences(5), title=None, duration_seconds=None, chapters=None, llm=llm)
    assert meta["mode"] == "short"


async def test_short_video_failure_gives_provisional_and_logs():
    logs: list[str] = []
    llm = FakeLLM(fail_brief=ValueError("nope"))
    brief, outline, meta = await build_brief(
        make_sentences(5), title=None, duration_seconds=25.0, chapters=None, llm=llm, log=logs.append
    )
    assert brief == provisional_brief()
    assert len(outline) == 1
    assert meta["fallback"] is True
    assert len(logs) == 1 and "S1" in logs[0]


async def test_no_sentences_gives_provisional_without_calls():
    llm = FakeLLM()
    brief, outline, meta = await build_brief([], title=None, duration_seconds=None, chapters=None, llm=llm)
    assert llm.calls == [] and outline == [] and meta["fallback"] is True
    assert brief == provisional_brief()


# --- map / reduce ----------------------------------------------------------------


async def test_map_reduce_call_counts_and_outline():
    sents = make_sentences(200, step=5.0, text_len=300)  # 1000 s
    expected = _chunk_sentences(sents)
    llm = FakeLLM()
    brief, outline, meta = await build_brief(
        sents, title="Başlık", duration_seconds=1000.0, chapters=[{"title": "Ch", "start_time": 0}], llm=llm
    )
    assert meta == {"mode": "map_reduce", "map_calls": len(expected), "failed_map_chunks": 0, "fallback": False}
    assert len(llm.calls) == len(expected) + 1
    assert [c["schema_name"] for c in llm.calls[:-1]] == [P.BRIEF_MAP_SCHEMA_NAME] * len(expected)
    assert llm.calls[-1]["schema_name"] == P.BRIEF_SCHEMA_NAME
    assert llm.calls[0]["max_tokens"] == C.MAX_TOKENS_BRIEF_MAP
    assert all(c["acquire_gpu_slot"] is False for c in llm.calls)
    assert len(outline) == len(expected)
    for e, chunk in zip(outline, expected):
        assert e.start_sentence_id == chunk[0].sentence_id
        assert e.end_sentence_id == chunk[-1].sentence_id
        assert e.start == chunk[0].start and e.end == chunk[-1].end
    # contiguous, ordered, whole coverage
    assert outline[0].start_sentence_id == "s1" and outline[-1].end_sentence_id == "s200"
    reduce_user = llm.calls[-1]["user"]
    assert "part 1" in reduce_user and "Başlık" in reduce_user and "Ch" in reduce_user
    assert brief.format_description == BRIEF_ANSWER["format_description"]


async def test_map_prompts_contain_exact_chunk_lines():
    sents = make_sentences(200, text_len=300)
    llm = FakeLLM()
    await build_brief(sents, title=None, duration_seconds=1000.0, chapters=None, llm=llm)
    first_chunk = _chunk_sentences(sents)[0]
    assert f"{first_chunk[-1].sentence_id}" in llm.calls[0]["user"]
    assert "s200" not in llm.calls[0]["user"].replace("s2000", "")


async def test_failing_map_chunk_does_not_abort_and_is_logged():
    sents = make_sentences(200, text_len=300)
    n = len(_chunk_sentences(sents))
    logs: list[str] = []
    llm = FakeLLM(fail_map={2})
    brief, outline, meta = await build_brief(
        sents, title=None, duration_seconds=1000.0, chapters=None, llm=llm, log=logs.append
    )
    assert len(outline) == n
    assert (outline[1].summary, outline[1].kind) == ("", "mixed")  # unchecked: never claimed as content
    assert meta["failed_map_chunks"] == 1
    assert outline[0].summary == "part 1" and outline[2].summary == "part 3"
    assert meta["fallback"] is False
    assert sum("map chunk 2" in m for m in logs) == 1
    assert "no summary available" in llm.calls[-1]["user"]


async def test_invalid_map_answer_counts_as_failure():
    sents = make_sentences(200, text_len=300)
    n = len(_chunk_sentences(sents))
    answers = [{"summary": "ok", "kind": "weird"}] + [{"summary": "ok", "kind": "mixed"}] * (n - 1)
    logs: list[str] = []
    _, outline, _ = await build_brief(
        sents, title=None, duration_seconds=1000.0, chapters=None, llm=FakeLLM(map_answers=answers), log=logs.append
    )
    assert outline[0].summary == "" and outline[1].kind == "mixed"
    assert len(logs) == 1


async def test_failing_reduce_returns_provisional_with_outline():
    sents = make_sentences(200, text_len=300)
    logs: list[str] = []
    llm = FakeLLM(fail_brief=ValueError("bad"))
    brief, outline, meta = await build_brief(
        sents, title=None, duration_seconds=1000.0, chapters=None, llm=llm, log=logs.append
    )
    assert brief == provisional_brief()
    assert meta["fallback"] is True and meta["mode"] == "map_reduce"
    assert len(outline) == len(_chunk_sentences(sents))
    assert outline[0].summary == "part 1"
    assert any("reduce failed" in m for m in logs)


@pytest.mark.parametrize(
    "bad",
    [
        None,
        [],
        {**BRIEF_ANSWER, "language": 3},
        {k: v for k, v in BRIEF_ANSWER.items() if k != "non_content"},
        {**BRIEF_ANSWER, "good_cut_criteria": "x"},
        {**BRIEF_ANSWER, "good_cut_criteria": [1, 2]},
    ],
)
async def test_malformed_brief_answer_falls_back(bad):
    llm = FakeLLM(brief=bad if bad is not None else [])
    llm.brief = bad
    brief, _, meta = await build_brief(make_sentences(5), title=None, duration_seconds=25.0, chapters=None, llm=llm)
    assert meta["fallback"] is True and brief == provisional_brief()


async def test_unit_seconds_are_clamped_in_result():
    ans = {**BRIEF_ANSWER, "unit_seconds": {"min": 1, "typical": 30, "max": 1000}}
    brief, _, _ = await build_brief(
        make_sentences(5), title=None, duration_seconds=25.0, chapters=None, llm=FakeLLM(brief=ans)
    )
    assert (brief.unit_seconds.min, brief.unit_seconds.max) == (10, 180)
    ans = {**BRIEF_ANSWER, "unit_seconds": "junk"}
    brief, _, meta = await build_brief(
        make_sentences(5), title=None, duration_seconds=25.0, chapters=None, llm=FakeLLM(brief=ans)
    )
    assert triple(brief.unit_seconds) == DEFAULTS and meta["fallback"] is False


async def test_text_fields_pass_through_untouched():
    ans = {
        **BRIEF_ANSWER,
        "format_description": "  Weird   spacing\nnewline  ",
        "unit_definition": "Tamamen özgün bir tanım",
        "non_content": "",
        "language": "xx",
    }
    brief, _, _ = await build_brief(
        make_sentences(5), title=None, duration_seconds=25.0, chapters=None, llm=FakeLLM(brief=ans)
    )
    for k in ("format_description", "unit_definition", "non_content", "language", "speakers"):
        assert getattr(brief, k) == ans[k]
    assert brief.good_cut_criteria == ["a", "b"]


# --- propagating errors ------------------------------------------------------------


PROPAGATING = [
    OperationCancelledError("c"),
    LocalLLMUnavailableError(),
    LLMContextOverflowError("ctx"),
    LLMEmptyResponseError("empty"),
]


@pytest.mark.parametrize("exc", PROPAGATING)
async def test_errors_propagate_from_short_call(exc):
    with pytest.raises(type(exc)):
        await build_brief(
            make_sentences(5), title=None, duration_seconds=25.0, chapters=None, llm=FakeLLM(fail_brief=exc)
        )


@pytest.mark.parametrize("exc", PROPAGATING)
async def test_errors_propagate_from_map_and_reduce(exc):
    sents = make_sentences(200, text_len=300)
    with pytest.raises(type(exc)):
        await build_brief(sents, title=None, duration_seconds=1000.0, chapters=None, llm=FakeLLM(raise_map=exc))
    with pytest.raises(type(exc)):
        await build_brief(sents, title=None, duration_seconds=1000.0, chapters=None, llm=FakeLLM(fail_brief=exc))


# --- schemas and no closed genre list -------------------------------------------------


async def test_schemas_passed_are_the_static_ones_with_exact_enums():
    sents = make_sentences(200, text_len=300)
    llm = FakeLLM()
    await build_brief(sents, title=None, duration_seconds=1000.0, chapters=None, llm=llm)
    for c in llm.calls[:-1]:
        assert c["json_schema"]["properties"]["kind"]["enum"] == ["content", "non_content", "mixed"]
    assert "enum" not in str(llm.calls[-1]["json_schema"])


# Genre nouns live ONLY here (D1): the prompts must not carry a closed list of them.
_GENRE_NOUNS = ["podcast", "interview", "lecture", "tutorial", "vlog", "documentary", "sermon", "gameplay", "news", "stand-up"]


def test_brief_schema_has_no_enum_and_prompts_have_no_genre_list():
    def walk(node):
        if isinstance(node, dict):
            yield node
            for v in node.values():
                yield from walk(v)
        elif isinstance(node, list):
            for v in node:
                yield from walk(v)

    assert all("enum" not in n for n in walk(P.BRIEF_JSON_SCHEMA))
    assert "enum" not in P.BRIEF_JSON_SCHEMA["properties"]["format_description"]
    texts = [
        value
        for name, value in vars(P).items()
        if isinstance(value, str) and (name.endswith("_PROMPT") or name.endswith("_TEMPLATE"))
    ]
    assert len(texts) >= 12  # S1, S2, S3, S4 and S5 prompts and templates are all covered
    for text in texts:
        low = text.lower()
        hits = [g for g in _GENRE_NOUNS if re.search(rf"\b{re.escape(g)}", low)]
        assert hits == []


async def test_short_video_outline_is_not_claimed_as_content_and_uses_the_description():
    sents = make_sentences(10)
    brief, outline, meta = await build_brief(
        sents, title=None, duration_seconds=50.0, chapters=None, llm=FakeLLM()
    )
    assert len(outline) == 1 and outline[0].kind == "mixed"
    assert outline[0].summary == brief.format_description


async def test_wrong_stored_duration_does_not_send_a_long_transcript_as_a_short_video():
    sents = make_sentences(200, step=5.0, text_len=300)  # spans 1000 s
    llm = FakeLLM()
    _brief, _outline, meta = await build_brief(sents, title=None, duration_seconds=100.0, chapters=None, llm=llm)
    assert meta["mode"] == "map_reduce"
