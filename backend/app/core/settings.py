"""Atomic reading/writing of data/settings.json with cross-OS base_dir normalization."""

from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

from app.core.paths import settings_file_path
from app.infrastructure.storage.atomic_store import atomic_write_json, read_json
from app.models.schemas import (
    AppSettings,
    LlmSettings,
    MediaSettings,
    PreferencesSettings,
    WhisperSettings,
)

_WINDOWS_DRIVE_RE = re.compile(r"^[A-Za-z]:[\\/]")
_INVALID_FOLDER_CHARS_RE = re.compile(r'[<>:"/\\|?*]')

_default_base_dir_override: Path | None = None
_cached_settings: tuple[AppSettings, float] | None = None
_cached_settings_file: Path | None = None


def set_default_base_dir_override(path: str | Path | None) -> None:
    """Override the default media base_dir (used by pytest fixtures)."""
    global _default_base_dir_override
    _default_base_dir_override = Path(path).resolve() if path is not None else None
    invalidate_settings_cache()


def invalidate_settings_cache() -> None:
    global _cached_settings, _cached_settings_file
    _cached_settings = None
    _cached_settings_file = None


def _settings_cache_ttl_seconds() -> float:
    raw = os.environ.get("SETTINGS_CACHE_TTL_MS")
    if raw:
        try:
            val = int(raw)
            if val > 0:
                return val / 1000.0
        except ValueError:
            pass
    return 3.0


def get_default_base_dir() -> Path:
    if _default_base_dir_override is not None:
        return _default_base_dir_override
    env_dir = os.environ.get("YTS_MEDIA_BASE_DIR")
    if env_dir:
        return Path(env_dir).resolve()
    return Path.home() / "Downloads" / "uploads"


def is_foreign_os_path(raw_path: str, target_os: str | None = None) -> bool:
    """Detect whether raw_path belongs to a different operating system than target_os ('nt' or 'posix')."""
    effective_os = target_os or os.name
    stripped = (raw_path or "").strip()
    if not stripped:
        return True
    if effective_os == "nt":
        # Running on Windows: POSIX absolute path like /home/... or /Users/... is foreign
        if stripped.startswith("/") and not _WINDOWS_DRIVE_RE.match(stripped):
            return True
        return False
    else:
        # Running on POSIX: Windows drive path like C:\... or C:/... is foreign
        if _WINDOWS_DRIVE_RE.match(stripped) or "\\" in stripped:
            return True
        return False


def normalize_cross_os_base_dir(
    raw_path: str | None,
    *,
    target_os: str | None = None,
    fallback_dir: str | Path | None = None,
) -> str:
    """Normalize media.base_dir across Windows and Linux/POSIX, falling back safely when foreign."""
    fallback = str(Path(fallback_dir) if fallback_dir is not None else get_default_base_dir())
    if not raw_path or not str(raw_path).strip():
        return fallback
    cleaned = str(raw_path).strip()
    if is_foreign_os_path(cleaned, target_os=target_os):
        return fallback
    return cleaned


def default_settings() -> AppSettings:
    base_dir = str(get_default_base_dir())
    return AppSettings(
        media=MediaSettings(base_dir=base_dir, download_resolution="1080p"),
        preferences=PreferencesSettings(
            ask_move_on_upload=True,
            move_uploads=True,
            ask_delete_cut_confirm=True,
        ),
        whisper=WhisperSettings(device="cuda", formats=["json", "vtt", "txt"]),
        llm=LlmSettings(model="qwen2.5:14b"),
    )


def _ensure_dir(path: str | Path) -> Path:
    p = Path(path)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _parse_settings_dict(parsed: dict[str, Any]) -> AppSettings:
    defaults = default_settings()
    media_in = parsed.get("media") if isinstance(parsed.get("media"), dict) else {}
    prefs_in = parsed.get("preferences") if isinstance(parsed.get("preferences"), dict) else {}
    whisper_in = parsed.get("whisper") if isinstance(parsed.get("whisper"), dict) else {}
    llm_in = parsed.get("llm") if isinstance(parsed.get("llm"), dict) else {}

    raw_base_dir = media_in.get("base_dir")
    base_dir = normalize_cross_os_base_dir(
        str(raw_base_dir) if raw_base_dir is not None else None
    )

    raw_res = media_in.get("download_resolution")
    download_resolution = (
        raw_res if raw_res in ("1080p", "1440p", "4k") else defaults.media.download_resolution
    )

    ask_move = (
        prefs_in["ask_move_on_upload"]
        if isinstance(prefs_in.get("ask_move_on_upload"), bool)
        else defaults.preferences.ask_move_on_upload
    )
    move_uploads = (
        prefs_in["move_uploads"]
        if isinstance(prefs_in.get("move_uploads"), bool)
        else defaults.preferences.move_uploads
    )
    ask_delete = (
        prefs_in["ask_delete_cut_confirm"]
        if isinstance(prefs_in.get("ask_delete_cut_confirm"), bool)
        else defaults.preferences.ask_delete_cut_confirm
    )

    device = "cpu" if whisper_in.get("device") == "cpu" else "cuda"
    formats = (
        [str(x) for x in whisper_in["formats"]]
        if isinstance(whisper_in.get("formats"), list)
        else list(defaults.whisper.formats)
    )

    model = str(llm_in.get("model") or "").strip() or defaults.llm.model

    return AppSettings(
        media=MediaSettings(base_dir=base_dir, download_resolution=download_resolution),
        preferences=PreferencesSettings(
            ask_move_on_upload=ask_move,
            move_uploads=move_uploads,
            ask_delete_cut_confirm=ask_delete,
        ),
        whisper=WhisperSettings(device=device, formats=formats),
        llm=LlmSettings(model=model),
    )


def load_settings() -> AppSettings:
    global _cached_settings, _cached_settings_file
    sf = settings_file_path()
    now = time.monotonic()
    if (
        _cached_settings is not None
        and _cached_settings_file == sf
        and _cached_settings[1] > now
    ):
        return _cached_settings[0].model_copy(deep=True)

    if not sf.exists():
        defaults = default_settings()
        _ensure_dir(defaults.media.base_dir)
        atomic_write_json(sf, defaults)
        _cached_settings = (defaults, now + _settings_cache_ttl_seconds())
        _cached_settings_file = sf
        return defaults.model_copy(deep=True)

    try:
        raw = read_json(sf)
        if not isinstance(raw, dict):
            raise ValueError("Settings root must be an object")
        settings = _parse_settings_dict(raw)
        _ensure_dir(settings.media.base_dir)
        # If cross-OS normalization changed base_dir on disk, persist the normalized path atomically
        raw_base = raw.get("media", {}).get("base_dir") if isinstance(raw.get("media"), dict) else None
        if raw_base != settings.media.base_dir:
            atomic_write_json(sf, settings)
        _cached_settings = (settings, now + _settings_cache_ttl_seconds())
        _cached_settings_file = sf
        return settings.model_copy(deep=True)
    except Exception:
        defaults = default_settings()
        _ensure_dir(defaults.media.base_dir)
        atomic_write_json(sf, defaults)
        _cached_settings = (defaults, now + _settings_cache_ttl_seconds())
        _cached_settings_file = sf
        return defaults.model_copy(deep=True)


def save_settings(next_settings: AppSettings | dict[str, Any]) -> AppSettings:
    global _cached_settings, _cached_settings_file
    sf = settings_file_path()
    if isinstance(next_settings, dict):
        parsed = _parse_settings_dict(next_settings)
    else:
        parsed = _parse_settings_dict(next_settings.model_dump())
    _ensure_dir(parsed.media.base_dir)
    atomic_write_json(sf, parsed)
    _cached_settings = (parsed, time.monotonic() + _settings_cache_ttl_seconds())
    _cached_settings_file = sf
    return parsed.model_copy(deep=True)


def update_settings(partial: dict[str, Any] | AppSettings) -> AppSettings:
    current = load_settings().model_dump()
    patch = partial.model_dump(exclude_unset=True) if isinstance(partial, AppSettings) else (partial or {})

    merged: dict[str, Any] = {
        "media": {**current["media"], **(patch.get("media") or {})},
        "preferences": {**current["preferences"], **(patch.get("preferences") or {})},
        "whisper": {**current["whisper"], **(patch.get("whisper") or {})},
        "llm": {**current["llm"], **(patch.get("llm") or {})},
    }
    if not merged["media"].get("base_dir"):
        merged["media"]["base_dir"] = current["media"]["base_dir"]
    if merged["media"].get("download_resolution") not in ("1080p", "1440p", "4k"):
        merged["media"]["download_resolution"] = current["media"]["download_resolution"]

    return save_settings(merged)


def get_video_folder(video_name: str) -> str:
    """Sanitize video name for use as folder name."""
    return _INVALID_FOLDER_CHARS_RE.sub("_", video_name)[:200]


def get_video_dir(job_id: str, video_name: str | None = None) -> Path:
    """Format: {base_dir}/{video_name}/"""
    settings = load_settings()
    folder_name = get_video_folder(video_name) if video_name else job_id
    return Path(settings.media.base_dir) / folder_name


def get_video_file_path(
    job_id: str,
    video_name: str | None = None,
    extension: str = ".mp4",
) -> Path:
    """Format: {base_dir}/{video_name}/video.mp4"""
    video_dir = get_video_dir(job_id, video_name)
    ext = extension if extension.startswith(".") else f".{extension}"
    return video_dir / f"video{ext}"


def get_transcriptions_dir(
    job_id: str,
    video_name: str | None = None,
    *,
    create: bool = True,
) -> Path:
    """Format: {base_dir}/{video_name}/transcrições/"""
    d = get_video_dir(job_id, video_name) / "transcrições"
    if create:
        _ensure_dir(d)
    return d


def get_shorts_dir(
    job_id: str,
    video_name: str | None = None,
    *,
    create: bool = True,
) -> Path:
    """Format: {base_dir}/{video_name}/shorts/"""
    d = get_video_dir(job_id, video_name) / "shorts"
    if create:
        _ensure_dir(d)
    return d


def archived_videos_dir(*, create: bool = True) -> Path:
    """Format: {base_dir}/_archived"""
    settings = load_settings()
    d = Path(settings.media.base_dir) / "_archived"
    if create:
        _ensure_dir(d)
    return d


def get_archived_video_dir(video_name: str, *, create: bool = True) -> Path:
    """Format: {base_dir}/_archived/{video_name}/"""
    settings = load_settings()
    folder_name = get_video_folder(video_name)
    d = Path(settings.media.base_dir) / "_archived" / folder_name
    if create:
        _ensure_dir(d)
    return d
