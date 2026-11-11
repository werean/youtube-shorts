"""Atomic JSON and text file persistence (write .tmp + fsync + os.replace)."""

from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Callable, TypeVar

from pydantic import BaseModel

T = TypeVar("T")


def _to_json_serializable(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", exclude_none=False)
    if isinstance(value, list):
        return [_to_json_serializable(item) for item in value]
    if isinstance(value, dict):
        return {k: _to_json_serializable(v) for k, v in value.items()}
    return value


def atomic_write_bytes(target_path: str | Path, data: bytes) -> Path:
    """Write bytes atomically to target_path using a sibling .tmp file + fsync + os.replace."""
    target = Path(target_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target.with_name(f"{target.name}.{uuid.uuid4().hex}.tmp")
    try:
        with open(tmp_path, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp_path, target)
    except Exception:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:
                pass
        raise
    return target


def atomic_write_text(target_path: str | Path, content: str, encoding: str = "utf-8") -> Path:
    """Write text atomically to target_path."""
    return atomic_write_bytes(target_path, content.encode(encoding))


def atomic_write_json(
    target_path: str | Path,
    payload: Any,
    *,
    indent: int = 2,
    trailing_newline: bool = False,
) -> Path:
    """Serialize payload (dict, list, or Pydantic model) to JSON and write atomically."""
    serializable = _to_json_serializable(payload)
    text = json.dumps(serializable, indent=indent, ensure_ascii=False)
    if trailing_newline:
        text += "\n"
    return atomic_write_text(target_path, text, encoding="utf-8")


def read_text(target_path: str | Path, encoding: str = "utf-8") -> str:
    """Read UTF-8 text from target_path."""
    return Path(target_path).read_text(encoding=encoding)


def read_json(target_path: str | Path) -> Any:
    """Read and parse JSON from target_path."""
    return json.loads(read_text(target_path, encoding="utf-8"))


class AtomicJsonArtifactStore:
    """Atomic file store with optional in-memory cache invalidation hooks."""

    def __init__(self, on_invalidate: Callable[[str | None], None] | None = None) -> None:
        self._on_invalidate = on_invalidate

    def set_invalidation_hook(self, callback: Callable[[str | None], None] | None) -> None:
        self._on_invalidate = callback

    def invalidate(self, job_id: str | None = None) -> None:
        if self._on_invalidate is not None:
            self._on_invalidate(job_id)

    def exists(self, path: str | Path) -> bool:
        return Path(path).exists()

    def write_json(
        self,
        path: str | Path,
        payload: Any,
        *,
        job_id: str | None = None,
        indent: int = 2,
        trailing_newline: bool = False,
    ) -> Path:
        result = atomic_write_json(
            path,
            payload,
            indent=indent,
            trailing_newline=trailing_newline,
        )
        if job_id is not None:
            self.invalidate(job_id)
        return result

    def read_json(self, path: str | Path) -> Any:
        return read_json(path)

    def write_text(
        self,
        path: str | Path,
        content: str,
        *,
        job_id: str | None = None,
    ) -> Path:
        result = atomic_write_text(path, content)
        if job_id is not None:
            self.invalidate(job_id)
        return result

    def read_text(self, path: str | Path) -> str:
        return read_text(path)

    def remove(self, path: str | Path, *, job_id: str | None = None) -> bool:
        target = Path(path)
        existed = target.exists()
        if existed:
            target.unlink(missing_ok=True)
        if job_id is not None:
            self.invalidate(job_id)
        return existed
