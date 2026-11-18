"""Audience signal (phase 5, part A): the YouTube "most replayed" heatmap as evidence of interest.

Pure code, no I/O. The heatmap is a list of ``{start_time, end_time, value}`` with ``value`` in [0, 1].
It never replaces the S4 gates; see ``selection.py`` for how it is used (opt-in, default off).
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from typing import Any


def _finite_float(raw: Any) -> float | None:
    if isinstance(raw, bool):
        return None
    try:
        v = float(raw)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def normalize_heatmap(raw: Any) -> list[dict[str, float]]:
    """Validate a raw heatmap: floats, start < end, value clamped to [0, 1], sorted; malformed entries dropped."""
    if not isinstance(raw, Sequence) or isinstance(raw, (str, bytes)):
        return []
    out: list[dict[str, float]] = []
    for item in raw:
        if not isinstance(item, Mapping):
            continue
        start = _finite_float(item.get("start_time"))
        end = _finite_float(item.get("end_time"))
        value = _finite_float(item.get("value"))
        if start is None or end is None or value is None or start < 0 or not start < end:
            continue
        out.append({"start_time": start, "end_time": end, "value": min(1.0, max(0.0, value))})
    out.sort(key=lambda e: (e["start_time"], e["end_time"]))
    return out


def has_heatmap(source_info: Any) -> bool:
    """True when ``source.info.json`` carries a usable (non-empty after normalisation) heatmap."""
    if not isinstance(source_info, Mapping):
        return False
    return bool(normalize_heatmap(source_info.get("heatmap")))


def mean_intensity(heatmap: Any, start: float, end: float) -> float | None:
    """Time-weighted mean of ``value`` over [start, end].

    Time with no heatmap entry inside the interval counts as zero weight (gaps are not averaged in); the mean is
    over the covered time only. ``None`` when there is no heatmap or no overlap (a zero-length interval overlaps
    nothing).
    """
    entries = normalize_heatmap(heatmap)
    if not entries or not end > start:
        return None
    weighted = 0.0
    covered = 0.0
    for e in entries:
        overlap = min(end, e["end_time"]) - max(start, e["start_time"])
        if overlap > 0:
            weighted += overlap * e["value"]
            covered += overlap
    if covered <= 0:
        return None
    return weighted / covered
