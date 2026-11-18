"""Phase 2 - S3 candidates, S4 scoring and S6 selection of the v2 analysis pipeline.

100% mocked: the LLM is a fake callable defined in this file.
"""

from __future__ import annotations

import pytest

from app.application.runtime_service import OperationCancelledError
from app.domain.analysis.lookaround import compute_temporal_iou
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.candidates import build_candidates, merge_candidate
from app.domain.analysis.v2.models import (
    Brief,
    Candidate,
    ScoreAnswers,
    ScoredCandidate,
    Sentence,
    Unit,
    UnitSeconds,
)
from app.domain.analysis.v2.scoring import compute_gates_and_score, score_all, score_candidate
from app.domain.analysis.v2.selection import select, to_cuts, used_fallback
from app.models.domain import Cut, SemanticBlock

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


def make_brief(min_s=20.0, typ=40.0, max_s=60.0) -> Brief:
    return Brief(unit_seconds=UnitSeconds(min=min_s, typical=typ, max=max_s))


def unit(uid, a, b, sentences, kind="content") -> Unit:
    s = {x.sentence_id: x for x in sentences}
    return Unit(
        unit_id=uid,
        start_sentence_id=f"s{a}",
        end_sentence_id=f"s{b}",
        start=s[f"s{a}"].start,
        end=s[f"s{b}"].end,
        kind=kind,
    )


def answers(**kw) -> dict:
    base = dict(
        premise="p",
        missing_context="",
        understandable_alone=True,
        has_payoff=True,
        ends_complete=True,
        depends_on_visuals=False,
        is_non_content=False,
        interest=4,
        title="t",
    )
    base.update(kw)
    return base


class FakeLLM:
    """Records calls; answers scoring by candidate first sentence id, sub-span by a fixed reply."""

    def __init__(self, scoring=None, spans=None, fail_on=(), default=None):
        self.scoring = scoring or {}  # key "first-last" -> answers dict
        self.spans = spans
        self.fail_on = set(fail_on)
        self.default = default if default is not None else answers()
        self.calls: list[dict] = []

    async def __call__(self, system_prompt, user_prompt, **kw):
        self.calls.append({"system": system_prompt, "user": user_prompt, **kw})
        if kw["schema_name"] == "unit_subspans":
            if self.spans == "raise":
                raise RuntimeError("boom")
            return ({"spans": self.spans or []}, "")
        cut = user_prompt.split("<<<CUT>>>")[1].split("<<<END CUT>>>")[0].strip().splitlines()
        first = cut[0].split()[0].rstrip(":")
        last = cut[-1].split()[0].rstrip(":")
        key = f"{first}-{last}"
        if key in self.fail_on:
            raise RuntimeError("scoring boom")
        return (self.scoring.get(key, self.default), "")


def sc(cid, a, b, sentences, **ans) -> ScoredCandidate:
    s = {x.sentence_id: x for x in sentences}
    ra = ScoreAnswers(**answers(**ans))
    gates, score = compute_gates_and_score(ra)
    return ScoredCandidate(
        candidate_id=cid,
        start_sentence_id=f"s{a}",
        end_sentence_id=f"s{b}",
        start=s[f"s{a}"].start,
        end=s[f"s{b}"].end,
        unit_ids=["u1"],
        answers=ra,
        gates_ok=gates,
        score=score,
    )


# --------------------------------------------------------------------- S3


async def test_s3_short_unit_alone_nothing_and_non_content_excluded():
    sents = make_sentences(30)
    units = [
        unit("u1", 1, 2, sents),  # 10s < min
        unit("u2", 3, 8, sents),  # 30s ok
        unit("u3", 9, 12, sents, kind="non_content"),  # 20s non_content
    ]
    cands = await build_candidates(units, sents, make_brief(), llm=None)
    assert [c.unit_ids for c in cands] == [["u2"]]
    assert cands[0].origin == "unit"
    assert (cands[0].start, cands[0].end) == (10.0, 40.0)


async def test_s3_unit_equal_to_bounds_is_candidate():
    sents = make_sentences(30)
    units = [unit("u1", 1, 4, sents), unit("u2", 5, 16, sents)]  # 20s and 60s
    cands = await build_candidates(units, sents, make_brief(), llm=None)
    assert len(cands) == 2


async def test_s3_long_unit_triggers_subspan_call_with_exact_enum():
    sents = make_sentences(30)
    units = [unit("u1", 1, 2, sents), unit("u2", 11, 30, sents)]  # u2: 95s > 60
    spans = [{"start_sentence_id": "s12", "end_sentence_id": "s19"}]  # 40s
    llm = FakeLLM(spans=spans)
    cands = await build_candidates(units, sents, make_brief(), llm=llm)
    assert len(llm.calls) == 1
    call = llm.calls[0]
    ids = [f"s{i}" for i in range(11, 31)]
    props = call["json_schema"]["properties"]["spans"]["items"]["properties"]
    assert props["start_sentence_id"]["enum"] == ids
    assert props["end_sentence_id"]["enum"] == ids
    assert call["acquire_gpu_slot"] is False
    assert call["max_tokens"] == C.MAX_TOKENS_SUBSPAN
    assert [(c.start_sentence_id, c.end_sentence_id, c.origin) for c in cands] == [("s12", "s19", "subspan")]
    assert cands[0].unit_ids == ["u2"]


async def test_s3_invalid_spans_discarded():
    sents = make_sentences(30)
    units = [unit("u2", 11, 30, sents)]
    spans = [
        {"start_sentence_id": "s20", "end_sentence_id": "s12"},  # start after end
        {"start_sentence_id": "s11", "end_sentence_id": "s12"},  # 10s < min
        {"start_sentence_id": "s11", "end_sentence_id": "s30"},  # 95s > max
        {"start_sentence_id": "s13", "end_sentence_id": "s20"},  # valid 40s
        {"start_sentence_id": "s13", "end_sentence_id": "s20"},  # duplicate
        {"start_sentence_id": "s99", "end_sentence_id": "s20"},  # not in unit
    ]
    llm = FakeLLM(spans=spans)
    cands = await build_candidates(units, sents, make_brief(), llm=llm)
    assert [(c.start_sentence_id, c.end_sentence_id) for c in cands] == [("s13", "s20")]


async def test_s3_overlapping_spans_keep_first_and_cap():
    sents = make_sentences(30)
    units = [unit("u2", 11, 30, sents)]
    spans = [
        {"start_sentence_id": "s11", "end_sentence_id": "s18"},
        {"start_sentence_id": "s15", "end_sentence_id": "s22"},  # overlaps
        {"start_sentence_id": "s23", "end_sentence_id": "s30"},
    ]
    cands = await build_candidates(units, sents, make_brief(), llm=FakeLLM(spans=spans))
    assert [(c.start_sentence_id, c.end_sentence_id) for c in cands] == [("s11", "s18"), ("s23", "s30")]
    assert len(cands) <= C.MAX_SUBSPANS_PER_UNIT


async def test_s3_failed_subspan_call_discards_only_that_unit_and_logs():
    sents = make_sentences(60)
    units = [unit("u1", 1, 20, sents), unit("u2", 21, 28, sents)]  # u1 100s long, u2 40s
    logs: list[str] = []
    cands = await build_candidates(units, sents, make_brief(), llm=FakeLLM(spans="raise"), log=logs.append)
    assert [c.unit_ids for c in cands] == [["u2"]]
    assert any("u1" in m for m in logs)


async def test_s3_cancellation_propagates():
    sents = make_sentences(30)

    async def llm(*a, **k):
        raise OperationCancelledError("cancelled")

    with pytest.raises(OperationCancelledError):
        await build_candidates([unit("u1", 1, 30, sents)], sents, make_brief(), llm=llm)


async def test_s3_candidates_never_contain_non_content_sentences():
    sents = make_sentences(30)
    units = [unit("u1", 1, 6, sents), unit("u2", 7, 10, sents, kind="non_content"), unit("u3", 11, 18, sents)]
    cands = await build_candidates(units, sents, make_brief(), llm=None)
    banned = {f"s{i}" for i in range(7, 11)}
    from app.domain.analysis.v2.sentences import sentences_between

    for c in cands:
        ids = {s.sentence_id for s in sentences_between(sents, c.start_sentence_id, c.end_sentence_id)}
        assert not (ids & banned)


# ------------------------------------------------------------------ merge


def merge_fixture():
    sents = make_sentences(30)
    units = [
        unit("u1", 1, 6, sents),  # 30s
        unit("u2", 7, 12, sents),  # 30s
        unit("u3", 13, 18, sents, kind="non_content"),  # 30s
        unit("u4", 19, 24, sents),  # 30s
        unit("u5", 25, 30, sents),  # 30s
    ]
    return sents, units


def cand_of(u: Unit, cid="k1") -> Candidate:
    return Candidate(
        candidate_id=cid,
        start_sentence_id=u.start_sentence_id,
        end_sentence_id=u.end_sentence_id,
        start=u.start,
        end=u.end,
        unit_ids=[u.unit_id],
    )


def test_merge_prev_and_next():
    sents, units = merge_fixture()
    brief = make_brief(max_s=70)
    c = cand_of(units[1])
    prev = merge_candidate(c, units, sents, brief, side="prev")
    nxt = merge_candidate(c, units, sents, brief, side="next")
    assert prev is None or prev.start_sentence_id == "s1"
    assert prev.end_sentence_id == "s12" and prev.origin == "merge_prev"
    assert prev.unit_ids == ["u1", "u2"]
    assert nxt is None  # next unit is non_content


def test_merge_forward():
    sents, units = merge_fixture()
    c = cand_of(units[3])
    nxt = merge_candidate(c, units, sents, make_brief(max_s=70), side="next")
    assert (nxt.start_sentence_id, nxt.end_sentence_id) == ("s19", "s30")
    assert nxt.origin == "merge_next" and nxt.unit_ids == ["u4", "u5"]


def test_merge_refused_cross_non_content_edges_and_max():
    sents, units = merge_fixture()
    brief = make_brief(max_s=70)
    assert merge_candidate(cand_of(units[3]), units, sents, brief, side="prev") is None  # u3 non_content
    assert merge_candidate(cand_of(units[0]), units, sents, brief, side="prev") is None  # no previous
    assert merge_candidate(cand_of(units[4]), units, sents, brief, side="next") is None  # no next
    assert merge_candidate(cand_of(units[3]), units, sents, make_brief(max_s=50), side="next") is None  # 60 > 50
    with pytest.raises(ValueError):
        merge_candidate(cand_of(units[3]), units, sents, brief, side="up")


# ------------------------------------------------------------------- S4


@pytest.mark.parametrize("understandable", [True, False])
@pytest.mark.parametrize("ends", [True, False])
@pytest.mark.parametrize("non_content", [True, False])
@pytest.mark.parametrize("payoff", [True, False])
@pytest.mark.parametrize("visuals", [True, False])
@pytest.mark.parametrize("interest", [1, 2, 3, 4, 5])
def test_gates_and_score_formula(understandable, ends, non_content, payoff, visuals, interest):
    a = ScoreAnswers(
        **answers(
            understandable_alone=understandable,
            ends_complete=ends,
            is_non_content=non_content,
            has_payoff=payoff,
            depends_on_visuals=visuals,
            interest=interest,
        )
    )
    gates, score = compute_gates_and_score(a)
    assert gates == (understandable and ends and not non_content)
    expected = interest * 20 - (0 if payoff else 10) - (5 if visuals else 0)
    assert score == expected
    assert 0 <= score <= 100


async def test_score_candidate_prompt_context_and_schema():
    sents = make_sentences(30)
    brief = make_brief()
    c = Candidate(candidate_id="k1", start_sentence_id="s10", end_sentence_id="s12", start=45, end=60)
    llm = FakeLLM()
    out = await score_candidate(c, sents, brief, llm=llm)
    call = llm.calls[0]
    user = call["user"]
    before = user.split("<<<CONTEXT BEFORE")[1].split("<<<END CONTEXT BEFORE>>>")[0]
    after = user.split("<<<CONTEXT AFTER")[1].split("<<<END CONTEXT AFTER>>>")[0]
    assert all(f"s{i} " in before or f"s{i}" in before for i in (7, 8, 9)) and "s6 " not in before
    assert "s13" in after and "s14" in after and "s15" not in after
    assert call["max_tokens"] == C.MAX_TOKENS_SCORING and call["acquire_gpu_slot"] is False
    assert list(call["json_schema"]["properties"])[-2:] == ["interest", "title"]
    assert out.gates_ok and out.score == 80 and out.outcome == "pending"


async def test_score_candidate_edges_have_fewer_context_sentences():
    sents = make_sentences(6)
    c = Candidate(candidate_id="k1", start_sentence_id="s1", end_sentence_id="s6", start=0, end=30)
    llm = FakeLLM()
    await score_candidate(c, sents, make_brief(), llm=llm)
    assert "(nothing)" in llm.calls[0]["user"]


async def test_identical_system_prompt_across_candidates():
    sents = make_sentences(30)
    cands = [
        Candidate(candidate_id=f"k{i}", start_sentence_id=f"s{i}", end_sentence_id=f"s{i + 5}", start=0, end=30)
        for i in (1, 8, 15)
    ]
    llm = FakeLLM()
    await score_all(cands, [], sents, make_brief(), llm=llm)
    assert len({c["system"] for c in llm.calls}) == 1


async def test_failed_call_and_invalid_answer_only_affect_that_candidate():
    sents = make_sentences(30)
    cands = [
        Candidate(candidate_id="k1", start_sentence_id="s1", end_sentence_id="s6", start=0, end=30),
        Candidate(candidate_id="k2", start_sentence_id="s7", end_sentence_id="s12", start=30, end=60),
        Candidate(candidate_id="k3", start_sentence_id="s13", end_sentence_id="s18", start=60, end=90),
    ]
    llm = FakeLLM(fail_on={"s1-s6"}, scoring={"s7-s12": {"premise": "x"}})
    logs: list[str] = []
    out = await score_all(cands, [], sents, make_brief(), llm=llm, log=logs.append)
    by = {c.candidate_id: c for c in out}
    assert by["k1"].outcome == "error" and "scoring boom" in by["k1"].outcome_reason
    assert by["k2"].outcome == "error"
    assert by["k3"].outcome == "pending" and by["k3"].gates_ok
    assert len(logs) == 2


async def test_interest_out_of_range_is_error():
    sents = make_sentences(10)
    c = Candidate(candidate_id="k1", start_sentence_id="s1", end_sentence_id="s6", start=0, end=30)
    out = await score_candidate(c, sents, make_brief(), llm=FakeLLM(default=answers(interest=9)))
    assert out.outcome == "error"


async def test_cancellation_propagates_from_scoring():
    sents = make_sentences(10)

    async def llm(*a, **k):
        raise OperationCancelledError("cancelled")

    c = Candidate(candidate_id="k1", start_sentence_id="s1", end_sentence_id="s6", start=0, end=30)
    with pytest.raises(OperationCancelledError):
        await score_candidate(c, sents, make_brief(), llm=llm)


async def test_merge_backward_supersedes_original_and_bookkeeping():
    sents, units = merge_fixture()
    brief = make_brief(max_s=70)
    orig = cand_of(units[1], "k1")
    llm = FakeLLM(
        scoring={
            "s7-s12": answers(understandable_alone=False, interest=4),
            "s1-s12": answers(),
        }
    )
    out = await score_all([orig], units, sents, brief, llm=llm)
    by = {c.candidate_id: c for c in out}
    assert by["k1"].outcome == "rejected_gates" and by["k1"].superseded_by == "k2"
    assert "superseded by k2" in by["k1"].outcome_reason
    m = by["k2"]
    assert m.origin == "merge_prev" and m.merged_from == "k1" and m.gates_ok
    assert len(out) == 2  # next side blocked by non_content, no merge of merge


async def test_merge_forward_and_both_sides_at_most_one_each_and_no_chain():
    sents = make_sentences(30)
    units = [unit("u1", 1, 6, sents), unit("u2", 7, 12, sents), unit("u3", 13, 18, sents)]
    brief = make_brief(max_s=100)
    bad = answers(understandable_alone=False, ends_complete=False, interest=4)
    llm = FakeLLM(scoring={"s7-s12": bad}, default=bad)
    out = await score_all([cand_of(units[1], "k1")], units, sents, brief, llm=llm)
    ids = sorted(c.candidate_id for c in out)
    assert ids == ["k1", "k2", "k3"]  # one per side; merged ones (also failing) spawn nothing
    assert len(llm.calls) == 3
    assert all(getattr(c, "superseded_by", None) is None for c in out)


async def test_no_merge_below_interest_or_when_gates_ok():
    sents, units = merge_fixture()
    brief = make_brief(max_s=70)
    low = FakeLLM(default=answers(understandable_alone=False, interest=2))
    out = await score_all([cand_of(units[1])], units, sents, brief, llm=low)
    assert len(out) == 1
    ok = FakeLLM()
    out = await score_all([cand_of(units[1])], units, sents, brief, llm=ok)
    assert len(out) == 1


async def test_merge_refused_when_exceeding_max_not_scored():
    sents, units = merge_fixture()
    brief = make_brief(max_s=40)  # 30 + 30 = 60 > 40
    llm = FakeLLM(default=answers(understandable_alone=False, interest=5))
    out = await score_all([cand_of(units[1])], units, sents, brief, llm=llm)
    assert len(out) == 1 and len(llm.calls) == 1


# ------------------------------------------------------------------- S6


def test_select_invariants_cap_overlap_and_outcomes():
    sents = make_sentences(40)
    cs = [
        sc("a", 1, 8, sents, interest=5),  # 0-40, 100
        sc("b", 2, 9, sents, interest=4),  # overlaps a heavily
        sc("c", 10, 17, sents, interest=4),  # 80
        sc("d", 18, 25, sents, interest=4),  # 80
        sc("e", 26, 33, sents, interest=4),  # 80 -> over cap
        sc("f", 34, 40, sents, interest=2),  # below min
        sc("g", 34, 40, sents, understandable_alone=False, interest=4),  # gates
    ]
    err = ScoredCandidate(
        candidate_id="h", start_sentence_id="s1", end_sentence_id="s2", start=0, end=10, outcome="error"
    )
    sup = sc("i", 1, 8, sents)
    sup.outcome, sup.gates_ok, sup.superseded_by = "rejected_gates", False, "z"
    allc = [*cs, err, sup]
    sel = select(allc, min_interest=4, max_cuts=3, iou_threshold=C.IOU_THRESHOLD)
    assert [c.candidate_id for c in sel] == ["a", "c", "d"]
    out = {c.candidate_id: c.outcome for c in allc}
    assert out == {
        "a": "selected",
        "b": "overlap",
        "c": "selected",
        "d": "selected",
        "e": "over_cap",
        "f": "below_min_interest",
        "g": "rejected_gates",
        "h": "error",
        "i": "rejected_gates",
    }
    assert all(c.outcome != "pending" for c in allc)
    assert all(c.outcome_reason for c in allc if c.outcome in ("overlap", "over_cap", "below_min_interest"))
    for i, x in enumerate(sel):
        for y in sel[i + 1 :]:
            assert compute_temporal_iou(x.start, x.end, y.start, y.end) <= C.IOU_THRESHOLD
    assert not used_fallback(sel)


def test_select_order_and_tiebreak_payoff_then_earlier():
    sents = make_sentences(40)
    # same score 70: interest 4 with no payoff (80-10) vs interest 4 without... build explicitly
    early_nopayoff = sc("early", 1, 6, sents, interest=4, has_payoff=False)  # 70
    late_payoff = sc("late", 20, 25, sents, interest=4, has_payoff=False)  # 70
    payoff_low = sc("pay", 30, 35, sents, interest=4, has_payoff=True)  # 80
    sel = select([late_payoff, early_nopayoff, payoff_low], min_interest=4, max_cuts=10, iou_threshold=0.35)
    assert [c.candidate_id for c in sel] == ["pay", "early", "late"]


def test_select_tiebreak_has_payoff_beats_start_on_equal_score():
    sents = make_sentences(40)
    a = sc("a", 1, 6, sents, interest=4, has_payoff=False, depends_on_visuals=False)  # 70
    b = sc("b", 20, 25, sents, interest=3, has_payoff=True, depends_on_visuals=False)  # 60 (not same)
    # make equal score: interest 4 no payoff (70) vs interest 4 payoff + visuals ... 75; use manual score
    b.answers.interest = 4
    b.score = 70.0
    sel = select([a, b], min_interest=4, max_cuts=5, iou_threshold=0.35)
    assert [c.candidate_id for c in sel] == ["b", "a"]


def test_select_d14_fallback_and_none_when_nothing():
    sents = make_sentences(40)
    cs = [
        sc("a", 1, 6, sents, interest=3),
        sc("b", 8, 13, sents, interest=3),
        sc("c", 15, 20, sents, interest=3),
        sc("d", 22, 27, sents, interest=3),
        sc("e", 29, 34, sents, interest=2),
        sc("f", 35, 40, sents, interest=3, ends_complete=False),
    ]
    sel = select(cs, min_interest=4, max_cuts=10, iou_threshold=0.35)
    assert len(sel) == C.FALLBACK_CANDIDATE_COUNT
    assert used_fallback(sel)
    assert all(c.answers.interest == C.FALLBACK_INTEREST and c.gates_ok for c in sel)
    assert {c.outcome for c in cs if c not in sel} <= {"below_min_interest", "rejected_gates", "over_cap"}
    cuts = to_cuts(sel, sents, [], snap=None)
    assert all(c.status == "pending" and not c.approved for c in cuts)
    # nothing at all: no fabrication
    nothing = [sc("x", 1, 6, sents, interest=2), sc("y", 8, 13, sents, understandable_alone=False)]
    assert select(nothing, min_interest=4, max_cuts=10, iou_threshold=0.35) == []


def test_select_fallback_not_used_when_some_reach_min():
    sents = make_sentences(40)
    cs = [sc("a", 1, 6, sents, interest=4), sc("b", 8, 13, sents, interest=3)]
    sel = select(cs, min_interest=4, max_cuts=10, iou_threshold=0.35)
    assert [c.candidate_id for c in sel] == ["a"] and not used_fallback(sel)
    assert cs[1].outcome == "below_min_interest"


def test_to_cuts_mapping_valid_cut_model_and_blocks():
    sents = make_sentences(40)
    a = sc("a", 3, 8, sents, interest=5, title="Başlık", premise="Premissa", missing_context="x")
    b = sc("b", 20, 26, sents, interest=4)
    sel = select([b, a], min_interest=4, max_cuts=5, iou_threshold=0.35)
    blocks = [
        SemanticBlock(block_id="b1", start=0, end=10, text="x"),
        SemanticBlock(block_id="b2", start=10, end=20, text="x"),
        SemanticBlock(block_id="b3", start=20, end=40, text="x"),
        SemanticBlock(block_id="b4", start=100, end=120, text="x"),
        SemanticBlock(block_id="b5", start=135, end=150, text="x"),
    ]
    snap = lambda s, e: (s + 0.1, e - 0.1)  # noqa: E731
    cuts = to_cuts(sel, sents, blocks, snap=snap)
    assert all(isinstance(c, Cut) for c in cuts)
    assert [c.cut_id for c in cuts] == ["c1", "c2"]
    assert a.cut_id == "c1" and b.cut_id == "c2"
    c1 = cuts[0]
    assert c1.id == "c1" and c1.status == "pending"
    assert (c1.start, c1.end) == (10.1, 39.9)
    assert c1.duration == pytest.approx(c1.end - c1.start, abs=0.01) and c1.duration_seconds == c1.duration
    assert c1.title == "Başlık" and c1.summary == "Premissa" and c1.content_reason == "Premissa"
    assert c1.score == 100 and c1.reasoning == c1.hook_reason and "Premissa" in c1.reasoning
    assert c1.block_ids == ["b2", "b3"] or c1.block_ids == ["b1", "b2", "b3"][1:]
    assert c1.block_ids == [bl.block_id for bl in blocks if bl.start < c1.end and bl.end > c1.start]
    assert c1.sentence_ids == [f"s{i}" for i in range(3, 9)]
    assert c1.interest == 5 and c1.pipeline == "v2"
    Cut.model_validate(c1.model_dump())  # valid for the existing model


def test_to_cuts_without_snap_keeps_sentence_bounds():
    sents = make_sentences(20)
    s = sc("a", 5, 10, sents)
    cuts = to_cuts([s], sents, [], snap=None)
    assert (cuts[0].start, cuts[0].end) == (20.0, 50.0)
    assert cuts[0].block_ids == []


def test_select_d14_uses_highest_interest_below_min():
    sents = make_sentences(80)
    cs = [
        sc("a", 1, 6, sents, interest=4),
        sc("b", 20, 26, sents, interest=4),
        sc("c", 40, 46, sents, interest=3),
    ]
    sel = select(cs, min_interest=5, max_cuts=10, iou_threshold=0.35)
    assert sorted(c.candidate_id for c in sel) == ["a", "b"] and used_fallback(sel)


def test_select_d14_overlap_removed_before_truncating_to_three():
    sents = make_sentences(120)
    cs = [
        sc("a", 1, 8, sents, interest=3),
        sc("b", 2, 9, sents, interest=3),
        sc("c", 3, 10, sents, interest=3),
        sc("d", 60, 67, sents, interest=3),
    ]
    sel = select(cs, min_interest=4, max_cuts=10, iou_threshold=0.35)
    assert sorted(c.candidate_id for c in sel) == ["a", "d"]


def test_superseded_original_keeps_link_after_select():
    sents = make_sentences(40)
    o = sc("o", 1, 6, sents, understandable_alone=False, interest=4)
    o.superseded_by = "m"
    select([o], min_interest=4, max_cuts=3, iou_threshold=0.35)
    assert o.outcome == "rejected_gates" and "superseded by m" in o.outcome_reason


async def test_s3_discards_are_returned_for_persistence():
    sents = make_sentences(60)
    units = [unit("u1", 1, 20, sents), unit("u2", 21, 28, sents)]
    discarded: list[dict] = []
    await build_candidates(units, sents, make_brief(), llm=FakeLLM(spans="raise"), discarded=discarded)
    assert [d["unit_id"] for d in discarded] == ["u1"] and "boom" in discarded[0]["reason"]
    discarded.clear()
    await build_candidates(units, sents, make_brief(), llm=FakeLLM(spans=[]), discarded=discarded)
    assert [d["unit_id"] for d in discarded] == ["u1"]


class _Raising:
    def __init__(self, exc):
        self.exc = exc

    async def __call__(self, *a, **kw):
        raise self.exc


@pytest.mark.parametrize("exc_cls", ["LLMContextOverflowError", "LLMEmptyResponseError"])
async def test_overflow_and_empty_response_are_job_errors_not_per_candidate(exc_cls):
    from app.infrastructure.llm import unified_adapter as ua

    exc = getattr(ua, exc_cls)("x")
    sents = make_sentences(30)
    c = Candidate(candidate_id="k1", start_sentence_id="s1", end_sentence_id="s6", start=0, end=30)
    with pytest.raises(getattr(ua, exc_cls)):
        await score_candidate(c, sents, make_brief(), llm=_Raising(exc))
    units = [unit("u1", 1, 20, sents)]
    with pytest.raises(getattr(ua, exc_cls)):
        await build_candidates(units, sents, make_brief(), llm=_Raising(exc))
