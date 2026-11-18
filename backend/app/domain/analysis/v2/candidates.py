"""S3 - candidate generation (code; one LLM call only for a unit longer than max).

Rules (pipeline-v2 S3): a content unit inside [min, max] is a candidate by itself;
shorter than min produces nothing alone; longer than max triggers one sub-span call
whose IDs are constrained by an enum built from that unit's sentence IDs.
A candidate never contains a sentence of a non_content unit.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from typing import Any

from app.application.runtime_service import OperationCancelledError
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.models import Brief, Candidate, Sentence, Unit
from app.domain.analysis.v2.prompts import (
    SUBSPAN_SCHEMA_NAME,
    SUBSPAN_SYSTEM_PROMPT,
    build_subspan_schema,
    build_subspan_user_prompt,
    summarize_brief_for_prompt,
)
from app.domain.analysis.v2.sentences import format_sentence_line, sentences_between
from app.infrastructure.llm.unified_adapter import (
    LLMContextOverflowError,
    LLMEmptyResponseError,
    LocalLLMUnavailableError,
)

# Same signature as UnifiedLocalLLMAdapter.chat_json; returns (parsed, raw_text).
LLMCall = Callable[..., Awaitable[tuple[Any, str]]]
LogFn = Callable[[str], Any]


def _log(log: LogFn | None, message: str) -> None:
    if log is not None:
        log(message)


def _index(sentences: Sequence[Sentence]) -> dict[str, int]:
    return {s.sentence_id: i for i, s in enumerate(sentences)}


def _unit_candidate(cid: str, unit: Unit) -> Candidate:
    return Candidate(
        candidate_id=cid,
        start_sentence_id=unit.start_sentence_id,
        end_sentence_id=unit.end_sentence_id,
        start=unit.start,
        end=unit.end,
        unit_ids=[unit.unit_id],
        origin="unit",
    )


def _valid_spans(
    raw: Any,
    unit_sentences: Sequence[Sentence],
    *,
    min_s: float,
    max_s: float,
) -> list[tuple[Sentence, Sentence]]:
    """Filter the model's spans: order, duplicates, overlap and duration."""
    if not isinstance(raw, dict) or not isinstance(raw.get("spans"), list):
        return []
    pos = {s.sentence_id: i for i, s in enumerate(unit_sentences)}
    out: list[tuple[Sentence, Sentence]] = []
    seen: set[tuple[str, str]] = set()
    for item in raw["spans"]:
        if not isinstance(item, dict):
            continue
        a, b = item.get("start_sentence_id"), item.get("end_sentence_id")
        if a not in pos or b not in pos or pos[a] > pos[b]:
            continue
        if (a, b) in seen:
            continue
        first, last = unit_sentences[pos[a]], unit_sentences[pos[b]]
        duration = last.end - first.start
        if duration < min_s or duration > max_s:
            continue
        # Pieces must not overlap (prompt rule); keep the earlier-returned one.
        if any(not (pos[b] < pos[x.sentence_id] or pos[a] > pos[y.sentence_id]) for x, y in out):
            continue
        seen.add((a, b))
        out.append((first, last))
        if len(out) >= C.MAX_SUBSPANS_PER_UNIT:
            break
    return out


async def build_candidates(
    units: Sequence[Unit],
    sentences: Sequence[Sentence],
    brief: Brief,
    *,
    llm: LLMCall | None,
    log: LogFn | None = None,
    discarded: list[dict[str, Any]] | None = None,
) -> list[Candidate]:
    """Build the S3 candidates.

    `discarded`, when given, receives one entry per content unit that produced nothing because
    of a failure (persisted in candidates.scored.json). `llm=None` is an API convenience: long
    units cannot be split and are discarded and recorded; the pipeline always passes the adapter.
    """
    min_s, max_s = brief.unit_seconds.min, brief.unit_seconds.max
    typical_s = brief.unit_seconds.typical
    summary = summarize_brief_for_prompt(brief.model_dump())
    candidates: list[Candidate] = []

    def discard(unit: Unit, reason: str) -> None:
        if discarded is not None:
            discarded.append({"unit_id": unit.unit_id, "start": unit.start, "end": unit.end, "reason": reason})

    def next_id() -> str:
        return f"k{len(candidates) + 1}"

    for unit in units:
        if unit.kind != "content":
            continue
        duration = unit.end - unit.start
        if duration < min_s:
            continue  # only usable inside a merge (S4)
        if duration <= max_s:
            candidates.append(_unit_candidate(next_id(), unit))
            continue
        # Longer than max: one sub-span call.
        if llm is None:
            _log(log, f"S3: unit {unit.unit_id} longer than max and no LLM available; discarded")
            discard(unit, "longer than max and no LLM available")
            continue
        try:
            unit_sentences = sentences_between(sentences, unit.start_sentence_id, unit.end_sentence_id)
            ids = [s.sentence_id for s in unit_sentences]
            user = build_subspan_user_prompt(
                brief_summary=summary,
                unit_lines=[format_sentence_line(s) for s in unit_sentences],
                unit_seconds_min=min_s,
                unit_seconds_typical=typical_s,
                unit_seconds_max=max_s,
                unit_duration_seconds=duration,
                max_spans=C.MAX_SUBSPANS_PER_UNIT,
            )
            parsed, _raw = await llm(
                SUBSPAN_SYSTEM_PROMPT,
                user,
                json_schema=build_subspan_schema(ids, max_spans=C.MAX_SUBSPANS_PER_UNIT),
                schema_name=SUBSPAN_SCHEMA_NAME,
                max_tokens=C.MAX_TOKENS_SUBSPAN,
                acquire_gpu_slot=False,
            )
        except (OperationCancelledError, LocalLLMUnavailableError, LLMContextOverflowError, LLMEmptyResponseError):
            raise
        except Exception as exc:  # noqa: BLE001 - a failed call discards only this unit
            _log(log, f"S3: sub-span call failed for unit {unit.unit_id}: {exc}; unit discarded")
            discard(unit, f"sub-span call failed: {exc}")
            continue
        spans = _valid_spans(parsed, unit_sentences, min_s=min_s, max_s=max_s)
        if not spans:
            _log(log, f"S3: no valid sub-span for unit {unit.unit_id}")
            discard(unit, "no valid sub-span returned")
        for first, last in spans:
            candidates.append(
                Candidate(
                    candidate_id=next_id(),
                    start_sentence_id=first.sentence_id,
                    end_sentence_id=last.sentence_id,
                    start=first.start,
                    end=last.end,
                    unit_ids=[unit.unit_id],
                    origin="subspan",
                )
            )
    return candidates


def merge_candidate(
    candidate: Candidate,
    units: Sequence[Unit],
    sentences: Sequence[Sentence],
    brief: Brief,
    *,
    side: str,
) -> Candidate | None:
    """Span of the defect-guided merge with the neighbouring content unit, or None.

    "prev": from the start of the previous unit to the candidate's end.
    "next": from the candidate's start to the end of the following unit.
    Not allowed when there is no such unit, it is non_content, or the total exceeds max.
    """
    if side not in ("prev", "next"):
        raise ValueError(f"invalid side: {side!r}")
    pos = {u.unit_id: i for i, u in enumerate(units)}
    own = [pos[u] for u in candidate.unit_ids if u in pos]
    if not own:
        return None
    sidx = _index(sentences)
    nb_i = min(own) - 1 if side == "prev" else max(own) + 1
    if nb_i < 0 or nb_i >= len(units):
        return None
    neighbour = units[nb_i]
    if neighbour.kind != "content":
        return None
    if side == "prev":
        start_id, end_id = neighbour.start_sentence_id, candidate.end_sentence_id
        unit_ids = [neighbour.unit_id, *candidate.unit_ids]
    else:
        start_id, end_id = candidate.start_sentence_id, neighbour.end_sentence_id
        unit_ids = [*candidate.unit_ids, neighbour.unit_id]
    if start_id not in sidx or end_id not in sidx or sidx[start_id] > sidx[end_id]:
        return None
    first, last = sentences[sidx[start_id]], sentences[sidx[end_id]]
    if last.end - first.start > brief.unit_seconds.max:
        return None
    return Candidate(
        candidate_id=f"{candidate.candidate_id}-{'p' if side == 'prev' else 'n'}",
        start_sentence_id=start_id,
        end_sentence_id=end_id,
        start=first.start,
        end=last.end,
        unit_ids=unit_ids,
        origin="merge_prev" if side == "prev" else "merge_next",
        merged_from=candidate.candidate_id,
    )
