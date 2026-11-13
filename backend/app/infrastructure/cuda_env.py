"""Windows/Linux CUDA DLL discovery and safe runtime probing for CTranslate2 / faster-whisper.

Kept lightweight with zero heavy AI/GPU imports at module import time.
"""

from __future__ import annotations

import ctypes
import logging
import os
import site
import sys
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Windows removes an added DLL directory when the cookie object returned by
# `os.add_dll_directory()` is garbage-collected, so handles must stay alive.
_DLL_DIR_HANDLES: list[Any] = []
_REGISTERED_DLL_DIRS: set[str] = set()

_CUDA_ERROR_MARKERS = (
    "cublas",
    "cudnn",
    "cudart",
    "cufft",
    "curand",
    "cusolver",
    "cusparse",
    "nvrtc",
    "cuda",
    "libcuda",
    "out of memory",
    "no kernel image",
    "insufficient driver",
    "driver version",
    "not found or cannot be loaded",
    "ctranslate2",
)


def _iter_candidate_site_roots() -> list[Path]:
    roots: list[Path] = []
    for raw in [sys.prefix, sys.base_prefix]:
        if not raw:
            continue
        base = Path(raw)
        roots.append(base / "Lib" / "site-packages")
        roots.append(base / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages")

    try:
        for sp in site.getsitepackages():
            roots.append(Path(sp))
    except Exception:
        pass

    try:
        user_sp = site.getusersitepackages()
        if user_sp:
            roots.append(Path(user_sp))
    except Exception:
        pass

    deduped: list[Path] = []
    seen: set[str] = set()
    for root in roots:
        key = str(root).lower()
        if key not in seen:
            seen.add(key)
            deduped.append(root)
    return deduped


def discover_cuda_dll_directories() -> list[Path]:
    """Return existing directories likely to hold CUDA 12 / cuBLAS / cuDNN DLLs."""
    candidates: list[Path] = []

    for sp in _iter_candidate_site_roots():
        if not sp.exists():
            continue
        nvidia_dir = sp / "nvidia"
        if nvidia_dir.is_dir():
            for pkg_dir in sorted(nvidia_dir.iterdir()):
                if not pkg_dir.is_dir():
                    continue
                candidates.append(pkg_dir / "bin")
                candidates.append(pkg_dir / "lib")
        candidates.append(sp / "torch" / "lib")
        candidates.append(sp / "ctranslate2")

    for env_var in ("CUDA_PATH", "CUDA_PATH_V12_8", "CUDA_PATH_V12_6", "CUDA_PATH_V12_4", "CUDA_PATH_V12_1", "CUDA_HOME"):
        val = os.environ.get(env_var, "").strip()
        if val:
            base = Path(val)
            candidates.append(base / "bin")
            candidates.append(base / "lib" / "x64")
            candidates.append(base / "lib64")

    if sys.platform == "win32":
        local_app_data = os.environ.get("LOCALAPPDATA", "").strip()
        if local_app_data:
            ollama_base = Path(local_app_data) / "Programs" / "Ollama" / "lib" / "ollama"
            candidates.append(ollama_base / "cuda_v12")
            candidates.append(ollama_base)
        program_files = os.environ.get("ProgramFiles", r"C:\Program Files")
        cuda_toolkit_root = Path(program_files) / "NVIDIA GPU Computing Toolkit" / "CUDA"
        if cuda_toolkit_root.is_dir():
            for ver_dir in sorted(cuda_toolkit_root.iterdir(), reverse=True):
                if ver_dir.is_dir() and ver_dir.name.lower().startswith("v12"):
                    candidates.append(ver_dir / "bin")

    existing: list[Path] = []
    seen: set[str] = set()
    for d in candidates:
        try:
            if not d.is_dir():
                continue
            resolved = str(d.resolve())
        except OSError:
            continue
        key = resolved.lower() if sys.platform == "win32" else resolved
        if key not in seen:
            seen.add(key)
            existing.append(Path(resolved))
    return existing


def ensure_cuda_dll_directories() -> list[str]:
    """Register discovered CUDA directories via `os.add_dll_directory` and `PATH`.

    Safe to call repeatedly; handles are retained globally so Windows keeps
    the search paths active for the lifetime of the process.
    """
    dirs = discover_cuda_dll_directories()
    added: list[str] = []

    current_path = os.environ.get("PATH", "")
    path_parts = [p for p in current_path.split(os.pathsep) if p]
    existing_path_keys = {p.lower() if sys.platform == "win32" else p for p in path_parts}
    prepend_parts: list[str] = []

    for d in dirs:
        d_str = str(d)
        key = d_str.lower() if sys.platform == "win32" else d_str
        if key not in _REGISTERED_DLL_DIRS:
            if sys.platform == "win32" and hasattr(os, "add_dll_directory"):
                try:
                    handle = os.add_dll_directory(d_str)
                    _DLL_DIR_HANDLES.append(handle)
                except OSError as exc:
                    logger.debug("os.add_dll_directory(%s) failed: %s", d_str, exc)
            _REGISTERED_DLL_DIRS.add(key)
            added.append(d_str)

        if key not in existing_path_keys:
            prepend_parts.append(d_str)
            existing_path_keys.add(key)

    if prepend_parts:
        os.environ["PATH"] = os.pathsep.join(prepend_parts + path_parts)

    return added


def probe_cuda_whisper_runtime() -> tuple[bool, str | None]:
    """Check whether required CUDA 12 runtime DLLs can be loaded before committing to GPU.

    Returns `(True, None)` when ready for CUDA execution, or `(False, reason)` when
    required native libraries (such as `cublas64_12.dll` on Windows) are missing or
    cannot be loaded.
    """
    ensure_cuda_dll_directories()

    if sys.platform == "win32":
        required_dlls = ("cublas64_12.dll",)
        for dll_name in required_dlls:
            try:
                ctypes.WinDLL(dll_name)
            except OSError as exc:
                return (
                    False,
                    f"Required CUDA library {dll_name} is not found or cannot be loaded ({exc})",
                )
        return True, None

    # Non-Windows platforms rely on standard shared library resolution.
    return True, None


def is_cuda_or_dll_error(exc: BaseException) -> bool:
    """Return True if `exc` indicates a CUDA, cuBLAS, cuDNN, or GPU memory failure."""
    msg = str(exc).lower()
    if any(marker in msg for marker in _CUDA_ERROR_MARKERS):
        return True
    cause = exc.__cause__ or exc.__context__
    if cause is not None and cause is not exc:
        return is_cuda_or_dll_error(cause)
    return False
