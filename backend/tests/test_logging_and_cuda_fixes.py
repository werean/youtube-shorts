"""Comprehensive mocked/synthetic unit and integration tests for persistent stage logging,
Windows CUDA DLL discovery/fallback, and multi-stage pipeline fixes.

Strictly 100% logical/mocked — zero real AI model downloads, zero GPU/CUDA allocations,
zero real network calls, and zero heavy video renders (AGENTS.md Section 5).
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
import threading
import types
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.application.orchestrator import BatchRunner, reset_batch_runner, run_job_pipeline
from app.application.runtime_service import (
    OperationRuntimeService,
    ServiceContainer,
    set_container_override,
)
from app.application.scheduler import ActiveVRAMBudgetManager, WhisperAllocationDecision
from app.core import paths, settings
from app.domain.analysis.narrative_miner import analyze_job
from app.domain.ingest.service import IngestDomainService
from app.domain.rendering.ass_generator import KeptTimeInterval, TimelineMapper
from app.domain.rendering.virtual_cameraman import CameraKeyframe, VirtualCameramanPlan
from app.domain.segmentation.semantic_blocks import build_semantic_blocks
from app.domain.segmentation.topic_segmentation import build_topic_segments
from app.domain.transcription.service import (
    FasterWhisperAdapter,
    RawWhisperSegment,
    RawWhisperWord,
    TranscriptionDomainService,
)
from app.infrastructure import cuda_env
from app.infrastructure.audio.pcm_extractor import extract_pcm_16k_wav, write_synthetic_pcm16_wav
from app.infrastructure.llm.unified_adapter import (
    LocalLLMUnavailableError,
    UnifiedLocalLLMAdapter,
)
from app.infrastructure.logging.stage_logger import (
    StageLogger,
    collect_environment_diagnostics,
)
from app.infrastructure.video import ffmpeg_executor
from app.infrastructure.video.filter_script_builder import (
    FilterScriptOptions,
    build_filter_complex_script_content,
)
from app.infrastructure.vision.face_tracker import MediaPipeVisionAdapter
from app.models.domain import (
    JobStatus,
    Segment,
    SemanticBlock,
    TopicSegment,
    WordTiming,
)


# ---------------------------------------------------------------------------
# 1. Persistent Stage File Logging & Thread-Safe Event Bus
# ---------------------------------------------------------------------------


def test_persistent_stage_logging_uses_media_base_dir_and_survives_restart(
    tmp_path: Path,
    container: ServiceContainer,
) -> None:
    """Logs go to `{media.base_dir}/logs/<job_id>/<stage>.log`, `pipeline.log`, and `backend.log`,
    respecting dynamic `media.base_dir` overrides and surviving in-memory ring-buffer clears.
    """
    job = container.jobs.create_job("https://youtube.com/watch?v=logtest1")
    expected_logs_root = Path(settings.load_settings().media.base_dir) / "logs"
    assert paths.logs_dir() == expected_logs_root

    container.runtime.log_stage_start(
        job.job_id,
        "transcription",
        inputs={"model": "large-v3-turbo", "device": "cuda"},
        message="Starting mock transcription",
    )
    container.runtime.append_task_log(job.job_id, "transcription", "[transcription] Line 1")
    container.runtime.log_warning(
        job.job_id,
        "transcription",
        "Fallback triggered",
        extra={"from": "cuda", "to": "cpu"},
    )
    container.runtime.publish_progress(
        job.job_id,
        status=JobStatus.TRANSCRIBING.value,
        task="transcription",
        percent=42.5,
        eta_seconds=12,
        message="Halfway there",
    )
    container.runtime.publish_state_change(
        job.job_id,
        JobStatus.BUILDING_BLOCKS,
        "Done transcribing",
    )
    container.runtime.log_stage_end(
        job.job_id,
        "transcription",
        duration_ms=123.45,
        outputs={"segments_count": 3},
        message="Finished mock transcription",
    )

    job_log_dir = expected_logs_root / job.job_id
    tr_log = job_log_dir / "transcription.log"
    orch_log = job_log_dir / "orchestrator.log"
    pipeline_log = job_log_dir / "pipeline.log"
    backend_log = expected_logs_root / "backend.log"

    assert tr_log.exists()
    assert orch_log.exists()
    assert pipeline_log.exists()
    assert backend_log.exists()

    tr_text = tr_log.read_text(encoding="utf-8")
    assert "=== START: Starting mock transcription ===" in tr_text
    assert "[transcription] Line 1" in tr_text
    assert "[WARNING] [transcription] Fallback triggered" in tr_text
    assert "[progress status=TRANSCRIBING percent=42.5% eta=12s] Halfway there" in tr_text
    assert "=== END: Finished mock transcription ===" in tr_text

    pipe_text = pipeline_log.read_text(encoding="utf-8")
    assert "[transcription] Line 1" in pipe_text
    assert "[state status=BUILDING_BLOCKS] Done transcribing" in pipe_text

    # Simulate restart with a fresh OperationRuntimeService reading from disk
    fresh_runtime = OperationRuntimeService(stage_logger=StageLogger())
    disk_tr_lines = fresh_runtime.get_task_logs(job.job_id, "transcription")
    disk_all_lines = fresh_runtime.get_task_logs(job.job_id, "all")
    assert any("Starting mock transcription" in ln for ln in disk_tr_lines)
    assert any("Done transcribing" in ln for ln in disk_all_lines)

    # clear_task_logs clears ring buffer only, keeping persistent disk files intact
    container.runtime.clear_task_logs(job.job_id, "transcription")
    assert container.runtime.get_task_logs(job.job_id, "transcription") == []
    assert tr_log.exists() and "Starting mock transcription" in tr_log.read_text(encoding="utf-8")


def test_log_exception_captures_traceback_context_and_safe_env_diagnostics(
    container: ServiceContainer,
) -> None:
    """`log_exception` records exception type, message, full Python traceback, context,
    and environment diagnostics without importing heavy GPU/AI libraries.
    """
    job = container.jobs.create_job("https://youtube.com/watch?v=exctest1")

    def _boom() -> None:
        raise RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")

    try:
        _boom()
    except RuntimeError as exc:
        formatted = container.runtime.log_exception(
            job.job_id,
            "transcription",
            exc,
            message="Whisper failed",
            context={"model": "large-v3-turbo", "device": "cuda"},
            include_env_diagnostics=True,
        )

    assert len(formatted) > 0
    tr_log = paths.job_stage_log_path(job.job_id, "transcription").read_text(encoding="utf-8")
    pipe_log = paths.job_pipeline_log_path(job.job_id).read_text(encoding="utf-8")
    for text in (tr_log, pipe_log):
        assert "EXCEPTION [RuntimeError]: Library cublas64_12.dll is not found or cannot be loaded" in text
        assert "Context:" in text
        assert '"model": "large-v3-turbo"' in text
        assert "Traceback:" in text
        assert "in _boom" in text
        assert "_boom()" in text
        assert "EnvironmentDiagnostics:" in text

    diag = collect_environment_diagnostics(context={"probe": "safe"})
    assert diag["context"] == {"probe": "safe"}
    assert "cuda_dll_probe" in diag
    assert "path_entry_count" in diag
    assert "active_settings" in diag


@pytest.mark.asyncio
async def test_logs_endpoint_falls_back_to_disk_and_event_bus_is_threadsafe(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    """`GET /jobs/{job_id}/logs/{task}` serves persisted logs when ring buffer is empty,
    and `JobEventBus.publish` safely dispatches from worker threads via `call_soon_threadsafe`.
    """
    job = container.jobs.create_job("https://youtube.com/watch?v=ssethread")
    container.runtime.append_task_log(job.job_id, "ingest", "[ingest] Persisted line A")

    # Drop in-memory ring buffer without touching disk logs
    container.runtime._logs.pop(job.job_id, None)  # noqa: SLF001

    resp = await async_client.get(f"/jobs/{job.job_id}/logs/ingest")
    assert resp.status_code == 200
    logs = resp.json()["logs"]
    assert any("Persisted line A" in line for line in logs)

    # Publish from a worker thread while subscribed on the active asyncio loop
    received: list[dict[str, Any]] = []
    async with container.runtime.event_bus.subscribe(job.job_id) as queue:
        def _worker() -> None:
            container.runtime.publish_progress(
                job.job_id,
                status=JobStatus.DOWNLOADING.value,
                task="ingest",
                percent=75.0,
                message="[ingest] Worker thread progress",
            )

        t = threading.Thread(target=_worker)
        t.start()
        t.join(timeout=2.0)

        evt = await asyncio.wait_for(queue.get(), timeout=2.0)
        assert evt is not None
        received.append(evt.data)

    assert len(received) == 1
    assert received[0]["percent"] == 75.0
    assert received[0]["message"] == "[ingest] Worker thread progress"


# ---------------------------------------------------------------------------
# 2. Orchestrator Stage Lifecycle, BUILDING_TOPICS Handoff & Batch Error Logs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_orchestrator_runs_all_stages_including_topics_and_logs_failures(
    tmp_path: Path,
    container: ServiceContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`semantic_blocks` transitions to `BUILDING_TOPICS` so `run_job_pipeline` executes
    `build_topic_segments` and logs every stage; failures log tracebacks to stage + pipeline logs.
    """
    job = container.jobs.create_job("https://youtube.com/watch?v=orch1", status=JobStatus.DOWNLOADED)
    video_dir = Path(settings.load_settings().media.base_dir) / (job.video_name or job.job_id)
    video_dir.mkdir(parents=True, exist_ok=True)
    video_file = video_dir / "video.mp4"
    video_file.write_bytes(b"\x00" * 512)
    container.jobs.set_cached_source_video(job.job_id, video_file)
    container.jobs.update_job(job.job_id, lambda j: setattr(j, "video_duration_seconds", 60.0))

    segments = [
        Segment(segment_id="s1", start=0.0, end=20.0, text="Primeiro tópico importante sobre arquitetura."),
        Segment(segment_id="s2", start=20.5, end=40.0, text="Segundo ponto completo com conclusão clara."),
    ]
    words = [
        WordTiming(word="Primeiro", start=0.0, end=0.5, probability=0.95, speaker="SPEAKER_00", segment_id="s1"),
        WordTiming(word="tópico", start=0.6, end=1.0, probability=0.95, speaker="SPEAKER_00", segment_id="s1"),
    ]
    container.jobs.save_transcription_segments(job.job_id, segments)
    container.jobs.save_transcription_words(job.job_id, words)
    container.jobs.update_job_status(job.job_id, JobStatus.BUILDING_BLOCKS)

    blocks = build_semantic_blocks(job.job_id, container=container)
    assert len(blocks) >= 1
    assert container.jobs.load_job(job.job_id).status == JobStatus.BUILDING_TOPICS

    # Verify blocks.log was written
    blocks_log = paths.job_stage_log_path(job.job_id, "blocks").read_text(encoding="utf-8")
    assert "START" in blocks_log and "END" in blocks_log

    # Reset back to BUILDING_BLOCKS and run orchestrator with mocked analysis & render
    container.jobs.update_job_status(job.job_id, JobStatus.BUILDING_BLOCKS)
    called_stages: list[str] = []

    async def _fake_analyze(jid: str, *, container: ServiceContainer | None = None, **_: Any) -> dict[str, Any]:
        called_stages.append("analysis")
        (container or get_container_ref()).jobs.update_job_status(jid, JobStatus.WAITING_APPROVAL)
        return {"cuts": []}

    def get_container_ref() -> ServiceContainer:
        return container

    class _FakeRenderSvc:
        async def render_job(self, jid: str) -> list[str]:
            called_stages.append("render")
            container.jobs.update_job_status(jid, JobStatus.DONE)
            return ["/media/shorts/demo.mp4"]

    monkeypatch.setattr("app.application.orchestrator.analyze_job", _fake_analyze)
    monkeypatch.setattr("app.application.orchestrator.get_rendering_service", lambda: _FakeRenderSvc())

    final_job = await run_job_pipeline(job.job_id, include_render=True, container=container)
    assert final_job.status == JobStatus.DONE
    assert called_stages == ["analysis", "render"]

    # Step 4 (topics) must have run and written topic.segments.json + topics.log
    topics = container.jobs.load_topic_segments(job.job_id)
    assert len(topics) >= 1
    assert paths.job_stage_log_path(job.job_id, "topics").exists()
    assert paths.job_stage_log_path(job.job_id, "orchestrator").exists()
    pipe_text = paths.job_pipeline_log_path(job.job_id).read_text(encoding="utf-8")
    assert "Step 3/5: Semantic blocks complete" in pipe_text
    assert "Step 4/5: Topic segmentation complete" in pipe_text

    # Failure case in BatchRunner logs traceback + env diagnostics
    reset_batch_runner()
    err_job = container.jobs.create_job("https://youtube.com/watch?v=batcherr", status=JobStatus.DOWNLOADED)
    err_video = Path(settings.load_settings().media.base_dir) / (err_job.video_name or err_job.job_id) / "v.mp4"
    err_video.parent.mkdir(parents=True, exist_ok=True)
    err_video.write_bytes(b"\x00" * 512)
    container.jobs.set_cached_source_video(err_job.job_id, err_video)

    async def _boom_transcribe(jid: str, *, container: ServiceContainer | None = None, **_: Any) -> Any:
        raise RuntimeError("Simulated GPU transcription explosion")

    monkeypatch.setattr("app.application.orchestrator.transcribe_job", _boom_transcribe)
    runner = BatchRunner(container=container)
    batch = runner.start_batch([err_job.job_id], options={"transcription": True, "analysis": False, "render": False})
    await asyncio.wait_for(runner._tasks[batch.batch_id], timeout=5.0)  # noqa: SLF001

    assert batch.failed == 1
    assert container.jobs.load_job(err_job.job_id).status == JobStatus.ERROR
    err_tr_log = paths.job_stage_log_path(err_job.job_id, "transcription").read_text(encoding="utf-8")
    assert "Simulated GPU transcription explosion" in err_tr_log
    assert "Traceback:" in err_tr_log
    assert "EnvironmentDiagnostics:" in err_tr_log


# ---------------------------------------------------------------------------
# 3. Windows CUDA DLL Discovery, VRAM Probe & Lazy transcribe() CPU Fallback
# ---------------------------------------------------------------------------


def test_cuda_dll_discovery_probe_and_error_classification(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`discover_cuda_dll_directories`, `ensure_cuda_dll_directories`, `probe_cuda_whisper_runtime`,
    and `is_cuda_or_dll_error` work cleanly with synthetic paths and mocked ctypes.WinDLL.
    """
    fake_site = tmp_path / "venv" / "Lib" / "site-packages"
    nvidia_cublas_bin = fake_site / "nvidia" / "cublas" / "bin"
    torch_lib = fake_site / "torch" / "lib"
    ct2_dir = fake_site / "ctranslate2"
    cuda_home_bin = tmp_path / "cuda_toolkit" / "bin"
    for d in (nvidia_cublas_bin, torch_lib, ct2_dir, cuda_home_bin):
        d.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(cuda_env, "_iter_candidate_site_roots", lambda: [fake_site])
    monkeypatch.setenv("CUDA_HOME", str(tmp_path / "cuda_toolkit"))

    discovered = cuda_env.discover_cuda_dll_directories()
    discovered_strs = {str(p) for p in discovered}
    assert str(nvidia_cublas_bin.resolve()) in discovered_strs
    assert str(torch_lib.resolve()) in discovered_strs
    assert str(ct2_dir.resolve()) in discovered_strs
    assert str(cuda_home_bin.resolve()) in discovered_strs

    # Mock add_dll_directory and PATH mutation safely
    added_calls: list[str] = []
    monkeypatch.setattr(cuda_env, "_REGISTERED_DLL_DIRS", set())
    monkeypatch.setattr(cuda_env, "_DLL_DIR_HANDLES", [])
    monkeypatch.setenv("PATH", "")
    if hasattr(cuda_env.os, "add_dll_directory"):
        monkeypatch.setattr(cuda_env.os, "add_dll_directory", lambda p: added_calls.append(p) or object())

    newly_added = cuda_env.ensure_cuda_dll_directories()
    assert str(nvidia_cublas_bin.resolve()) in newly_added
    assert str(nvidia_cublas_bin.resolve()) in cuda_env.os.environ["PATH"]

    # Probe fails when cublas64_12.dll cannot be loaded on Windows
    monkeypatch.setattr(cuda_env.sys, "platform", "win32")

    def _raise_dll(name: str) -> Any:
        raise FileNotFoundError(f"Could not find module '{name}'")

    monkeypatch.setattr(cuda_env.ctypes, "WinDLL", _raise_dll)
    ok, reason = cuda_env.probe_cuda_whisper_runtime()
    assert ok is False
    assert reason is not None and "cublas64_12.dll" in reason

    # Probe succeeds when WinDLL loads
    monkeypatch.setattr(cuda_env.ctypes, "WinDLL", lambda name: object())
    ok2, reason2 = cuda_env.probe_cuda_whisper_runtime()
    assert ok2 is True
    assert reason2 is None

    # Recursive error classification
    root = RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")
    try:
        try:
            raise root
        except RuntimeError as inner:
            raise ValueError("Transcription wrapper error") from inner
    except ValueError as outer:
        assert cuda_env.is_cuda_or_dll_error(outer) is True

    assert cuda_env.is_cuda_or_dll_error(ValueError("unrelated schema error")) is False


@pytest.mark.asyncio
async def test_scheduler_prepare_for_whisper_falls_back_when_cuda_dll_missing() -> None:
    """When CUDA runtime DLL probe reports missing `cublas64_12.dll`, `ActiveVRAMBudgetManager`
    immediately selects `cpu` (`int8`) with `fell_back_to_cpu=True` and `fallback_reason`.
    """
    mgr = ActiveVRAMBudgetManager(
        vram_probe=lambda: 10.5,
        cuda_runtime_probe=lambda: (False, "Required CUDA library cublas64_12.dll is not found"),
    )
    decision = await mgr.prepare_for_whisper("cuda")
    assert decision.device == "cpu"
    assert decision.compute_type == "int8"
    assert decision.fell_back_to_cpu is True
    assert decision.fallback_reason is not None and "cublas64_12.dll" in decision.fallback_reason


@pytest.mark.asyncio
async def test_faster_whisper_lazy_transcribe_cuda_error_falls_back_to_cpu_and_logs(
    tmp_path: Path,
    container: ServiceContainer,
) -> None:
    """Simulate `WhisperModel(device='cuda')` succeeding, then `model.transcribe()` / generator
    iteration lazily raising `RuntimeError: Library cublas64_12.dll is not found or cannot be loaded`.
    Verify cleanup, transparent CPU `int8` retry, warning log, and preserved `"render"` logs.
    """
    job = container.jobs.create_job("https://youtube.com/watch?v=lazydll", status=JobStatus.DOWNLOADED)
    video_dir = Path(settings.load_settings().media.base_dir) / (job.video_name or job.job_id)
    video_dir.mkdir(parents=True, exist_ok=True)
    video_file = video_dir / "clip.mp4"
    video_file.write_bytes(b"\x00" * 512)
    container.jobs.set_cached_source_video(job.job_id, video_file)

    wav_path = container.jobs.audio_16k_path(job.job_id)
    write_synthetic_pcm16_wav(wav_path, duration_seconds=2.0)

    # Pre-existing render log must NOT be wiped by transcribe_job
    container.runtime.append_task_log(job.job_id, "render", "[render] Keep me intact")

    calls: list[dict[str, Any]] = []

    class _FakeCudaModel:
        def transcribe(self, audio_path: str, **kwargs: Any) -> tuple[Any, dict[str, Any]]:
            def _lazy_gen():
                raise RuntimeError("Library cublas64_12.dll is not found or cannot be loaded")
                yield  # pragma: no cover

            return _lazy_gen(), {"duration": 2.0}

    class _FakeCpuModel:
        def transcribe(self, audio_path: str, **kwargs: Any) -> tuple[Any, dict[str, Any]]:
            seg = RawWhisperSegment(
                start=0.0,
                end=1.8,
                text="Transcrição concluída na CPU com sucesso.",
                avg_logprob=-0.2,
                no_speech_prob=0.05,
                compression_ratio=1.2,
                words=[
                    RawWhisperWord(word="Transcrição", start=0.0, end=0.6, probability=0.95),
                    RawWhisperWord(word="concluída", start=0.7, end=1.3, probability=0.95),
                ],
            )
            return iter([seg]), {"duration": 2.0}

    def _factory(model_name: str, **kwargs: Any) -> Any:
        calls.append({"model_name": model_name, **kwargs})
        if kwargs.get("device") == "cuda":
            return _FakeCudaModel()
        return _FakeCpuModel()

    # Force scheduler to initially decide CUDA (e.g. VRAM looks healthy before lazy DLL error)
    container.scheduler.vram_manager._vram_probe = lambda: 10.0  # noqa: SLF001
    container.scheduler.vram_manager._cuda_runtime_probe = lambda: (True, None)  # noqa: SLF001

    adapter = FasterWhisperAdapter(model_factory=_factory)
    service = TranscriptionDomainService(container=container, whisper_adapter=adapter)
    result = await service.transcribe_job(job.job_id)

    assert len(calls) == 2
    assert calls[0]["device"] == "cuda" and calls[0]["compute_type"] == "int8_float16"
    assert calls[1]["device"] == "cpu" and calls[1]["compute_type"] == "int8"
    assert len(result.segments) == 1
    assert "Transcrição concluída na CPU" in result.transcription

    # Verify fallback warning landed in transcription.log & pipeline.log, and render logs survived
    tr_log = paths.job_stage_log_path(job.job_id, "transcription").read_text(encoding="utf-8")
    assert "WARNING" in tr_log
    assert "cublas64_12.dll" in tr_log
    assert container.runtime.get_task_logs(job.job_id, "render") == ["[render] Keep me intact"]


@pytest.mark.asyncio
async def test_faster_whisper_model_load_error_falls_back_to_cpu(tmp_path: Path) -> None:
    """If `WhisperModel(device='cuda')` itself raises CUDA error at load time, retry on CPU `int8`."""
    calls: list[dict[str, Any]] = []

    class _FakeCpuModel:
        def transcribe(self, audio_path: str, **kwargs: Any) -> tuple[Any, dict[str, Any]]:
            return iter([RawWhisperSegment(start=0.0, end=1.0, text="Ok")]), {"duration": 1.0}

    def _factory(model_name: str, **kwargs: Any) -> Any:
        calls.append(kwargs)
        if kwargs.get("device") == "cuda":
            raise RuntimeError("CUDA out of memory during model load")
        return _FakeCpuModel()

    adapter = FasterWhisperAdapter(model_factory=_factory)
    decision = WhisperAllocationDecision(
        device="cuda",
        compute_type="int8_float16",
        cpu_threads=0,
        free_vram_gb=8.0,
    )
    fallback_reasons: list[str] = []
    segs, dur, final_dec = await adapter.transcribe(
        tmp_path / "dummy.wav",
        model_name="large-v3-turbo",
        decision=decision,
        whisper_cfg={"temperature": [0.0, 0.2]},
        on_fallback=fallback_reasons.append,
    )

    assert len(calls) == 2
    assert final_dec.device == "cpu"
    assert final_dec.compute_type == "int8"
    assert final_dec.fell_back_to_cpu is True
    assert len(segs) == 1 and dur == 1.0
    assert len(fallback_reasons) == 1 and "CUDA" in fallback_reasons[0]


# ---------------------------------------------------------------------------
# 4. Ingest, Segmentation & LLM Analysis Fixes
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_pcm_extractor_fails_loudly_on_real_media_when_ffmpeg_errors(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`extract_pcm_16k_wav` must NOT swallow FFmpeg failures for real media (> 4096 bytes)."""
    big_video = tmp_path / "real_video.mp4"
    big_video.write_bytes(b"\x01" * 8192)
    out_wav = tmp_path / "audio_16k.wav"

    class _FailProc:
        returncode = 1

        async def communicate(self) -> tuple[bytes, bytes]:
            return b"", b"Invalid data found when processing input"

    monkeypatch.setattr("app.infrastructure.audio.pcm_extractor.shutil.which", lambda _: "ffmpeg")

    async def _fake_exec(*args: Any, **kwargs: Any) -> _FailProc:
        return _FailProc()

    monkeypatch.setattr("app.infrastructure.audio.pcm_extractor.asyncio.create_subprocess_exec", _fake_exec)

    with pytest.raises(RuntimeError, match="Invalid data found when processing input"):
        await extract_pcm_16k_wav(big_video, out_wav, allow_synthetic_fallback=True)
    assert not out_wav.exists()


@pytest.mark.asyncio
async def test_upload_local_video_chunked_and_error_logs(
    container: ServiceContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`upload_local_video` supports chunked stream reads and logs/marks ERROR on failure."""
    svc = IngestDomainService(container=container)

    class _ChunkedStream:
        def __init__(self, payload: bytes) -> None:
            self._buf = payload
            self._pos = 0

        async def read(self, size: int = -1) -> bytes:
            if self._pos >= len(self._buf):
                return b""
            if size < 0:
                chunk = self._buf[self._pos :]
                self._pos = len(self._buf)
                return chunk
            chunk = self._buf[self._pos : self._pos + size]
            self._pos += len(chunk)
            return chunk

    async def _fail_extract(*args: Any, **kwargs: Any) -> Path:
        raise RuntimeError("Corrupt audio stream")

    monkeypatch.setattr(svc, "_probe_duration", lambda p: asyncio.sleep(0, result=12.0))
    monkeypatch.setattr(svc, "_extract_audio_16k", _fail_extract)

    with pytest.raises(RuntimeError, match="Corrupt audio stream"):
        await svc.upload_local_video(filename="broken.mp4", content=_ChunkedStream(b"1234567890"))

    jobs = container.jobs.list_jobs()
    assert len(jobs) == 1
    assert jobs[0].status == JobStatus.ERROR
    ingest_log = paths.job_stage_log_path(jobs[0].job_id, "ingest").read_text(encoding="utf-8")
    assert "Corrupt audio stream" in ingest_log
    assert "Traceback:" in ingest_log


@pytest.mark.asyncio
async def test_topic_segmentation_logs_warning_on_embedding_fallback(
    container: ServiceContainer,
) -> None:
    """When local embeddings return empty, `build_topic_segments` logs a warning to `topics.log`
    and cleanly falls back to TF-IDF lexical segmentation.
    """
    job = container.jobs.create_job("https://youtube.com/watch?v=topicwarn", status=JobStatus.BUILDING_TOPICS)
    container.jobs.update_job(job.job_id, lambda j: setattr(j, "video_duration_seconds", 240.0))

    blocks = [
        SemanticBlock(
            block_id=f"b{i}",
            start=float(i * 25),
            end=float((i + 1) * 25),
            text=f"Bloco temático {i} discutindo assunto específico número {i}.",
            segment_ids=[f"s{i}"],
        )
        for i in range(8)
    ]
    container.jobs.save_semantic_blocks(job.job_id, blocks)

    async def _offline_fetcher(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
        raise httpx.ConnectError("connection refused")

    container.llm_http_fetcher = _offline_fetcher
    topics = await build_topic_segments(job.job_id, container=container, use_embeddings=True)
    assert len(topics) >= 1
    topics_log = paths.job_stage_log_path(job.job_id, "topics").read_text(encoding="utf-8")
    assert "WARNING" in topics_log
    assert "TF-IDF" in topics_log


@pytest.mark.asyncio
async def test_unified_llm_adapter_handles_empty_lms_400_retry_and_timeout(
    container: ServiceContainer,
) -> None:
    """Covers:
    1. LM Studio online with 0 loaded models falls back to Ollama (or raises 503 if Ollama offline).
    2. LM Studio HTTP 400 on `json_schema` retries with `json_object` and succeeds.
    3. `httpx.TimeoutException` maps cleanly to `LocalLLMUnavailableError` (HTTP 503).
    """
    # 1. LM Studio empty models -> Ollama fallback
    async def _empty_lms_then_ollama(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
        if url.endswith("/v1/models"):
            return 200, {"data": []}
        if url.endswith("/api/tags"):
            return 200, {"models": [{"name": "qwen2.5:14b"}]}
        return 404, {}

    container.llm_http_fetcher = _empty_lms_then_ollama
    adapter = UnifiedLocalLLMAdapter(container=container)
    res = await adapter.detect_provider_and_model()
    assert res.provider == "ollama"

    # Both LM Studio empty and Ollama offline -> LocalLLMUnavailableError
    async def _empty_lms_no_ollama(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
        if url.endswith("/v1/models"):
            return 200, {"data": []}
        raise httpx.ConnectError("ollama down")

    container.llm_http_fetcher = _empty_lms_no_ollama
    with pytest.raises(LocalLLMUnavailableError, match="no model loaded"):
        await adapter.detect_provider_and_model()

    # 2. LM Studio HTTP 400 json_schema -> json_object retry
    chat_payloads: list[dict[str, Any]] = []

    async def _lms_400_then_ok(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
        if url.endswith("/v1/models"):
            return 200, {"data": [{"id": "qwen2.5-14b-instruct"}]}
        if url.endswith("/chat/completions") and body is not None:
            chat_payloads.append(body)
            if body.get("response_format", {}).get("type") == "json_schema":
                return 400, {"error": "json_schema unsupported"}
            return 200, {"choices": [{"message": {"content": '{"cuts": []}'}}]}
        return 404, {}

    container.llm_http_fetcher = _lms_400_then_ok
    parsed, _raw = await adapter.chat_json("sys", "user")
    assert parsed == {"cuts": []}
    assert len(chat_payloads) == 2
    assert chat_payloads[0]["response_format"]["type"] == "json_schema"
    assert chat_payloads[1]["response_format"]["type"] == "json_object"

    # 3. httpx.TimeoutException -> LocalLLMUnavailableError
    async def _lms_timeout(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
        if url.endswith("/v1/models"):
            return 200, {"data": [{"id": "qwen2.5-14b-instruct"}]}
        raise httpx.ReadTimeout("timed out after 120s")

    container.llm_http_fetcher = _lms_timeout
    with pytest.raises(LocalLLMUnavailableError, match="timed out"):
        await adapter.chat_json("sys", "user")


@pytest.mark.asyncio
async def test_narrative_miner_overrides_legacy_conflicting_system_prompt(
    container: ServiceContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Legacy `custom_settings.json` system_prompt containing `'Never include score'`
    must trigger a warning in `analysis.log` and substitute `SYSTEM_PROMPT_TEMPLATE`.
    """
    job = container.jobs.create_job("https://youtube.com/watch?v=promptfix", status=JobStatus.ANALYZING)
    container.jobs.update_job(job.job_id, lambda j: setattr(j, "video_duration_seconds", 60.0))
    container.jobs.save_semantic_blocks(
        job.job_id,
        [SemanticBlock(block_id="b1", start=0.0, end=30.0, text="História completa com início e fim.")],
    )
    container.jobs.save_topic_segments(
        job.job_id,
        [TopicSegment(topic_id="t1", start=0.0, end=30.0, block_ids=["b1"], title="Tópico 1")],
    )

    from app.core import tool_configs

    cfg = tool_configs.load_active_tool_configs()
    cfg["llm"]["system_prompt"] = "Never include score, hook_reason, or content_reason. Return JSON array only."
    monkeypatch.setattr(container, "load_active_tool_configs", lambda: cfg)

    captured_prompts: list[str] = []

    async def _fake_mine(*args: Any, **kwargs: Any) -> tuple[list[Any], str]:
        captured_prompts.append(kwargs["system_prompt"])
        return [], "{}"

    monkeypatch.setattr("app.domain.analysis.narrative_miner.mine_narrative_cuts", _fake_mine)
    await analyze_job(job.job_id, container=container)

    assert len(captured_prompts) == 1
    assert "Never include score" not in captured_prompts[0]
    analysis_log = paths.job_stage_log_path(job.job_id, "analysis").read_text(encoding="utf-8")
    assert "Prompt legado incompatível" in analysis_log


# ---------------------------------------------------------------------------
# 5. Rendering Fixes (FFmpeg 9 `-/filter_complex`, Crop Quoting, Silent Audio, OpenCV 5)
# ---------------------------------------------------------------------------


def test_ffmpeg_resolve_filter_complex_flag_for_ffmpeg8_and_legacy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """`resolve_filter_complex_script_flag()` picks `-/filter_complex` on FFmpeg 8/9+
    and `-filter_complex_script` when legacy option is present.
    """
    ffmpeg_executor.resolve_filter_complex_script_flag.cache_clear()
    monkeypatch.setattr(ffmpeg_executor.shutil, "which", lambda _: "ffmpeg")

    class _ProcFFmpeg9:
        stdout = "Global options:\n-filter_complex graph_description  create a complex filtergraph\n"
        stderr = ""

    monkeypatch.setattr(ffmpeg_executor.subprocess, "run", lambda *a, **kw: _ProcFFmpeg9())
    assert ffmpeg_executor.resolve_filter_complex_script_flag() == "-/filter_complex"

    ffmpeg_executor.resolve_filter_complex_script_flag.cache_clear()

    class _ProcFFmpeg6:
        stdout = "-filter_complex_script filename  read complex filtergraph from file\n"
        stderr = ""

    monkeypatch.setattr(ffmpeg_executor.subprocess, "run", lambda *a, **kw: _ProcFFmpeg6())
    assert ffmpeg_executor.resolve_filter_complex_script_flag() == "-filter_complex_script"
    ffmpeg_executor.resolve_filter_complex_script_flag.cache_clear()


def test_filter_script_builder_quotes_crop_handles_silent_video_single_trim_and_split_screen() -> None:
    """Verifies all 4 filtergraph fixes:
    - Piecewise-linear `crop=` expression is quoted (`'if(lt(...))'`)
    - Single-interval `timeline_mapper` (`len(intervals) == 1`) applies trim/concat
    - `split_screen` clamps crop width to `min(source_width, 960)` and clamps `left_x`/`right_x`
    - `has_audio=False` generates `anullsrc` with zero `[0:a]` references.
    """
    crop_plan = VirtualCameramanPlan(
        source_width=1920,
        source_height=1080,
        target_width=1080,
        target_height=1920,
        crop_width=608,
        crop_height=1080,
        vertical_mode="auto_crop",
        primary_mode="crop_track",
        keyframes=[
            CameraKeyframe(time=0.0, x=100.0, mode="crop_track"),
            CameraKeyframe(time=2.5, x=500.0, mode="crop_track"),
        ],
    )
    single_trim = TimelineMapper(
        cut_start=10.0,
        cut_end=15.0,
        trim_enabled=True,
        intervals=[KeptTimeInterval(rel_start=0.0, rel_end=5.0, out_start=0.0, out_end=5.0)],
    )
    script = build_filter_complex_script_content(
        crop_plan,
        5.0,
        timeline_mapper=single_trim,
        options=FilterScriptOptions(burn_subtitles=False, has_audio=False),
    )
    assert "[0:v]trim=start=0.000:end=5.000" in script
    assert "concat=n=1:v=1:a=0[v_trimmed]" in script
    assert "[0:a]" not in script
    assert "anullsrc=channel_layout=stereo:sample_rate=44100:d=5.000[a_out]" in script
    assert "crop=608:1080:'if(lt(t," in script

    # Split-screen clamping check (source_width=1920 -> split_crop_w=960, max_x=960)
    split_plan = VirtualCameramanPlan(
        source_width=1920,
        source_height=1080,
        target_width=1080,
        target_height=1920,
        crop_width=608,
        crop_height=1080,
        vertical_mode="auto_crop",
        primary_mode="split_screen",
        keyframes=[
            CameraKeyframe(time=0.0, x=-50.0, secondary_x=1500.0, mode="split_screen"),
        ],
    )
    split_script = build_filter_complex_script_content(
        split_plan,
        4.0,
        options=FilterScriptOptions(burn_subtitles=False, has_audio=True),
    )
    assert "crop=960:1080:0.0:0" in split_script
    assert "crop=960:1080:960.0:0" in split_script
    assert "vstack=inputs=2[v_base]" in split_script


def test_face_tracker_handles_opencv5_missing_cascade_cleanly(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
) -> None:
    """When `mediapipe` is absent and `cv2` (OpenCV 5.0) lacks `CascadeClassifier`/`data`,
    `MediaPipeVisionAdapter` cleanly degrades to `noop_fallback` with a warning instead of raising.
    """
    fake_cv2 = types.ModuleType("cv2")
    monkeypatch.setitem(sys.modules, "cv2", fake_cv2)
    monkeypatch.setitem(sys.modules, "mediapipe", None)  # Force ImportError on import mediapipe

    adapter = MediaPipeVisionAdapter()
    with caplog.at_level("WARNING"):
        detector = adapter._build_default_detector()  # noqa: SLF001

    assert adapter._backend_name == "noop_fallback"  # noqa: SLF001
    assert detector(None, 0.0, 1920, 1080) == []
    assert any("No face detector backend active" in rec.message for rec in caplog.records)


@pytest.mark.asyncio
async def test_windows_selector_loop_notimplemented_subprocess_fallbacks(
    tmp_path: Path,
    container: ServiceContainer,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """When Windows SelectorEventLoop (e.g. under `uvicorn --reload`) raises `NotImplementedError`
    on `asyncio.create_subprocess_exec`, both `extract_pcm_16k_wav` and `FFmpegExecutor`
    fall back transparently to threaded `subprocess.run` / `subprocess.Popen`.
    """
    from app.infrastructure.audio import pcm_extractor
    from app.infrastructure.video.ffmpeg_executor import FFmpegNvencExecutor

    src_video = tmp_path / "video.mp4"
    src_video.write_bytes(b"\x00" * 8192)
    out_wav = tmp_path / "audio_16k.wav"

    async def _raise_not_implemented(*_args: Any, **_kwargs: Any) -> Any:
        raise NotImplementedError()

    monkeypatch.setattr(pcm_extractor.shutil, "which", lambda name: "ffmpeg" if name == "ffmpeg" else None)
    monkeypatch.setattr(pcm_extractor.asyncio, "create_subprocess_exec", _raise_not_implemented)

    def _fake_subprocess_run(cmd: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[bytes]:
        pcm_extractor.write_synthetic_pcm16_wav(out_wav, duration_seconds=2.0)
        return subprocess.CompletedProcess(args=cmd, returncode=0, stdout=b"", stderr=b"")

    monkeypatch.setattr(pcm_extractor.subprocess, "run", _fake_subprocess_run)
    res_wav = await pcm_extractor.extract_pcm_16k_wav(
        src_video,
        out_wav,
        allow_synthetic_fallback=False,
    )
    assert res_wav == out_wav
    assert out_wav.exists()

    # Now test FFmpegNvencExecutor._default_run_subprocess NotImplementedError -> threaded Popen fallback
    executor = FFmpegNvencExecutor(container=container)
    import app.infrastructure.video.ffmpeg_executor as ff_exec_mod

    monkeypatch.setattr(ff_exec_mod.asyncio, "create_subprocess_exec", _raise_not_implemented)

    class _FakePopen:
        pid = 999888
        stdout = iter(["frame=10\n", "frame=20\n"])

        def wait(self) -> int:
            return 0

    monkeypatch.setattr(ff_exec_mod.subprocess, "Popen", lambda *args, **kwargs: _FakePopen())
    lines: list[str] = []
    token = container.runtime.create_cancel_token("job-subproc", "render")
    rc = await executor._default_run_subprocess(["ffmpeg", "-version"], lines.append, token)  # noqa: SLF001
    assert rc == 0
    assert lines == ["frame=10", "frame=20"]
