"""Phase 5 part A: audience heatmap signal (analysis_v2.audience_signal, default off). 100% mocked."""

from __future__ import annotations

import json

import random
from typing import Any

import httpx
import pytest

from app.application.runtime_service import OperationCancelledError, ServiceContainer
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.audience import has_heatmap, mean_intensity, normalize_heatmap
from app.domain.analysis.v2.models import ScoreAnswers, ScoredCandidate
from app.domain.analysis.v2.pipeline import analyze_job_v2, resolve_audience_signal, resolve_stage_toggles
from app.domain.analysis.v2.scoring import compute_gates_and_score
from app.domain.analysis.v2.selection import select
from app.domain.ingest.service import build_source_video_info
from test_analysis_v2_pipeline import (  # noqa: E402
    FULL,
    TURKISH,
    FakeLLM,
    _log_text,
    _scored,
    configure,
    good_answers,
    make_words,
    seed_job,
)


# --- normalisation / mean_intensity -------------------------------------------------------------


def test_normalize_heatmap_clamps_sorts_and_drops_malformed() -> None:
    raw = [
        {"start_time": 10, "end_time": 20, "value": 1.7},
        {"start_time": "0", "end_time": "10", "value": -0.5},
        {"start_time": 5, "end_time": 5, "value": 0.5},  # start == end
        {"start_time": 9, "end_time": 3, "value": 0.5},  # start > end
        {"start_time": 1, "end_time": 2},  # no value
        {"start_time": 1, "end_time": 2, "value": "abc"},
        {"start_time": 1, "end_time": 2, "value": float("nan")},
        {"start_time": True, "end_time": 2, "value": 0.1},
        "junk",
        None,
    ]
    out = normalize_heatmap(raw)
    assert out == [
        {"start_time": 0.0, "end_time": 10.0, "value": 0.0},
        {"start_time": 10.0, "end_time": 20.0, "value": 1.0},
    ]
    assert normalize_heatmap(out) == out  # idempotent
    for bad in (None, [], "x", 5, {}):
        assert normalize_heatmap(bad) == []


def test_normalize_heatmap_properties_random() -> None:
    rng = random.Random(7)
    for _ in range(50):
        raw = [
            {"start_time": rng.uniform(-5, 100), "end_time": rng.uniform(-5, 100), "value": rng.uniform(-2, 3)}
            for _ in range(rng.randint(0, 12))
        ]
        out = normalize_heatmap(raw)
        assert out == sorted(out, key=lambda e: (e["start_time"], e["end_time"]))
        for e in out:
            assert 0 <= e["start_time"] < e["end_time"] and 0.0 <= e["value"] <= 1.0


HM = [
    {"start_time": 0, "end_time": 10, "value": 0.2},
    {"start_time": 10, "end_time": 20, "value": 0.8},
    {"start_time": 30, "end_time": 40, "value": 1.0},  # gap 20-30
]


def test_mean_intensity_hand_computed() -> None:
    assert mean_intensity(HM, 0, 20) == pytest.approx(0.5)
    assert mean_intensity(HM, 5, 15) == pytest.approx(0.5)  # partial overlap on both sides
    assert mean_intensity(HM, 5, 10) == pytest.approx(0.2)
    # The gap has no weight: covered time only (10 s of 0.8 and 10 s of 1.0).
    assert mean_intensity(HM, 10, 40) == pytest.approx(0.9)
    assert mean_intensity(HM, 15, 35) == pytest.approx((5 * 0.8 + 5 * 1.0) / 10)
    assert mean_intensity(HM, -50, 100) == pytest.approx((10 * 0.2 + 10 * 0.8 + 10 * 1.0) / 30)


def test_mean_intensity_none_cases() -> None:
    assert mean_intensity(None, 0, 10) is None
    assert mean_intensity([], 0, 10) is None
    assert mean_intensity(HM, 22, 28) is None  # only the gap
    assert mean_intensity(HM, 40, 50) is None  # touching, no overlap
    assert mean_intensity(HM, 5, 5) is None  # zero length
    assert mean_intensity(HM, 8, 3) is None


def test_has_heatmap() -> None:
    assert has_heatmap({"heatmap": HM})
    assert not has_heatmap({})
    assert not has_heatmap({"heatmap": []})
    assert not has_heatmap({"heatmap": [{"start_time": 3, "end_time": 1, "value": 1}]})
    assert not has_heatmap(None)


# --- selection (unit level) ---------------------------------------------------------------------


def _sc(n: int, start: float, *, interest: int = 4, payoff: bool = True, gates: bool = True, visuals: bool = False) -> ScoredCandidate:
    answers = ScoreAnswers(
        premise="p",
        missing_context="",
        understandable_alone=gates,
        has_payoff=payoff,
        ends_complete=True,
        depends_on_visuals=visuals,
        is_non_content=False,
        interest=interest,
        title="t",
    )
    ok, score = compute_gates_and_score(answers)
    return ScoredCandidate(
        candidate_id=f"k{n}",
        start_sentence_id=f"s{n}",
        end_sentence_id=f"s{n}",
        start=start,
        end=start + 10,
        answers=answers,
        gates_ok=ok,
        score=score,
    )


def _run(cands: list[ScoredCandidate], mode: str | None, heatmap: list[dict] | None, **kw: Any) -> list[str]:
    extra = {} if mode is None else {"audience_mode": mode, "heatmap": heatmap}
    sel = select(cands, min_interest=4, max_cuts=kw.pop("max_cuts", 10), iou_threshold=0.35, **extra)
    return [c.candidate_id for c in sorted(sel, key=lambda c: (-c.score, c.start))]


def _heat(values: list[float]) -> list[dict]:
    return [{"start_time": i * 20.0, "end_time": i * 20.0 + 10.0, "value": v} for i, v in enumerate(values)]


def test_off_and_default_are_identical_even_with_a_heatmap() -> None:
    hm = _heat([0.1, 0.9, 0.5])
    a = [_sc(i, i * 20.0) for i in range(3)]
    b = [_sc(i, i * 20.0) for i in range(3)]
    ids_default = [c.candidate_id for c in select(a, min_interest=4, max_cuts=10, iou_threshold=0.35)]
    ids_off = [c.candidate_id for c in select(b, min_interest=4, max_cuts=10, iou_threshold=0.35, audience_mode="off", heatmap=hm)]
    assert ids_default == ids_off == ["k0", "k1", "k2"]
    assert [c.model_dump() for c in a] == [c.model_dump() for c in b]
    assert not hasattr(b[0], "audience_intensity")


def test_tiebreak_only_reorders_exact_ties() -> None:
    hm = _heat([0.1, 0.9, 0.5, 1.0])
    # k0..k2 tie on score; k3 has a lower score (no payoff) but the highest intensity.
    cands = [_sc(0, 0), _sc(1, 20), _sc(2, 40), _sc(3, 60, payoff=False)]
    sel = select(cands, min_interest=4, max_cuts=10, iou_threshold=0.35, audience_mode="tiebreak", heatmap=hm)
    from app.domain.analysis.v2.selection import _order_key

    assert [c.candidate_id for c in sorted(sel, key=_order_key)] == ["k1", "k2", "k0", "k3"]
    assert all(c.score == compute_gates_and_score(c.answers)[1] for c in cands)  # scores untouched
    assert cands[1].audience_mode == "tiebreak" and cands[1].audience_intensity == pytest.approx(0.9)


def test_tiebreak_does_not_override_has_payoff_or_earlier_start_on_equal_intensity() -> None:
    from app.domain.analysis.v2.selection import _order_key

    hm = [{"start_time": 0, "end_time": 200, "value": 0.5}]
    cands = [_sc(0, 0, payoff=True), _sc(1, 20), _sc(2, 40)]
    sel = select(cands, min_interest=4, max_cuts=10, iou_threshold=0.35, audience_mode="tiebreak", heatmap=hm)
    assert [c.candidate_id for c in sorted(sel, key=_order_key)] == ["k0", "k1", "k2"]


def test_tiebreak_can_change_which_candidate_survives_an_overlap_or_cap() -> None:
    hm = _heat([0.1, 0.9])
    cands = [_sc(0, 0), _sc(1, 20)]
    sel = select(cands, min_interest=4, max_cuts=1, iou_threshold=0.35, audience_mode="tiebreak", heatmap=hm)
    assert [c.candidate_id for c in sel] == ["k1"]
    assert cands[0].outcome == "over_cap"


def test_bonus_is_bounded_and_records_values() -> None:
    hm = _heat([1.0, 1.0])
    cands = [_sc(0, 0, interest=3), _sc(1, 20, interest=3)]
    select(cands, min_interest=3, max_cuts=10, iou_threshold=0.35, audience_mode="bonus", heatmap=hm)
    for c in cands:
        assert c.audience_bonus == pytest.approx(C.AUDIENCE_BONUS_MAX_POINTS)
        assert c.score == pytest.approx(60 + C.AUDIENCE_BONUS_MAX_POINTS)
        assert c.score_before_audience == 60 and c.audience_mode == "bonus"


def test_bonus_never_crosses_an_interest_level_random_pools() -> None:
    rng = random.Random(11)
    for _ in range(200):
        n = rng.randint(2, 8)
        cands = [
            _sc(
                i,
                i * 20.0,
                interest=rng.randint(3, 5),
                payoff=rng.random() < 0.6,
                visuals=rng.random() < 0.3,
            )
            for i in range(n)
        ]
        before = {c.candidate_id: (c.score, c.answers.interest) for c in cands}
        hm = _heat([rng.random() for _ in range(n)])
        select(cands, min_interest=3, max_cuts=20, iou_threshold=0.35, audience_mode="bonus", heatmap=hm)
        for x in cands:
            sx, ix = before[x.candidate_id]
            assert sx <= x.score <= sx + C.AUDIENCE_BONUS_MAX_POINTS
            assert x.score <= C.SCORE_MAX
            for y in cands:
                sy, iy = before[y.candidate_id]
                if iy > ix and sy >= sx:
                    assert x.score < y.score  # x is not lifted over a higher-interest y


def test_bonus_never_rescues_a_gate_failure_and_leaves_gates_alone() -> None:
    hm = _heat([1.0, 0.0])
    failed = _sc(0, 0, interest=5, gates=False)
    ok = _sc(1, 20, interest=4)
    sel = select([failed, ok], min_interest=4, max_cuts=10, iou_threshold=0.35, audience_mode="bonus", heatmap=hm)
    assert [c.candidate_id for c in sel] == ["k1"]
    assert failed.outcome == "rejected_gates" and failed.gates_ok is False
    assert not hasattr(failed, "audience_bonus")  # only the pool gets a bonus
    assert failed.audience_intensity == pytest.approx(1.0)  # still recorded


def test_candidate_without_overlap_with_the_heatmap_gets_no_bonus() -> None:
    hm = [{"start_time": 0, "end_time": 10, "value": 1.0}]
    c = _sc(0, 500)
    select([c], min_interest=4, max_cuts=10, iou_threshold=0.35, audience_mode="bonus", heatmap=hm)
    assert c.audience_intensity is None and c.audience_bonus == 0 and c.score == 80


# --- toggle parsing -----------------------------------------------------------------------------


def test_resolve_audience_signal() -> None:
    warns: list[str] = []
    assert resolve_audience_signal(None, warns.append) == "off"
    assert resolve_audience_signal({}, warns.append) == "off"
    assert resolve_audience_signal({"audience_signal": "tiebreak"}, warns.append) == "tiebreak"
    assert resolve_audience_signal({"audience_signal": "bonus"}, warns.append) == "bonus"
    assert warns == []
    assert resolve_audience_signal({"audience_signal": "max"}, warns.append) == "off"
    assert resolve_audience_signal({"audience_signal": True}, warns.append) == "off"
    assert len(warns) == 2
    # The key is not reported as an unknown stage toggle.
    w2: list[str] = []
    resolve_stage_toggles({"audience_signal": "bonus"}, w2.append)
    assert w2 == []


# --- pipeline -----------------------------------------------------------------------------------


def _heat_job(container: ServiceContainer, values: list[float]) -> str:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    info = container.jobs.load_source_info(jid) or {"id": "x", "title": "V2Pipeline"}
    span = 357.0 / len(values)
    info["heatmap"] = [{"start_time": i * span, "end_time": (i + 1) * span, "value": v} for i, v in enumerate(values)]
    container.jobs.save_source_info(jid, info)
    return jid


async def _run_job(
    container: ServiceContainer,
    values: list[float] | None,
    mode: str | None,
    bodies: list[Any] | None = None,
    **extra: Any,
) -> str:
    jid = _heat_job(container, values) if values else seed_job(container, make_words(TURKISH, punctuate=True))
    toggles = dict(FULL)
    if mode is not None:
        toggles["audience_signal"] = mode
    fake = FakeLLM(container, **extra)
    configure(container, analysis_pipeline="v2", analysis_v2=toggles)
    await analyze_job_v2(jid, container=container)
    if bodies is not None:
        bodies.extend(fake.bodies)
    return jid


def _cuts_bytes(container: ServiceContainer, jid: str) -> bytes:
    return (container.jobs.job_dir_path(jid) / "cuts.suggested.json").read_bytes()


def _scored_bytes(container: ServiceContainer, jid: str) -> bytes:
    return (container.jobs.job_dir_path(jid) / "candidates.scored.json").read_bytes()


@pytest.mark.asyncio
async def test_off_or_absent_is_identical_for_a_job_that_has_a_heatmap(container: ServiceContainer) -> None:
    values = [0.1, 0.9, 0.3, 0.7, 0.2, 1.0]
    bodies_absent: list[Any] = []
    bodies_off: list[Any] = []
    bodies_none: list[Any] = []
    j_absent = await _run_job(container, values, None, bodies_absent)
    j_off = await _run_job(container, values, "off", bodies_off)
    assert bodies_absent and json.dumps(bodies_absent, sort_keys=True) == json.dumps(bodies_off, sort_keys=True)
    assert _cuts_bytes(container, j_absent) == _cuts_bytes(container, j_off)
    scored_a, scored_o = _scored(container, j_absent), _scored(container, j_off)
    assert scored_a == scored_o
    assert "audience_signal" not in scored_a
    assert all("audience_intensity" not in c and "audience_mode" not in c for c in scored_a["candidates"])
    assert "audience" not in _log_text(container, j_off)
    # And the same as a job without any heatmap.
    j_none = await _run_job(container, None, None, bodies_none)
    assert json.dumps(bodies_none, sort_keys=True) == json.dumps(bodies_absent, sort_keys=True)
    assert _cuts_bytes(container, j_none) == _cuts_bytes(container, j_absent)
    assert _scored(container, j_none) == scored_a


@pytest.mark.asyncio
@pytest.mark.parametrize("mode", ["tiebreak", "bonus"])
async def test_videos_without_a_heatmap_are_identical_under_every_mode(container: ServiceContainer, mode: str) -> None:
    base = await _run_job(container, None, None)
    other = await _run_job(container, None, mode)
    assert _cuts_bytes(container, base) == _cuts_bytes(container, other)
    scored = _scored(container, other)
    assert scored == _scored(container, base)
    assert "no heatmap" in _log_text(container, other)  # the fallback is logged, not silent


@pytest.mark.asyncio
async def test_tiebreak_reorders_ties_and_records_intensity_per_candidate(container: ServiceContainer) -> None:
    values = [0.1, 0.1, 0.1, 0.2, 0.9, 1.0]  # later parts of the video are replayed the most
    j_off = await _run_job(container, values, "off")
    j_tb = await _run_job(container, values, "tiebreak")
    cuts_off = container.jobs.load_cuts(j_off)
    cuts_tb = container.jobs.load_cuts(j_tb)
    assert {(c.start, c.end) for c in cuts_off} == {(c.start, c.end) for c in cuts_tb}  # same cuts, same scores
    assert [c.score for c in cuts_off] == [c.score for c in cuts_tb]
    assert cuts_off[0].start < cuts_tb[0].start  # the most replayed cut now comes first
    scored = _scored(container, j_tb)
    assert scored["audience_signal"] == "tiebreak"
    cands = scored["candidates"]
    assert all(c["audience_mode"] == "tiebreak" for c in cands)
    assert any(c["audience_intensity"] is not None for c in cands)
    assert all("audience_bonus" not in c for c in cands)


@pytest.mark.asyncio
async def test_bonus_in_the_pipeline_is_bounded_and_does_not_change_the_gates(container: ServiceContainer) -> None:
    values = [0.0, 0.0, 0.0, 1.0, 1.0, 1.0]
    j_off = await _run_job(container, values, "off")
    j_b = await _run_job(container, values, "bonus")
    off = {c["candidate_id"]: c for c in _scored(container, j_off)["candidates"]}
    on = {c["candidate_id"]: c for c in _scored(container, j_b)["candidates"]}
    assert off.keys() == on.keys()
    for cid, c in on.items():
        assert c["gates_ok"] == off[cid]["gates_ok"]
        assert 0 <= c["score"] - off[cid]["score"] <= C.AUDIENCE_BONUS_MAX_POINTS
    assert any(c.get("audience_bonus", 0) > 0 for c in on.values())


@pytest.mark.asyncio
async def test_unknown_toggle_value_warns_and_acts_as_off(container: ServiceContainer) -> None:
    values = [0.1, 0.9, 0.3, 0.7, 0.2, 1.0]
    j_off = await _run_job(container, values, "off")
    j_bad = await _run_job(container, values, "sometimes")
    assert "is not one of" in _log_text(container, j_bad)
    assert _cuts_bytes(container, j_bad) == _cuts_bytes(container, j_off)
    assert _scored(container, j_bad) == _scored(container, j_off)


# --- route fix (D23 known limitation) -----------------------------------------------------------


@pytest.mark.asyncio
async def test_cancelled_analysis_through_the_route_returns_409_not_500(
    async_client: httpx.AsyncClient, container: ServiceContainer, monkeypatch: pytest.MonkeyPatch
) -> None:
    from app.api.routers import jobs_analysis

    async def cancelled(job_id: str, **kwargs: Any) -> Any:
        raise OperationCancelledError(job_id, "analysis")

    monkeypatch.setattr(jobs_analysis, "analyze_job", cancelled)
    resp = await async_client.post("/jobs/some-job/analyze")
    assert resp.status_code == 409
    assert resp.json()["detail"] == "Analysis cancelled"


@pytest.mark.asyncio
async def test_cancelled_v2_analysis_through_the_route_returns_409(
    async_client: httpx.AsyncClient, container: ServiceContainer
) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    FakeLLM(container)
    configure(container, analysis_pipeline="v2", analysis_v2=FULL)

    orig = container.runtime.create_cancel_token

    def create(job_id: str, task: str) -> Any:
        tok = orig(job_id, task)
        if task == "analysis":
            tok.set()  # cancelled before the first LLM call
        return tok

    container.runtime.create_cancel_token = create  # type: ignore[method-assign]
    resp = await async_client.post(f"/jobs/{jid}/analyze")
    assert resp.status_code == 409
    assert container.jobs.load_job(jid).status.value == "DOWNLOADED"
