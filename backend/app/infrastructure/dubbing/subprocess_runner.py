"""Subprocess runner for isolated `.venv-dubbing-*` worker scripts.

Executes `worker_demucs.py`, `worker_diarize.py`, and `worker_tts.py` inside their
isolated virtualenvs, streams JSON progress lines (`{"event": "progress", ...}`),
registers PIDs in `OperationRuntimeService`, kills process trees on `CancelToken`,
and supports injectable fake runners on `ServiceContainer.dubbing_subprocess_runner`.
"""

from __future__ import annotations

import asyncio
import inspect
import json
import os
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable

from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.core.paths import (
    dubbing_base_venv_dir,
    dubbing_engine_venv_dir,
    dubbing_hf_cache_dir,
    dubbing_sep_cache_dir,
    dubbing_sherpa_cache_dir,
)

DubbingSubprocessRunner = Callable[..., Awaitable[Any]]
ProgressCallback = Callable[[float, str], Any]

_WORKER_DIR = Path(__file__).resolve().parent


@dataclass
class WorkerExecutionResult:
    returncode: int
    result: dict[str, Any] = field(default_factory=dict)
    error: str | None = None
    logs: list[str] = field(default_factory=list)


def resolve_venv_python(venv_dir: Path) -> Path:
    """Return the Python executable inside `venv_dir` cross-OS."""
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def build_worker_env(extra_env: dict[str, str] | None = None) -> dict[str, str]:
    """Build sanitized worker subprocess environment with HF cache isolation."""
    env = os.environ.copy()
    env["HF_HOME"] = str(dubbing_hf_cache_dir(create=True))
    env["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"
    if extra_env:
        env.update(extra_env)
    return env


async def _call_progress(cb: ProgressCallback | None, percent: float, message: str) -> None:
    if cb is None:
        return
    res = cb(float(percent), str(message))
    if inspect.isawaitable(res):
        await res


def _parse_json_event(line: str) -> dict[str, Any] | None:
    stripped = line.strip()
    if not stripped.startswith("{") or not stripped.endswith("}"):
        return None
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict) and "event" in parsed:
            return parsed
    except json.JSONDecodeError:
        return None
    return None


async def _invoke_custom_runner(
    runner: DubbingSubprocessRunner,
    command: list[str],
    env: dict[str, str],
    on_line: Callable[[str], None],
    cancel_token: CancelToken | None,
) -> Any:
    sig = inspect.signature(runner)
    params = [
        p
        for p in sig.parameters.values()
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
    ]
    has_varargs = any(p.kind == p.VAR_POSITIONAL for p in sig.parameters.values())
    if has_varargs or len(params) >= 4:
        res = runner(command, env, on_line, cancel_token)
    elif len(params) == 3:
        res = runner(command, on_line, cancel_token)
    else:
        res = runner(command)
    if inspect.isawaitable(res):
        return await res
    return res


async def _default_run_subprocess(
    *,
    job_id: str,
    command: list[str],
    env: dict[str, str],
    on_line: Callable[[str], None],
    cancel_token: CancelToken | None,
    container: ServiceContainer,
    task_name: str = "dubbing",
) -> int:
    if cancel_token and cancel_token.is_set():
        raise OperationCancelledError(job_id, task_name)

    try:
        proc = await asyncio.create_subprocess_exec(
            command[0],
            *command[1:],
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=env,
        )
    except NotImplementedError:
        return await _run_subprocess_threaded(
            job_id=job_id,
            command=command,
            env=env,
            on_line=on_line,
            cancel_token=cancel_token,
            container=container,
            task_name=task_name,
        )

    pid = proc.pid
    container.runtime.register_process(job_id, task_name, pid)
    if cancel_token is not None:
        cancel_token.on_cancel(lambda: container.runtime.kill_process_tree(pid))

    async def _read_stream(stream: asyncio.StreamReader | None) -> None:
        if not stream:
            return
        while not stream.at_eof():
            line_bytes = await stream.readline()
            if not line_bytes:
                break
            line = line_bytes.decode("utf-8", errors="replace").rstrip("\r\n")
            if line:
                on_line(line)

    try:
        await asyncio.gather(_read_stream(proc.stdout), _read_stream(proc.stderr))
        return int(await proc.wait())
    except asyncio.CancelledError:
        container.runtime.kill_process_tree(pid)
        raise
    finally:
        container.runtime.unregister_process(job_id, task_name, pid)


async def _run_subprocess_threaded(
    *,
    job_id: str,
    command: list[str],
    env: dict[str, str],
    on_line: Callable[[str], None],
    cancel_token: CancelToken | None,
    container: ServiceContainer,
    task_name: str = "dubbing",
) -> int:
    """Fallback runner for Windows SelectorEventLoop where `create_subprocess_exec` raises NotImplementedError."""
    loop = asyncio.get_running_loop()

    def _worker() -> int:
        proc = subprocess.Popen(
            command,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=1,
            env=env,
        )
        pid = proc.pid
        container.runtime.register_process(job_id, task_name, pid)
        if cancel_token is not None:
            cancel_token.on_cancel(lambda: container.runtime.kill_process_tree(pid))
        try:
            if proc.stdout is not None:
                for raw_line in proc.stdout:
                    if cancel_token and cancel_token.is_set():
                        container.runtime.kill_process_tree(pid)
                        break
                    line = raw_line.rstrip("\r\n")
                    if line:
                        loop.call_soon_threadsafe(on_line, line)
            return int(proc.wait())
        finally:
            container.runtime.unregister_process(job_id, task_name, pid)

    return await asyncio.to_thread(_worker)


async def run_dubbing_worker(
    *,
    job_id: str,
    python_exe: Path,
    script_path: Path,
    args: list[str],
    cancel_token: CancelToken | None = None,
    on_progress: ProgressCallback | None = None,
    container: ServiceContainer | None = None,
    subprocess_runner: DubbingSubprocessRunner | None = None,
    extra_env: dict[str, str] | None = None,
    task_name: str = "dubbing",
) -> WorkerExecutionResult:
    """Execute an isolated dubbing worker script and parse its structured stdout events."""
    active_container = container or get_container()
    token = cancel_token or active_container.runtime.get_cancel_token(job_id, task_name)
    if token and token.is_set():
        raise OperationCancelledError(job_id, task_name)

    runner = subprocess_runner or getattr(active_container, "dubbing_subprocess_runner", None)
    if runner is None and not python_exe.exists():
        raise FileNotFoundError(
            f"Ambiente Python de dublagem não encontrado: {python_exe}. Execute a instalação primeiro."
        )

    command = [str(python_exe), str(script_path), *args]
    env = build_worker_env(extra_env)

    logs: list[str] = []
    parsed_result: dict[str, Any] = {}
    parsed_error: str | None = None
    progress_tasks: list[asyncio.Task[Any]] = []
    loop = asyncio.get_running_loop()

    def _handle_line(line: str) -> None:
        nonlocal parsed_result, parsed_error
        evt = _parse_json_event(line)
        if evt is not None:
            etype = evt.get("event")
            if etype == "progress":
                pct = float(evt.get("percent") or 0.0)
                msg = str(evt.get("message") or "")
                if msg:
                    active_container.runtime.append_task_log(job_id, task_name, msg)
                if on_progress is not None:
                    res = on_progress(pct, msg)
                    if inspect.isawaitable(res):
                        progress_tasks.append(loop.create_task(res))
                return
            if etype == "result":
                parsed_result = {k: v for k, v in evt.items() if k != "event"}
                return
            if etype == "error":
                parsed_error = str(evt.get("error") or "Worker error")
                active_container.runtime.append_task_log(job_id, task_name, f"ERROR: {parsed_error}", level="ERROR")
                return
        logs.append(line)
        active_container.runtime.append_task_log(job_id, task_name, line)

    if runner is not None:
        raw_ret = await _invoke_custom_runner(runner, command, env, _handle_line, token)
        if isinstance(raw_ret, dict):
            retcode = int(raw_ret.get("returncode", 0))
            if isinstance(raw_ret.get("result"), dict):
                parsed_result = {**raw_ret["result"], **parsed_result}
            if raw_ret.get("error") and not parsed_error:
                parsed_error = str(raw_ret["error"])
        else:
            retcode = int(raw_ret)
    else:
        retcode = await _default_run_subprocess(
            job_id=job_id,
            command=command,
            env=env,
            on_line=_handle_line,
            cancel_token=token,
            container=active_container,
            task_name=task_name,
        )

    if progress_tasks:
        await asyncio.gather(*progress_tasks, return_exceptions=True)

    if token and token.is_set():
        raise OperationCancelledError(job_id, task_name)

    if retcode != 0:
        detail = parsed_error or (logs[-1] if logs else f"Worker exited with code {retcode}")
        raise RuntimeError(f"Dubbing worker '{script_path.name}' failed ({retcode}): {detail}")

    return WorkerExecutionResult(
        returncode=retcode,
        result=parsed_result,
        error=parsed_error,
        logs=logs,
    )


async def run_demucs_worker(
    *,
    job_id: str,
    input_path: Path,
    output_dir: Path,
    model_dir: Path | None = None,
    model: str = "htdemucs_ft",
    fallback_model: str = "htdemucs",
    start: float | None = None,
    end: float | None = None,
    device: str = "auto",
    cancel_token: CancelToken | None = None,
    on_progress: ProgressCallback | None = None,
    container: ServiceContainer | None = None,
    subprocess_runner: DubbingSubprocessRunner | None = None,
) -> WorkerExecutionResult:
    """Execute `worker_demucs.py` inside `.venv-dubbing-base`."""
    py = resolve_venv_python(dubbing_base_venv_dir())
    script = _WORKER_DIR / "worker_demucs.py"
    mdir = model_dir or dubbing_sep_cache_dir(create=True)
    args = [
        "--input",
        str(input_path),
        "--output-dir",
        str(output_dir),
        "--model-dir",
        str(mdir),
        "--model",
        model,
        "--fallback-model",
        fallback_model,
        "--device",
        device,
    ]
    if start is not None:
        args.extend(["--start", f"{float(start):.3f}"])
    if end is not None:
        args.extend(["--end", f"{float(end):.3f}"])

    return await run_dubbing_worker(
        job_id=job_id,
        python_exe=py,
        script_path=script,
        args=args,
        cancel_token=cancel_token,
        on_progress=on_progress,
        container=container,
        subprocess_runner=subprocess_runner,
    )


async def run_diarize_worker(
    *,
    job_id: str,
    input_path: Path,
    output_path: Path,
    model_dir: Path | None = None,
    voice_mode: str = "auto",
    num_speakers: int = -1,
    threshold: float = 0.5,
    cancel_token: CancelToken | None = None,
    on_progress: ProgressCallback | None = None,
    container: ServiceContainer | None = None,
    subprocess_runner: DubbingSubprocessRunner | None = None,
) -> WorkerExecutionResult:
    """Execute `worker_diarize.py` inside `.venv-dubbing-base`."""
    py = resolve_venv_python(dubbing_base_venv_dir())
    script = _WORKER_DIR / "worker_diarize.py"
    mdir = model_dir or dubbing_sherpa_cache_dir(create=True)
    args = [
        "--input",
        str(input_path),
        "--output",
        str(output_path),
        "--model-dir",
        str(mdir),
        "--voice-mode",
        voice_mode,
        "--num-speakers",
        str(int(num_speakers)),
        "--threshold",
        str(float(threshold)),
    ]
    return await run_dubbing_worker(
        job_id=job_id,
        python_exe=py,
        script_path=script,
        args=args,
        cancel_token=cancel_token,
        on_progress=on_progress,
        container=container,
        subprocess_runner=subprocess_runner,
    )


async def run_tts_worker(
    *,
    job_id: str,
    engine: str,
    manifest_path: Path,
    results_path: Path,
    cancel_token: CancelToken | None = None,
    on_progress: ProgressCallback | None = None,
    container: ServiceContainer | None = None,
    subprocess_runner: DubbingSubprocessRunner | None = None,
) -> WorkerExecutionResult:
    """Execute `worker_tts.py` inside the engine-isolated sub-venv (`.venv-qwen3` or `.venv-chatterbox`)."""
    py = resolve_venv_python(dubbing_engine_venv_dir(engine))
    script = _WORKER_DIR / "worker_tts.py"
    args = [
        "--manifest",
        str(manifest_path),
        "--results",
        str(results_path),
    ]
    return await run_dubbing_worker(
        job_id=job_id,
        python_exe=py,
        script_path=script,
        args=args,
        cancel_token=cancel_token,
        on_progress=on_progress,
        container=container,
        subprocess_runner=subprocess_runner,
    )
