"""Persistent, thread-safe, cross-OS stage and pipeline logging.

Writes timestamped logs dynamically under `{settings.media.base_dir}/logs/`:
- `{media.base_dir}/logs/<job_id>/<stage>.log`
- `{media.base_dir}/logs/<job_id>/pipeline.log`
- `{media.base_dir}/logs/backend.log`

Always resolves `media.base_dir` via `app.core.paths` -> `load_settings().media.base_dir`
so pytest `tmp_path` overrides and runtime settings updates take effect immediately.
"""

from __future__ import annotations

import importlib.util
import json
import os
import platform
import shutil
import sys
import threading
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Sequence

from app.core import paths

STAGE_NAMES: tuple[str, ...] = (
    "orchestrator",
    "ingest",
    "transcription",
    "blocks",
    "topics",
    "analysis",
    "render",
    "batch",
)

_CUDA_DLL_GLOBS: tuple[str, ...] = (
    "cublas64_*.dll",
    "cublasLt64_*.dll",
    "cudnn*.dll",
    "cudart64_*.dll",
    "cufft64_*.dll",
)


def _utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def format_log_line(
    stage: str,
    message: str,
    *,
    level: str = "INFO",
    timestamp: str | None = None,
) -> str:
    ts = timestamp or _utc_timestamp()
    lvl = (level or "INFO").upper()
    stg = (stage or "general").strip() or "general"
    return f"[{ts}] [{lvl}] [{stg}] {message}"


def _safe_json_preview(data: Any, max_len: int = 1200) -> str:
    try:
        serialized = json.dumps(data, ensure_ascii=False, default=str)
    except Exception:
        serialized = repr(data)
    if len(serialized) > max_len:
        return serialized[: max_len - 3] + "..."
    return serialized


def _find_site_packages_roots() -> list[Path]:
    roots: list[Path] = []
    seen: set[str] = set()
    candidates = [
        Path(sys.prefix) / "Lib" / "site-packages",
        Path(sys.prefix) / "lib",
        *(Path(p) for p in sys.path if p),
    ]
    for cand in candidates:
        try:
            resolved = str(cand.resolve())
        except Exception:
            resolved = str(cand)
        if resolved in seen:
            continue
        if cand.exists() and cand.is_dir():
            seen.add(resolved)
            roots.append(cand)
    return roots


def _probe_cuda_dll_locations() -> dict[str, Any]:
    """Inspect filesystem DLL locations without importing heavy GPU libraries."""
    dll_dirs_found: list[str] = []
    cuda_dlls_found: dict[str, list[str]] = {}
    site_roots = _find_site_packages_roots()

    candidate_dirs: list[Path] = []
    for root in site_roots:
        nvidia_dir = root / "nvidia"
        if nvidia_dir.is_dir():
            try:
                for pkg_dir in sorted(nvidia_dir.iterdir()):
                    bin_dir = pkg_dir / "bin"
                    if bin_dir.is_dir():
                        candidate_dirs.append(bin_dir)
                    lib_dir = pkg_dir / "lib"
                    if lib_dir.is_dir():
                        candidate_dirs.append(lib_dir)
            except OSError:
                pass
        torch_lib = root / "torch" / "lib"
        if torch_lib.is_dir():
            candidate_dirs.append(torch_lib)
        ct2_dir = root / "ctranslate2"
        if ct2_dir.is_dir():
            candidate_dirs.append(ct2_dir)

    for env_key in ("CUDA_PATH", "CUDA_HOME", "CUDNN_PATH"):
        env_val = os.environ.get(env_key)
        if env_val:
            env_path = Path(env_val)
            for sub in (env_path / "bin", env_path / "lib" / "x64", env_path):
                if sub.is_dir():
                    candidate_dirs.append(sub)

    if os.name == "nt":
        local_app_data = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local"))
        ollama_cuda = local_app_data / "Programs" / "Ollama" / "lib" / "ollama" / "cuda_v12"
        if ollama_cuda.is_dir():
            candidate_dirs.append(ollama_cuda)
        base_prefix_site = Path(sys.base_prefix) / "Lib" / "site-packages" / "torch" / "lib"
        if base_prefix_site.is_dir():
            candidate_dirs.append(base_prefix_site)

    seen_dirs: set[str] = set()
    for d in candidate_dirs:
        key = str(d)
        if key in seen_dirs:
            continue
        seen_dirs.add(key)
        dll_dirs_found.append(key)
        matched_dlls: list[str] = []
        for pattern in _CUDA_DLL_GLOBS:
            try:
                for hit in sorted(d.glob(pattern)):
                    if hit.name not in matched_dlls:
                        matched_dlls.append(hit.name)
            except OSError:
                pass
        if matched_dlls:
            cuda_dlls_found[key] = matched_dlls

    path_entries = [p for p in os.environ.get("PATH", "").split(os.pathsep) if p]
    cuda_in_path = [
        p
        for p in path_entries
        if any(tok in p.lower() for tok in ("cuda", "nvidia", "cudnn", "cublas", "torch", "ffmpeg"))
    ]

    return {
        "candidate_dll_dirs": dll_dirs_found[:30],
        "cuda_dlls_found": cuda_dlls_found,
        "cuda_or_ffmpeg_in_PATH": cuda_in_path[:20],
    }


def collect_environment_diagnostics(context: dict[str, Any] | None = None) -> dict[str, Any]:
    """Collect safe runtime diagnostics (PATH, CUDA/DLL paths, active settings, loaded modules).

    Never imports heavy libraries (`torch`, `ctranslate2`, `faster_whisper`, `cv2`, `mediapipe`, `yt_dlp`)
    and never allocates GPU memory.
    """
    active_settings: dict[str, Any] | str
    try:
        from app.core.settings import load_settings

        active_settings = load_settings().model_dump()
    except Exception as settings_exc:
        active_settings = f"<unavailable: {settings_exc}>"

    active_tool_configs: dict[str, Any] | str
    try:
        from app.core.tool_configs import load_active_tool_configs

        tc = load_active_tool_configs()
        active_tool_configs = {
            "whisper": tc.get("whisper"),
            "llm": {
                k: v
                for k, v in (tc.get("llm") or {}).items()
                if k not in ("system_prompt", "user_prompt")
            }
            if isinstance(tc.get("llm"), dict)
            else tc.get("llm"),
            "rendering": tc.get("rendering"),
        }
    except Exception as tc_exc:
        active_tool_configs = f"<unavailable: {tc_exc}>"

    heavy_modules: dict[str, str] = {}
    package_specs: dict[str, bool] = {}
    for mod_name in ("torch", "ctranslate2", "faster_whisper", "cv2", "mediapipe", "yt_dlp", "numpy"):
        mod = sys.modules.get(mod_name)
        if mod is not None:
            heavy_modules[mod_name] = str(getattr(mod, "__version__", "loaded"))
        try:
            package_specs[mod_name] = importlib.util.find_spec(mod_name) is not None
        except Exception:
            package_specs[mod_name] = False

    path_raw = os.environ.get("PATH", "")
    path_entries = [p for p in path_raw.split(os.pathsep) if p]

    diagnostics: dict[str, Any] = {
        "os": os.name,
        "platform": platform.platform(),
        "python_version": sys.version.split()[0],
        "python_executable": sys.executable,
        "sys_prefix": sys.prefix,
        "sys_base_prefix": sys.base_prefix,
        "cwd": os.getcwd(),
        "binaries": {
            "ffmpeg": shutil.which("ffmpeg"),
            "ffprobe": shutil.which("ffprobe"),
            "nvidia_smi": shutil.which("nvidia-smi"),
        },
        "cuda_env": {
            k: os.environ.get(k)
            for k in ("CUDA_PATH", "CUDA_HOME", "CUDA_VISIBLE_DEVICES", "CUDNN_PATH", "LD_LIBRARY_PATH")
            if os.environ.get(k) is not None
        },
        "path_entry_count": len(path_entries),
        "path_head": path_entries[:15],
        "cuda_dll_probe": _probe_cuda_dll_locations(),
        "package_installed": package_specs,
        "active_settings": active_settings,
        "active_tool_configs": active_tool_configs,
        "loaded_modules": heavy_modules,
    }
    if context:
        diagnostics["context"] = context
    return diagnostics


class StageLogger:
    """Thread-safe persistent file logger writing to `{media.base_dir}/logs/`."""

    def __init__(self) -> None:
        self._lock = threading.RLock()

    def _append_to_file(self, file_path: Path, lines: Sequence[str], *, fsync: bool = False) -> None:
        if not lines:
            return
        payload = "\n".join(lines) + "\n"
        try:
            with self._lock:
                file_path.parent.mkdir(parents=True, exist_ok=True)
                with open(file_path, "a", encoding="utf-8", errors="replace") as fh:
                    fh.write(payload)
                    fh.flush()
                    if fsync:
                        try:
                            os.fsync(fh.fileno())
                        except OSError:
                            pass
        except OSError:
            # Never crash pipeline operations due to filesystem log write errors.
            pass

    def _resolve_targets(
        self,
        job_id: str,
        stage: str,
        *,
        write_backend_log: bool = False,
    ) -> list[Path]:
        targets: list[Path] = []
        clean_stage = (stage or "").strip() or "general"
        if clean_stage not in ("all", "pipeline"):
            targets.append(paths.job_stage_log_path(job_id, clean_stage))
        targets.append(paths.job_pipeline_log_path(job_id))
        if write_backend_log:
            targets.append(paths.backend_log_path())
        return targets

    def log(
        self,
        job_id: str,
        stage: str,
        message: str,
        *,
        level: str = "INFO",
        extra: dict[str, Any] | None = None,
        write_backend_log: bool = False,
        fsync: bool = False,
    ) -> list[str]:
        ts = _utc_timestamp()
        text = str(message)
        if extra:
            text = f"{text} | extra={_safe_json_preview(extra)}"
        raw_lines = text.splitlines() or [""]
        formatted = [
            format_log_line(stage, ln, level=level, timestamp=ts)
            for ln in raw_lines
        ]
        targets = self._resolve_targets(job_id, stage, write_backend_log=write_backend_log)
        backend_path = paths.backend_log_path()
        for target in targets:
            if target == backend_path:
                backend_lines = [
                    format_log_line(f"job:{job_id}/{stage}", ln, level=level, timestamp=ts)
                    for ln in raw_lines
                ]
                self._append_to_file(target, backend_lines, fsync=fsync)
            else:
                self._append_to_file(target, formatted, fsync=fsync)
        return formatted

    def log_lines(
        self,
        job_id: str,
        stage: str,
        lines: Sequence[str],
        *,
        level: str = "INFO",
        write_backend_log: bool = False,
        fsync: bool = False,
    ) -> list[str]:
        if not lines:
            return []
        ts = _utc_timestamp()
        formatted: list[str] = []
        backend_lines: list[str] = []
        for item in lines:
            for sub in str(item).splitlines() or [""]:
                formatted.append(format_log_line(stage, sub, level=level, timestamp=ts))
                if write_backend_log:
                    backend_lines.append(
                        format_log_line(f"job:{job_id}/{stage}", sub, level=level, timestamp=ts)
                    )
        targets = self._resolve_targets(job_id, stage, write_backend_log=write_backend_log)
        backend_path = paths.backend_log_path()
        for target in targets:
            if target == backend_path:
                self._append_to_file(target, backend_lines, fsync=fsync)
            else:
                self._append_to_file(target, formatted, fsync=fsync)
        return formatted

    def log_stage_start(
        self,
        job_id: str,
        stage: str,
        *,
        inputs: dict[str, Any] | None = None,
        message: str = "",
    ) -> list[str]:
        msg = message or f"Stage '{stage}' started"
        return self.log(
            job_id,
            stage,
            f"=== START: {msg} ===",
            level="INFO",
            extra={"inputs": inputs} if inputs is not None else None,
            write_backend_log=True,
            fsync=False,
        )

    def log_stage_end(
        self,
        job_id: str,
        stage: str,
        *,
        duration_ms: float | None = None,
        outputs: dict[str, Any] | None = None,
        message: str = "",
    ) -> list[str]:
        msg = message or f"Stage '{stage}' completed"
        extra: dict[str, Any] = {}
        if duration_ms is not None:
            extra["duration_ms"] = round(float(duration_ms), 2)
        if outputs is not None:
            extra["outputs"] = outputs
        return self.log(
            job_id,
            stage,
            f"=== END: {msg} ===",
            level="INFO",
            extra=extra or None,
            write_backend_log=True,
            fsync=False,
        )

    def log_exception(
        self,
        job_id: str,
        stage: str,
        exc: BaseException,
        *,
        message: str | None = None,
        context: dict[str, Any] | None = None,
        include_env_diagnostics: bool = True,
    ) -> list[str]:
        exc_type = type(exc).__name__
        exc_msg = str(exc)
        tb_text = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__)).rstrip()
        header = f"{message} | EXCEPTION [{exc_type}]: {exc_msg}" if message else f"EXCEPTION [{exc_type}]: {exc_msg}"
        raw_lines: list[str] = [header]
        if context:
            raw_lines.append(f"Context: {_safe_json_preview(context, max_len=4000)}")
        if tb_text:
            raw_lines.append("Traceback:")
            raw_lines.extend(tb_text.splitlines())
        if include_env_diagnostics:
            diag = collect_environment_diagnostics(context=None)
            raw_lines.append(f"EnvironmentDiagnostics: {_safe_json_preview(diag, max_len=6000)}")
        return self.log_lines(
            job_id,
            stage,
            raw_lines,
            level="ERROR",
            write_backend_log=True,
            fsync=True,
        )

    def read_stage_log(self, job_id: str, stage: str, *, tail: int = 400) -> list[str]:
        target = (
            paths.job_pipeline_log_path(job_id)
            if stage in ("all", "pipeline")
            else paths.job_stage_log_path(job_id, stage)
        )
        if not target.exists() or not target.is_file():
            return []
        try:
            with self._lock:
                content = target.read_text(encoding="utf-8", errors="replace")
            lines = content.splitlines()
            if tail > 0 and len(lines) > tail:
                return lines[-tail:]
            return lines
        except OSError:
            return []


_DEFAULT_STAGE_LOGGER: StageLogger | None = None


def get_stage_logger() -> StageLogger:
    global _DEFAULT_STAGE_LOGGER
    if _DEFAULT_STAGE_LOGGER is None:
        _DEFAULT_STAGE_LOGGER = StageLogger()
    return _DEFAULT_STAGE_LOGGER
