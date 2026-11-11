"""Phase 1 logical test suite: foundation, atomic storage, scheduler/VRAM, lifecycle, config, videos, and HTTP 206 media streaming."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.application.job_lifecycle import can_transition
from app.application.runtime_service import OperationCancelledError, ServiceContainer
from app.application.scheduler import ActiveVRAMBudgetManager, HardwareResourceScheduler
from app.core import paths, settings, tool_configs
from app.infrastructure.storage.atomic_store import AtomicJsonArtifactStore, atomic_write_json
from app.models.domain import JobStatus, Segment


# ---------------------------------------------------------------------------
# 1. Atomic Storage & Cross-OS Settings Normalization
# ---------------------------------------------------------------------------


def test_atomic_store_writes_clean_json_and_triggers_invalidation(tmp_path: Path) -> None:
    invalidated: list[str | None] = []
    store = AtomicJsonArtifactStore(on_invalidate=lambda jid: invalidated.append(jid))

    target = tmp_path / "nested" / "artifact.json"
    store.write_json(target, {"hello": "world", "count": 42}, job_id="job_123")

    assert target.exists()
    assert store.read_json(target) == {"hello": "world", "count": 42}
    # Ensure no temporary .tmp files remain
    leftover_tmps = list(target.parent.glob("*.tmp"))
    assert leftover_tmps == []
    assert invalidated == ["job_123"]


def test_cross_os_base_dir_normalization(tmp_path: Path) -> None:
    fallback = tmp_path / "fallback_uploads"

    # Windows path on POSIX -> falls back
    normalized_posix = settings.normalize_cross_os_base_dir(
        r"C:\Users\lucas\Downloads\uploads",
        target_os="posix",
        fallback_dir=fallback,
    )
    assert normalized_posix == str(fallback)

    # POSIX path on Windows -> falls back
    normalized_win = settings.normalize_cross_os_base_dir(
        "/home/lucas/Downloads/uploads",
        target_os="nt",
        fallback_dir=fallback,
    )
    assert normalized_win == str(fallback)

    # Native path is preserved
    native_win = settings.normalize_cross_os_base_dir(
        r"D:\Videos\Shorts",
        target_os="nt",
        fallback_dir=fallback,
    )
    assert native_win == r"D:\Videos\Shorts"

    native_posix = settings.normalize_cross_os_base_dir(
        "/var/media/shorts",
        target_os="posix",
        fallback_dir=fallback,
    )
    assert native_posix == "/var/media/shorts"


def test_settings_file_persists_normalized_base_dir_when_foreign(tmp_path: Path) -> None:
    sf = paths.settings_file_path()
    foreign_path = "/home/linuxuser/uploads" if settings.os.name == "nt" else r"C:\Users\win\uploads"
    atomic_write_json(
        sf,
        {
            "media": {"base_dir": foreign_path, "download_resolution": "1440p"},
            "preferences": {
                "ask_move_on_upload": False,
                "move_uploads": True,
                "ask_delete_cut_confirm": False,
            },
            "whisper": {"device": "cuda", "formats": ["json", "vtt"]},
            "llm": {"model": "qwen2.5:14b"},
        },
    )
    settings.invalidate_settings_cache()
    loaded = settings.load_settings()
    assert loaded.media.base_dir == str(settings.get_default_base_dir())
    assert loaded.media.download_resolution == "1440p"
    assert loaded.preferences.ask_move_on_upload is False


# ---------------------------------------------------------------------------
# 2. Hardware Resource Scheduler & ActiveVRAMBudgetManager
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_vram_budget_manager_cuda_direct_when_vram_sufficient() -> None:
    cleanups = 0

    def _clear() -> None:
        nonlocal cleanups
        cleanups += 1

    mgr = ActiveVRAMBudgetManager(
        vram_probe=lambda: 4.5,
        ollama_unloader=lambda: [],
        lms_unloader=lambda: False,
        cuda_cache_clear=_clear,
    )
    scheduler = HardwareResourceScheduler(vram_manager=mgr)

    async with scheduler.whisper_slot(requested_device="cuda") as decision:
        assert decision.device == "cuda"
        assert decision.compute_type == "int8_float16"
        assert decision.fell_back_to_cpu is False
        assert decision.free_vram_gb == 4.5

    assert cleanups == 1


@pytest.mark.asyncio
async def test_vram_budget_manager_unloads_ollama_and_recovers_vram() -> None:
    vram_samples = [1.1, 3.8]
    unloaded_called: list[str] = []

    def _probe() -> float:
        return vram_samples.pop(0) if len(vram_samples) > 1 else vram_samples[0]

    async def _unload_ollama() -> list[str]:
        unloaded_called.append("qwen2.5:14b")
        return ["qwen2.5:14b"]

    mgr = ActiveVRAMBudgetManager(
        vram_probe=_probe,
        ollama_unloader=_unload_ollama,
        lms_unloader=lambda: True,
    )
    decision = await mgr.prepare_for_whisper(requested_device="cuda")
    assert decision.device == "cuda"
    assert decision.compute_type == "int8_float16"
    assert decision.unloaded_models == ["qwen2.5:14b"]
    assert decision.lms_unloaded is True
    assert decision.fell_back_to_cpu is False


@pytest.mark.asyncio
async def test_vram_budget_manager_falls_back_to_cpu_int8_when_vram_still_low() -> None:
    mgr = ActiveVRAMBudgetManager(
        vram_probe=lambda: 0.9,
        ollama_unloader=lambda: [],
        lms_unloader=lambda: False,
    )
    decision = await mgr.prepare_for_whisper(requested_device="cuda")
    assert decision.device == "cpu"
    assert decision.compute_type == "int8"
    assert decision.cpu_threads == 8
    assert decision.fell_back_to_cpu is True


@pytest.mark.asyncio
async def test_scheduler_concurrency_bounds() -> None:
    scheduler = HardwareResourceScheduler(io_concurrency=2, render_concurrency=2)

    active_gpu = 0
    max_gpu_seen = 0

    async def _gpu_worker() -> None:
        nonlocal active_gpu, max_gpu_seen
        async with scheduler.gpu_slot("test"):
            active_gpu += 1
            max_gpu_seen = max(max_gpu_seen, active_gpu)
            await asyncio.sleep(0.01)
            active_gpu -= 1

    await asyncio.gather(_gpu_worker(), _gpu_worker(), _gpu_worker())
    assert max_gpu_seen == 1

    active_io = 0
    max_io_seen = 0

    async def _io_worker() -> None:
        nonlocal active_io, max_io_seen
        async with scheduler.io_slot():
            active_io += 1
            max_io_seen = max(max_io_seen, active_io)
            await asyncio.sleep(0.01)
            active_io -= 1

    await asyncio.gather(_io_worker(), _io_worker(), _io_worker(), _io_worker())
    assert max_io_seen <= 2


# ---------------------------------------------------------------------------
# 3. Runtime Service (400-line Ring Buffer, Cancel Tokens, Process Tree, SSE Bus)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_runtime_service_logs_cancel_tokens_and_sse_bus(
    container: ServiceContainer, tmp_path: Path
) -> None:
    rt = container.runtime

    # 1. 400-line ring buffer
    for i in range(450):
        rt.append_task_log("job_1", "transcription", f"line-{i}")
    logs = rt.get_task_logs("job_1", "transcription")
    assert len(logs) == 400
    assert logs[0] == "line-50"
    assert logs[-1] == "line-449"

    # 2. Cooperative cancel token + process kill + partial file cleanup
    killed: list[int] = []
    rt._process_killer = lambda pid: killed.append(pid)

    partial_mp4 = tmp_path / "partial_cut.mp4"
    partial_ass = tmp_path / "partial_cut.ass"
    partial_mp4.write_bytes(b"incomplete")
    partial_ass.write_text("incomplete ass", encoding="utf-8")

    token = rt.create_cancel_token("job_1", "render")
    rt.register_process("job_1", "render", 99991)
    rt.register_partial_file("job_1", partial_mp4)
    rt.register_partial_file("job_1", partial_ass)

    assert rt.request_cancel("job_1", "render") is True
    assert token.is_set() is True
    assert killed == [99991]
    assert not partial_mp4.exists()
    assert not partial_ass.exists()
    with pytest.raises(OperationCancelledError):
        token.raise_if_cancelled()

    # 3. Per-job SSE event bus
    async with rt.event_bus.subscribe("job_1") as queue:
        rt.publish_progress(
            "job_1",
            status="TRANSCRIBING",
            task="transcription",
            percent=65.0,
            eta_seconds=18,
            message="[transcription] Progresso: 65%",
        )
        evt = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert evt is not None
        sse_text = evt.format_sse()
        assert sse_text.startswith("event: progress\ndata: ")
        payload = json.loads(sse_text.splitlines()[1].removeprefix("data: "))
        assert payload["job_id"] == "job_1"
        assert payload["percent"] == 65.0
        assert payload["eta_seconds"] == 18


# ---------------------------------------------------------------------------
# 4. Job Lifecycle & Transcription Format Deletion
# ---------------------------------------------------------------------------


def test_job_lifecycle_and_transcription_format_deletion(container: ServiceContainer) -> None:
    assert can_transition(JobStatus.CREATED, JobStatus.DOWNLOADING) is True
    assert can_transition(JobStatus.TRANSCRIBING, JobStatus.DOWNLOADED) is True

    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=test123",
        status=JobStatus.WAITING_APPROVAL,
        video_name="Meu Video Teste",
    )
    jid = job.job_id

    container.jobs.save_transcription_segments(
        jid,
        [Segment(segment_id="s1", start=0.0, end=2.5, text="Olá mundo", speaker="SPEAKER_00")],
    )
    container.jobs.save_transcription_text(jid, "Olá mundo")
    container.jobs.save_transcription_vtt(jid, "WEBVTT\n\n00:00.000 --> 00:02.500\nOlá mundo\n")

    avail = container.jobs.get_available_transcription_formats(jid)
    assert avail.segments is True
    assert avail.text is True
    assert avail.vtt is True

    # Delete only text format ("txt" alias) -> status stays WAITING_APPROVAL
    deleted, avail_after_txt = container.jobs.delete_transcription_artifacts(jid, "txt")
    assert deleted is True
    assert avail_after_txt.text is False
    assert avail_after_txt.segments is True
    assert container.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL

    # Delete segments ("segments") -> status resets to DOWNLOADED
    deleted_seg, avail_after_seg = container.jobs.delete_transcription_artifacts(jid, "segments")
    assert deleted_seg is True
    assert avail_after_seg.segments is False
    assert container.jobs.load_job(jid).status == JobStatus.DOWNLOADED


# ---------------------------------------------------------------------------
# 5. API Routes: /health, /config/*, /videos/*, /media/* (HTTP Range 206)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_health_and_config_routes(async_client: httpx.AsyncClient) -> None:
    r_health = await async_client.get("/health")
    assert r_health.status_code == 200
    assert r_health.json() == {"status": "ok"}

    # GET /config summary
    r_cfg = await async_client.get("/config")
    assert r_cfg.status_code == 200
    assert r_cfg.json()["llm"]["model"] == "qwen2.5:14b"

    # GET & POST /config/tool-configs
    r_tc = await async_client.get("/config/tool-configs")
    assert r_tc.status_code == 200
    tc_body = r_tc.json()
    assert tc_body["source"] == "default"
    assert tc_body["defaults"]["whisper"]["model"] == "large-v3-turbo"
    assert tc_body["defaults"]["ffmpeg"]["vertical_mode"] == "auto_reframe"
    assert tc_body["defaults"]["llm"]["model"] == "qwen2.5:14b"

    r_tc_update = await async_client.post(
        "/config/tool-configs",
        json={"ffmpeg": {"vertical_mode": "split_podcast"}},
    )
    assert r_tc_update.status_code == 200
    assert r_tc_update.json()["source"] == "custom"
    assert r_tc_update.json()["active"]["ffmpeg"]["vertical_mode"] == "split_podcast"

    # Invalid reset section -> 400 {"detail": "Invalid section"}
    r_bad_sec = await async_client.post("/config/tool-configs/reset/invalid")
    assert r_bad_sec.status_code == 400
    assert r_bad_sec.json() == {"detail": "Invalid section"}

    # Reset ffmpeg section back to defaults
    r_reset_sec = await async_client.post("/config/tool-configs/reset/ffmpeg")
    assert r_reset_sec.status_code == 200
    assert r_reset_sec.json()["active"]["ffmpeg"]["vertical_mode"] == "auto_reframe"

    # Saved prompts validation & upsert
    r_p_err1 = await async_client.post("/config/llm-saved-prompts", json={})
    assert r_p_err1.status_code == 400
    assert r_p_err1.json() == {"detail": "Nome do prompt é obrigatório."}

    r_p_err2 = await async_client.post("/config/llm-saved-prompts", json={"name": "Teste"})
    assert r_p_err2.status_code == 400
    assert r_p_err2.json() == {"detail": "Prompt não pode estar vazio."}

    r_p_ok = await async_client.post(
        "/config/llm-saved-prompts",
        json={"name": "Meu Prompt", "prompt": "Extraia cortes épicos"},
    )
    assert r_p_ok.status_code == 200
    assert len(r_p_ok.json()["prompts"]) == 1
    assert r_p_ok.json()["prompts"][0]["name"] == "Meu Prompt"

    # GET /config/llm-prompt, /config/llm-prompt/default, /config/llm-saved-prompts
    r_prompt = await async_client.get("/config/llm-prompt")
    assert r_prompt.status_code == 200
    assert "prompt" in r_prompt.json()
    assert r_prompt.json()["version"] == "v3"

    r_prompt_def = await async_client.get("/config/llm-prompt/default")
    assert r_prompt_def.status_code == 200
    assert "SELF-CONTAINED" in r_prompt_def.json()["prompt"]

    r_saved_list = await async_client.get("/config/llm-saved-prompts")
    assert r_saved_list.status_code == 200
    assert len(r_saved_list.json()["prompts"]) == 1

    # GET & POST /config/settings, /config/common-folders, /config/select-folder
    r_get_set = await async_client.get("/config/settings")
    assert r_get_set.status_code == 200
    assert r_get_set.json()["media"]["download_resolution"] == "1080p"

    r_post_set = await async_client.post(
        "/config/settings",
        json={"media": {"download_resolution": "4k"}},
    )
    assert r_post_set.status_code == 200
    assert r_post_set.json()["media"]["download_resolution"] == "4k"

    r_folders = await async_client.get("/config/common-folders")
    assert r_folders.status_code == 200
    assert len(r_folders.json()["folders"]) == 4

    r_pick = await async_client.post("/config/select-folder")
    assert r_pick.status_code == 200
    assert r_pick.json()["selected"] is True

    # tool-configs import & full reset
    r_import = await async_client.post(
        "/config/tool-configs/import",
        json={"llm": {"max_suggested_cuts": 8}},
    )
    assert r_import.status_code == 200
    assert r_import.json()["source"] == "custom"
    assert r_import.json()["active"]["llm"]["max_suggested_cuts"] == 8

    r_reset_all = await async_client.post("/config/tool-configs/reset")
    assert r_reset_all.status_code == 200
    assert r_reset_all.json()["source"] == "default"
    assert r_reset_all.json()["active"]["llm"]["max_suggested_cuts"] == 12


@pytest.mark.asyncio
async def test_llm_models_and_dependencies_routes(async_client: httpx.AsyncClient) -> None:
    # Both /config/llm-models and alias /config/ollama-models work
    for endpoint in ("/config/llm-models", "/config/ollama-models"):
        r = await async_client.get(endpoint)
        assert r.status_code == 200
        data = r.json()
        assert data["online"] is True
        assert data["configuredModel"] == "qwen2.5:14b"
        assert "qwen2.5:14b" in data["models"]

    # Validation errors on register return 400 {"detail": ...}
    r_reg_empty = await async_client.post("/config/llm-models/register", json={})
    assert r_reg_empty.status_code == 400
    assert r_reg_empty.json() == {"detail": "O nome do modelo é obrigatório."}

    r_reg_bad_src = await async_client.post(
        "/config/ollama-models/register",
        json={"name": "gemma3:12b", "source": "invalid"},
    )
    assert r_reg_bad_src.status_code == 400
    assert r_reg_bad_src.json() == {"detail": "A origem do modelo deve ser cloud ou local."}

    r_reg_ok = await async_client.post(
        "/config/llm-models/register",
        json={"name": "gemma3:12b", "source": "local"},
    )
    assert r_reg_ok.status_code == 200
    assert r_reg_ok.json()["success"] is True

    r_del_ok = await async_client.delete("/config/llm-models/gemma3:12b")
    assert r_del_ok.status_code == 200
    assert r_del_ok.json()["removedModel"] == "gemma3:12b"

    # Dependencies routes
    r_deps = await async_client.get("/config/dependencies")
    assert r_deps.status_code == 200
    assert "dependencies" in r_deps.json()

    r_guide_404 = await async_client.get("/config/dependencies/unknown-dep/instructions")
    assert r_guide_404.status_code == 404
    assert r_guide_404.json() == {"error": "Dependency not found"}

    r_pytorch_no_tier = await async_client.post("/config/dependencies/pytorch/install", json={})
    assert r_pytorch_no_tier.status_code == 400
    assert r_pytorch_no_tier.json()["success"] is False

    # Install session start & cancel
    r_start = await async_client.post("/config/dependencies/ffmpeg/install/start", json={})
    assert r_start.status_code == 202
    session_id = r_start.json()["sessionId"]

    r_cancel = await async_client.post(f"/config/dependencies/install-sessions/{session_id}/cancel")
    assert r_cancel.status_code == 200
    assert r_cancel.json()["success"] is True

    r_status = await async_client.get(f"/config/dependencies/install-sessions/{session_id}")
    assert r_status.status_code == 200
    assert r_status.json()["status"] == "cancelled"

    r_term_unknown = await async_client.post(
        "/config/dependencies/not-real/open-terminal",
        json={"mode": "install"},
    )
    assert r_term_unknown.status_code == 400
    assert r_term_unknown.json() == {
        "success": False,
        "message": "No terminal command available for not-real (install)",
    }

    r_term_ok = await async_client.post(
        "/config/dependencies/pytorch/open-terminal",
        json={"mode": "install", "pytorchGpuTier": "rtx_5000"},
    )
    assert r_term_ok.status_code == 200
    assert r_term_ok.json()["success"] is True
    assert "cu128" in r_term_ok.json()["command"]


def test_no_heavy_libraries_imported_at_module_top_level() -> None:
    import subprocess
    import sys

    code = (
        "import app.main, sys; "
        "heavy = [m for m in ('faster_whisper', 'ctranslate2', 'torch', 'cv2', 'mediapipe', 'yt_dlp') if m in sys.modules]; "
        "assert not heavy, f'Heavy libraries imported: {heavy}'"
    )
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


@pytest.mark.asyncio
async def test_videos_library_and_http_range_206_media_streaming(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    # Create synthetic video file (1024 deterministic bytes) in {base_dir}/Episodio_Teste/video.mp4
    video_dir = container.video_dir("job_stream_1", "Episodio_Teste")
    video_dir.mkdir(parents=True, exist_ok=True)
    video_file = video_dir / "video.mp4"
    synthetic_bytes = bytes(i % 256 for i in range(1024))
    video_file.write_bytes(synthetic_bytes)

    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=stream1",
        status=JobStatus.DOWNLOADED,
        job_id="job_stream_1",
        source_video_path=str(video_file),
        source_file_name="video.mp4",
        video_name="Episodio_Teste",
        video_duration_seconds=95.0,
    )

    # Also create a synthetic rendered short
    shorts_dir = container.shorts_dir(job.job_id, "Episodio_Teste")
    short_file = shorts_dir / "cut_01.mp4"
    short_bytes = b"SHORT_HEADER_" + bytes(range(200))
    short_file.write_bytes(short_bytes)

    # 1. GET /videos lists the active video
    r_videos = await async_client.get("/videos")
    assert r_videos.status_code == 200
    videos_list = r_videos.json()
    assert len(videos_list) == 1
    assert videos_list[0]["job_id"] == "job_stream_1"
    assert videos_list[0]["archived"] is False

    # 2. Full GET /media/videos/:job_id -> 200 OK with Accept-Ranges: bytes
    r_full = await async_client.get(f"/media/videos/{job.job_id}")
    assert r_full.status_code == 200
    assert r_full.headers["accept-ranges"] == "bytes"
    assert r_full.headers["content-length"] == "1024"
    assert r_full.content == synthetic_bytes

    # 3. Byte-Range GET /media/videos/:job_id -> 206 Partial Content
    r_range = await async_client.get(
        f"/media/videos/{job.job_id}",
        headers={"Range": "bytes=100-199"},
    )
    assert r_range.status_code == 206
    assert r_range.headers["accept-ranges"] == "bytes"
    assert r_range.headers["content-range"] == "bytes 100-199/1024"
    assert r_range.headers["content-length"] == "100"
    assert r_range.content == synthetic_bytes[100:200]

    # 4. Open-ended Range (bytes=900-) -> 206 Partial Content
    r_open_range = await async_client.get(
        f"/media/videos/{job.job_id}",
        headers={"Range": "bytes=900-"},
    )
    assert r_open_range.status_code == 206
    assert r_open_range.headers["content-range"] == "bytes 900-1023/1024"
    assert r_open_range.content == synthetic_bytes[900:]

    # 5. Out-of-bounds Range -> 416 Range Not Satisfiable
    r_416 = await async_client.get(
        f"/media/videos/{job.job_id}",
        headers={"Range": "bytes=2048-4096"},
    )
    assert r_416.status_code == 416

    # 6. Byte-Range GET /media/shorts/:job_id/:file -> 206 Partial Content
    r_short = await async_client.get(
        f"/media/shorts/{job.job_id}/cut_01.mp4",
        headers={"Range": "bytes=0-12"},
    )
    assert r_short.status_code == 206
    assert r_short.content == b"SHORT_HEADER_"

    # 7. Archive, open-folder, and delete video lifecycle
    r_open = await async_client.post(f"/videos/{job.job_id}/open-folder")
    assert r_open.status_code == 200
    assert r_open.json() == {"ok": True}

    r_arch = await async_client.post(f"/videos/{job.job_id}/archive")
    assert r_arch.status_code == 200
    assert r_arch.json() == {"ok": True, "job_id": job.job_id}

    r_arch_list = await async_client.get("/videos/archived")
    assert r_arch_list.status_code == 200
    assert len(r_arch_list.json()) == 1
    assert r_arch_list.json()[0]["archived"] is True

    r_del = await async_client.delete(f"/videos/{job.job_id}")
    assert r_del.status_code == 200
    assert r_del.json() == {"ok": True, "job_id": job.job_id}
