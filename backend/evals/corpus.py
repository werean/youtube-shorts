"""Corpus access for the evaluation harness (manifest, labels, cut text).

The corpus lives in ``backend/evals/corpus/<slug>/`` (git-ignored). The manifest
``corpus.manifest.json`` is versioned. The ``format`` label is only used to group
report tables; it must never reach a prompt or the pipeline.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.infrastructure.storage.atomic_store import atomic_write_json

from evals.metrics import CutSpan

EVALS_DIR = Path(__file__).resolve().parent
MANIFEST_PATH = EVALS_DIR / "corpus.manifest.json"
CORPUS_ROOT = EVALS_DIR / "corpus"
RUNS_ROOT = EVALS_DIR / "runs"

VALID_SPLITS = ("dev", "holdout")
_SLUG_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")


@dataclass(frozen=True)
class VideoEntry:
    slug: str
    format: str
    language: str | None
    duration_seconds: float | None
    split: str
    source: str | None


def validate_slug(slug: str) -> str:
    if not _SLUG_RE.match(slug or ""):
        raise ValueError(f"Invalid slug {slug!r}: use letters, digits, '.', '_' or '-'.")
    return slug


def _read_json(path: Path) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def load_manifest_raw(path: Path | None = None) -> dict[str, Any]:
    p = Path(path) if path else MANIFEST_PATH
    if not p.exists():
        return {"videos": []}
    data = _read_json(p)
    if not isinstance(data, dict) or not isinstance(data.get("videos"), list):
        raise ValueError(f"Malformed manifest: {p}")
    return data


def load_manifest(path: Path | None = None) -> list[VideoEntry]:
    entries: list[VideoEntry] = []
    for raw in load_manifest_raw(path)["videos"]:
        split = str(raw.get("split") or "dev")
        if split not in VALID_SPLITS:
            raise ValueError(f"Invalid split {split!r} for {raw.get('slug')!r}")
        dur = raw.get("duration_seconds")
        entries.append(
            VideoEntry(
                slug=validate_slug(str(raw["slug"])),
                format=str(raw.get("format") or ""),
                language=raw.get("language"),
                duration_seconds=float(dur) if dur is not None else None,
                split=split,
                source=raw.get("source"),
            )
        )
    return entries


def upsert_manifest_entry(entry: dict[str, Any], path: Path | None = None) -> Path:
    p = Path(path) if path else MANIFEST_PATH
    data = load_manifest_raw(p)
    videos = [v for v in data["videos"] if v.get("slug") != entry["slug"]]
    videos.append(entry)
    videos.sort(key=lambda v: str(v.get("slug")))
    return atomic_write_json(p, {"videos": videos}, trailing_newline=True)


def corpus_dir(slug: str, root: Path | None = None) -> Path:
    return (Path(root) if root else CORPUS_ROOT) / validate_slug(slug)


def load_labels(slug: str, root: Path | None = None) -> tuple[list[CutSpan], list[CutSpan]]:
    """Return (must, never) spans from labels.json; both empty when the file is absent."""
    p = corpus_dir(slug, root) / "labels.json"
    if not p.exists():
        return [], []
    data = _read_json(p)

    def _spans(key: str) -> list[CutSpan]:
        return [CutSpan(float(i["start"]), float(i["end"])) for i in (data.get(key) or [])]

    return _spans("must"), _spans("never")


def _as_list(data: Any, key: str) -> list[dict[str, Any]]:
    if isinstance(data, dict):
        data = data.get(key) or []
    return [x for x in data if isinstance(x, dict)]


def load_words(slug: str, root: Path | None = None) -> list[dict[str, Any]]:
    p = corpus_dir(slug, root) / "transcription.words.json"
    return _as_list(_read_json(p), "words") if p.exists() else []


def load_segments(slug: str, root: Path | None = None) -> list[dict[str, Any]]:
    p = corpus_dir(slug, root) / "transcription.segments.json"
    return _as_list(_read_json(p), "segments") if p.exists() else []


def cut_text(slug: str, start: float, end: float, root: Path | None = None) -> str:
    """Text spoken in [start, end], from words (preferred) or segments (fallback).

    An item belongs to the range when its midpoint falls inside it.
    """
    words = load_words(slug, root)
    if words:
        parts = [
            str(w.get("word", "")).strip()
            for w in words
            if start <= (float(w["start"]) + float(w["end"])) / 2.0 <= end
        ]
        return " ".join(p for p in parts if p)
    parts = [
        str(s.get("text", "")).strip()
        for s in load_segments(slug, root)
        if start <= (float(s["start"]) + float(s["end"])) / 2.0 <= end
    ]
    return " ".join(p for p in parts if p)
