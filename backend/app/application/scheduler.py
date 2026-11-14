"""Hardware resource scheduler: IOQueue(2), GPUMutex(1) + ActiveVRAMBudgetManager, RenderWorkerPool(2)."""

from __future__ import annotations

import asyncio
import contextvars
import gc
import inspect
import shutil
import subprocess
import sys
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Awaitable, Callable, Literal

import httpx

from app.core.config import config

_TASK_IN_GPU_SLOT: contextvars.ContextVar[bool] = contextvars.ContextVar(
    "_TASK_IN_GPU_SLOT", default=False
)
_TASK_GPU_MUTEX_IDS: contextvars.ContextVar[tuple[int, ...]] = contextvars.ContextVar(
    "_TASK_GPU_MUTEX_IDS", default=()
)


@dataclass
class WhisperAllocationDecision:
    device: Literal["cuda", "cpu"]
    compute_type: str
    cpu_threads: int = 8
    free_vram_gb: float = 0.0
    unloaded_models: list[str] = field(default_factory=list)
    lms_unloaded: bool = False
    fell_back_to_cpu: bool = False
    fallback_reason: str | None = None


VRAMProbeFn = Callable[[], float | Awaitable[float]]
CudaRuntimeProbeFn = Callable[[], tuple[bool, str | None] | Awaitable[tuple[bool, str | None]]]
OllamaUnloadFn = Callable[[], list[str] | Awaitable[list[str]]]
LmsUnloadFn = Callable[[], bool | Awaitable[bool]]
CudaCacheClearFn = Callable[[], None]


def default_vram_probe() -> float:
    """Query free VRAM in GB lazily via torch.cuda (if loaded) or nvidia-smi."""
    torch_mod = sys.modules.get("torch")
    if torch_mod is not None:
        try:
            if torch_mod.cuda.is_available():
                free_bytes, _total_bytes = torch_mod.cuda.mem_get_info()
                return float(free_bytes) / (1024.0**3)
        except Exception:
            pass

    if shutil.which("nvidia-smi"):
        try:
            res = subprocess.run(
                ["nvidia-smi", "--query-gpu=memory.free", "--format=csv,noheader,nounits"],
                capture_output=True,
                text=True,
                timeout=3,
                check=False,
            )
            if res.returncode == 0 and res.stdout.strip():
                first_line = res.stdout.strip().splitlines()[0].strip()
                free_mib = float(first_line)
                return free_mib / 1024.0
        except Exception:
            pass

    return 0.0


async def default_ollama_unloader(base_url: str | None = None) -> list[str]:
    """Check GET /api/ps on Ollama and send keep_alive: 0 for any loaded models."""
    url = (base_url or config.OLLAMA_BASE_URL).rstrip("/")
    unloaded: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=1.5) as client:
            resp = await client.get(f"{url}/api/ps")
            if resp.status_code != 200:
                return []
            payload = resp.json()
            models = payload.get("models") if isinstance(payload, dict) else []
            if not isinstance(models, list):
                return []
            for item in models:
                if not isinstance(item, dict):
                    continue
                name = str(item.get("name") or item.get("model") or "").strip()
                if not name:
                    continue
                try:
                    await client.post(
                        f"{url}/api/generate",
                        json={"model": name, "keep_alive": 0},
                    )
                    unloaded.append(name)
                except Exception:
                    pass
    except Exception:
        return unloaded
    return unloaded


async def default_lms_unloader() -> bool:
    """Unload all LM Studio models (`lms unload --all`) and stop server (`lms server stop`) if running."""
    from app.infrastructure.llm.lmstudio_cli import (
        extract_json_from_cli_output,
        resolve_lms_binary,
        run_lms_subprocess,
    )

    lms_bin = resolve_lms_binary()
    if not lms_bin:
        return False

    try:
        st_rc, st_out, st_err = await run_lms_subprocess(
            lms_bin,
            ["server", "status", "--json"],
            timeout=5.0,
        )
        for raw in (st_out, st_err):
            if raw.strip():
                try:
                    parsed = extract_json_from_cli_output(raw)
                    if isinstance(parsed, dict) and parsed.get("running") is False:
                        return False
                    break
                except Exception:
                    continue

        rc, _out, _err = await run_lms_subprocess(lms_bin, ["unload", "--all"], timeout=10.0)
        if rc == 0 or st_rc == 0:
            await run_lms_subprocess(lms_bin, ["server", "stop"], timeout=10.0)
        return rc == 0
    except Exception:
        return False


def default_cuda_cache_clear() -> None:
    """Run gc.collect() and empty CUDA cache if torch is loaded."""
    gc.collect()
    torch_mod = sys.modules.get("torch")
    if torch_mod is not None:
        try:
            if torch_mod.cuda.is_available():
                torch_mod.cuda.empty_cache()
        except Exception:
            pass


class ActiveVRAMBudgetManager:
    """Manages RTX 5070 12GB VRAM coexistence between faster-whisper and local LLMs."""

    def __init__(
        self,
        *,
        min_free_vram_gb: float = config.MIN_FREE_VRAM_GB_FOR_WHISPER,
        vram_probe: VRAMProbeFn | None = None,
        cuda_runtime_probe: CudaRuntimeProbeFn | None = None,
        ollama_unloader: OllamaUnloadFn | None = None,
        lms_unloader: LmsUnloadFn | None = None,
        cuda_cache_clear: CudaCacheClearFn | None = None,
        http_client: httpx.AsyncClient | None = None,
        ollama_base_url: str | None = None,
        lmstudio_manager: Any | None = None,
    ) -> None:
        self.min_free_vram_gb = min_free_vram_gb
        self._vram_probe = vram_probe or default_vram_probe
        self._cuda_runtime_probe = cuda_runtime_probe
        self._ollama_unloader = ollama_unloader
        self._lms_unloader = lms_unloader or default_lms_unloader
        self._cuda_cache_clear = cuda_cache_clear or default_cuda_cache_clear
        self._http_client = http_client
        self._ollama_base_url = (ollama_base_url or config.OLLAMA_BASE_URL).rstrip("/")
        self._lmstudio_manager = lmstudio_manager
        self.cleanup_count: int = 0

    async def probe_free_vram_gb(self) -> float:
        res = self._vram_probe()
        if inspect.isawaitable(res):
            return float(await res)
        return float(res)

    async def unload_idle_ollama_models(self) -> list[str]:
        if self._ollama_unloader is not None:
            res = self._ollama_unloader()
            if inspect.isawaitable(res):
                return list(await res)
            return list(res)

        if self._http_client is not None:
            unloaded: list[str] = []
            try:
                resp = await self._http_client.get(f"{self._ollama_base_url}/api/ps")
                if resp.status_code == 200:
                    data = resp.json()
                    models = data.get("models", []) if isinstance(data, dict) else []
                    for m in models:
                        name = str(m.get("name") or m.get("model") or "").strip()
                        if name:
                            await self._http_client.post(
                                f"{self._ollama_base_url}/api/generate",
                                json={"model": name, "keep_alive": 0},
                            )
                            unloaded.append(name)
            except Exception:
                pass
            return unloaded

        return await default_ollama_unloader(self._ollama_base_url)

    async def unload_lms_models(self) -> bool:
        if self._lms_unloader is not default_lms_unloader:
            res = self._lms_unloader()
            if inspect.isawaitable(res):
                return bool(await res)
            return bool(res)
        if self._lmstudio_manager is not None and hasattr(self._lmstudio_manager, "ensure_idle_vram_released"):
            try:
                if await self._lmstudio_manager.ensure_idle_vram_released(task_log="transcription"):
                    return True
            except Exception:
                pass
        res = self._lms_unloader()
        if inspect.isawaitable(res):
            return bool(await res)
        return bool(res)

    async def probe_cuda_runtime(self) -> tuple[bool, str | None]:
        """Verify CUDA DLL availability before committing Whisper to GPU.

        Only runs the default Windows DLL probe when using the real default VRAM
        probe (or when an explicit `cuda_runtime_probe` was injected), so unit
        tests injecting synthetic `vram_probe` callbacks remain deterministic.
        """
        if self._cuda_runtime_probe is None and self._vram_probe is not default_vram_probe:
            return True, None
        probe_fn = self._cuda_runtime_probe
        if probe_fn is None:
            from app.infrastructure.cuda_env import probe_cuda_whisper_runtime

            probe_fn = probe_cuda_whisper_runtime
        res = probe_fn()
        if inspect.isawaitable(res):
            res = await res
        ok, reason = res
        return bool(ok), (str(reason) if reason else None)

    async def prepare_for_whisper(
        self,
        requested_device: str = "cuda",
    ) -> WhisperAllocationDecision:
        """Inspect CUDA runtime + free VRAM (>=2.2GB), unload idle Ollama/LMS models if needed, or fall back to CPU int8."""
        if requested_device == "cpu":
            return WhisperAllocationDecision(
                device="cpu",
                compute_type=config.WHISPER_COMPUTE_TYPE_CPU,
                cpu_threads=config.WHISPER_CPU_THREADS,
                free_vram_gb=0.0,
                fell_back_to_cpu=False,
            )

        cuda_ready, cuda_reason = await self.probe_cuda_runtime()
        if not cuda_ready:
            return WhisperAllocationDecision(
                device="cpu",
                compute_type=config.WHISPER_COMPUTE_TYPE_CPU,
                cpu_threads=config.WHISPER_CPU_THREADS,
                free_vram_gb=0.0,
                fell_back_to_cpu=True,
                fallback_reason=cuda_reason or "CUDA runtime libraries unavailable",
            )

        free_gb = await self.probe_free_vram_gb()
        if free_gb >= self.min_free_vram_gb:
            return WhisperAllocationDecision(
                device="cuda",
                compute_type=config.WHISPER_COMPUTE_TYPE_CUDA,
                cpu_threads=0,
                free_vram_gb=free_gb,
                fell_back_to_cpu=False,
            )

        lms_unloaded = await self.unload_lms_models()
        unloaded = await self.unload_idle_ollama_models()
        free_after = await self.probe_free_vram_gb()

        if free_after >= self.min_free_vram_gb:
            return WhisperAllocationDecision(
                device="cuda",
                compute_type=config.WHISPER_COMPUTE_TYPE_CUDA,
                cpu_threads=0,
                free_vram_gb=free_after,
                unloaded_models=unloaded,
                lms_unloaded=lms_unloaded,
                fell_back_to_cpu=False,
            )

        return WhisperAllocationDecision(
            device="cpu",
            compute_type=config.WHISPER_COMPUTE_TYPE_CPU,
            cpu_threads=config.WHISPER_CPU_THREADS,
            free_vram_gb=free_after,
            unloaded_models=unloaded,
            lms_unloaded=lms_unloaded,
            fell_back_to_cpu=True,
            fallback_reason=(
                f"Free VRAM ({free_after:.2f}GB < {self.min_free_vram_gb:.2f}GB); "
                "falling back to CPU int8"
            ),
        )

    def cleanup_whisper_vram(self) -> None:
        """Deterministic post-transcription VRAM release (to be called in `finally:`)."""
        self.cleanup_count += 1
        self._cuda_cache_clear()


class IOQueue:
    """Async semaphore queue (concurrency = 2) for yt-dlp downloads and PCM extraction."""

    def __init__(self, concurrency: int = config.IO_CONCURRENCY) -> None:
        self.concurrency = concurrency
        self._semaphore = asyncio.Semaphore(concurrency)
        self.active_count = 0

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        async with self._semaphore:
            self.active_count += 1
            try:
                yield
            finally:
                self.active_count -= 1

    async def __aenter__(self) -> IOQueue:
        await self._semaphore.acquire()
        self.active_count += 1
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.active_count -= 1
        self._semaphore.release()


class GPUMutex:
    """Strict mutual exclusion lock (concurrency = 1) for GPU VRAM workloads (Whisper vs LLM)."""

    def __init__(self, vram_manager: ActiveVRAMBudgetManager | None = None) -> None:
        self._lock = asyncio.Lock()
        self.vram_manager = vram_manager or ActiveVRAMBudgetManager()
        self.active_holder: str | None = None
        self._enter_tokens: list[tuple[contextvars.Token[bool], contextvars.Token[tuple[int, ...]]]] = []

    @property
    def locked(self) -> bool:
        return self._lock.locked()

    def current_task_holds_slot(self) -> bool:
        """Return True only if the current asyncio task/context holds this GPUMutex."""
        return bool(
            self._lock.locked()
            and _TASK_IN_GPU_SLOT.get()
            and id(self) in _TASK_GPU_MUTEX_IDS.get()
        )

    @asynccontextmanager
    async def acquire(self, holder: str = "gpu_task") -> AsyncIterator[ActiveVRAMBudgetManager]:
        async with self._lock:
            self.active_holder = holder
            slot_tok = _TASK_IN_GPU_SLOT.set(True)
            ids_tok = _TASK_GPU_MUTEX_IDS.set((*_TASK_GPU_MUTEX_IDS.get(), id(self)))
            try:
                yield self.vram_manager
            finally:
                _TASK_GPU_MUTEX_IDS.reset(ids_tok)
                _TASK_IN_GPU_SLOT.reset(slot_tok)
                self.active_holder = None

    @asynccontextmanager
    async def acquire_for_whisper(
        self,
        *,
        requested_device: str = "cuda",
        holder: str = "faster-whisper",
    ) -> AsyncIterator[WhisperAllocationDecision]:
        """Acquire GPU lock, negotiate VRAM budget, and guarantee VRAM cleanup on exit."""
        async with self._lock:
            self.active_holder = holder
            slot_tok = _TASK_IN_GPU_SLOT.set(True)
            ids_tok = _TASK_GPU_MUTEX_IDS.set((*_TASK_GPU_MUTEX_IDS.get(), id(self)))
            try:
                decision = await self.vram_manager.prepare_for_whisper(
                    requested_device=requested_device
                )
                yield decision
            finally:
                self.vram_manager.cleanup_whisper_vram()
                _TASK_GPU_MUTEX_IDS.reset(ids_tok)
                _TASK_IN_GPU_SLOT.reset(slot_tok)
                self.active_holder = None

    async def __aenter__(self) -> ActiveVRAMBudgetManager:
        await self._lock.acquire()
        self.active_holder = "gpu_task"
        slot_tok = _TASK_IN_GPU_SLOT.set(True)
        ids_tok = _TASK_GPU_MUTEX_IDS.set((*_TASK_GPU_MUTEX_IDS.get(), id(self)))
        self._enter_tokens.append((slot_tok, ids_tok))
        return self.vram_manager

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        if self._enter_tokens:
            slot_tok, ids_tok = self._enter_tokens.pop()
            _TASK_GPU_MUTEX_IDS.reset(ids_tok)
            _TASK_IN_GPU_SLOT.reset(slot_tok)
        self.active_holder = None
        self._lock.release()


class RenderWorkerPool:
    """Async semaphore pool (concurrency = 2) for CPU Auto-Reframe + NVENC encoding."""

    def __init__(self, concurrency: int = config.RENDER_CONCURRENCY) -> None:
        self.concurrency = concurrency
        self._semaphore = asyncio.Semaphore(concurrency)
        self.active_count = 0

    @asynccontextmanager
    async def acquire(self) -> AsyncIterator[None]:
        async with self._semaphore:
            self.active_count += 1
            try:
                yield
            finally:
                self.active_count -= 1

    async def __aenter__(self) -> RenderWorkerPool:
        await self._semaphore.acquire()
        self.active_count += 1
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        self.active_count -= 1
        self._semaphore.release()


class HardwareResourceScheduler:
    """Unified hardware scheduler isolating IOQueue(2), GPUMutex(1) + VRAM manager, and RenderWorkerPool(2)."""

    def __init__(
        self,
        *,
        io_concurrency: int = config.IO_CONCURRENCY,
        render_concurrency: int = config.RENDER_CONCURRENCY,
        vram_manager: ActiveVRAMBudgetManager | None = None,
    ) -> None:
        self.vram_manager = vram_manager or ActiveVRAMBudgetManager()
        self.io_queue = IOQueue(concurrency=io_concurrency)
        self.gpu_mutex = GPUMutex(vram_manager=self.vram_manager)
        self.render_pool = RenderWorkerPool(concurrency=render_concurrency)

    @asynccontextmanager
    async def io_slot(self) -> AsyncIterator[None]:
        async with self.io_queue.acquire():
            yield

    @asynccontextmanager
    async def gpu_slot(self, holder: str = "gpu_task") -> AsyncIterator[ActiveVRAMBudgetManager]:
        async with self.gpu_mutex.acquire(holder=holder) as mgr:
            yield mgr

    @asynccontextmanager
    async def whisper_slot(
        self,
        *,
        requested_device: str = "cuda",
    ) -> AsyncIterator[WhisperAllocationDecision]:
        async with self.gpu_mutex.acquire_for_whisper(requested_device=requested_device) as dec:
            yield dec

    @asynccontextmanager
    async def render_slot(self) -> AsyncIterator[None]:
        async with self.render_pool.acquire():
            yield
