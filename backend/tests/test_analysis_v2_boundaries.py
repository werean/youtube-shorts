"""Phase 3 - S5 boundary refinement and pre-selection of the v2 analysis pipeline.

100% mocked: the LLM and the rescore callable are fakes defined in this file.
"""

from __future__ import annotations

import math

import pytest

from app.application.runtime_service import OperationCancelledError
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.boundaries import (
    end_options,
    preselect,
    refine_all,
    refine_candidate,
    start_options,
)
from app.domain.analysis.v2.models import (
    Brief,
    Candidate,
    ScoreAnswers,
    ScoredCandidate,
    Sentence,
    Unit,
    UnitSeconds,
)
from app.infrastructure.llm.unified_adapter import (
    LLMContextOverflowError,
    LLMEmptyResponseError,
    LocalLLMUnavailableError,
)

TEXTS = [
    "bugün hava çok güzel ve herkes dışarıda yürüyüşe çıkmış",  # Turkish
    "e entao a gente foi la sem parar e depois voltou pra casa",  # no punctuation
    "Selamlar dostlar, bugün size bir hikaye anlatacağım.",
]


def make_sentences(n: int, step: float = 5.0) -> list[Sentence]:
    return [
        Sentence(sentence_id=f"s{i}", start=(i - 1) * step, end=i * step, text=TEXTS[i % 3])
        for i in range(1, n + 1)
    ]


def make_brief(min_s=20.0, typ=40.0, max_s=60.0) -> Brief:
    return Brief(unit_seconds=UnitSeconds(min=min_s, typical=typ, max=max_s))


def unit(uid, a, b, sents, kind="content") -> Unit:
    s = {x.sentence_id: x for x in sents}
    return Unit(
        unit_id=uid,
        start_sentence_id=f"s{a}",
        end_sentence_id=f"s{b}",
        start=s[f"s{a}"].start,
        end=s[f"s{b}"].end,
        kind=kind,
    )


def answers(interest=4, **kw) -> ScoreAnswers:
    base = dict(
        premise="p",
        missing_context="",
        understandable_alone=True,
        has_payoff=True,
        ends_complete=True,
        depends_on_visuals=False,
        is_non_content=False,
        interest=interest,
        title="t",
    )
    base.update(kw)
    return ScoreAnswers(**base)


def cand(cid, a, b, sents, **kw) -> ScoredCandidate:
    by = {s.sentence_id: s for s in sents}
    return ScoredCandidate(
        candidate_id=cid,
        start_sentence_id=f"s{a}",
        end_sentence_id=f"s{b}",
        start=by[f"s{a}"].start,
        end=by[f"s{b}"].end,
        unit_ids=["u1"],
        answers=kw.pop("answers", answers()),
        gates_ok=kw.pop("gates_ok", True),
        score=kw.pop("score", 80.0),
        **kw,
    )


class FakeLLM:
    """Answers start/end calls by schema name. Records every call and checks the enum."""

    def __init__(self, start=None, end=None, fail=(), raises=None):
        self.start, self.end = start, end  # sentence id to choose (None: pick the first option)
        self.fail = set(fail)  # {"cut_start", "cut_end"} -> raise ValueError
        self.raises = raises  # {schema_name: exception}
        self.calls: list[dict] = []

    async def __call__(self, system, user, **kw):
        self.calls.append({"system": system, "user": user, **kw})
        name = kw["schema_name"]
        assert kw["acquire_gpu_slot"] is False
        assert kw["max_tokens"] == C.MAX_TOKENS_REFINE
        props = kw["json_schema"]["properties"]
        assert list(props)[0] == "reason"
        field = "start_sentence_id" if name == "cut_start" else "end_sentence_id"
        assert list(props) == ["reason", field]
        if self.raises and name in self.raises:
            raise self.raises[name]
        if name in self.fail:
            raise ValueError("boom")
        enum = props[field]["enum"]
        pick = self.start if name == "cut_start" else self.end
        return {"reason": f"why {name}", field: pick if pick is not None else enum[0]}, "raw"

    def enums(self, name):
        field = "start_sentence_id" if name == "cut_start" else "end_sentence_id"
        return [c["json_schema"]["properties"][field]["enum"] for c in self.calls if c["schema_name"] == name]


class FakeRescore:
    def __init__(self, gates_ok=True, interest=5, error=False, exc=None):
        self.gates_ok, self.interest, self.error, self.exc = gates_ok, interest, error, exc
        self.calls: list[Candidate] = []

    async def __call__(self, candidate: Candidate) -> ScoredCandidate:
        self.calls.append(candidate)
        if self.exc:
            raise self.exc
        data = candidate.model_dump()
        if self.error:
            return ScoredCandidate(**data, outcome="error", outcome_reason="x")
        return ScoredCandidate(
            **data, answers=answers(self.interest), gates_ok=self.gates_ok, score=60.0 + self.interest
        )


# --------------------------------------------------------------------------- options


def _without_refine_fields(c):
    return {k: v for k, v in c.model_dump().items() if not k.startswith("refine")}


def ids(ss):
    return [s.sentence_id for s in ss]


def test_options_middle_of_video():
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents)
    opts, after = start_options(c, [unit("u1", 1, 30, sents)], sents)
    assert ids(opts) == ["s6", "s7", "s8", "s9", "s10", "s11"]
    assert ids(after) == ["s12", "s13", "s14"]
    before, opts = end_options(c, [unit("u1", 1, 30, sents)], sents)
    assert ids(before) == ["s13", "s14", "s15"]
    assert ids(opts) == ["s16", "s17", "s18", "s19", "s20"]


def test_options_at_video_edges():
    sents = make_sentences(12)
    units = [unit("u1", 1, 12, sents)]
    first = cand("k1", 1, 6, sents)
    opts, after = start_options(first, units, sents)
    assert ids(opts) == ["s1", "s2"]
    assert ids(after) == ["s3", "s4", "s5"]
    before, _ = end_options(first, units, sents)
    assert ids(before) == ["s2", "s3", "s4"]
    last = cand("k2", 7, 12, sents)
    before, opts = end_options(last, units, sents)
    assert ids(opts) == ["s11", "s12"]
    assert ids(before) == ["s8", "s9", "s10"]
    opts, _ = start_options(last, units, sents)
    assert ids(opts)[-1] == "s8" and ids(opts)[0] == "s3"


def test_options_never_cross_non_content_in_either_direction():
    sents = make_sentences(30)
    units = [
        unit("u1", 1, 8, sents, "non_content"),
        unit("u2", 9, 20, sents),
        unit("u3", 21, 22, sents, "non_content"),
        unit("u4", 23, 30, sents),
    ]
    c = cand("k1", 9, 20, sents)
    opts, _ = start_options(c, units, sents)
    assert ids(opts) == ["s9", "s10"]  # s8 is non_content, cannot be an option
    _, opts = end_options(c, units, sents)
    assert ids(opts) == ["s19", "s20"]  # s21 is non_content
    c2 = cand("k2", 11, 19, sents)
    opts, _ = start_options(c2, units, sents)
    assert ids(opts) == ["s9", "s10", "s11", "s12"]
    c3 = cand("k3", 23, 29, sents)
    opts, _ = start_options(c3, units, sents)
    assert ids(opts) == ["s23", "s24"]


def test_options_short_candidates():
    sents = make_sentences(20)
    units = [unit("u1", 1, 20, sents)]
    one = cand("k1", 10, 10, sents)
    opts, after = start_options(one, units, sents)
    assert ids(opts) == ["s6", "s7", "s8", "s9", "s10"]  # never past the candidate's own last sentence
    assert ids(after) == ["s11", "s12", "s13"]
    before, opts = end_options(one, units, sents)
    assert ids(opts) == ["s10", "s11", "s12", "s13"]
    assert ids(before) == ["s7", "s8", "s9"]
    two = cand("k2", 10, 11, sents)
    opts, _ = start_options(two, units, sents)
    assert ids(opts)[-2:] == ["s10", "s11"]
    _, opts = end_options(two, units, sents)
    assert ids(opts)[:2] == ["s10", "s11"]


# --------------------------------------------------------------------------- refine_candidate


async def run(c, llm, rescore=None, units=None, sents=None, brief=None, log=None):
    sents = sents or make_sentences(30)
    units = units or [unit("u1", 1, 30, sents)]
    rescore = rescore or FakeRescore()
    return await refine_candidate(c, units, sents, brief or make_brief(), llm=llm, rescore=rescore, log=log)


async def test_enums_equal_exactly_the_valid_ids_and_prompts_name_current_border():
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents)
    llm = FakeLLM()
    await run(c, llm, sents=sents)
    assert llm.enums("cut_start") == [["s6", "s7", "s8", "s9", "s10", "s11"]]
    assert llm.enums("cut_end") == [["s16", "s17", "s18", "s19", "s20"]]
    start_call = next(x for x in llm.calls if x["schema_name"] == "cut_start")
    assert "s10" in start_call["user"] and "s14" in start_call["user"]


async def test_no_change_returns_original_with_reasons():
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents)
    rescore = FakeRescore()
    out = await run(c, FakeLLM(start="s10", end="s17"), rescore, sents=sents)
    assert (out.start_sentence_id, out.end_sentence_id) == ("s10", "s17")
    assert out.answers == c.answers and out.score == c.score and out.origin == "unit"
    assert out.refine_start_reason and out.refine_end_reason
    assert rescore.calls == []


async def test_small_shift_keeps_answers_no_rescore():
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents, score=77.0)
    rescore = FakeRescore()
    out = await run(c, FakeLLM(start="s9", end="s17"), rescore, sents=sents)
    assert rescore.calls == []
    assert out.start_sentence_id == "s9" and out.start == sents[8].start
    assert out.end_sentence_id == "s17" and out.end == c.end
    assert out.score == 77.0 and out.answers == c.answers and out.candidate_id == "k1"
    assert out.refined_from == {"start_sentence_id": "s10", "end_sentence_id": "s17"}
    assert out.origin == "unit"


async def test_shift_counted_across_both_borders_triggers_single_rescore():
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents, merge_side="prev")
    rescore = FakeRescore(interest=5)
    out = await run(c, FakeLLM(start="s9", end="s18"), rescore, sents=sents)
    assert len(rescore.calls) == 1
    assert rescore.calls[0].origin == "refined"
    assert (rescore.calls[0].start_sentence_id, rescore.calls[0].end_sentence_id) == ("s9", "s18")
    assert rescore.calls[0].candidate_id == "k1"
    assert out.origin == "refined" and out.answers.interest == 5
    assert out.candidate_id == "k1" and out.merge_side == "prev"
    assert out.start == sents[8].start and out.end == sents[17].end
    assert out.refined_from["start_sentence_id"] == "s10"
    assert out.refine_start_reason == "why cut_start"


async def test_shift_of_exactly_the_constant_rescores_and_one_less_does_not():
    assert C.S5_RESCORE_MIN_SHIFT_SENTENCES == 2
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents)
    r = FakeRescore()
    await run(c, FakeLLM(start="s8", end="s17"), r, sents=sents)
    assert len(r.calls) == 1
    r = FakeRescore()
    await run(c, FakeLLM(start="s9", end="s17"), r, sents=sents)
    assert r.calls == []


@pytest.mark.parametrize("kw", [{"gates_ok": False}, {"error": True}])
async def test_rescore_failing_gates_returns_original_unchanged(kw):
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents)
    out = await run(c, FakeLLM(start="s8", end="s19"), FakeRescore(**kw), sents=sents)
    assert _without_refine_fields(out) == _without_refine_fields(c)
    assert out.refine_outcome == "reverted_gates"
    assert out.refine_rejected_span == {"start_sentence_id": "s8", "end_sentence_id": "s19"}
    assert out.refine_fallbacks and out.refine_fallbacks[0]["side"] == "rescore"
    assert out.refine_start_reason and out.refine_end_reason
    assert "refined_from" not in out.model_dump()


async def test_rescore_unexpected_exception_returns_original_but_cancel_propagates():
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents)
    out = await run(c, FakeLLM(start="s8"), FakeRescore(exc=RuntimeError("x")), sents=sents)
    assert _without_refine_fields(out) == _without_refine_fields(c)
    assert out.refine_outcome == "reverted_rescore_error"
    assert "x" in out.refine_fallbacks[0]["reason"]
    with pytest.raises(OperationCancelledError):
        await run(c, FakeLLM(start="s8"), FakeRescore(exc=OperationCancelledError()), sents=sents)


async def test_duration_validation_order_start_then_end():
    sents = make_sentences(40)
    # candidate s10..s17 = 40s; range [35, 45]
    brief = make_brief(35, 40, 45)
    c = cand("k1", 10, 17, sents)
    # start s8 -> 50s (> max): rejected. end s19 given ORIGINAL start s10 -> 50s: rejected.
    out = await run(c, FakeLLM(start="s8", end="s19"), sents=sents, brief=brief)
    assert (out.start_sentence_id, out.end_sentence_id) == ("s10", "s17")
    # start s11 -> 35s accepted; end s18 given accepted start s11 -> 40s accepted.
    r = FakeRescore()
    out = await run(c, FakeLLM(start="s11", end="s18"), r, sents=sents, brief=brief)
    assert (out.start_sentence_id, out.end_sentence_id) == ("s11", "s18")
    assert len(r.calls) == 1  # 1 + 1 = 2 sentences
    # start s11 accepted (35s); end s19 given s11 -> 45s accepted; but with end s20 -> 50s rejected.
    out = await run(c, FakeLLM(start="s11", end="s20"), sents=sents, brief=brief)
    assert (out.start_sentence_id, out.end_sentence_id) == ("s11", "s17")


async def test_end_validated_against_accepted_start_not_original():
    sents = make_sentences(40)
    brief = make_brief(30, 40, 40)
    c = cand("k1", 10, 17, sents)  # 40s
    # end s16 alone: 35s fine; start s8: 50s and the pair s8..s16 (45s) are > 40: rejected; end s16 given original start OK.
    out = await run(c, FakeLLM(start="s8", end="s16"), sents=sents, brief=brief)
    assert (out.start_sentence_id, out.end_sentence_id) == ("s10", "s16")
    # start s11 accepted (35s); end s19 given s11 = 45s rejected, though s19 given s10 would be 50s too.
    out = await run(c, FakeLLM(start="s11", end="s19"), sents=sents, brief=brief)
    assert out.end_sentence_id == "s17" and out.start_sentence_id == "s11"


async def test_valid_pair_is_accepted_even_when_one_border_alone_is_out_of_range():
    sents = make_sentences(40)
    brief = make_brief(20, 40, 120)
    c = cand("k1", 20, 23, sents)  # 20 s
    # start s21 alone would give s21..s23 = 15 s (< min); the pair s21..s26 = 30 s is valid.
    out = await run(c, FakeLLM(start="s21", end="s26"), sents=sents, brief=brief)
    assert (out.start_sentence_id, out.end_sentence_id) == ("s21", "s26")
    assert not getattr(out, "refine_fallbacks", None)


async def test_every_s5_fallback_leaves_a_trace_on_the_candidate():
    sents = make_sentences(40)
    brief = make_brief(35, 40, 45)
    c = cand("k1", 10, 17, sents)
    # failed start call + end rejected for duration
    out = await run(c, FakeLLM(end="s20", fail=("cut_start",)), sents=sents, brief=brief)
    sides = {f["side"] for f in out.refine_fallbacks}
    assert sides == {"start", "end"} and out.refine_outcome == "unchanged"
    # start after end
    short = cand("k2", 10, 11, sents)
    out = await run(short, FakeLLM(start="s11", end="s10"), sents=sents, brief=brief)
    assert out.refine_fallbacks[0]["side"] == "both"
    # clean run records the outcome and no fallback
    out = await run(c, FakeLLM(start="s10", end="s17"), sents=sents, brief=brief)
    assert out.refine_outcome == "unchanged" and not getattr(out, "refine_fallbacks", None)


async def test_start_after_end_keeps_both_originals():
    sents = make_sentences(30)
    # one-sentence-wide candidate so options of the start (s6..s10) and the end (s10..s13) can invert
    c = cand("k1", 10, 10, sents)
    brief = make_brief(1, 5, 60)
    llm = FakeLLM(start="s10", end="s10")
    out = await run(c, llm, sents=sents, brief=brief)
    assert out.start_sentence_id == "s10"
    # force an inversion: start option inside candidate later than a chosen end
    c2 = cand("k2", 10, 11, sents)
    llm = FakeLLM(start="s11", end="s10")
    out = await run(c2, llm, sents=sents, brief=brief)
    assert (out.start_sentence_id, out.end_sentence_id) == ("s10", "s11")
    assert out.start == c2.start and out.end == c2.end


async def test_failed_call_keeps_only_that_border():
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents)
    logs: list[str] = []
    out = await run(c, FakeLLM(start="s9", end="s18", fail={"cut_start"}), sents=sents, log=logs.append)
    assert out.start_sentence_id == "s10" and out.end_sentence_id == "s18"
    assert any("start refinement failed" in m for m in logs)
    out = await run(c, FakeLLM(start="s9", end="s18", fail={"cut_end"}), sents=sents)
    assert out.start_sentence_id == "s9" and out.end_sentence_id == "s17"


async def test_answer_outside_enum_is_discarded():
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents)

    async def bad(system, user, **kw):
        return {"reason": "x", "start_sentence_id": "s99", "end_sentence_id": "s99"}, ""

    out = await run(c, bad, sents=sents)
    assert (out.start_sentence_id, out.end_sentence_id) == ("s10", "s17")

    async def notdict(system, user, **kw):
        return ["s9"], ""

    out = await run(c, notdict, sents=sents)
    assert (out.start_sentence_id, out.end_sentence_id) == ("s10", "s17")


@pytest.mark.parametrize(
    "exc", [OperationCancelledError(), LocalLLMUnavailableError("x"), LLMContextOverflowError("x"), LLMEmptyResponseError("x")]
)
async def test_job_level_errors_propagate(exc):
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents)
    with pytest.raises(type(exc)):
        await run(c, FakeLLM(raises={"cut_end": exc}), sents=sents)


async def test_single_option_makes_no_call():
    sents = make_sentences(3)
    units = [unit("u1", 1, 3, sents)]
    c = cand("k1", 1, 1, sents)
    # start: s1 only option -> no call; end: s1,s2,s3 -> call
    llm = FakeLLM(end="s1")
    await refine_candidate(c, units, sents, make_brief(1, 5, 60), llm=llm, rescore=FakeRescore())
    assert [x["schema_name"] for x in llm.calls] == ["cut_end"]


async def test_candidate_at_video_start_and_end_and_non_content_neighbours():
    sents = make_sentences(30)
    units = [unit("u1", 1, 3, sents, "non_content"), unit("u2", 4, 30, sents)]
    c = cand("k1", 4, 12, sents)
    llm = FakeLLM()
    await run(c, llm, units=units, sents=sents)
    assert llm.enums("cut_start") == [["s4", "s5"]]
    c2 = cand("k2", 22, 30, sents)
    llm = FakeLLM()
    await run(c2, llm, units=units, sents=sents)
    assert llm.enums("cut_end") == [["s29", "s30"]]
    assert llm.enums("cut_start") == [["s18", "s19", "s20", "s21", "s22", "s23"]]


async def test_unit_ids_recomputed_on_new_span():
    sents = make_sentences(30)
    units = [unit("u1", 1, 12, sents), unit("u2", 13, 30, sents)]
    c = cand("k1", 12, 20, sents)
    c.unit_ids = ["u1", "u2"]
    out = await run(c, FakeLLM(start="s13", end="s20"), units=units, sents=sents)
    assert out.unit_ids == ["u2"]


async def test_original_input_not_mutated():
    sents = make_sentences(30)
    c = cand("k1", 10, 17, sents)
    snap = c.model_dump()
    await run(c, FakeLLM(start="s8", end="s19"), sents=sents)
    assert c.model_dump() == snap


async def test_invariants_over_all_option_choices():
    sents = make_sentences(30)
    units = [unit("u1", 1, 30, sents)]
    c = cand("k1", 10, 17, sents)
    s_opts, _ = start_options(c, units, sents)
    _, e_opts = end_options(c, units, sents)
    for so in s_opts:
        for eo in e_opts:
            out = await run(c, FakeLLM(start=so.sentence_id, end=eo.sentence_id), sents=sents)
            idx = {s.sentence_id: i for i, s in enumerate(sents)}
            assert idx[out.start_sentence_id] <= idx[out.end_sentence_id]
            assert out.candidate_id == "k1"
            assert 20 <= out.end - out.start <= 60
            by = {s.sentence_id: s for s in sents}
            assert out.start == by[out.start_sentence_id].start
            assert out.end == by[out.end_sentence_id].end


# --------------------------------------------------------------------------- preselect


def pool(sents):
    return [
        cand("k1", 1, 5, sents, answers=answers(5), score=100.0),
        cand("k2", 6, 10, sents, answers=answers(4), score=80.0),
        cand("k3", 11, 15, sents, answers=answers(2), score=40.0),
        cand("k4", 16, 20, sents, answers=answers(5, understandable_alone=False), gates_ok=False, score=100.0),
        cand("k5", 21, 25, sents, answers=answers(4), score=80.0, outcome="error"),
        ScoredCandidate(
            candidate_id="k6", start_sentence_id="s26", end_sentence_id="s30", start=125, end=150, outcome="error"
        ),
    ]


def test_preselect_eligible_ordered_and_limited():
    sents = make_sentences(30)
    p = pool(sents)
    out = preselect(p, min_interest=4, max_cuts=1)
    assert [c.candidate_id for c in out] == ["k1", "k2"]  # ceil(1.5 * 1) = 2
    out = preselect(p, min_interest=4, max_cuts=10)
    assert [c.candidate_id for c in out] == ["k1", "k2"]
    assert all(o.outcome == "pending" for o in p[:4])  # input not mutated
    assert not hasattr(p[0], "fallback") or not p[0].fallback


def test_preselect_limit_is_ceil_factor_times_max():
    sents = make_sentences(30)
    many = [cand(f"k{i}", 1, 5, sents, score=90.0 - i) for i in range(1, 11)]
    for n in (1, 3, 5):
        assert len(preselect(many, min_interest=4, max_cuts=n)) == math.ceil(C.S5_PRESELECT_FACTOR * n)


def test_preselect_does_not_drop_overlapping_candidates():
    sents = make_sentences(30)
    a = cand("k1", 1, 10, sents, score=90.0)
    b = cand("k2", 1, 9, sents, score=80.0)
    assert [c.candidate_id for c in preselect([a, b], min_interest=4, max_cuts=5)] == ["k1", "k2"]


def test_preselect_d21_fallback_pool_when_nothing_reaches_min_interest():
    sents = make_sentences(30)
    p = [
        cand("k1", 1, 5, sents, answers=answers(3), score=60.0),
        cand("k2", 6, 10, sents, answers=answers(4), score=80.0),
        cand("k3", 11, 15, sents, answers=answers(2), score=40.0),
        cand("k4", 16, 20, sents, answers=answers(4), score=80.0, gates_ok=False),
    ]
    out = preselect(p, min_interest=5, max_cuts=10)
    assert [c.candidate_id for c in out] == ["k2"]  # best interest below the minimum, still >= fallback floor
    assert preselect([p[2]], min_interest=5, max_cuts=10) == []  # interest 2 < FALLBACK_INTEREST
    assert preselect([], min_interest=4, max_cuts=3) == []
    assert preselect(p, min_interest=4, max_cuts=0) == []


# --------------------------------------------------------------------------- refine_all


async def test_refine_all_replaces_only_preselected_and_keeps_order():
    sents = make_sentences(30)
    units = [unit("u1", 1, 30, sents)]
    p = [
        cand("k1", 10, 17, sents, answers=answers(2), score=40.0),
        cand("k2", 10, 17, sents, answers=answers(5), score=100.0),
        cand("k3", 12, 19, sents, answers=answers(4), score=80.0, gates_ok=False),
        cand("k4", 14, 21, sents, answers=answers(4), score=80.0),
    ]
    llm = FakeLLM(start="s9", end="s17")
    out = await refine_all(
        p, units, sents, make_brief(), min_interest=4, max_cuts=1, llm=llm, rescore=FakeRescore()
    )
    assert [c.candidate_id for c in out] == ["k1", "k2", "k3", "k4"]
    assert out[0] == p[0] and out[2] == p[2]
    assert out[1].start_sentence_id == "s9"
    assert out[3].start_sentence_id == "s14"  # "s9" is not an option for k4: answer discarded, border kept
    assert len(llm.calls) == 4  # two eligible candidates x (start, end)


async def test_refine_all_with_nothing_eligible_makes_no_call():
    sents = make_sentences(30)
    llm = FakeLLM()
    p = [cand("k1", 10, 17, sents, gates_ok=False)]
    out = await refine_all(
        p, [unit("u1", 1, 30, sents)], sents, make_brief(), min_interest=4, max_cuts=3, llm=llm, rescore=FakeRescore()
    )
    assert out == p and llm.calls == []
