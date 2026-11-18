"""S5 - boundary refinement (two LLM calls per pre-selected candidate) and pre-selection.

The LLM only chooses among option IDs (JSON-schema enum built per call). Code validates
the chosen borders against the duration range of the brief, decides whether a re-score
is due and keeps the original candidate whenever the refinement does not hold up.
"""

from __future__ import annotations

import math
from collections.abc import Awaitable, Callable, Sequence

from app.application.runtime_service import OperationCancelledError
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.candidates import LLMCall, LogFn, _index, _log
from app.domain.analysis.v2.models import Brief, Candidate, ScoredCandidate, Sentence, Unit
from app.domain.analysis.v2.prompts import (
    REFINE_END_FIELD,
    REFINE_END_SCHEMA_NAME,
    REFINE_END_SYSTEM_PROMPT,
    REFINE_START_FIELD,
    REFINE_START_SCHEMA_NAME,
    REFINE_START_SYSTEM_PROMPT,
    build_refine_end_user_prompt,
    build_refine_schema,
    build_refine_start_user_prompt,
    summarize_brief_for_units,
)
from app.domain.analysis.v2.selection import select
from app.domain.analysis.v2.sentences import format_sentence_line
from app.infrastructure.llm.unified_adapter import (
    LLMContextOverflowError,
    LLMEmptyResponseError,
    LocalLLMUnavailableError,
)

Rescore = Callable[[Candidate], Awaitable[ScoredCandidate]]

_PROPAGATE = (OperationCancelledError, LocalLLMUnavailableError, LLMContextOverflowError, LLMEmptyResponseError)

# Fields that exist only on ScoredCandidate (scoring results), dropped when a plain Candidate is rebuilt.
_SCORED_ONLY = ("answers", "gates_ok", "score", "outcome", "outcome_reason", "cut_id")


def _non_content_flags(units: Sequence[Unit], sentences: Sequence[Sentence]) -> list[bool]:
    idx = _index(sentences)
    flags = [False] * len(sentences)
    for u in units:
        if u.kind != "non_content":
            continue
        a, b = idx.get(u.start_sentence_id), idx.get(u.end_sentence_id)
        if a is None or b is None:
            continue
        for i in range(a, b + 1):
            flags[i] = True
    return flags


def _span(candidate: Candidate, sentences: Sequence[Sentence]) -> tuple[int, int]:
    idx = _index(sentences)
    a, b = idx[candidate.start_sentence_id], idx[candidate.end_sentence_id]
    if a > b:
        raise ValueError("candidate start after end")
    return a, b


def _start_range(candidate: Candidate, units: Sequence[Unit], sentences: Sequence[Sentence]) -> tuple[int, int]:
    """(first, last) sentence indexes of the start options."""
    a, b = _span(candidate, sentences)
    flags = _non_content_flags(units, sentences)
    first = a
    while first > 0 and a - first < C.S5_START_OPTIONS_BEFORE and not flags[first - 1]:
        first -= 1
    return first, min(b, a + C.S5_START_OPTIONS_INSIDE - 1)


def _end_range(candidate: Candidate, units: Sequence[Unit], sentences: Sequence[Sentence]) -> tuple[int, int]:
    """(first, last) sentence indexes of the end options."""
    a, b = _span(candidate, sentences)
    flags = _non_content_flags(units, sentences)
    last = b
    while last < len(sentences) - 1 and last - b < C.S5_END_OPTIONS_AFTER and not flags[last + 1]:
        last += 1
    return max(a, b - C.S5_END_OPTIONS_INSIDE + 1), last


def start_options(
    candidate: Candidate, units: Sequence[Unit], sentences: Sequence[Sentence]
) -> tuple[list[Sentence], list[Sentence]]:
    """(options, context_after): up to 4 sentences before the candidate (never crossing into a
    non_content unit) plus its first 2, then up to 3 sentences that follow the options."""
    first, last = _start_range(candidate, units, sentences)
    return list(sentences[first : last + 1]), list(sentences[last + 1 : last + 1 + C.S5_START_CONTEXT_AFTER])


def end_options(
    candidate: Candidate, units: Sequence[Unit], sentences: Sequence[Sentence]
) -> tuple[list[Sentence], list[Sentence]]:
    """(context_before, options): up to 3 sentences before the options; the last 2 sentences of
    the candidate plus up to 3 after it (never crossing into a non_content unit)."""
    first, last = _end_range(candidate, units, sentences)
    return list(sentences[max(0, first - C.S5_END_CONTEXT_BEFORE) : first]), list(sentences[first : last + 1])


async def _ask(
    llm: LLMCall,
    system: str,
    user: str,
    options: Sequence[Sentence],
    *,
    field: str,
    schema_name: str,
) -> tuple[str, str]:
    """One call; returns (chosen sentence id, reason). Raises ValueError on an unusable answer."""
    ids = [s.sentence_id for s in options]
    parsed, _raw = await llm(
        system,
        user,
        json_schema=build_refine_schema(ids, field=field),
        schema_name=schema_name,
        max_tokens=C.MAX_TOKENS_REFINE,
        acquire_gpu_slot=False,
    )
    if not isinstance(parsed, dict):
        raise ValueError("refine answer is not a JSON object")
    chosen = parsed.get(field)
    if chosen not in ids:
        raise ValueError(f"{field} {chosen!r} is not one of the options")
    reason = parsed.get("reason")
    return chosen, reason if isinstance(reason, str) else ""


def _unit_ids_for(units: Sequence[Unit], sentences: Sequence[Sentence], a: int, b: int) -> list[str]:
    idx = _index(sentences)
    out = []
    for u in units:
        ua, ub = idx.get(u.start_sentence_id), idx.get(u.end_sentence_id)
        if ua is not None and ub is not None and ua <= b and ub >= a:
            out.append(u.unit_id)
    return out


async def refine_candidate(
    scored: ScoredCandidate,
    units: Sequence[Unit],
    sentences: Sequence[Sentence],
    brief: Brief,
    *,
    llm: LLMCall,
    rescore: Rescore,
    log: LogFn | None = None,
) -> ScoredCandidate:
    cid = scored.candidate_id
    try:
        a, b = _span(scored, sentences)
        start_opts, ctx_after = start_options(scored, units, sentences)
        ctx_before, end_opts = end_options(scored, units, sentences)
    except Exception as exc:  # noqa: BLE001 - unusable candidate: leave it as it is
        _log(log, f"S5: candidate {cid} not refined: {exc}")
        return scored
    idx = _index(sentences)
    brief_block = summarize_brief_for_units(brief.model_dump())
    min_s, max_s = brief.unit_seconds.min, brief.unit_seconds.max

    notes: list[dict[str, str]] = []  # every fallback taken, persisted on the candidate

    def note(side: str, reason: str) -> None:
        notes.append({"side": side, "reason": reason})

    async def choose(options: Sequence[Sentence], *, side: str) -> tuple[int, str] | None:
        if len(options) < 2:  # a single option leaves nothing to decide
            return None
        try:
            if side == "start":
                user = build_refine_start_user_prompt(
                    brief_block=brief_block,
                    option_lines=[format_sentence_line(s) for s in options],
                    context_after_lines=[format_sentence_line(s) for s in ctx_after],
                    current_start_id=scored.start_sentence_id,
                )
                chosen, reason = await _ask(
                    llm,
                    REFINE_START_SYSTEM_PROMPT,
                    user,
                    options,
                    field=REFINE_START_FIELD,
                    schema_name=REFINE_START_SCHEMA_NAME,
                )
            else:
                user = build_refine_end_user_prompt(
                    brief_block=brief_block,
                    context_before_lines=[format_sentence_line(s) for s in ctx_before],
                    option_lines=[format_sentence_line(s) for s in options],
                    current_end_id=scored.end_sentence_id,
                )
                chosen, reason = await _ask(
                    llm,
                    REFINE_END_SYSTEM_PROMPT,
                    user,
                    options,
                    field=REFINE_END_FIELD,
                    schema_name=REFINE_END_SCHEMA_NAME,
                )
        except _PROPAGATE:
            raise
        except Exception as exc:  # noqa: BLE001 - this border keeps its original value
            _log(log, f"S5: candidate {cid} {side} refinement failed, border kept: {exc}")
            note(side, f"call failed, border kept: {exc}")
            return None
        return idx[chosen], reason

    start_ans = await choose(start_opts, side="start")
    end_ans = await choose(end_opts, side="end")

    extras: dict = {}
    if start_ans is not None:
        extras["refine_start_reason"] = start_ans[1]
    if end_ans is not None:
        extras["refine_end_reason"] = end_ans[1]

    def duration_ok(first: int, last: int) -> bool:
        return min_s <= sentences[last].end - sentences[first].start <= max_s

    want_a = start_ans[0] if start_ans else a
    want_b = end_ans[0] if end_ans else b
    na, nb = a, b
    if want_a > want_b:
        _log(log, f"S5: candidate {cid} chosen start after chosen end, borders kept")
        note("both", "chosen start after chosen end, borders kept")
    elif want_a != a and want_b != b and duration_ok(want_a, want_b):
        na, nb = want_a, want_b  # the pair the model chose is valid as a whole
    else:
        # Start first (against the original end), then end given the accepted start.
        if want_a != a:
            if duration_ok(want_a, b):
                na = want_a
            else:
                _log(log, f"S5: candidate {cid} new start rejected: duration out of range")
                note("start", "new start rejected: duration out of range")
        if want_b != b:
            if duration_ok(na, want_b):
                nb = want_b
            else:
                _log(log, f"S5: candidate {cid} new end rejected: duration out of range")
                note("end", "new end rejected: duration out of range")

    def finish(candidate: ScoredCandidate, outcome: str, more: dict | None = None) -> ScoredCandidate:
        fields: dict = {**extras, **(more or {}), "refine_outcome": outcome}
        if notes:
            fields["refine_fallbacks"] = list(notes)
        return candidate.model_copy(update=fields)

    shift = abs(na - a) + abs(nb - b)
    if shift == 0:
        return finish(scored, "unchanged")

    moved = {
        "start_sentence_id": sentences[na].sentence_id,
        "end_sentence_id": sentences[nb].sentence_id,
        "start": sentences[na].start if na != a else scored.start,
        "end": sentences[nb].end if nb != b else scored.end,
        "unit_ids": _unit_ids_for(units, sentences, na, nb),
    }
    original = {
        "start_sentence_id": scored.start_sentence_id,
        "end_sentence_id": scored.end_sentence_id,
    }

    if shift < C.S5_RESCORE_MIN_SHIFT_SENTENCES:
        return finish(scored.model_copy(update=moved), "moved", {"refined_from": original})

    plain = {k: v for k, v in scored.model_dump().items() if k not in _SCORED_ONLY}
    new_candidate = Candidate.model_validate({**plain, **moved, "origin": "refined"})
    rejected = {"start_sentence_id": moved["start_sentence_id"], "end_sentence_id": moved["end_sentence_id"]}
    try:
        rescored = await rescore(new_candidate)
    except _PROPAGATE:
        raise
    except Exception as exc:  # noqa: BLE001
        _log(log, f"S5: candidate {cid} rescore failed, original kept: {exc}")
        note("rescore", f"rescore failed, original kept: {exc}")
        return finish(scored, "reverted_rescore_error", {"refine_rejected_span": rejected})
    if rescored.outcome == "error" or not rescored.gates_ok:
        _log(log, f"S5: candidate {cid} refined span fails the gates, original kept")
        note("rescore", "refined span fails the gates, original kept")
        rejected_answers = rescored.answers.model_dump() if rescored.answers is not None else None
        return finish(
            scored,
            "reverted_gates",
            {
                "refine_rejected_span": rejected,
                "refine_rejected_rescore": {
                    "outcome": rescored.outcome,
                    "gates_ok": rescored.gates_ok,
                    "answers": rejected_answers,
                },
            },
        )
    merged = ScoredCandidate(
        **{**scored.model_dump(), **rescored.model_dump(), **extras, "candidate_id": cid, "refined_from": original}
    )
    return finish(merged, "rescored")


def preselect(scored: Sequence[ScoredCandidate], *, min_interest: int, max_cuts: int) -> list[ScoredCandidate]:
    """Candidates eligible for S6, best first, at most ceil(S5_PRESELECT_FACTOR * max_cuts).

    Eligibility and the D14/D21 fallback pool come from selection.select, run on throwaway
    copies with overlap removal disabled, so the input is not mutated. In fallback mode
    select() caps the pool at FALLBACK_CANDIDATE_COUNT, so at most that many are refined.
    """
    if max_cuts <= 0 or not scored:
        return []
    copies = {c.candidate_id: c.model_copy(deep=True) for c in scored}
    chosen = select(list(copies.values()), min_interest=min_interest, max_cuts=len(copies), iou_threshold=1.0)
    by_id = {c.candidate_id: c for c in scored}
    limit = math.ceil(C.S5_PRESELECT_FACTOR * max_cuts)
    return [by_id[c.candidate_id] for c in chosen][:limit]


async def refine_all(
    scored: Sequence[ScoredCandidate],
    units: Sequence[Unit],
    sentences: Sequence[Sentence],
    brief: Brief,
    *,
    min_interest: int,
    max_cuts: int,
    llm: LLMCall,
    rescore: Rescore,
    log: LogFn | None = None,
) -> list[ScoredCandidate]:
    chosen = preselect(scored, min_interest=min_interest, max_cuts=max_cuts)
    replaced: dict[str, ScoredCandidate] = {}
    for c in chosen:
        replaced[c.candidate_id] = await refine_candidate(
            c, units, sentences, brief, llm=llm, rescore=rescore, log=log
        )
    return [replaced.get(c.candidate_id, c) for c in scored]
