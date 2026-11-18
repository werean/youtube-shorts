"""Local profile persistence (`data/profile/profile.json`).

Phase 1 only knows the local profile (`p_local`). The file already has the final format of a profile that
will later live inside the storage root, so phase 2 only has to copy it.

Rules enforced here:
- Every write is atomic (`AtomicJsonArtifactStore`).
- A `profile.json` that exists but cannot be read is NEVER overwritten (`ProfileUnreadableError`).
- Unknown fields are preserved when the file is rewritten.
- The watermark image path is fixed (`marca-dagua/watermark.png`); the `watermark.file` field is informative only.
"""

from __future__ import annotations

import copy
import json
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.core import paths
from app.infrastructure.storage.atomic_store import AtomicJsonArtifactStore

LOCAL_PROFILE_ID = "p_local"
ACTIVE_ALIAS = "active"
PROFILE_SCHEMA_VERSION = 1
LOCAL_PROFILE_NAME = "Perfil local"

WATERMARK_DIR_NAME = "marca-dagua"
WATERMARK_FILE_NAME = "watermark.png"
WATERMARK_RELATIVE_FILE = f"{WATERMARK_DIR_NAME}/{WATERMARK_FILE_NAME}"

WATERMARK_MODES = ("always", "never", "ask")
WATERMARK_POSITIONS = (
    "top-left",
    "top-center",
    "top-right",
    "middle-left",
    "center",
    "middle-right",
    "bottom-left",
    "bottom-center",
    "bottom-right",
)
DEFAULT_OPACITY = 0.7
MIN_OPACITY = 0.05
MAX_OPACITY = 1.0
DEFAULT_POSITION = "top-right"
DEFAULT_SIZE_PERCENT = 18
MIN_SIZE_PERCENT = 5
MAX_SIZE_PERCENT = 50

_PROFILE_ID_FORMAT = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_store = AtomicJsonArtifactStore()
profile_lock = threading.RLock()


class ProfileNotFoundError(LookupError):
    """The profile id is unknown (or not a valid identifier)."""


class ProfileUnreadableError(RuntimeError):
    """`profile.json` exists but cannot be read (or was written by a newer app). It is never overwritten."""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def resolve_profile_id(profile_id: str) -> str:
    """Map a route `:profile_id` (`active` or `p_local` in phase 1) to the real profile id."""
    if not isinstance(profile_id, str) or not _PROFILE_ID_FORMAT.match(profile_id):
        raise ProfileNotFoundError(profile_id)
    if profile_id in (ACTIVE_ALIAS, LOCAL_PROFILE_ID):
        return LOCAL_PROFILE_ID
    raise ProfileNotFoundError(profile_id)


def profile_dir() -> Path:
    return paths.local_profile_dir()


def profile_file() -> Path:
    return paths.local_profile_file_path()


def watermark_image_path() -> Path:
    """Fixed, server-built path of the watermark image. Never derived from any field of the JSON."""
    return profile_dir() / WATERMARK_DIR_NAME / WATERMARK_FILE_NAME


def default_watermark_block() -> dict[str, Any]:
    return {
        "mode": "never",
        "file": None,
        "opacity": DEFAULT_OPACITY,
        "position": DEFAULT_POSITION,
        "size_percent": DEFAULT_SIZE_PERCENT,
        "image": None,
    }


def default_profile() -> dict[str, Any]:
    now = now_iso()
    return {
        "schema_version": PROFILE_SCHEMA_VERSION,
        "profile_id": LOCAL_PROFILE_ID,
        "name": LOCAL_PROFILE_NAME,
        "created_at": now,
        "revision": 0,
        "updated_at": now,
        "updated_by": None,
        "accounts": [],
        "preferences": {
            "settings": {},
            "tool_configs": {},
            "watermark": default_watermark_block(),
            "publish": {"default_hashtags": ""},
        },
        "merged_conflict_files": [],
    }


def _as_float(value: Any, default: float) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return float(value)


def normalize_watermark_block(raw: Any) -> dict[str, Any]:
    """Return a clean watermark block: invalid or missing values fall back to defaults (unknown keys kept)."""
    block = dict(raw) if isinstance(raw, dict) else {}
    out = default_watermark_block()
    out.update({k: v for k, v in block.items() if k not in out})

    mode = block.get("mode")
    out["mode"] = mode if mode in WATERMARK_MODES else "never"

    opacity = _as_float(block.get("opacity"), DEFAULT_OPACITY)
    out["opacity"] = round(min(MAX_OPACITY, max(MIN_OPACITY, opacity)), 4)

    position = block.get("position")
    out["position"] = position if position in WATERMARK_POSITIONS else DEFAULT_POSITION

    size = _as_float(block.get("size_percent"), float(DEFAULT_SIZE_PERCENT))
    out["size_percent"] = int(min(MAX_SIZE_PERCENT, max(MIN_SIZE_PERCENT, round(size))))

    file_value = block.get("file")
    out["file"] = file_value if isinstance(file_value, str) else None

    image = block.get("image")
    if (
        isinstance(image, dict)
        and isinstance(image.get("width"), int)
        and isinstance(image.get("height"), int)
        and isinstance(image.get("updated_at"), str)
    ):
        out["image"] = {
            "width": image["width"],
            "height": image["height"],
            "updated_at": image["updated_at"],
        }
    else:
        out["image"] = None
    return out


def _read_existing(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise ProfileUnreadableError("Não foi possível ler o perfil.") from exc
    if not isinstance(data, dict) or not isinstance(data.get("preferences", {}), dict):
        raise ProfileUnreadableError("Não foi possível ler o perfil.")
    return data


def load_profile(*, create: bool = True) -> dict[str, Any]:
    """Load `profile.json`, creating it with defaults on the first read (when `create`)."""
    path = profile_file()
    with profile_lock:
        if path.exists():
            return _read_existing(path)
        profile = default_profile()
        if create:
            _store.write_json(path, profile)
        return profile


def _check_writable(profile: dict[str, Any]) -> None:
    version = profile.get("schema_version")
    if isinstance(version, int) and not isinstance(version, bool) and version > PROFILE_SCHEMA_VERSION:
        raise ProfileUnreadableError("Este perfil foi alterado por uma versão mais nova do app.")


def update_profile(mutator: Any) -> dict[str, Any]:
    """Apply `mutator(profile_dict)` to the current on-disk profile and persist it atomically."""
    with profile_lock:
        current = load_profile(create=True)
        _check_writable(current)
        updated = copy.deepcopy(current)
        mutator(updated)
        updated["revision"] = int(updated.get("revision") or 0) + 1
        updated["updated_at"] = now_iso()
        _store.write_json(profile_file(), updated)
        return updated


def get_watermark_block(profile: dict[str, Any] | None = None) -> dict[str, Any]:
    profile = profile if profile is not None else load_profile()
    prefs = profile.get("preferences")
    return normalize_watermark_block(prefs.get("watermark") if isinstance(prefs, dict) else None)


def watermark_image_exists() -> bool:
    path = watermark_image_path()
    try:
        return path.is_file() and not path.is_symlink()
    except OSError:
        return False


def set_watermark_block(profile: dict[str, Any], block: dict[str, Any]) -> None:
    prefs = profile.setdefault("preferences", {})
    if not isinstance(prefs, dict):
        prefs = {}
        profile["preferences"] = prefs
    prefs["watermark"] = block
