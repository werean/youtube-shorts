"""Operational runtime service (log ring buffer, cancel tokens, process trees, SSE event bus, DI container)."""

from __future__ import annotations

import asyncio
import collections
import json
import os
import signal
import subprocess
import threading
import uuid
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Literal

from app.application.job_lifecycle import JobLifecycleService, utc_now_iso
from app.application.scheduler import HardwareResourceScheduler
from app.core import paths, settings, tool_configs
from app.core.config import config
from app.infrastructure.logging.stage_logger import StageLogger, get_stage_logger
from app.infrastructure.storage.atomic_store import AtomicJsonArtifactStore
from app.models.schemas import BatchPipelineProgress

TaskName = Literal[
    "ingest",
    "transcription",
    "blocks",
    "topics",
    "analysis",
    "render",
    "orchestrator",
    "batch",
    "all",
]
VALID_TASK_NAMES: set[str] = {
    "ingest",
    "transcription",
    "blocks",
    "topics",
    "analysis",
    "render",
    "orchestrator",
    "batch",
    "all",
}


class OperationCancelledError(RuntimeError):
    """Raised when a cooperative CancelToken is triggered."""

    def __init__(self, job_id: str = "", task: str = "") -> None:
        msg = f"Operation cancelled for job={job_id} task={task}".strip()
        super().__init__(msg)
        self.job_id = job_id
        self.task = task


class CancelToken:
    """Thread-safe and async-aware cooperative cancellation token."""

    def __init__(self, job_id: str = "", task: str = "default") -> None:
        self.job_id = job_id
        self.task = task
        self._thread_event = threading.Event()
        self._callbacks: list[Callable[[], Any]] = []
        self._lock = threading.Lock()

    def is_set(self) -> bool:
        return self._thread_event.is_set()

    @property
    def cancelled(self) -> bool:
        return self._thread_event.is_set()

    def on_cancel(self, callback: Callable[[], Any]) -> None:
        with self._lock:
            if self._thread_event.is_set():
                try:
                    callback()
                except Exception:
                    pass
                return
            self._callbacks.append(callback)

    def set(self) -> None:
        with self._lock:
            if self._thread_event.is_set():
                return
            self._thread_event.set()
            callbacks = list(self._callbacks)
            self._callbacks.clear()
        for cb in callbacks:
            try:
                cb()
            except Exception:
                pass

    def cancel(self) -> None:
        self.set()

    def raise_if_cancelled(self) -> None:
        if self._thread_event.is_set():
            raise OperationCancelledError(self.job_id, self.task)


@dataclass
class JobEvent:
    """Event payload published to the per-job SSE event bus."""

    job_id: str
    event: str
    data: dict[str, Any]
    timestamp: str = field(default_factory=utc_now_iso)

    def format_sse(self) -> str:
        payload = {"job_id": self.job_id, **self.data}
        return f"event: {self.event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


def _safe_queue_put_nowait(q: asyncio.Queue[JobEvent | None], item: JobEvent | None) -> None:
    try:
        q.put_nowait(item)
    except asyncio.QueueFull:
        pass


class JobEventBus:
    """Thread-safe async pub/sub event bus per job_id for real-time Server-Sent Events (`/jobs/:id/events`)."""

    def __init__(self, max_history: int = 100) -> None:
        self._lock = threading.RLock()
        self._subscribers: dict[str, dict[asyncio.Queue[JobEvent | None], asyncio.AbstractEventLoop]] = (
            collections.defaultdict(dict)
        )
        self._history: dict[str, collections.deque[JobEvent]] = collections.defaultdict(
            lambda: collections.deque(maxlen=max_history)
        )

    def _dispatch(self, q: asyncio.Queue[JobEvent | None], loop: asyncio.AbstractEventLoop, item: JobEvent | None) -> None:
        try:
            running_loop = asyncio.get_running_loop()
        except RuntimeError:
            running_loop = None

        if running_loop is loop:
            _safe_queue_put_nowait(q, item)
            return

        if not loop.is_closed():
            try:
                loop.call_soon_threadsafe(_safe_queue_put_nowait, q, item)
            except RuntimeError:
                pass

    def publish(self, job_id: str, event: str, data: dict[str, Any]) -> JobEvent:
        evt = JobEvent(job_id=job_id, event=event, data={"job_id": job_id, **data})
        with self._lock:
            self._history[job_id].append(evt)
            subscribers = list(self._subscribers.get(job_id, {}).items())
        for q, loop in subscribers:
            self._dispatch(q, loop, evt)
        return evt

    def get_history(self, job_id: str) -> list[JobEvent]:
        with self._lock:
            return list(self._history.get(job_id, ()))

    def close_stream(self, job_id: str) -> None:
        with self._lock:
            subscribers = list(self._subscribers.get(job_id, {}).items())
        for q, loop in subscribers:
            self._dispatch(q, loop, None)

    @asynccontextmanager
    async def subscribe(
        self,
        job_id: str,
        *,
        replay_history: bool = False,
    ) -> AsyncIterator[asyncio.Queue[JobEvent | None]]:
        loop = asyncio.get_running_loop()
        q: asyncio.Queue[JobEvent | None] = asyncio.Queue(maxsize=256)
        with self._lock:
            if replay_history:
                for item in self._history.get(job_id, ()):
                    _safe_queue_put_nowait(q, item)
            self._subscribers[job_id][q] = loop
        try:
            yield q
        finally:
            with self._lock:
                subs = self._subscribers.get(job_id)
                if subs is not None:
                    subs.pop(q, None)


def default_kill_process_tree(pid: int) -> None:
    """Kill a process and its entire child tree cross-OS (taskkill /T /F on Windows, killpg on POSIX)."""
    if pid <= 0:
        return
    if os.name == "nt":
        try:
            subprocess.run(
                ["taskkill", "/T", "/F", "/PID", str(pid)],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=5,
            )
        except Exception:
            pass
    else:
        try:
            pgid = os.getpgid(pid)
            os.killpg(pgid, signal.SIGTERM)
        except Exception:
            try:
                os.kill(pid, signal.SIGTERM)
            except Exception:
                pass


class OperationRuntimeService:
    """Centralized in-memory state + persistent stage file logging for task logs, cancel tokens, process trees, SSE events, and sessions."""

    def __init__(
        self,
        *,
        max_log_lines: int = config.MAX_TASK_LOG_LINES,
        process_killer: Callable[[int], None] | None = None,
        stage_logger: StageLogger | None = None,
    ) -> None:
        self.max_log_lines = max_log_lines
        self._process_killer = process_killer or default_kill_process_tree
        self._stage_logger = stage_logger or get_stage_logger()
        self._logs: dict[str, dict[str, collections.deque[str]]] = {}
        self._cleared_tasks: set[tuple[str, str]] = set()
        self._cancel_tokens: dict[tuple[str, str], CancelToken] = {}
        self._process_pids: dict[tuple[str, str], set[int]] = collections.defaultdict(set)
        self._partial_files: dict[str, set[Path]] = collections.defaultdict(set)
        self._cancelled_renderings: set[str] = set()
        self._batches: dict[str, BatchPipelineProgress] = {}
        self._install_sessions: dict[str, dict[str, Any]] = {}
        self._install_session_tokens: dict[str, CancelToken] = {}
        self.event_bus = JobEventBus()
        self.killed_pids: list[int] = []

    @property
    def stage_logger(self) -> StageLogger:
        return self._stage_logger

    # --- Task Ring-Buffer & Persistent File Logs ---

    def _get_job_log_store(self, job_id: str) -> dict[str, collections.deque[str]]:
        store = self._logs.get(job_id)
        if store is None:
            store = {
                "ingest": collections.deque(maxlen=self.max_log_lines),
                "transcription": collections.deque(maxlen=self.max_log_lines),
                "render": collections.deque(maxlen=self.max_log_lines),
            }
            self._logs[job_id] = store
        return store

    def _append_ring_buffer_line(self, job_id: str, task: str, line: str) -> None:
        store = self._get_job_log_store(job_id)
        if task not in store:
            store[task] = collections.deque(maxlen=self.max_log_lines)
        store[task].append(line)
        self._cleared_tasks.discard((job_id, task))
        self._cleared_tasks.discard((job_id, "all"))

    def _append_ring_buffer_lines(self, job_id: str, task: str, lines: list[str]) -> None:
        if not lines:
            return
        store = self._get_job_log_store(job_id)
        if task not in store:
            store[task] = collections.deque(maxlen=self.max_log_lines)
        store[task].extend(lines)
        self._cleared_tasks.discard((job_id, task))
        self._cleared_tasks.discard((job_id, "all"))

    def append_task_log(self, job_id: str, task: str, line: str, *, level: str = "INFO") -> None:
        self._append_ring_buffer_line(job_id, task, line)
        self._stage_logger.log(job_id, task, line, level=level, write_backend_log=False)

    def append_log(self, job_id: str, line: str, task: str = "orchestrator", *, level: str = "INFO") -> None:
        self.append_task_log(job_id, task, line, level=level)

    def append_task_logs(self, job_id: str, task: str, lines: list[str], *, level: str = "INFO") -> None:
        if not lines:
            return
        self._append_ring_buffer_lines(job_id, task, lines)
        self._stage_logger.log_lines(job_id, task, lines, level=level, write_backend_log=False)

    def log_stage_start(
        self,
        job_id: str,
        task: str,
        *,
        inputs: dict[str, Any] | None = None,
        message: str = "",
    ) -> None:
        msg = message or f"Stage '{task}' started"
        self._append_ring_buffer_line(job_id, task, f"[{task}] START: {msg}")
        self._stage_logger.log_stage_start(job_id, task, inputs=inputs, message=msg)

    def log_stage_end(
        self,
        job_id: str,
        task: str,
        *,
        duration_ms: float | None = None,
        outputs: dict[str, Any] | None = None,
        message: str = "",
    ) -> None:
        msg = message or f"Stage '{task}' completed"
        dur_tag = f" ({duration_ms:.1f}ms)" if duration_ms is not None else ""
        self._append_ring_buffer_line(job_id, task, f"[{task}] END{dur_tag}: {msg}")
        self._stage_logger.log_stage_end(
            job_id,
            task,
            duration_ms=duration_ms,
            outputs=outputs,
            message=msg,
        )

    def log_warning(
        self,
        job_id: str,
        task: str,
        message: str,
        *,
        extra: dict[str, Any] | None = None,
    ) -> None:
        """Log a warning (e.g. CUDA->CPU or TF-IDF fallback) to disk and ring buffer."""
        line = f"[{task}] WARNING: {message}"
        if extra:
            line = f"{line} ({extra})"
        self._append_ring_buffer_line(job_id, task, line)
        self._stage_logger.log(
            job_id,
            task,
            message,
            level="WARNING",
            extra=extra,
            write_backend_log=True,
        )

    def log_exception(
        self,
        job_id: str,
        task: str,
        exc: BaseException,
        *,
        message: str | None = None,
        context: dict[str, Any] | None = None,
        include_env_diagnostics: bool = True,
    ) -> list[str]:
        """Log full exception traceback and environment diagnostics to disk and ring buffer."""
        formatted = self._stage_logger.log_exception(
            job_id,
            task,
            exc,
            message=message,
            context=context,
            include_env_diagnostics=include_env_diagnostics,
        )
        self._append_ring_buffer_lines(job_id, task, formatted)
        return formatted

    def get_task_logs(self, job_id: str, task: str, *, fallback_to_disk: bool = True) -> list[str]:
        if task == "all":
            if job_id in self._logs:
                store = self._logs[job_id]
                ordered_keys = [
                    "orchestrator",
                    "batch",
                    "ingest",
                    "transcription",
                    "blocks",
                    "topics",
                    "analysis",
                    "render",
                ]
                seen = set(ordered_keys)
                all_lines: list[str] = []
                for t in ordered_keys:
                    all_lines.extend(store.get(t, ()))
                for t, q in store.items():
                    if t not in seen:
                        all_lines.extend(q)
                if all_lines:
                    return all_lines
            if fallback_to_disk and (job_id, "all") not in self._cleared_tasks:
                return self._stage_logger.read_stage_log(job_id, "all", tail=self.max_log_lines)
            return []

        if job_id in self._logs:
            lines = list(self._logs[job_id].get(task, ()))
            if lines:
                return lines
            if (job_id, task) in self._cleared_tasks:
                return []

        if fallback_to_disk:
            return self._stage_logger.read_stage_log(job_id, task, tail=self.max_log_lines)
        return []

    def clear_task_logs(self, job_id: str, task: str) -> None:
        store = self._get_job_log_store(job_id)
        if task in store:
            store[task].clear()
        self._cleared_tasks.add((job_id, task))

    def clear_all_task_logs(self, job_id: str) -> None:
        store = self._get_job_log_store(job_id)
        for t, q in store.items():
            q.clear()
            self._cleared_tasks.add((job_id, t))
        self._cleared_tasks.add((job_id, "all"))

    # --- SSE Event Bus Helpers ---

    def _normalize_status(self, status: Any) -> str:
        s = status.value if hasattr(status, "value") else str(status)
        if s.startswith("JobStatus."):
            s = s.split(".", 1)[1]
        return s

    def publish_progress(
        self,
        job_id: str,
        *,
        status: Any,
        task: str,
        percent: float,
        eta_seconds: int | float | None = None,
        message: str = "",
    ) -> JobEvent:
        clean_status = self._normalize_status(status)
        pct = round(float(percent), 2)
        if message:
            self._append_ring_buffer_line(job_id, task, message)
        eta_part = f" eta={eta_seconds}s" if eta_seconds is not None else ""
        disk_msg = (
            f"[progress status={clean_status} percent={pct}%{eta_part}] {message}"
            if message
            else f"[progress status={clean_status} percent={pct}%{eta_part}]"
        )
        self._stage_logger.log(job_id, task, disk_msg, level="INFO", write_backend_log=False)
        payload: dict[str, Any] = {
            "job_id": job_id,
            "status": clean_status,
            "task": task,
            "percent": pct,
            "eta_seconds": eta_seconds,
            "message": message,
        }
        return self.event_bus.publish(job_id, "progress", payload)

    def publish_state_change(self, job_id: str, status: Any, message: str = "") -> JobEvent:
        clean_status = self._normalize_status(status)
        state_line = f"[state status={clean_status}] {message}" if message else f"[state status={clean_status}]"
        self._stage_logger.log(job_id, "orchestrator", state_line, level="INFO", write_backend_log=True)
        return self.event_bus.publish(
            job_id,
            "state",
            {"job_id": job_id, "status": clean_status, "message": message},
        )

    def publish_event(self, job_id: str, event: str, data: dict[str, Any]) -> JobEvent:
        """Generic event publish helper forwarding to the job's SSE event bus."""
        return self.event_bus.publish(job_id, event, data)

    # --- Cooperative Cancel Tokens & Process Trees ---

    def create_cancel_token(self, job_id: str, task: str = "default") -> CancelToken:
        token = CancelToken(job_id=job_id, task=task)
        self._cancel_tokens[(job_id, task)] = token
        if task == "render":
            self._cancelled_renderings.discard(job_id)
        return token

    def get_cancel_token(self, job_id: str, task: str = "default") -> CancelToken | None:
        return self._cancel_tokens.get((job_id, task))

    def is_cancel_requested(self, job_id: str, task: str | None = None) -> bool:
        if task is not None:
            token = self._cancel_tokens.get((job_id, task))
            return token.is_set() if token is not None else False
        return any(token.is_set() for (jid, _), token in self._cancel_tokens.items() if jid == job_id)

    def clear_cancel_token(self, job_id: str, task: str = "default") -> None:
        self._cancel_tokens.pop((job_id, task), None)
        self._process_pids.pop((job_id, task), None)

    def register_process(self, job_id: str, task: str, pid: int) -> None:
        if pid > 0:
            self._process_pids[(job_id, task)].add(pid)

    def unregister_process(self, job_id: str, task: str, pid: int) -> None:
        pids = self._process_pids.get((job_id, task))
        if pids:
            pids.discard(pid)

    def kill_process_tree(self, pid: int) -> None:
        self.killed_pids.append(pid)
        self._process_killer(pid)

    def register_partial_file(self, job_id: str, file_path: str | Path) -> None:
        self._partial_files[job_id].add(Path(file_path))

    def unregister_partial_file(self, job_id: str, file_path: str | Path) -> None:
        self._partial_files[job_id].discard(Path(file_path))

    def cleanup_partial_files(self, job_id: str) -> list[str]:
        removed: list[str] = []
        files = self._partial_files.pop(job_id, set())
        for f in files:
            if f.exists():
                try:
                    f.unlink(missing_ok=True)
                    removed.append(str(f))
                except OSError:
                    pass
        return removed

    def request_cancel(self, job_id: str, task: str | None = None) -> bool:
        """Cancel active token(s) and kill registered subprocess tree(s) for job_id."""
        found = False
        if task is not None:
            token = self._cancel_tokens.get((job_id, task))
            if token is not None:
                token.set()
                found = True
            pids = list(self._process_pids.pop((job_id, task), ()))
            for pid in pids:
                self.kill_process_tree(pid)
                found = True
            if task == "render" and found:
                self._cancelled_renderings.add(job_id)
                self.cleanup_partial_files(job_id)
            return found

        # Cancel all tasks for job_id
        for (jid, tname), token in list(self._cancel_tokens.items()):
            if jid == job_id:
                token.set()
                found = True
                if tname == "render":
                    self._cancelled_renderings.add(job_id)
        for (jid, tname), pids in list(self._process_pids.items()):
            if jid == job_id:
                for pid in list(pids):
                    self.kill_process_tree(pid)
                    found = True
                self._process_pids.pop((jid, tname), None)
        if job_id in self._partial_files:
            self.cleanup_partial_files(job_id)
        return found

    def is_rendering_cancelled(self, job_id: str) -> bool:
        return job_id in self._cancelled_renderings

    def conflicting_active_rendering_job_id(self, job_id: str) -> str | None:
        for (jid, task), token in self._cancel_tokens.items():
            if task == "render" and jid != job_id and not token.is_set():
                return jid
        for (jid, task), pids in self._process_pids.items():
            if task == "render" and jid != job_id and len(pids) > 0:
                return jid
        return None

    # --- Batch Pipeline State ---

    def create_batch_progress(self, batch_id: str, job_ids: list[str]) -> BatchPipelineProgress:
        progress = BatchPipelineProgress(
            current_job_index=0,
            current_job_id=job_ids[0] if job_ids else "",
            current_step="starting",
            completed_jobs=[],
            failed_jobs=[],
            is_running=True,
        )
        self._batches[batch_id] = progress
        return progress

    def get_batch_progress(self, batch_id: str) -> BatchPipelineProgress | None:
        return self._batches.get(batch_id)

    def mark_batch_not_running(self, batch_id: str, *, cascade_cancel: bool = True) -> bool:
        progress = self._batches.get(batch_id)
        if progress is None:
            return False
        progress.is_running = False
        if cascade_cancel and progress.current_job_id:
            self.request_cancel(progress.current_job_id, task=None)
        return True

    # --- Dependency Install Sessions ---

    def start_dependency_session(
        self,
        name: str,
        operation: Literal["install", "uninstall"],
        runner: Callable[[CancelToken, Callable[[str], None]], Awaitable[dict[str, Any]]],
    ) -> dict[str, Any]:
        session_id = str(uuid.uuid4())
        started_at = utc_now_iso()
        action_label = "Install" if operation == "install" else "Uninstall"
        session: dict[str, Any] = {
            "sessionId": session_id,
            "operation": operation,
            "dependencyName": name,
            "status": "running",
            "cancelRequested": False,
            "startedAt": started_at,
            "endedAt": None,
            "logs": [f"{action_label} session created for {name}."],
            "result": None,
        }
        token = CancelToken(job_id=session_id, task=f"dep_{operation}")
        self._install_sessions[session_id] = session
        self._install_session_tokens[session_id] = token

        def _append_log(line: str) -> None:
            if len(session["logs"]) < 1000:
                session["logs"].append(line)

        async def _run() -> None:
            try:
                await asyncio.sleep(0)
                if token.is_set():
                    session["status"] = "cancelled"
                    session["result"] = {
                        "success": False,
                        "message": f"{'Instalação' if operation == 'install' else 'Desinstalação'} de {name} cancelada pelo usuário",
                    }
                    session["endedAt"] = utc_now_iso()
                    _append_log(f"{action_label} cancelled for {name}.")
                    return

                res = await runner(token, _append_log)
                payload = res.get("payload", res) if isinstance(res, dict) else {"success": False, "message": "Failed"}
                if token.is_set():
                    session["status"] = "cancelled"
                    session["result"] = {
                        "success": False,
                        "message": f"{'Instalação' if operation == 'install' else 'Desinstalação'} de {name} cancelada pelo usuário",
                    }
                    _append_log(f"{action_label} cancelled for {name}.")
                else:
                    session["result"] = payload
                    session["status"] = "success" if payload.get("success") else "failed"
                    _append_log(
                        f"{action_label} finished successfully for {name}."
                        if session["status"] == "success"
                        else f"{action_label} finished with errors for {name}."
                    )
                session["endedAt"] = utc_now_iso()
            except OperationCancelledError:
                session["status"] = "cancelled"
                session["result"] = {
                    "success": False,
                    "message": f"{'Instalação' if operation == 'install' else 'Desinstalação'} de {name} cancelada pelo usuário",
                }
                session["endedAt"] = utc_now_iso()
                _append_log(f"{action_label} cancelled for {name}.")
            except Exception as exc:
                session["status"] = "failed"
                session["result"] = {
                    "success": False,
                    "message": f"Failed to {operation} {name}",
                    "error": str(exc),
                }
                session["endedAt"] = utc_now_iso()
                _append_log(f"Unexpected {operation} session error: {exc}")
            finally:
                session["cancelRequested"] = False
                self._install_session_tokens.pop(session_id, None)

        try:
            loop = asyncio.get_running_loop()
            loop.create_task(_run())
        except RuntimeError:
            pass

        return {
            "sessionId": session_id,
            "operation": operation,
            "dependencyName": name,
            "status": "running",
            "startedAt": started_at,
        }

    def get_dependency_session(self, session_id: str) -> dict[str, Any] | None:
        session = self._install_sessions.get(session_id)
        if session is None:
            return None
        out = dict(session)
        out["logs"] = list(session["logs"])
        if session.get("endedAt") is None:
            out.pop("endedAt", None)
        if session.get("result") is None:
            out.pop("result", None)
        return out

    def cancel_dependency_session(self, session_id: str) -> tuple[int, dict[str, Any]]:
        session = self._install_sessions.get(session_id)
        token = self._install_session_tokens.get(session_id)
        if session is None or token is None:
            return 404, {
                "success": False,
                "message": f"Install session '{session_id}' was not found",
            }
        if session["status"] != "running":
            return 409, {
                "success": False,
                "message": f"Session '{session_id}' is not running anymore",
                "status": session["status"],
            }
        session["cancelRequested"] = True
        session["logs"].append("Cancellation requested by user.")
        token.set()
        session["status"] = "cancelled"
        session["endedAt"] = utc_now_iso()
        session["cancelRequested"] = False
        op = session["operation"]
        dep_name = session["dependencyName"]
        session["result"] = {
            "success": False,
            "message": f"{'Instalação' if op == 'install' else 'Desinstalação'} de {dep_name} cancelada pelo usuário",
        }
        return 200, {
            "success": True,
            "message": "Cancellation requested successfully.",
            "sessionId": session_id,
            "status": "running",
        }


class ServiceContainer:
    """Dependency Injection container shared across routers and domain stages."""

    def __init__(
        self,
        *,
        store: AtomicJsonArtifactStore | None = None,
        jobs: JobLifecycleService | None = None,
        scheduler: HardwareResourceScheduler | None = None,
        runtime: OperationRuntimeService | None = None,
    ) -> None:
        self.store = store or AtomicJsonArtifactStore()
        self.jobs = jobs or JobLifecycleService(store=self.store)
        self.scheduler = scheduler or HardwareResourceScheduler()
        self.runtime = runtime or OperationRuntimeService()

        # Pluggable OS / external adapters (overridable in tests)
        self.folder_picker: Callable[[], dict[str, Any]] | None = None
        self.folder_opener: Callable[[Path, list[Path] | None], dict[str, Any]] | None = None
        self.llm_http_fetcher: Callable[[str, str, dict[str, Any] | None], Awaitable[tuple[int, Any]]] | None = None
        self.ollama_command_runner: Callable[[list[str]], Awaitable[dict[str, Any]]] | None = None
        self.dependency_prober: Callable[[], Awaitable[dict[str, Any]]] | None = None
        self.dependency_installer: Callable[[str, dict[str, Any] | None, CancelToken | None, Callable[[str], None] | None], Awaitable[tuple[int, dict[str, Any]]]] | None = None
        self.dependency_uninstaller: Callable[[str, CancelToken | None, Callable[[str], None] | None], Awaitable[tuple[int, dict[str, Any]]]] | None = None
        self.terminal_opener: Callable[[str], dict[str, Any]] | None = None

    # Convenience accessors for settings and tool_configs
    def load_settings(self) -> settings.AppSettings:
        return settings.load_settings()

    def save_settings(self, next_settings: settings.AppSettings | dict[str, Any]) -> settings.AppSettings:
        return settings.save_settings(next_settings)

    def update_settings(self, partial: dict[str, Any]) -> settings.AppSettings:
        return settings.update_settings(partial)

    def load_active_tool_configs(self) -> dict[str, Any]:
        return tool_configs.load_active_tool_configs()

    def load_default_tool_configs(self) -> dict[str, Any]:
        return tool_configs.load_default_tool_configs()

    def update_tool_configs(self, partial: dict[str, Any] | None) -> dict[str, Any]:
        return tool_configs.update_tool_configs(partial)

    # Convenience path accessors
    def data_dir(self) -> Path:
        return paths.data_dir()

    def job_dir(self, job_id: str) -> Path:
        return self.jobs.job_dir_path(job_id)

    def video_dir(self, job_id: str, video_name: str | None = None) -> Path:
        return self.jobs.video_dir_path(job_id, video_name)

    def transcriptions_dir(
        self, job_id: str, video_name: str | None = None, *, create: bool = True
    ) -> Path:
        return self.jobs.transcriptions_dir_path(job_id, video_name, create=create)

    def shorts_dir(
        self, job_id: str, video_name: str | None = None, *, create: bool = True
    ) -> Path:
        return self.jobs.shorts_dir_path(job_id, video_name, create=create)


_default_container: ServiceContainer | None = None
_override_container: ServiceContainer | None = None


def get_container() -> ServiceContainer:
    """Return the active ServiceContainer (or test override if configured)."""
    global _default_container
    if _override_container is not None:
        return _override_container
    if _default_container is None:
        _default_container = ServiceContainer()
    return _default_container


def set_container_override(container: ServiceContainer | None) -> None:
    """Override the global ServiceContainer for tests."""
    global _override_container
    _override_container = container


def reset_container() -> ServiceContainer:
    """Reset the default container and clear caches."""
    global _default_container, _override_container
    _override_container = None
    settings.invalidate_settings_cache()
    tool_configs.invalidate_tool_configs_cache()
    _default_container = ServiceContainer()
    return _default_container
