"""S1 - brief and outline (map/reduce over the transcription; one call for short videos).

The brief text fields come from the model and are stored untouched; code only clamps
``unit_seconds`` (stage-contracts S1). A failed map chunk keeps an empty summary and kind "mixed" (nobody checked it), a failed
reduce/short call falls back to ``provisional_brief()``; the fatal LLM errors propagate.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any

from app.application.runtime_service import OperationCancelledError
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.candidates import LLMCall, LogFn, _log
from app.domain.analysis.v2.models import Brief, OutlineEntry, Sentence, UnitSeconds
from app.domain.analysis.v2.prompts import (
    BRIEF_JSON_SCHEMA,
    BRIEF_MAP_JSON_SCHEMA,
    BRIEF_MAP_SCHEMA_NAME,
    BRIEF_MAP_SYSTEM_PROMPT,
    BRIEF_REDUCE_SYSTEM_PROMPT,
    BRIEF_SCHEMA_NAME,
    BRIEF_SHORT_SYSTEM_PROMPT,
    build_brief_map_user_prompt,
    build_brief_reduce_user_prompt,
    build_brief_short_user_prompt,
    format_outline_line,
)
from app.domain.analysis.v2.provisional import provisional_brief
from app.domain.analysis.v2.sentences import format_sentence_line
from app.infrastructure.llm.unified_adapter import (
    LLMContextOverflowError,
    LLMEmptyResponseError,
    LocalLLMUnavailableError,
)

_PROPAGATE = (OperationCancelledError, LocalLLMUnavailableError, LLMContextOverflowError, LLMEmptyResponseError)
_MAP_KINDS = ("content", "non_content", "mixed")
_TEXT_FIELDS = ("language", "format_description", "speakers", "unit_definition", "non_content")


def _number(value: Any) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    f = float(value)
    return f if math.isfinite(f) else None


def _default_unit_seconds() -> UnitSeconds:
    return UnitSeconds(
        min=C.DEFAULT_UNIT_SECONDS_MIN,
        typical=C.DEFAULT_UNIT_SECONDS_TYPICAL,
        max=C.DEFAULT_UNIT_SECONDS_MAX,
    )


def clamp_unit_seconds(raw: Mapping[str, Any] | None) -> UnitSeconds:
    """min to its clamp, max to its clamp, then min < typical < max; otherwise the defaults."""
    if not isinstance(raw, Mapping):
        return _default_unit_seconds()
    lo, typ, hi = _number(raw.get("min")), _number(raw.get("typical")), _number(raw.get("max"))
    if lo is None or typ is None or hi is None:
        return _default_unit_seconds()
    lo = max(C.UNIT_MIN_SECONDS_CLAMP[0], min(C.UNIT_MIN_SECONDS_CLAMP[1], lo))
    hi = max(C.UNIT_MAX_SECONDS_CLAMP[0], min(C.UNIT_MAX_SECONDS_CLAMP[1], hi))
    if not lo < typ < hi:
        return _default_unit_seconds()
    return UnitSeconds(min=lo, typical=typ, max=hi)


def _chunk_sentences(sentences: Sequence[Sentence]) -> list[list[Sentence]]:
    """Contiguous chunks up to BRIEF_MAP_CHUNK_CHARS of formatted text; a sentence is never split."""
    chunks: list[list[Sentence]] = []
    current: list[Sentence] = []
    size = 0
    for s in sentences:
        cost = len(format_sentence_line(s)) + 1  # + newline
        if current and size + cost > C.BRIEF_MAP_CHUNK_CHARS:
            chunks.append(current)
            current, size = [], 0
        current.append(s)
        size += cost
    if current:
        chunks.append(current)
    return chunks


def _entry(chunk: Sequence[Sentence], summary: str, kind: str) -> OutlineEntry:
    return OutlineEntry(
        start_sentence_id=chunk[0].sentence_id,
        end_sentence_id=chunk[-1].sentence_id,
        start=chunk[0].start,
        end=chunk[-1].end,
        summary=summary,
        kind=kind,
    )


def _parse_brief(parsed: Any) -> Brief:
    if not isinstance(parsed, dict):
        raise ValueError("brief answer is not a JSON object")
    values: dict[str, Any] = {}
    for name in _TEXT_FIELDS:
        if not isinstance(parsed.get(name), str):
            raise ValueError(f"brief field {name!r} is missing or not a string")
        values[name] = parsed[name]
    criteria = parsed.get("good_cut_criteria")
    if not isinstance(criteria, list) or not all(isinstance(c, str) for c in criteria):
        raise ValueError("brief field 'good_cut_criteria' is missing or not a list of strings")
    values["good_cut_criteria"] = list(criteria)
    values["unit_seconds"] = clamp_unit_seconds(parsed.get("unit_seconds"))
    return Brief(**values)


async def _call(llm: LLMCall, system: str, user: str, schema: dict[str, Any], name: str, max_tokens: int) -> Any:
    parsed, _raw = await llm(
        system,
        user,
        json_schema=schema,
        schema_name=name,
        max_tokens=max_tokens,
        acquire_gpu_slot=False,
    )
    return parsed


def _decision_duration(sentences: Sequence[Sentence], duration_seconds: float | None) -> float:
    """Duration used for the short-video decision: the larger of the stored duration and the transcript span,
    so a wrong or truncated stored duration never sends a long transcript into a single prompt."""
    span = sentences[-1].end
    if duration_seconds is None or not math.isfinite(duration_seconds) or duration_seconds <= 0:
        return span
    return max(duration_seconds, span)


def estimate_brief_calls(sentences: Sequence[Sentence], duration_seconds: float | None) -> int:
    """Number of LLM calls build_brief will make (for progress display): 1 for a short video, else chunks + 1."""
    if not sentences:
        return 0
    if _decision_duration(sentences, duration_seconds) < C.SHORT_VIDEO_SECONDS:
        return 1
    return len(_chunk_sentences(sentences)) + 1


async def build_brief(
    sentences: Sequence[Sentence],
    *,
    title: str | None,
    duration_seconds: float | None,
    chapters: Sequence[Mapping[str, Any]] | None,
    llm: LLMCall,
    log: LogFn | None = None,
) -> tuple[Brief, list[OutlineEntry], dict]:
    if not sentences:
        _log(log, "S1: no sentences; using the provisional brief")
        return provisional_brief(), [], {"mode": "short", "map_calls": 0, "fallback": True}

    duration = _decision_duration(sentences, duration_seconds)
    lines_all = [format_sentence_line(s) for s in sentences]

    if duration < C.SHORT_VIDEO_SECONDS:
        # No map call looked at the video: kind and summary are unknown, never stated as content.
        outline = [_entry(sentences, "", "mixed")]
        try:
            parsed = await _call(
                llm,
                BRIEF_SHORT_SYSTEM_PROMPT,
                build_brief_short_user_prompt(title=title, duration_seconds=duration_seconds, sentence_lines=lines_all),
                BRIEF_JSON_SCHEMA,
                BRIEF_SCHEMA_NAME,
                C.MAX_TOKENS_BRIEF_REDUCE,
            )
            brief = _parse_brief(parsed)
        except _PROPAGATE:
            raise
        except Exception as exc:  # noqa: BLE001 - documented fallback
            _log(log, f"S1: short-video brief failed ({exc}); using the provisional brief")
            return provisional_brief(), outline, {"mode": "short", "map_calls": 0, "fallback": True}
        outline = [_entry(sentences, brief.format_description, "mixed")]
        return brief, outline, {"mode": "short", "map_calls": 0, "fallback": False}

    outline: list[OutlineEntry] = []
    failed_chunks = 0
    chunks = _chunk_sentences(sentences)
    for n, chunk in enumerate(chunks, start=1):
        try:
            parsed = await _call(
                llm,
                BRIEF_MAP_SYSTEM_PROMPT,
                build_brief_map_user_prompt(sentence_lines=[format_sentence_line(s) for s in chunk]),
                BRIEF_MAP_JSON_SCHEMA,
                BRIEF_MAP_SCHEMA_NAME,
                C.MAX_TOKENS_BRIEF_MAP,
            )
            if not isinstance(parsed, dict) or not isinstance(parsed.get("summary"), str) or parsed.get("kind") not in _MAP_KINDS:
                raise ValueError("map answer does not match the schema")
            outline.append(_entry(chunk, parsed["summary"], parsed["kind"]))
        except _PROPAGATE:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad chunk never stops the run
            _log(log, f"S1: map chunk {n}/{len(chunks)} failed ({exc}); empty summary, kind mixed")
            failed_chunks += 1
            outline.append(_entry(chunk, "", "mixed"))

    meta: dict[str, Any] = {
        "mode": "map_reduce",
        "map_calls": len(chunks),
        "failed_map_chunks": failed_chunks,
        "fallback": False,
    }
    try:
        outline_lines = [
            format_outline_line(start_seconds=e.start, end_seconds=e.end, summary=e.summary, kind=e.kind)
            for e in outline
        ]
        parsed = await _call(
            llm,
            BRIEF_REDUCE_SYSTEM_PROMPT,
            build_brief_reduce_user_prompt(
                title=title, duration_seconds=duration_seconds, chapters=chapters, outline_lines=outline_lines
            ),
            BRIEF_JSON_SCHEMA,
            BRIEF_SCHEMA_NAME,
            C.MAX_TOKENS_BRIEF_REDUCE,
        )
        brief = _parse_brief(parsed)
    except _PROPAGATE:
        raise
    except Exception as exc:  # noqa: BLE001 - documented fallback
        _log(log, f"S1: reduce failed ({exc}); using the provisional brief")
        meta["fallback"] = True
        return provisional_brief(), outline, meta
    return brief, outline, meta
