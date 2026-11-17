"""Atomic persistence store for per-job dubbing manifests (`data/jobs/<job_id>/dubbing.manifest.json`)."""

from __future__ import annotations

import threading
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app.application.job_lifecycle import utc_now_iso
from app.core.paths import dubbing_manifest_path
from app.infrastructure.storage.atomic_store import atomic_write_json, read_json
from app.models.domain import DubbingCutTrack, DubbingManifest, DubbingPreview, DubbingTrack, Job

if TYPE_CHECKING:
    from app.application.runtime_service import ServiceContainer

_MANIFEST_LOCKS_GUARD = threading.Lock()
_MANIFEST_LOCKS: dict[str, threading.RLock] = {}


def _get_manifest_lock(job_id: str) -> threading.RLock:
    with _MANIFEST_LOCKS_GUARD:
        lock = _MANIFEST_LOCKS.get(job_id)
        if lock is None:
            lock = threading.RLock()
            _MANIFEST_LOCKS[job_id] = lock
        return lock


def _coerce_track(lang: str, track: DubbingTrack | dict[str, Any]) -> DubbingTrack:
    if isinstance(track, DubbingTrack):
        return track
    data = dict(track)
    data.setdefault("lang", lang)
    return DubbingTrack.model_validate(data)


def _coerce_cut_track(
    cut_id: str,
    lang: str,
    track: DubbingCutTrack | dict[str, Any],
) -> DubbingCutTrack:
    if isinstance(track, DubbingCutTrack):
        return track
    data = dict(track)
    data.setdefault("cut_id", cut_id)
    data.setdefault("lang", lang)
    return DubbingCutTrack.model_validate(data)


def _coerce_preview(preview: DubbingPreview | dict[str, Any] | None) -> DubbingPreview | None:
    if preview is None:
        return None
    if isinstance(preview, DubbingPreview):
        return preview
    return DubbingPreview.model_validate(dict(preview))


def _coerce_manifest(job_id: str, payload: DubbingManifest | dict[str, Any]) -> DubbingManifest:
    if isinstance(payload, DubbingManifest):
        return payload
    data = dict(payload)
    data.setdefault("job_id", job_id)
    return DubbingManifest.model_validate(data)


def load_dubbing_manifest(job_id: str) -> DubbingManifest | None:
    """Load `data/jobs/<job_id>/dubbing.manifest.json` if it exists, else return None."""
    lock = _get_manifest_lock(job_id)
    with lock:
        path = dubbing_manifest_path(job_id)
        if not path.exists():
            return None
        raw = read_json(path)
        if not isinstance(raw, dict):
            return None
        return _coerce_manifest(job_id, raw)


def load_or_create_dubbing_manifest(job_id: str) -> DubbingManifest:
    """Load existing dubbing manifest or return a fresh initialized `DubbingManifest`."""
    existing = load_dubbing_manifest(job_id)
    if existing is not None:
        return existing
    return DubbingManifest(job_id=job_id, updated_at=utc_now_iso())


def save_dubbing_manifest(
    job_id: str,
    manifest: DubbingManifest | dict[str, Any],
) -> Path:
    """Persist `dubbing.manifest.json` atomically (`write .tmp + fsync + os.replace`)."""
    lock = _get_manifest_lock(job_id)
    with lock:
        model = _coerce_manifest(job_id, manifest)
        if not getattr(model, "updated_at", None):
            model.updated_at = utc_now_iso()
        else:
            model.updated_at = utc_now_iso()
        path = dubbing_manifest_path(job_id)
        return atomic_write_json(path, model)


def upsert_dubbing_track(
    job_id: str,
    lang: str,
    track: DubbingTrack | dict[str, Any],
    *,
    set_active: bool = True,
) -> DubbingManifest:
    """Atomically insert or update a language track in `dubbing.manifest.json`."""
    lock = _get_manifest_lock(job_id)
    with lock:
        manifest = load_or_create_dubbing_manifest(job_id)
        coerced = _coerce_track(lang, track)
        tracks = dict(manifest.tracks or {})
        tracks[lang] = coerced
        manifest.tracks = tracks
        if set_active or not manifest.active_lang:
            manifest.active_lang = lang
        manifest.updated_at = utc_now_iso()
        save_dubbing_manifest(job_id, manifest)
        return manifest


def set_dubbing_preview(
    job_id: str,
    preview: DubbingPreview | dict[str, Any] | None,
) -> DubbingManifest:
    """Atomically update or clear `manifest.preview`."""
    lock = _get_manifest_lock(job_id)
    with lock:
        manifest = load_or_create_dubbing_manifest(job_id)
        manifest.preview = _coerce_preview(preview)
        manifest.updated_at = utc_now_iso()
        save_dubbing_manifest(job_id, manifest)
        return manifest


def remove_dubbing_track(job_id: str, lang: str) -> DubbingManifest:
    """Atomically delete a language track (and any matching preview) from `dubbing.manifest.json`."""
    lock = _get_manifest_lock(job_id)
    with lock:
        manifest = load_or_create_dubbing_manifest(job_id)
        tracks = dict(manifest.tracks or {})
        tracks.pop(lang, None)
        manifest.tracks = tracks
        if manifest.active_lang == lang:
            manifest.active_lang = next(iter(tracks.keys()), None)
        if manifest.preview is not None and getattr(manifest.preview, "lang", None) == lang:
            manifest.preview = None
        manifest.updated_at = utc_now_iso()
        save_dubbing_manifest(job_id, manifest)
        return manifest


def upsert_cut_dubbing_track(
    job_id: str,
    cut_id: str,
    lang: str,
    track: DubbingCutTrack | dict[str, Any],
) -> DubbingManifest:
    """Atomically insert or update a per-cut language track under `manifest.cut_dubs[cut_id][lang]`."""
    lock = _get_manifest_lock(job_id)
    with lock:
        manifest = load_or_create_dubbing_manifest(job_id)
        coerced = _coerce_cut_track(cut_id, lang, track)
        cut_dubs = dict(manifest.cut_dubs or {})
        lang_map = dict(cut_dubs.get(cut_id) or {})
        lang_map[lang] = coerced
        cut_dubs[cut_id] = lang_map
        manifest.cut_dubs = cut_dubs
        manifest.updated_at = utc_now_iso()
        save_dubbing_manifest(job_id, manifest)
        return manifest


def remove_cut_dubbing_track(
    job_id: str,
    cut_id: str,
    lang: str | None = None,
) -> DubbingManifest:
    """Atomically delete a per-cut dubbing track (or all languages for `cut_id` when `lang` is None)."""
    lock = _get_manifest_lock(job_id)
    with lock:
        manifest = load_or_create_dubbing_manifest(job_id)
        cut_dubs = dict(manifest.cut_dubs or {})
        if lang is None:
            cut_dubs.pop(cut_id, None)
        else:
            lang_map = dict(cut_dubs.get(cut_id) or {})
            lang_map.pop(lang, None)
            if lang_map:
                cut_dubs[cut_id] = lang_map
            else:
                cut_dubs.pop(cut_id, None)
        manifest.cut_dubs = cut_dubs
        manifest.updated_at = utc_now_iso()
        save_dubbing_manifest(job_id, manifest)
        return manifest


def sync_job_dubbing_fields(
    job_id: str,
    manifest: DubbingManifest,
    *,
    container: ServiceContainer | None = None,
    dubbing_status: str | None = None,
) -> Job | None:
    """Sync additive `dubbing_status` and `dubbed_languages` on `job.json` without mutating `job.status`."""
    from app.application.runtime_service import get_container

    c = container or get_container()
    try:
        c.jobs.load_job(job_id)
    except Exception:
        return None

    tracks = manifest.tracks or {}
    ready_langs = sorted(
        lang
        for lang, tr in tracks.items()
        if str(getattr(tr, "status", "") or "").lower() in {"ready", "done", "completed"}
        or bool(getattr(tr, "audio_url", None))
    )

    resolved_status = dubbing_status
    if resolved_status is None:
        active = tracks.get(manifest.active_lang or "") if manifest.active_lang else None
        if active is not None:
            resolved_status = str(getattr(active, "status", "") or "") or None
        elif ready_langs:
            resolved_status = "ready"
        elif tracks:
            first_track = next(iter(tracks.values()))
            resolved_status = str(getattr(first_track, "status", "") or "") or None
        else:
            resolved_status = None

    def _mutate(job: Job) -> None:
        job.dubbing_status = resolved_status
        job.dubbed_languages = ready_langs

    return c.jobs.update_job(job_id, _mutate)


def save_preview_manifest(preview_dir: str | Path, payload: dict[str, Any]) -> Path:
    """Persist `{video_dir}/dubs/{lang}/_preview/preview.manifest.json` atomically."""
    pdir = Path(preview_dir)
    pdir.mkdir(parents=True, exist_ok=True)
    return atomic_write_json(pdir / "preview.manifest.json", payload)


def load_preview_manifest(preview_dir: str | Path) -> dict[str, Any] | None:
    """Load `preview.manifest.json` if present."""
    path = Path(preview_dir) / "preview.manifest.json"
    if not path.exists():
        return None
    raw = read_json(path)
    return raw if isinstance(raw, dict) else None


class DubbingManifestStore:
    """Object-oriented wrapper around atomic dubbing manifest persistence."""

    def load(self, job_id: str) -> DubbingManifest | None:
        return load_dubbing_manifest(job_id)

    def load_or_create(self, job_id: str) -> DubbingManifest:
        return load_or_create_dubbing_manifest(job_id)

    def save(self, job_id: str, manifest: DubbingManifest | dict[str, Any]) -> Path:
        return save_dubbing_manifest(job_id, manifest)

    def upsert_track(
        self,
        job_id: str,
        lang: str,
        track: DubbingTrack | dict[str, Any],
        *,
        set_active: bool = True,
    ) -> DubbingManifest:
        return upsert_dubbing_track(job_id, lang, track, set_active=set_active)

    def set_preview(
        self,
        job_id: str,
        preview: DubbingPreview | dict[str, Any] | None,
    ) -> DubbingManifest:
        return set_dubbing_preview(job_id, preview)

    def remove_track(self, job_id: str, lang: str) -> DubbingManifest:
        return remove_dubbing_track(job_id, lang)

    def upsert_cut_track(
        self,
        job_id: str,
        cut_id: str,
        lang: str,
        track: DubbingCutTrack | dict[str, Any],
    ) -> DubbingManifest:
        return upsert_cut_dubbing_track(job_id, cut_id, lang, track)

    def remove_cut_track(
        self,
        job_id: str,
        cut_id: str,
        lang: str | None = None,
    ) -> DubbingManifest:
        return remove_cut_dubbing_track(job_id, cut_id, lang)

    def sync_job(
        self,
        job_id: str,
        manifest: DubbingManifest,
        *,
        container: ServiceContainer | None = None,
        dubbing_status: str | None = None,
    ) -> Job | None:
        return sync_job_dubbing_fields(
            job_id,
            manifest,
            container=container,
            dubbing_status=dubbing_status,
        )


__all__ = [
    "DubbingManifestStore",
    "load_dubbing_manifest",
    "load_or_create_dubbing_manifest",
    "load_preview_manifest",
    "remove_cut_dubbing_track",
    "remove_dubbing_track",
    "save_dubbing_manifest",
    "save_preview_manifest",
    "set_dubbing_preview",
    "sync_job_dubbing_fields",
    "upsert_cut_dubbing_track",
    "upsert_dubbing_track",
]
