"""Hardware resource scheduler: IOQueue(2), GPUMutex(1) + ActiveVRAMBudgetManager, RenderWorkerPool(2)."""

from __future__ import annotations

import asyncio
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


@dataclass
class WhisperAllocationDecision:
    device: Literal["cuda", "cpu"]
    compute_type: str
    cpu_threads: int = 8
    free_vram_gb: float = 0.0
    unloaded_models: list[str] = field(default_factory=list)
    lms_unloaded: bool = False
    fell_back_to_cpu: bool = False


VRAMProbeFn = Callable[[], float | Awaitable[float]]
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
        async with httpx.AsyncClient(timeout=3.0) as client:
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
    """Attempt `lms unload --all` if LM Studio CLI is available on PATH."""
    lms_bin = shutil.which("lms")
    if not lms_bin:
        return False
    try:
        proc = await asyncio.create_subprocess_exec(
            lms_bin,
            "unload",
            "--all",
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await asyncio.wait_for(proc.wait(), timeout=5.0)
        return proc.returncode == 0
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
        ollama_unloader: OllamaUnloadFn | None = None,
        lms_unloader: LmsUnloadFn | None = None,
        cuda_cache_clear: CudaCacheClearFn | None = None,
        http_client: httpx.AsyncClient | None = None,
        ollama_base_url: str | None = None,
    ) -> None:
        self.min_free_vram_gb = min_free_vram_gb
        self._vram_probe = vram_probe or default_vram_probe
        self._ollama_unloader = ollama_unloader
        self._lms_unloader = lms_unloader or default_lms_unloader
        self._cuda_cache_clear = cuda_cache_clear or default_cuda_cache_clear
        self._http_client = http_client
        self._ollama_base_url = (ollama_base_url or config.OLLAMA_BASE_URL).rstrip("/")
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
        res = self._lms_unloader()
        if inspect.isawaitable(res):
            return bool(await res)
        return bool(res)

    async def prepare_for_whisper(
        self,
        requested_device: str = "cuda",
    ) -> WhisperAllocationDecision:
        """Inspect free VRAM (>=2.2GB), unload idle Ollama/LMS models if needed, or fall back to CPU int8."""
        if requested_device == "cpu":
            return WhisperAllocationDecision(
                device="cpu",
                compute_type=config.WHISPER_COMPUTE_TYPE_CPU,
                cpu_threads=config.WHISPER_CPU_THREADS,
                free_vram_gb=0.0,
                fell_back_to_cpu=False,
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

        unloaded = await self.unload_idle_ollama_models()
        lms_unloaded = await self.unload_lms_models()
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

    @property
    def locked(self) -> bool:
        return self._lock.locked()

    @asynccontextmanager
    async def acquire(self, holder: str = "gpu_task") -> AsyncIterator[ActiveVRAMBudgetManager]:
        async with self._lock:
            self.active_holder = holder
            try:
                yield self.vram_manager
            finally:
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
            try:
                decision = await self.vram_manager.prepare_for_whisper(
                    requested_device=requested_device
                )
                yield decision
            finally:
                self.vram_manager.cleanup_whisper_vram()
                self.active_holder = None

    async def __aenter__(self) -> ActiveVRAMBudgetManager:
        await self._lock.acquire()
        self.active_holder = "gpu_task"
        return self.vram_manager

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
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
