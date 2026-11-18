"""S2 - units (one LLM call per window of sentences; code does the rest).

The model only marks where each unit begins, choosing among the sentence IDs of the
window (JSON-schema enum). Everything else - ordering, junction between windows, unit
ends, ids and times - is code. See docs/analysis-v2/stage-contracts.md, S2.

Junction rule (precise). Windows are half-open index ranges ``[a0, a1)`` and ``[b0, b1)``
of consecutive windows A and B; their overlap is ``[b0, a1)`` with ``L = a1 - b0``
sentences. The split index is ``b0 + (L + 1) // 2``: starts at indexes ``< split`` come
from A (first half of the overlap, the larger half when L is odd), starts at indexes
``>= split`` come from B. Each window therefore owns ``[split_prev, split_next)`` (the
first window from 0, the last up to n) and only its own starts count. The kind and the
label of a unit come from the window that owns its start sentence. With L == 0 the
window boundary itself is a unit boundary (B owns its forced first sentence).
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from app.application.runtime_service import OperationCancelledError
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.candidates import LLMCall, LogFn, _log
from app.domain.analysis.v2.models import Brief, OutlineEntry, Sentence, Unit
from app.domain.analysis.v2.prompts import (
    SUBSPAN_SYSTEM_PROMPT,
    UNITS_SCHEMA_NAME,
    UNITS_SYSTEM_PROMPT,
    build_units_schema,
    build_units_user_prompt,
    build_subspan_user_prompt,
    format_outline_line,
    summarize_brief_for_prompt,
    summarize_brief_for_units,
)
from app.domain.analysis.v2.sentences import format_sentence_line
from app.infrastructure.llm.unified_adapter import (
    LLMContextOverflowError,
    LLMEmptyResponseError,
    LocalLLMUnavailableError,
    estimate_prompt_tokens,
)

_KINDS = ("content", "non_content")


def build_windows(n_sentences: int, *, window: int, overlap: int) -> list[tuple[int, int]]:
    """Half-open index ranges ``[start, end)`` that cover ``0..n_sentences`` with the given overlap.

    One window when everything fits. The last window always holds more than ``overlap``
    sentences (it is never contained in the previous one).
    """
    if n_sentences <= 0:
        return []
    window = max(1, int(window))
    overlap = max(0, min(int(overlap), window - 1))
    windows: list[tuple[int, int]] = []
    start = 0
    while True:
        end = min(start + window, n_sentences)
        windows.append((start, end))
        if end >= n_sentences:
            return windows
        start = end - overlap


def _ownership(windows: Sequence[tuple[int, int]]) -> list[tuple[int, int]]:
    """Half-open index range of the starts each window owns (the junction rule)."""
    if not windows:
        return []
    splits = [0]
    for (_a0, a1), (b0, _b1) in zip(windows, windows[1:], strict=False):
        splits.append(max(splits[-1], b0 + (a1 - b0 + 1) // 2))
    splits.append(windows[-1][1])
    return [(splits[i], splits[i + 1]) for i in range(len(windows))]


def merge_window_boundaries(
    windows: Sequence[tuple[int, int]],
    starts_per_window: Sequence[Sequence[int]],
) -> list[int]:
    """Sorted unique sentence indexes that start a unit; index 0 is always included."""
    owned = _ownership(windows)
    result: set[int] = {0}
    for (lo, hi), starts in zip(owned, starts_per_window, strict=False):
        result.update(i for i in starts if lo <= i < hi)
    return sorted(result)


def _window_user_prompt(
    sentences: Sequence[Sentence],
    outline: Sequence[OutlineEntry],
    brief_block: str,
    w: tuple[int, int],
) -> str:
    chunk = sentences[w[0] : w[1]]
    t0, t1 = chunk[0].start, chunk[-1].end
    lines = [
        format_outline_line(start_seconds=e.start, end_seconds=e.end, summary=e.summary, kind=e.kind)
        for e in outline
        if e.end > t0 and e.start < t1
    ]
    return build_units_user_prompt(
        brief_block=brief_block,
        outline_lines=lines,
        sentence_lines=[format_sentence_line(s) for s in chunk],
    )


def _choose_windows(
    sentences: Sequence[Sentence],
    outline: Sequence[OutlineEntry],
    brief_block: str,
    context_tokens: int | None,
) -> tuple[list[tuple[int, int]], int]:
    window = C.UNITS_WINDOW_SENTENCES
    n = len(sentences)

    def make(w: int) -> list[tuple[int, int]]:
        ov = min(
            C.UNITS_WINDOW_OVERLAP_SENTENCES,
            max(1, w * C.UNITS_WINDOW_OVERLAP_SENTENCES // C.UNITS_WINDOW_SENTENCES),
        )
        return build_windows(n, window=w, overlap=ov)

    windows = make(window)
    if context_tokens is None or n == 0:
        return windows, window
    while True:
        worst = max(
            estimate_prompt_tokens(UNITS_SYSTEM_PROMPT, _window_user_prompt(sentences, outline, brief_block, w))
            for w in windows
        )
        if worst + C.MAX_TOKENS_UNITS + C.PROMPT_CONTEXT_MARGIN_TOKENS <= context_tokens or window <= C.UNITS_MIN_WINDOW_SENTENCES:
            # Below the minimum nothing more is done here: the adapter raises
            # LLMContextOverflowError, which is a job error.
            return windows, window
        window = max(C.UNITS_MIN_WINDOW_SENTENCES, int(window * C.UNITS_WINDOW_SHRINK_FACTOR))
        windows = make(window)


def _parse_window_answer(parsed: Any, ids: Sequence[str]) -> dict[int, tuple[str, str]]:
    """Window-local index -> (label, kind). Unknown IDs dropped, duplicates keep the first."""
    if not isinstance(parsed, dict) or not isinstance(parsed.get("units"), list):
        return {}
    pos = {sid: i for i, sid in enumerate(ids)}
    out: dict[int, tuple[str, str]] = {}
    for item in parsed["units"]:
        if not isinstance(item, dict):
            continue
        sid = item.get("start_sentence_id")
        if not isinstance(sid, str) or sid not in pos or pos[sid] in out:
            continue
        label = item.get("label")
        kind = item.get("kind")
        out[pos[sid]] = (label.strip() if isinstance(label, str) else "", kind if kind in _KINDS else "content")
    return out


def _fallback_window(
    sentences: Sequence[Sentence],
    w: tuple[int, int],
    brief: Brief,
    fallback_units: Sequence[Unit] | None,
) -> dict[int, tuple[str, str]]:
    """Global index -> (label, kind) for a window that has no usable answer."""
    lo, hi = w
    result: dict[int, tuple[str, str]] = {}
    if fallback_units is not None:
        pos = {s.sentence_id: i for i, s in enumerate(sentences)}
        covering: Unit | None = None
        for u in fallback_units:
            a, b = pos.get(u.start_sentence_id), pos.get(u.end_sentence_id)
            if a is None or b is None:
                continue
            kind = u.kind if u.kind in _KINDS else "content"
            if a <= lo <= b:
                covering = u
            if lo <= a < hi:
                result[a] = (u.label, kind)
        if lo not in result:
            if covering is not None:
                kind = covering.kind if covering.kind in _KINDS else "content"
                result[lo] = (covering.label, kind)
            else:
                result[lo] = ("", "content")
        return result
    typical = brief.unit_seconds.typical  # clamp_unit_seconds guarantees 0 < min < typical
    last_t = sentences[lo].start
    result[lo] = ("", "content")
    for i in range(lo + 1, hi):
        if sentences[i].start - last_t >= typical:
            result[i] = ("", "content")
            last_t = sentences[i].start
    return result


def _subspan_prompt_fits(
    sentences: Sequence[Sentence], brief: Brief, a: int, b: int, context_tokens: int
) -> bool:
    """Whether the S3 sub-span call for sentences ``a..b`` fits the context (same estimate as the adapter)."""
    user = build_subspan_user_prompt(
        brief_summary=summarize_brief_for_prompt(brief.model_dump()),
        unit_lines=[format_sentence_line(s) for s in sentences[a : b + 1]],
        unit_seconds_min=brief.unit_seconds.min,
        unit_seconds_typical=brief.unit_seconds.typical,
        unit_seconds_max=brief.unit_seconds.max,
        unit_duration_seconds=sentences[b].end - sentences[a].start,
        max_spans=C.MAX_SUBSPANS_PER_UNIT,
    )
    need = estimate_prompt_tokens(SUBSPAN_SYSTEM_PROMPT, user) + C.MAX_TOKENS_SUBSPAN + C.PROMPT_CONTEXT_MARGIN_TOKENS
    return need <= context_tokens


def _bound_for_subspan_prompt(
    sentences: Sequence[Sentence], brief: Brief, a: int, b: int, context_tokens: int
) -> list[tuple[int, int]]:
    """Index ranges for a content unit so that none needs an S3 sub-span prompt larger than the context.

    A unit that is not longer than max never reaches S3's sub-span call and is left alone. Otherwise a
    unit whose prompt does not fit is halved by sentence count, recursively (no lexical rule). A single
    sentence is never split.
    """
    if sentences[b].end - sentences[a].start <= brief.unit_seconds.max or a >= b:
        return [(a, b)]
    if _subspan_prompt_fits(sentences, brief, a, b, context_tokens):
        return [(a, b)]
    mid = (a + b + 1) // 2
    return _bound_for_subspan_prompt(sentences, brief, a, mid - 1, context_tokens) + _bound_for_subspan_prompt(
        sentences, brief, mid, b, context_tokens
    )


async def build_units(
    sentences: Sequence[Sentence],
    brief: Brief,
    outline: Sequence[OutlineEntry],
    *,
    llm: LLMCall,
    fallback_units: Sequence[Unit] | None = None,
    context_tokens: int | None = None,
    log: LogFn | None = None,
) -> tuple[list[Unit], dict]:
    """Segment the transcription into units covering every sentence, in order, ids u1..uN."""
    n = len(sentences)
    if n == 0:
        return [], {"windows": 0, "window_size": 0, "fallback_windows": 0, "split_units": 0}

    brief_block = summarize_brief_for_units(brief.model_dump())
    windows, window_size = _choose_windows(sentences, outline, brief_block, context_tokens)
    if window_size != C.UNITS_WINDOW_SENTENCES:
        _log(log, f"S2: window reduced to {window_size} sentences to fit the context")

    infos: list[dict[int, tuple[str, str]]] = []  # global index -> (label, kind), per window
    fallback_windows = 0
    for k, w in enumerate(windows):
        ids = [s.sentence_id for s in sentences[w[0] : w[1]]]
        local: dict[int, tuple[str, str]] = {}
        reason = "answer has no usable unit start"
        try:
            parsed, _raw = await llm(
                UNITS_SYSTEM_PROMPT,
                _window_user_prompt(sentences, outline, brief_block, w),
                json_schema=build_units_schema(ids),
                schema_name=UNITS_SCHEMA_NAME,
                max_tokens=C.MAX_TOKENS_UNITS,
                acquire_gpu_slot=False,
            )
            local = _parse_window_answer(parsed, ids)
            if not local and isinstance(parsed, dict) and parsed.get("units") == []:
                # Valid per the schema: no change inside the window, i.e. one unit (rule 2 starts it).
                _log(log, f"S2: window {k + 1}/{len(windows)} answered with no unit start; one unit for the window")
                local = {0: ("", "content")}
        except (OperationCancelledError, LocalLLMUnavailableError, LLMContextOverflowError, LLMEmptyResponseError):
            raise
        except Exception as exc:  # noqa: BLE001 - one bad window never stops the run
            reason = f"call failed: {exc}"
        if local:
            if 0 not in local:
                # The model left the first sentence out: it still begins a unit (rule 2).
                local[0] = ("", "content")
            infos.append({w[0] + i: v for i, v in local.items()})
        else:
            fallback_windows += 1
            _log(
                log,
                f"S2: window {k + 1}/{len(windows)} (sentences {w[0] + 1}-{w[1]}): {reason}; using fallback boundaries",
            )
            infos.append(_fallback_window(sentences, w, brief, fallback_units))

    owned = _ownership(windows)
    starts = merge_window_boundaries(windows, [list(d) for d in infos])
    spans: list[tuple[int, int, str, str]] = []  # (first index, last index, label, kind)
    for j, a in enumerate(starts):
        b = (starts[j + 1] - 1) if j + 1 < len(starts) else n - 1
        label, kind = "", "content"
        for (lo, hi), info in zip(owned, infos, strict=False):
            if lo <= a < hi:
                label, kind = info.get(a, ("", "content"))
                break
        spans.append((a, b, label, kind))

    split_units = 0
    if context_tokens is not None:
        bounded: list[tuple[int, int, str, str]] = []
        for a, b, label, kind in spans:
            pieces = [(a, b)]
            if kind == "content":
                pieces = _bound_for_subspan_prompt(sentences, brief, a, b, context_tokens)
            if len(pieces) > 1:
                split_units += 1
                _log(
                    log,
                    f"S2: unit of sentences {a + 1}-{b + 1} is too long for the S3 prompt; split into {len(pieces)} units",
                )
            bounded.extend((pa, pb, label, kind) for pa, pb in pieces)
        spans = bounded

    units: list[Unit] = []
    for j, (a, b, label, kind) in enumerate(spans):
        units.append(
            Unit(
                unit_id=f"u{j + 1}",
                start_sentence_id=sentences[a].sentence_id,
                end_sentence_id=sentences[b].sentence_id,
                start=sentences[a].start,
                end=sentences[b].end,
                label=label,
                kind=kind,
            )
        )
    return units, {
        "windows": len(windows),
        "window_size": window_size,
        "fallback_windows": fallback_windows,
        "split_units": split_units,
    }
