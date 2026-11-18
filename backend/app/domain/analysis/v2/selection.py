"""S6 - selection and assembly of Cut objects."""

from __future__ import annotations

from collections.abc import Callable, Sequence

from app.domain.analysis.lookaround import compute_temporal_iou
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.audience import mean_intensity
from app.domain.analysis.v2.models import ScoredCandidate, Sentence
from app.domain.analysis.v2.sentences import sentences_between
from app.models.domain import Cut, SemanticBlock

FALLBACK_REASON = "fallback: nothing reached the minimum interest"


def used_fallback(selected: Sequence[ScoredCandidate]) -> bool:
    """True when the D14 fallback produced this selection (for the pipeline to log)."""
    return any(getattr(c, "fallback", False) for c in selected)


def _order_key(c: ScoredCandidate) -> tuple:
    has_payoff = bool(c.answers.has_payoff) if c.answers else False
    # The audience intensity exists only when analysis_v2.audience_signal is on and a heatmap is present;
    # otherwise it is the constant 0.0 and the key orders exactly as before.
    intensity = getattr(c, "audience_intensity", None) or 0.0
    return (-c.score, 0 if has_payoff else 1, -intensity, c.start, c.candidate_id)


def apply_audience_bonus(pool: Sequence[ScoredCandidate]) -> None:
    """``audience_signal="bonus"``: add at most AUDIENCE_BONUS_MAX_POINTS * intensity to each pool score.

    Cannot cross an interest level: for a candidate X, every Y in the pool with a higher interest and
    score_Y >= score_X (the only ones X does not already trail) limits X's bonus to half the gap, so the adjusted
    X stays strictly below the unadjusted Y (and Y's own bonus is >= 0); with a gap of 0 the bonus is 0. The pool
    holds gate-passing candidates only, so a gate failure is never rescued. Scores are clamped to SCORE_MAX.
    """
    base = {id(c): c.score for c in pool}
    for x in pool:
        intensity = getattr(x, "audience_intensity", None) or 0.0
        bonus = C.AUDIENCE_BONUS_MAX_POINTS * intensity
        limits = [
            base[id(y)]
            for y in pool
            if y.answers and x.answers and y.answers.interest > x.answers.interest and base[id(y)] >= base[id(x)]
        ]
        if limits:
            bonus = min(bonus, (min(limits) - base[id(x)]) / 2.0)
        bonus = max(0.0, min(bonus, C.SCORE_MAX - base[id(x)]))
        x.score_before_audience = base[id(x)]
        x.audience_bonus = round(bonus, C.AUDIENCE_INTENSITY_DECIMALS)
        x.score = base[id(x)] + bonus


def select(
    scored: Sequence[ScoredCandidate],
    *,
    min_interest: int,
    max_cuts: int,
    iou_threshold: float,
    audience_mode: str = "off",
    heatmap: Sequence[dict] | None = None,
) -> list[ScoredCandidate]:
    """Set outcome/outcome_reason on every candidate and return the selected ones.

    The candidates are updated in place (the returned list holds the same objects),
    so the caller can persist the full list afterwards.
    """
    audience_on = audience_mode in ("tiebreak", "bonus") and bool(heatmap)
    if audience_on:
        # Recorded on every candidate (candidates.scored.json); never touches outcome or the gates.
        for c in scored:
            intensity = mean_intensity(heatmap, c.start, c.end)
            c.audience_intensity = None if intensity is None else round(intensity, C.AUDIENCE_INTENSITY_DECIMALS)
            c.audience_mode = audience_mode
    eligible: list[ScoredCandidate] = []
    for c in scored:
        if c.outcome == "error":
            continue
        a = c.answers
        if a is None:
            c.outcome, c.outcome_reason = "error", "missing answers"
        elif not c.gates_ok:
            c.outcome = "rejected_gates"
            superseded_by = getattr(c, "superseded_by", None)
            c.outcome_reason = (f"superseded by {superseded_by}; " if superseded_by else "") + (
                f"understandable_alone={a.understandable_alone} ends_complete={a.ends_complete} "
                f"is_non_content={a.is_non_content}"
            )
        elif a.interest < min_interest:
            c.outcome, c.outcome_reason = "below_min_interest", f"interest {a.interest} < {min_interest}"
        else:
            eligible.append(c)

    pool = eligible
    fallback = False
    if not pool:
        # D14: gate-passing candidates (otherwise outcome would be rejected_gates) at the highest
        # interest below min_interest that is still >= FALLBACK_INTEREST. Overlap removal runs over
        # the whole pool and stops after FALLBACK_CANDIDATE_COUNT accepted cuts.
        weak = [
            c
            for c in scored
            if c.outcome == "below_min_interest" and c.answers and c.answers.interest >= C.FALLBACK_INTEREST
        ]
        if weak:
            best = max(c.answers.interest for c in weak)
            pool = [c for c in weak if c.answers.interest == best]
        fallback = bool(pool)
    if audience_on and audience_mode == "bonus":
        apply_audience_bonus(pool)
    cap = min(max_cuts, C.FALLBACK_CANDIDATE_COUNT) if fallback else max_cuts

    accepted: list[ScoredCandidate] = []
    for c in sorted(pool, key=_order_key):
        if len(accepted) >= cap:
            c.outcome, c.outcome_reason = "over_cap", f"cap of {cap} cuts reached"
            continue
        clash = next(
            (x for x in accepted if compute_temporal_iou(c.start, c.end, x.start, x.end) > iou_threshold),
            None,
        )
        if clash is not None:
            c.outcome, c.outcome_reason = "overlap", f"IoU above {iou_threshold} with {clash.candidate_id}"
            continue
        c.outcome = "selected"
        c.outcome_reason = FALLBACK_REASON if fallback else ""
        if fallback:
            c.fallback = True
        accepted.append(c)
    return accepted


def _reasoning(c: ScoredCandidate) -> str:
    a = c.answers
    if a is None:
        return ""
    parts = [a.premise.strip()]
    if a.missing_context.strip():
        parts.append(f"missing_context: {a.missing_context.strip()}")
    parts.append(
        f"interest={a.interest} understandable_alone={a.understandable_alone} "
        f"has_payoff={a.has_payoff} ends_complete={a.ends_complete} "
        f"depends_on_visuals={a.depends_on_visuals}"
    )
    return " | ".join(p for p in parts if p)


def to_cuts(
    selected: Sequence[ScoredCandidate],
    sentences: Sequence[Sentence],
    blocks: Sequence[SemanticBlock],
    *,
    snap: Callable[[float, float], tuple[float, float]] | None,
    auto_approve_min_interest: int | None = None,
) -> list[Cut]:
    """Assemble the Cut objects. ``auto_approve_min_interest`` is None (default) unless llm.auto_approve is on.

    When set, a selected cut whose gates passed, that did not come from the D14 fallback and whose interest is at
    least that value is written as "approved" (with ``auto_approved: true``); every other cut stays "pending".
    The decision is recorded on the candidate (``auto_approved``) for candidates.scored.json.
    """
    cuts: list[Cut] = []
    for n, c in enumerate(sorted(selected, key=_order_key), start=1):
        start, end = c.start, c.end
        if snap is not None:
            start, end = snap(start, end)
        start, end = round(float(start), C.CUT_TIME_DECIMALS), round(float(end), C.CUT_TIME_DECIMALS)
        a = c.answers
        reasoning = _reasoning(c)
        cut_id = f"c{n}"
        c.cut_id = cut_id
        auto_fields: dict[str, object] = {}
        if auto_approve_min_interest is not None:
            auto = bool(
                a is not None
                and c.gates_ok
                and not getattr(c, "fallback", False)
                and a.interest >= auto_approve_min_interest
            )
            c.auto_approved = auto
            if auto:
                auto_fields = {"approved": True, "auto_approved": True}
        cuts.append(
            Cut(
                cut_id=cut_id,
                start=start,
                end=end,
                duration=round(end - start, C.CUT_DURATION_DECIMALS),
                title=a.title if a else None,
                score=c.score,
                summary=a.premise if a else None,
                content_reason=a.premise if a else None,
                reasoning=reasoning,
                hook_reason=reasoning,
                block_ids=[b.block_id for b in blocks if b.start < end and b.end > start],
                status="approved" if auto_fields else "pending",
                **auto_fields,
                sentence_ids=[
                    s.sentence_id for s in sentences_between(sentences, c.start_sentence_id, c.end_sentence_id)
                ],
                interest=a.interest if a else None,
                pipeline="v2",
            )
        )
    return cuts
