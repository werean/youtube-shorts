"""Phase 3 - S2 units of the v2 analysis pipeline. 100% mocked: the LLM is a fake defined here."""

from __future__ import annotations

import asyncio
import random

import pytest

from app.application.runtime_service import OperationCancelledError
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.models import Brief, OutlineEntry, Sentence, Unit, UnitSeconds
from app.domain.analysis.v2.units import build_units, build_windows, merge_window_boundaries
from app.infrastructure.llm.unified_adapter import (
    LLMContextOverflowError,
    LLMEmptyResponseError,
    LocalLLMUnavailableError,
)

TURKISH = "bugün hava çok güzel ve herkes dışarıda yürüyüşe çıkmış"
NO_PUNCT = "e entao a gente foi la sem parar e depois voltou pra casa"


def make_sentences(n: int, step: float = 5.0) -> list[Sentence]:
    texts = [TURKISH, NO_PUNCT, "Selamlar dostlar, bugün size bir hikaye anlatacağım."]
    return [
        Sentence(
            sentence_id=f"s{i}",
            start=(i - 1) * step,
            end=i * step,
            text=texts[i % 3],
            speaker="SPEAKER_00" if i % 2 else None,
        )
        for i in range(1, n + 1)
    ]


def make_brief(typ: float = 40.0) -> Brief:
    return Brief(unit_seconds=UnitSeconds(min=20.0, typical=typ, max=90.0))


def run(coro):
    return asyncio.run(coro)


class FakeLLM:
    """answer(ids, call_no) -> parsed answer (or raises). Records schemas and prompts."""

    def __init__(self, answer):
        self.answer = answer
        self.calls: list[dict] = []

    async def __call__(self, system, user, **kw):
        schema = kw["json_schema"]
        ids = schema["properties"]["units"]["items"]["properties"]["start_sentence_id"]["enum"]
        self.calls.append({"system": system, "user": user, "ids": list(ids), "kw": kw})
        return self.answer(list(ids), len(self.calls)), "raw"


def starts_every(k: int, kind: str = "content"):
    def answer(ids, _n):
        return {
            "units": [
                {"start_sentence_id": sid, "label": f"L{i}", "kind": kind} for i, sid in enumerate(ids) if i % k == 0
            ]
        }

    return answer


def assert_invariants(units: list[Unit], sentences: list[Sentence]) -> None:
    assert units, "no units"
    assert [u.unit_id for u in units] == [f"u{i}" for i in range(1, len(units) + 1)]
    pos = {s.sentence_id: i for i, s in enumerate(sentences)}
    assert pos[units[0].start_sentence_id] == 0
    assert pos[units[-1].end_sentence_id] == len(sentences) - 1
    for prev, cur in zip(units, units[1:], strict=False):
        assert pos[cur.start_sentence_id] == pos[prev.end_sentence_id] + 1
    for u in units:
        a, b = pos[u.start_sentence_id], pos[u.end_sentence_id]
        assert a <= b
        assert u.start == sentences[a].start and u.end == sentences[b].end
        assert u.kind in ("content", "non_content")


# --- windows ---------------------------------------------------------------


@pytest.mark.parametrize("n", [0, 1, 2, 14, 15, 16, 79, 80, 81, 95, 96, 145, 200, 500])
def test_build_windows_cover_and_overlap(n):
    ws = build_windows(n, window=80, overlap=15)
    if n == 0:
        assert ws == []
        return
    assert ws[0][0] == 0 and ws[-1][1] == n
    covered = set()
    for a, b in ws:
        assert 0 <= a < b <= n and b - a <= 80
        covered.update(range(a, b))
    assert covered == set(range(n))
    for (a0, a1), (b0, b1) in zip(ws, ws[1:], strict=False):
        assert a1 - b0 == 15
        assert b1 > a1  # the last window is never contained in the previous one
    if n <= 80:
        assert ws == [(0, n)]


def test_build_windows_last_window_is_never_inside_previous():
    # n=148: the last window (130, 148) has 18 > overlap sentences, never contained in the previous one.
    ws = build_windows(148, window=80, overlap=15)
    assert ws == [(0, 80), (65, 145), (130, 148)]
    assert all(b - a > 15 for _, (a, b) in zip(ws, ws[1:], strict=False))


def test_build_windows_degenerate_args():
    assert build_windows(5, window=3, overlap=99) == [(0, 3), (1, 4), (2, 5)]  # overlap clamped to window-1
    assert build_windows(3, window=0, overlap=0) == [(0, 1), (1, 2), (2, 3)]


# --- junction rule ---------------------------------------------------------


def test_merge_junction_split_rule():
    ws = [(0, 80), (65, 145)]  # overlap [65, 80), L=15, split = 65 + 8 = 73
    merged = merge_window_boundaries(
        ws,
        [[0, 10, 64, 70, 72, 73, 79], [65, 66, 72, 73, 74, 100]],
    )
    # window A owns < 73: 0,10,64,70,72 ; window B owns >= 73: 73,74,100
    assert merged == [0, 10, 64, 70, 72, 73, 74, 100]
    # B's 65, 66 (first half) and A's 73, 79 (second half) are ignored, but 73 is in B's list
    assert 65 not in merged and 66 not in merged and 79 not in merged


def test_merge_always_includes_zero_and_sorts_unique():
    assert merge_window_boundaries([(0, 5)], [[3, 1, 3]]) == [0, 1, 3]
    assert merge_window_boundaries([(0, 5)], [[]]) == [0]


def test_merge_zero_overlap_window_boundary_is_a_boundary():
    assert merge_window_boundaries([(0, 4), (4, 8)], [[0], [4]]) == [0, 4]


def test_merge_single_sentence_overlap_belongs_to_earlier_window():
    ws = [(0, 5), (4, 9)]  # L=1, split = 4 + 1 = 5
    assert merge_window_boundaries(ws, [[0, 4], [4, 6]]) == [0, 4, 6]
    assert merge_window_boundaries(ws, [[0], [4, 6]]) == [0, 6]


# --- build_units -----------------------------------------------------------


@pytest.mark.parametrize("n", [1, 2, 79, 80, 81, 200])
def test_invariants_for_sizes(n):
    ss = make_sentences(n)
    llm = FakeLLM(starts_every(7))
    units, meta = run(build_units(ss, make_brief(), [], llm=llm))
    assert_invariants(units, ss)
    assert meta["windows"] == len(build_windows(n, window=80, overlap=15)) == len(llm.calls)
    assert meta["window_size"] == 80 and meta["fallback_windows"] == 0


def test_one_sentence_single_unit():
    ss = make_sentences(1)
    units, _ = run(build_units(ss, make_brief(), [], llm=FakeLLM(lambda ids, n: {"units": []})))
    assert len(units) == 1 and units[0].start_sentence_id == units[0].end_sentence_id == "s1"


def test_empty_input():
    units, meta = run(build_units([], make_brief(), [], llm=FakeLLM(starts_every(1))))
    assert units == [] and meta["windows"] == 0


def test_schema_enum_is_exactly_the_window_ids_and_call_kwargs():
    ss = make_sentences(200)
    llm = FakeLLM(starts_every(10))
    run(build_units(ss, make_brief(), [], llm=llm))
    ws = build_windows(200, window=80, overlap=15)
    assert len(llm.calls) == len(ws)
    for call, (a, b) in zip(llm.calls, ws, strict=False):
        assert call["ids"] == [s.sentence_id for s in ss[a:b]]
        assert call["kw"]["max_tokens"] == C.MAX_TOKENS_UNITS
        assert call["kw"]["acquire_gpu_slot"] is False
        assert call["kw"]["schema_name"]
        assert ss[a].text in call["user"]


def test_outline_lines_only_for_overlapping_window():
    ss = make_sentences(200)  # 5 s each: window 1 spans 0-400 s, window 2 325-725 s ...
    outline = [
        OutlineEntry(start_sentence_id="s1", end_sentence_id="s10", start=0, end=50, summary="ZZEARLY", kind="content"),
        OutlineEntry(
            start_sentence_id="s150", end_sentence_id="s190", start=745, end=950, summary="ZZLATE", kind="content"
        ),
    ]
    llm = FakeLLM(starts_every(10))
    run(build_units(ss, make_brief(), outline, llm=llm))
    assert "ZZEARLY" in llm.calls[0]["user"] and "ZZLATE" not in llm.calls[0]["user"]
    assert "ZZLATE" in llm.calls[-1]["user"] and "ZZEARLY" not in llm.calls[-1]["user"]


def test_postprocessing_duplicates_unordered_unknown_ids_and_bad_kind():
    ss = make_sentences(20)

    def answer(ids, _n):
        return {
            "units": [
                {"start_sentence_id": "s10", "label": " second ", "kind": "non_content"},
                {"start_sentence_id": "s1", "label": "first", "kind": "content"},
                {"start_sentence_id": "s10", "label": "dup", "kind": "content"},
                {"start_sentence_id": "s999", "label": "ghost", "kind": "content"},
                {"start_sentence_id": "s15", "label": 3, "kind": "weird"},
                "junk",
                {"label": "no id"},
            ]
        }

    units, _ = run(build_units(ss, make_brief(), [], llm=FakeLLM(answer)))
    assert_invariants(units, ss)
    assert [(u.start_sentence_id, u.label, u.kind) for u in units] == [
        ("s1", "first", "content"),
        ("s10", "second", "non_content"),
        ("s15", "", "content"),
    ]
    assert [u.end_sentence_id for u in units] == ["s9", "s14", "s20"]


def test_model_omits_first_sentence_it_still_starts_a_unit():
    ss = make_sentences(30)
    answer = lambda ids, n: {"units": [{"start_sentence_id": "s12", "label": "x", "kind": "non_content"}]}  # noqa: E731
    units, meta = run(build_units(ss, make_brief(), [], llm=FakeLLM(answer)))
    assert_invariants(units, ss)
    assert [u.start_sentence_id for u in units] == ["s1", "s12"]
    assert units[0].kind == "content" and meta["fallback_windows"] == 0


def test_kind_and_label_come_from_the_window_that_owns_the_start():
    ss = make_sentences(145)  # windows (0,80) and (65,145); split = 73 (index) -> s74
    kinds = {1: "non_content", 2: "content"}

    def answer(ids, call_no):
        # both windows mark s70 (index 69, owned by window 1) and s78 (index 77, owned by window 2)
        return {
            "units": [
                {"start_sentence_id": ids[0], "label": f"w{call_no}", "kind": kinds[call_no]},
                *[
                    {"start_sentence_id": s, "label": f"w{call_no}", "kind": kinds[call_no]}
                    for s in ("s70", "s78")
                    if s in ids
                ],
            ]
        }

    units, _ = run(build_units(ss, make_brief(), [], llm=FakeLLM(answer)))
    assert_invariants(units, ss)
    by_start = {u.start_sentence_id: u for u in units}
    assert by_start["s70"].label == "w1" and by_start["s70"].kind == "non_content"
    assert by_start["s78"].label == "w2" and by_start["s78"].kind == "content"
    # window 2's forced first sentence (s66) lies in window 1's half: not a boundary
    assert "s66" not in by_start


def test_boundaries_in_overlap_follow_junction_rule_end_to_end():
    ss = make_sentences(145)

    def answer(ids, call_no):
        marks = [ids[0], "s68", "s72", "s75", "s80"] if call_no == 1 else [ids[0], "s68", "s72", "s75", "s90"]
        return {"units": [{"start_sentence_id": m, "label": "", "kind": "content"} for m in marks if m in ids]}

    units, _ = run(build_units(ss, make_brief(), [], llm=FakeLLM(answer)))
    starts = [u.start_sentence_id for u in units]
    # first window owns indexes < 73 (s1..s73); the second owns s74 onwards
    assert starts == ["s1", "s68", "s72", "s75", "s90"]


def test_window_failure_falls_back_only_for_that_window_without_fallback_units():
    ss = make_sentences(200)  # 5 s per sentence, typical 40 s -> every 8 sentences

    def answer(ids, call_no):
        if call_no == 2:
            raise ValueError("garbled json")
        return starts_every(10)(ids, call_no)

    logs: list[str] = []
    llm = FakeLLM(answer)
    units, meta = run(build_units(ss, make_brief(40.0), [], llm=llm, log=logs.append))
    assert_invariants(units, ss)
    assert meta["fallback_windows"] == 1
    assert any("window 2" in m and "fallback" in m for m in logs)
    ws = build_windows(200, window=80, overlap=15)
    starts = [int(u.start_sentence_id[1:]) - 1 for u in units]
    # window 2 = indexes 65..145 owns [73, 138): boundaries every 8 sentences from its first (65)
    in_w2 = [i for i in starts if 73 <= i < 138]
    assert in_w2 == [i for i in range(65, 145, 8) if 73 <= i < 138]
    # window 1 owns [0, 73) with the model's every-10 marks; window 3 untouched
    assert [i for i in starts if i < 73] == list(range(0, 73, 10))
    assert ws[2][0] == 130 and [i for i in starts if i >= 138] == [i for i in range(130, 200, 10) if i >= 138]


def test_window_with_nothing_usable_falls_back_with_fallback_units():
    ss = make_sentences(200)

    def answer(ids, call_no):
        if call_no == 2:
            return {"units": [{"start_sentence_id": "zzz", "label": "", "kind": "content"}]}  # nothing usable
        return starts_every(10)(ids, call_no)

    fb = [
        Unit(unit_id="u1", start_sentence_id="s1", end_sentence_id="s90", start=0, end=450, label="A", kind="content"),
        Unit(
            unit_id="u2", start_sentence_id="s91", end_sentence_id="s120", start=450, end=600, label="B", kind="non_content"
        ),
        Unit(
            unit_id="u3", start_sentence_id="s121", end_sentence_id="s200", start=600, end=1000, label="C", kind="content"
        ),
    ]
    logs: list[str] = []
    units, meta = run(build_units(ss, make_brief(), [], llm=FakeLLM(answer), fallback_units=fb, log=logs.append))
    assert_invariants(units, ss)
    assert meta["fallback_windows"] == 1 and logs
    by_start = {u.start_sentence_id: u for u in units}
    # window 2 owns indexes [73, 138): fallback boundaries inside it are s91 (idx 90) and s121 (idx 120);
    # the fallback unit covering its first sentence is not a boundary there (owned by window 1).
    assert by_start["s91"].kind == "non_content" and by_start["s91"].label == "B"
    assert by_start["s121"].label == "C"
    assert "s66" not in by_start and "s74" not in by_start
    # a fallback in window 2 does not touch window 1 / 3 boundaries
    assert "s11" in by_start and "s141" in by_start


def test_fallback_units_cover_window_first_sentence_kind():
    ss = make_sentences(30)
    fb = [
        Unit(unit_id="u1", start_sentence_id="s1", end_sentence_id="s30", start=0, end=150, label="T", kind="non_content")
    ]
    answer = lambda ids, n: (_ for _ in ()).throw(RuntimeError("boom"))  # noqa: E731
    units, meta = run(build_units(ss, make_brief(), [], llm=FakeLLM(answer), fallback_units=fb))
    assert meta["fallback_windows"] == 1
    assert len(units) == 1 and units[0].kind == "non_content" and units[0].label == "T"


@pytest.mark.parametrize(
    "exc",
    [OperationCancelledError("x"), LocalLLMUnavailableError("x"), LLMContextOverflowError("x"), LLMEmptyResponseError("x")],
)
def test_job_level_errors_propagate(exc):
    def answer(ids, n):
        raise exc

    with pytest.raises(type(exc)):
        run(build_units(make_sentences(10), make_brief(), [], llm=FakeLLM(answer)))


def test_window_shrinks_when_prompt_does_not_fit():
    ss = make_sentences(200)
    llm = FakeLLM(starts_every(10))
    units, meta = run(build_units(ss, make_brief(), [], llm=llm, context_tokens=2500))
    assert_invariants(units, ss)
    assert meta["window_size"] < 80 and meta["window_size"] >= C.UNITS_MIN_WINDOW_SENTENCES
    sizes = {len(c["ids"]) for c in llm.calls}
    assert max(sizes) <= meta["window_size"]
    assert meta["windows"] == len(llm.calls) > 3


def test_no_shrink_when_it_fits_and_floor_is_respected():
    ss = make_sentences(200)
    _, meta = run(build_units(ss, make_brief(), [], llm=FakeLLM(starts_every(10)), context_tokens=100000))
    assert meta["window_size"] == 80
    _, meta = run(build_units(ss, make_brief(), [], llm=FakeLLM(starts_every(10)), context_tokens=10))
    assert meta["window_size"] == C.UNITS_MIN_WINDOW_SENTENCES


def test_no_punctuation_transcription():
    ss = [
        Sentence(sentence_id=f"s{i}", start=i * 3.0, end=i * 3.0 + 3.0, text=NO_PUNCT + " " + str(i)) for i in range(1, 100)
    ]
    units, _ = run(build_units(ss, make_brief(), [], llm=FakeLLM(starts_every(9))))
    assert_invariants(units, ss)


def test_prompts_carry_brief_and_no_timestamps_requested():
    ss = make_sentences(10)
    brief = Brief(
        format_description="FMT-DESC", unit_definition="UNIT-DEF", non_content="NONC", unit_seconds=UnitSeconds(min=20, typical=40, max=90)
    )
    llm = FakeLLM(starts_every(3))
    run(build_units(ss, brief, [], llm=llm))
    user = llm.calls[0]["user"]
    assert "FMT-DESC" in user and "UNIT-DEF" in user and "NONC" in user


@pytest.mark.parametrize("seed", range(25))
def test_invariants_property_random_answers(seed):
    rng = random.Random(seed)
    n = rng.choice([1, 2, 3, 16, 50, 79, 80, 81, 95, 130, 200, 333])
    ss = make_sentences(n)
    fb_mode = rng.random() < 0.5
    fallback = None
    if fb_mode:
        fallback = [
            Unit(
                unit_id="u1",
                start_sentence_id="s1",
                end_sentence_id=f"s{n}",
                start=ss[0].start,
                end=ss[-1].end,
                kind="content",
            )
        ]

    def answer(ids, call_no):
        roll = rng.random()
        if roll < 0.15:
            raise ValueError("bad")
        if roll < 0.25:
            return {"units": []}
        if roll < 0.3:
            return "not a dict"
        picks = [rng.choice(ids) for _ in range(rng.randint(1, max(1, len(ids) // 3)))]  # unordered, duplicates
        return {
            "units": [
                {"start_sentence_id": p, "label": "x", "kind": rng.choice(["content", "non_content"])} for p in picks
            ]
        }

    ctx = rng.choice([None, None, 3000])
    units, meta = run(build_units(ss, make_brief(), [], llm=FakeLLM(answer), fallback_units=fallback, context_tokens=ctx))
    assert_invariants(units, ss)
    assert 0 <= meta["fallback_windows"] <= meta["windows"]


# --- phase 3 review fixes -------------------------------------------------------------


def _long_sentences(n: int) -> list[Sentence]:
    text = ("palavra " * 12).strip()  # about 90 characters
    return [Sentence(sentence_id=f"s{i}", start=(i - 1) * 5.0, end=i * 5.0, text=text) for i in range(1, n + 1)]


def test_valid_answer_marking_only_the_first_sentence_never_yields_a_unit_the_s3_prompt_cannot_hold():
    from app.domain.analysis.v2.units import _subspan_prompt_fits

    ss = _long_sentences(300)
    brief = make_brief()
    llm = FakeLLM(lambda ids, _n: {"units": [{"start_sentence_id": ids[0], "label": "x", "kind": "content"}]})
    logs: list[str] = []
    units, meta = run(build_units(ss, brief, [], llm=llm, context_tokens=8192, log=logs.append))
    assert_invariants(units, ss)
    assert meta["windows"] == 5 and meta["fallback_windows"] == 0
    assert len(units) > 1 and meta["split_units"] >= 1
    assert any("too long for the S3 prompt" in m for m in logs)
    pos = {s.sentence_id: i for i, s in enumerate(ss)}
    for u in units:
        a, b = pos[u.start_sentence_id], pos[u.end_sentence_id]
        assert (u.end - u.start) <= brief.unit_seconds.max or _subspan_prompt_fits(ss, brief, a, b, 8192)


def test_units_are_not_split_without_a_context_or_when_they_fit():
    ss = _long_sentences(300)
    llm = FakeLLM(lambda ids, _n: {"units": [{"start_sentence_id": ids[0], "label": "x", "kind": "content"}]})
    units, meta = run(build_units(ss, make_brief(), [], llm=llm, context_tokens=None))
    assert len(units) == 1 and meta["split_units"] == 0  # as answered: one unit for the video
    short = _long_sentences(30)
    units, meta = run(build_units(short, make_brief(), [], llm=llm, context_tokens=8192))
    assert len(units) == 1 and meta["split_units"] == 0


def test_empty_units_list_is_one_unit_not_a_failed_window():
    ss = make_sentences(40)
    logs: list[str] = []
    topic_units = [Unit(unit_id="u1", start_sentence_id="s1", end_sentence_id="s20", start=0, end=100, label="T1"),
                   Unit(unit_id="u2", start_sentence_id="s21", end_sentence_id="s40", start=100, end=200, label="T2")]
    units, meta = run(
        build_units(ss, make_brief(), [], llm=FakeLLM(lambda ids, _n: {"units": []}), fallback_units=topic_units,
                    log=logs.append)
    )
    assert meta["fallback_windows"] == 0 and len(units) == 1
    assert any("no unit start" in m for m in logs)
    # malformed answers still use the fallback
    units, meta = run(build_units(ss, make_brief(), [], llm=FakeLLM(lambda ids, _n: "garbage"), fallback_units=topic_units))
    assert meta["fallback_windows"] == 1 and len(units) == 2
