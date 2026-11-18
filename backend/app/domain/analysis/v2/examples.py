"""Phase 7 - choice of the few past decisions shown to S4 (``analysis_v2.scoring_examples``, default 0 = off).

Selection rule of the first version (deterministic, no model involved):
  1. usable entries: status approved or rejected, a job other than the one being analysed (never its own cuts,
     whatever the attempt) and a non-empty cut text (entries of archived attempts carry none and are never used);
  2. each side ("kept" = approved, "rejected") is ordered by recency: ``job_created_at`` descending, then ``job_id``
     descending, ``attempt_id`` descending, ``cut_id`` descending (string order; ties never depend on input order);
  3. with ``count`` examples: ``ceil(count / 2)`` kept and ``floor(count / 2)`` rejected; a side that has fewer gives
     its unused places to the other side;
  4. they are listed alternating kept, rejected, kept, ... so the order is stable and neither side is last.
The text of an example is cut to whole lines within SCORING_EXAMPLE_MAX_CHARS (at least its first line is kept).

EXTENSION POINT (not implemented, deliberately): phase-7.md / D9 foresee choosing the examples by similarity to the
candidate through ``adapter.embed_texts``. That would load an embedding model in the middle of the pipeline, which
needs GPU sequencing (D8: unload the LLM, verify the VRAM was released, load the embedder, unload it, reload the LLM)
that has not been validated. ``select_examples`` is the single place to add a ``mode="similarity"`` later; until
then every candidate of a video sees the same examples, which also keeps the system prompt byte-identical.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.prompts import SCORING_EXAMPLE_VERDICT_KEPT, SCORING_EXAMPLE_VERDICT_REJECTED

_VERDICT = {"approved": SCORING_EXAMPLE_VERDICT_KEPT, "rejected": SCORING_EXAMPLE_VERDICT_REJECTED}


def _trim_lines(lines: Sequence[str]) -> list[str]:
    kept: list[str] = []
    used = 0
    for line in lines:
        if kept and used + len(line) > C.SCORING_EXAMPLE_MAX_CHARS:
            break
        kept.append(line)
        used += len(line)
    return kept


def _recency_key(entry: Mapping[str, Any]) -> tuple[str, str, str, str]:
    return (
        str(entry.get("job_created_at") or ""),
        str(entry.get("job_id") or ""),
        str(entry.get("attempt_id") or ""),
        str(entry.get("cut_id") or ""),
    )


def select_examples(history: Mapping[str, Any] | None, count: int, *, current_job_id: str) -> list[dict[str, Any]]:
    """Up to ``count`` examples ``{"id", "job_id", "attempt_id", "cut_id", "verdict", "text"}``; [] when none usable."""
    if not history or count <= 0:
        return []
    sides: dict[str, list[Mapping[str, Any]]] = {"approved": [], "rejected": []}
    for entry in history.get("entries") or []:
        if not isinstance(entry, Mapping) or entry.get("job_id") == current_job_id:
            continue
        text = entry.get("text")
        if (
            entry.get("status") not in sides
            or not isinstance(text, list)
            or not any(isinstance(x, str) and x.strip() for x in text)
        ):
            continue
        sides[entry["status"]].append(entry)
    for side in sides.values():
        side.sort(key=_recency_key, reverse=True)
    want_kept, want_rejected = (count + 1) // 2, count // 2
    n_kept0 = min(len(sides["approved"]), want_kept)
    n_rejected0 = min(len(sides["rejected"]), want_rejected)
    # A side that is short gives its unused places to the other one (both refills use the original counts).
    n_kept = min(len(sides["approved"]), n_kept0 + (want_rejected - n_rejected0))
    n_rejected = min(len(sides["rejected"]), n_rejected0 + (want_kept - n_kept0))
    kept, rejected = sides["approved"][:n_kept], sides["rejected"][:n_rejected]
    ordered: list[tuple[str, Mapping[str, Any]]] = []
    for i in range(max(len(kept), len(rejected))):
        if i < len(kept):
            ordered.append(("approved", kept[i]))
        if i < len(rejected):
            ordered.append(("rejected", rejected[i]))
    return [
        {
            "id": f"{e.get('job_id')}:{e.get('attempt_id') or '-'}:{e.get('cut_id')}",
            "job_id": e.get("job_id"),
            "attempt_id": e.get("attempt_id"),
            "cut_id": e.get("cut_id"),
            "verdict": _VERDICT[status],
            "text": _trim_lines([x.strip() for x in e["text"] if isinstance(x, str) and x.strip()]),
        }
        for status, e in ordered
    ]
