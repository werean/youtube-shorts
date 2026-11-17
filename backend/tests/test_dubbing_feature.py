"""Comprehensive 100% mocked/synthetic test suite for the AI Video Dubbing feature (Wave 2)."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest
from starlette.testclient import TestClient

from app.api.routers import config as config_router
from app.application.runtime_service import ServiceContainer
from app.core import paths, settings
from app.core.paths import (
    dubbing_base_venv_dir,
    dubbing_engine_venv_dir,
    dubbing_hf_cache_dir,
    dubbing_sep_cache_dir,
    dubbing_sherpa_cache_dir,
    dubs_dir_path,
    job_logs_dir,
    whisper_models_dir,
)
from app.domain.dubbing.audio_mixer import _run_command, mix_dubbed_audio
from app.domain.dubbing.manifest_store import (
    load_dubbing_manifest,
    upsert_dubbing_track,
)
from app.domain.dubbing.service import DubbingService
from app.domain.dubbing.translator import repair_unit_segment_subtitles
from app.domain.rendering.rendering_service import build_cut_filename
from app.domain.transcription.service import set_custom_whisper_model_factory
from app.infrastructure.audio.pcm_extractor import write_synthetic_pcm16_wav
from app.infrastructure.dubbing.env_manager import CHATTERBOX_REPO, QWEN3_TTS_REPO
from app.infrastructure.dubbing.storage_manager import (
    ModelInUseError,
    compute_app_storage_usage,
    delete_lmstudio_model,
    scan_lmstudio_models,
)
from app.infrastructure.storage.atomic_store import atomic_write_json, atomic_write_text
from app.main import create_app
from app.models.domain import (
    Cut,
    DubbingManifest,
    DubbingSegmentSubtitle,
    DubbingTrack,
    DubbingUnit,
    JobStatus,
    LmStudioModelStorageItem,
    Segment,
    StorageUsageSummary,
    WordTiming,
)


# ---------------------------------------------------------------------------
# Helpers for Synthetic Fixtures & Mock Runners
# ---------------------------------------------------------------------------


def _write_tone_wav(
    output_path: Path,
    *,
    duration_seconds: float,
    sample_rate: int = 16000,
    freq_hz: float = 220.0,
    amplitude: float = 0.25,
) -> Path:
    n = max(160, int(round(duration_seconds * sample_rate)))
    t = np.arange(n, dtype=np.float32) / float(sample_rate)
    samples = (amplitude * np.sin(2.0 * np.pi * freq_hz * t)).astype(np.float32)
    return write_synthetic_pcm16_wav(output_path, samples, sample_rate=sample_rate, duration_seconds=duration_seconds)


def _seed_downloaded_job(
    container: ServiceContainer,
    tmp_path: Path,
    *,
    video_name: str = "Sample_Video",
    status: JobStatus = JobStatus.DOWNLOADED,
    duration: float = 24.0,
    with_transcription: bool = True,
) -> tuple[str, Path, Path]:
    base_dir = Path(settings.load_settings().media.base_dir)
    vdir = base_dir / video_name
    vdir.mkdir(parents=True, exist_ok=True)
    video_file = vdir / "video.mp4"
    video_file.write_bytes(b"FAKE_MP4_HEADER_" + b"0" * 128)

    job = container.jobs.create_job(
        youtube_url="https://youtube.com/watch?v=dubtest123",
        status=status,
        source_video_path=str(video_file),
        source_file_name="video.mp4",
        video_name=video_name,
        video_duration_seconds=duration,
    )

    if with_transcription:
        tdir = container.transcriptions_dir(job.job_id, video_name, create=True)
        wav_path = tdir / "audio_16k.wav"
        _write_tone_wav(wav_path, duration_seconds=duration, sample_rate=16000, freq_hz=220.0)
        segs = [
            Segment(id=1, segment_id="1", start=0.5, end=5.5, text="Hello everyone, welcome to the show."),
            Segment(id=2, segment_id="2", start=6.0, end=12.0, text="Today we explore local AI video dubbing."),
            Segment(id=3, segment_id="3", start=13.0, end=20.0, text="Everything runs offline on your own GPU."),
        ]
        words = [
            WordTiming(word="Hello", start=0.5, end=1.0),
            WordTiming(word="everyone,", start=1.1, end=1.8),
            WordTiming(word="welcome", start=2.0, end=2.6),
            WordTiming(word="Today", start=6.0, end=6.6),
            WordTiming(word="offline", start=14.0, end=14.8),
        ]
        container.jobs.save_transcription_segments(job.job_id, segs)
        container.jobs.save_transcription_words(job.job_id, words)
        container.jobs.save_transcription_text(job.job_id, "\n".join(s.text for s in segs))
        container.jobs.save_transcription_vtt(
            job.job_id,
            "WEBVTT\n\n00:00:00.500 --> 00:00:05.500\nHello everyone\n",
        )

    return job.job_id, vdir, video_file


def _seed_installed_dubbing_env(engine: str = "qwen3_tts") -> None:
    """Create fake isolated venv markers and model caches so preflight reports ready=True."""
    for venv_dir in (dubbing_base_venv_dir(), dubbing_engine_venv_dir(engine)):
        py = venv_dir / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
        py.parent.mkdir(parents=True, exist_ok=True)
        py.write_bytes(b"FAKE_PYTHON_EXE")

    hf = dubbing_hf_cache_dir(create=True)
    repo = QWEN3_TTS_REPO if engine == "qwen3_tts" else CHATTERBOX_REPO
    snap_dir = hf / "hub" / f"models--{repo.replace('/', '--')}" / "snapshots" / "rev1"
    snap_dir.mkdir(parents=True, exist_ok=True)
    if engine == "qwen3_tts":
        (snap_dir / "config.json").write_text('{"model_type": "tts"}', encoding="utf-8")
        (snap_dir / "model.safetensors").write_bytes(b"QWEN_WEIGHTS")
    else:
        (snap_dir / "ve.pt").write_bytes(b"VE")
        (snap_dir / "t3_mtl23ls_v2.safetensors").write_bytes(b"T3")
        (snap_dir / "s3gen.pt").write_bytes(b"S3")

    sep = dubbing_sep_cache_dir(create=True)
    (sep / "htdemucs_ft.th").write_bytes(b"DEMUCS_CKPT")

    sherpa = dubbing_sherpa_cache_dir(create=True)
    (sherpa / "segmentation.onnx").write_bytes(b"ONNX")
    (sherpa / "embedding.onnx").write_bytes(b"ONNX")


def _install_full_dubbing_mocks(
    container: ServiceContainer,
    *,
    fail_download: bool = False,
    slow_gate: asyncio.Event | None = None,
) -> list[list[str]]:
    """Wire fake command_runner, subprocess_runner, and LLM HTTP fetcher on `container`."""
    commands_seen: list[list[str]] = []

    async def _fake_cmd_runner(cmd: list[str], env: dict[str, str], cancel_token: Any) -> dict[str, Any]:
        commands_seen.append(list(cmd))
        if cancel_token and cancel_token.is_set():
            return {"ok": False, "returncode": 1, "stderr": "cancelled"}
        if fail_download and cmd and Path(cmd[0]).name.startswith("python"):
            return {"ok": False, "returncode": 1, "stderr": "Simulated download failure"}

        # If creating venv / pip install, touch fake python executable so preflight sees it
        if len(cmd) >= 4 and cmd[1:3] == ["-m", "venv"]:
            target_venv = Path(cmd[3])
            py = target_venv / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            py.parent.mkdir(parents=True, exist_ok=True)
            py.write_bytes(b"FAKE_PY")
            return {"ok": True, "returncode": 0}

        # If ffmpeg command, write the output file (last arg)
        if cmd and Path(cmd[0]).name.lower().startswith("ffmpeg"):
            out_path = Path(cmd[-1])
            out_path.parent.mkdir(parents=True, exist_ok=True)
            if out_path.suffix.lower() == ".wav":
                _write_tone_wav(out_path, duration_seconds=2.0, sample_rate=48000, freq_hz=330.0)
            else:
                out_path.write_bytes(b"FAKE_MEDIA_OUTPUT_" + out_path.name.encode("utf-8"))
        return {"ok": True, "returncode": 0}

    async def _fake_subproc_runner(
        command: list[str],
        env: dict[str, str],
        on_line: Any,
        cancel_token: Any,
    ) -> dict[str, Any]:
        commands_seen.append(list(command))
        script_name = Path(command[1]).name if len(command) > 1 else ""

        def _arg_val(flag: str) -> str | None:
            if flag in command:
                idx = command.index(flag)
                if idx + 1 < len(command):
                    return command[idx + 1]
            return None

        if slow_gate is not None and script_name == "worker_demucs.py":
            container.runtime.register_process(
                cancel_token.job_id if cancel_token else "unknown",
                "dubbing",
                998877,
            )
            while not slow_gate.is_set():
                if cancel_token and cancel_token.is_set():
                    return {"returncode": 1, "error": "cancelled"}
                await asyncio.sleep(0.01)

        if script_name == "worker_demucs.py":
            out_dir = Path(_arg_val("--output-dir") or ".")
            out_dir.mkdir(parents=True, exist_ok=True)
            voc_path = out_dir / "vocals.wav"
            novoc_path = out_dir / "no_vocals.wav"
            _write_tone_wav(voc_path, duration_seconds=24.0, sample_rate=48000, freq_hz=260.0)
            _write_tone_wav(novoc_path, duration_seconds=24.0, sample_rate=48000, freq_hz=80.0, amplitude=0.05)
            on_line(json.dumps({"event": "progress", "percent": 100.0, "message": "demucs done"}))
            on_line(json.dumps({"event": "result", "vocals_path": str(voc_path), "no_vocals_path": str(novoc_path)}))
            return {"returncode": 0}

        if script_name == "worker_diarize.py":
            out_json = Path(_arg_val("--output") or "speakers.json")
            turns = [
                {"speaker": "SPEAKER_00", "start": 0.0, "end": 12.5},
                {"speaker": "SPEAKER_01", "start": 12.5, "end": 24.0},
            ]
            atomic_write_json(out_json, {"segments": turns})
            on_line(json.dumps({"event": "progress", "percent": 100.0, "message": "diarize done"}))
            on_line(json.dumps({"event": "result", "speakers_path": str(out_json)}))
            return {"returncode": 0}

        if script_name == "worker_tts.py":
            manifest_file = Path(_arg_val("--manifest") or "manifest.json")
            results_file = Path(_arg_val("--results") or "results.json")
            payload = json.loads(manifest_file.read_text(encoding="utf-8"))
            synthesized: list[dict[str, Any]] = []
            for item in payload.get("units", []):
                if item.get("passthrough_original"):
                    continue
                out_wav = Path(str(item["output_wav_path"]))
                _write_tone_wav(out_wav, duration_seconds=2.5, sample_rate=24000, freq_hz=300.0)
                synthesized.append({"unit_id": item["unit_id"], "wav": str(out_wav)})
            atomic_write_json(results_file, {"units": synthesized})
            on_line(json.dumps({"event": "progress", "percent": 100.0, "message": "tts done"}))
            on_line(json.dumps({"event": "result", "count": len(synthesized)}))
            return {"returncode": 0}

        return {"returncode": 0}

    async def _fake_llm_fetcher(method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        if url.endswith("/v1/models") or url.endswith(":1234/models"):
            return 200, {"data": [{"id": "qwen2.5:14b"}]}
        if url.endswith("/api/tags"):
            return 200, {"models": [{"name": "qwen2.5:14b", "size": 9500000000}]}
        if url.endswith("/api/ps"):
            return 200, {"models": [{"name": "qwen2.5:14b"}]}

        if url.endswith("/chat/completions") or url.endswith("/api/chat"):
            user_content = ""
            if isinstance(body, dict):
                for msg in body.get("messages") or []:
                    if isinstance(msg, dict) and msg.get("role") == "user":
                        user_content = str(msg.get("content") or "")
            # Detect translation JSON request vs condense text request
            if '"units"' in user_content or "units" in user_content:
                # Parse unit_ids from prompt JSON if possible
                translations: list[dict[str, Any]] = []
                try:
                    start_idx = user_content.find("[")
                    end_idx = user_content.rfind("]")
                    if start_idx != -1 and end_idx > start_idx:
                        parsed_units = json.loads(user_content[start_idx : end_idx + 1])
                        for u in parsed_units:
                            uid = u.get("unit_id", "u1")
                            seg_subs = [
                                {
                                    "seg_id": str(sid),
                                    "subtitle_text": f"Legenda traduzida {sid}",
                                }
                                for sid in (u.get("segment_ids") or ["1"])
                            ]
                            translations.append(
                                {
                                    "unit_id": uid,
                                    "dub_text": f"Fala dublada para unidade {uid}.",
                                    "seg_subtitles": seg_subs,
                                }
                            )
                except Exception:
                    translations = [
                        {
                            "unit_id": "u1",
                            "dub_text": "Olá pessoal, bem-vindos.",
                            "seg_subtitles": [{"seg_id": "1", "subtitle_text": "Olá pessoal"}],
                        }
                    ]
                content_str = json.dumps({"translations": translations}, ensure_ascii=False)
                return 200, {
                    "choices": [{"message": {"content": content_str}}],
                    "message": {"content": content_str},
                }

            content_str = json.dumps({"condensed_text": "Texto condensado curto."}, ensure_ascii=False)
            return 200, {
                "choices": [{"message": {"content": content_str}}],
                "message": {"content": content_str},
            }

        return 404, {}

    container.dubbing_command_runner = _fake_cmd_runner
    container.dubbing_subprocess_runner = _fake_subproc_runner
    container.llm_http_fetcher = _fake_llm_fetcher
    return commands_seen


# ---------------------------------------------------------------------------
# 1. Wave 1 Note (#115): Runner Signature Alignment & Fallback
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audio_mixer_runner_handles_1arg_3arg_and_dict_returns(
    tmp_path: Path, container: ServiceContainer
) -> None:
    # 1-arg returning int
    rc, out = await _run_command(["ffmpeg", "-version"], command_runner=lambda cmd: 0)
    assert rc == 0 and out == ""

    # 3-arg async runner matching env_manager signature returning dict
    seen: list[tuple[list[str], bool]] = []

    async def _three_arg_runner(cmd: list[str], env: dict[str, str], cancel_token: Any) -> dict[str, Any]:
        seen.append((cmd, "PATH" in env or isinstance(env, dict)))
        return {"ok": True, "returncode": 0, "stdout": "ok_3arg"}

    rc3, out3 = await _run_command(["ffmpeg", "-version"], command_runner=_three_arg_runner)
    assert rc3 == 0
    assert out3 == "ok_3arg"
    assert len(seen) == 1

    # Service._ffmpeg_runner prefers dedicated ffmpeg_command_runner if present
    container.dubbing_command_runner = _three_arg_runner
    svc = DubbingService(container=container)
    assert svc._ffmpeg_runner() is _three_arg_runner
    custom_ffmpeg = lambda cmd: (0, "custom")  # noqa: E731
    setattr(container, "ffmpeg_command_runner", custom_ffmpeg)
    assert svc._ffmpeg_runner() is custom_ffmpeg

    # End-to-end mix_dubbed_audio works cleanly with 3-arg dict runner
    unit = DubbingUnit(unit_id="u1", speaker="SPEAKER_00", start=0.0, end=2.0, segment_ids=["1"], text="Hi", dub_text="Oi")
    tts_wav = tmp_path / "u1.wav"
    write_synthetic_pcm16_wav(tts_wav, duration_seconds=1.5, sample_rate=24000)

    async def _ffmpeg_dict_runner(cmd: list[str], env: dict[str, str], cancel_token: Any) -> dict[str, Any]:
        Path(cmd[-1]).write_bytes(b"M4A_FAKE")
        return {"ok": True, "returncode": 0}

    out_m4a = tmp_path / "dub.audio.m4a"
    mix_res = await mix_dubbed_audio(
        [unit],
        {"u1": tts_wav},
        out_m4a,
        total_duration=3.0,
        work_dir=tmp_path / "work",
        command_runner=_ffmpeg_dict_runner,
    )
    assert out_m4a.exists()
    assert mix_res.duration_seconds == pytest.approx(3.0)


# ---------------------------------------------------------------------------
# 2. Lifespan Startup Trash Sweep (main.py)
# ---------------------------------------------------------------------------


def test_lifespan_startup_sweeps_trash_directories(tmp_path: Path) -> None:
    base_dir = Path(settings.load_settings().media.base_dir)
    arch_dir = settings.archived_videos_dir(create=True)
    d_dir = paths.data_dir()

    t1 = base_dir / ".trash_old_job_1"
    t2 = arch_dir / ".trash_old_job_2"
    t3 = d_dir / ".trash_old_job_3"
    for td in (t1, t2, t3):
        td.mkdir(parents=True, exist_ok=True)
        (td / "leftover.tmp").write_bytes(b"123")

    with TestClient(create_app()) as client:
        resp = client.get("/health")
        assert resp.status_code == 200

    assert not t1.exists()
    assert not t2.exists()
    assert not t3.exists()


# ---------------------------------------------------------------------------
# 3. Config Settings, Storage Usage & Individual Model Deletion
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_config_dubbing_settings_storage_usage_and_model_deletion(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    # Settings GET/POST round-trip for dubbing section
    r_get = await async_client.get("/config/settings")
    assert r_get.status_code == 200
    assert r_get.json()["dubbing"]["engine"] == "qwen3_tts"

    r_post = await async_client.post(
        "/config/settings",
        json={
            "dubbing": {
                "engine": "chatterbox",
                "default_target_lang": "pt-BR",
                "default_voice_mode": "single",
                "default_subtitles_enabled": False,
                "default_subtitle_preset": "hardsub",
            }
        },
    )
    assert r_post.status_code == 200
    saved_dub = r_post.json()["dubbing"]
    assert saved_dub["engine"] == "chatterbox"
    assert saved_dub["default_target_lang"] == "pt-BR"
    assert saved_dub["default_voice_mode"] == "single"
    assert saved_dub["default_subtitles_enabled"] is False
    assert saved_dub["default_subtitle_preset"] == "hardsub"

    # Seed fake model caches, venvs, and media files
    _seed_installed_dubbing_env("qwen3_tts")
    _seed_installed_dubbing_env("chatterbox")
    wdir = whisper_models_dir(create=True)
    (wdir / "model.bin").write_bytes(b"W" * 500)

    job_id, vdir, _ = _seed_downloaded_job(container, tmp_path, video_name="StorageVid")
    ddir = dubs_dir_path(vdir, create=True) / "pt-BR"
    ddir.mkdir(parents=True, exist_ok=True)
    (ddir / "dub.audio.m4a").write_bytes(b"A" * 200)
    stems = dubs_dir_path(vdir, create=True) / "_stems"
    stems.mkdir(parents=True, exist_ok=True)
    (stems / "vocals.flac").write_bytes(b"V" * 300)

    # Archived attempts under data/jobs/{job_id}/attempts/ are counted in archives_bytes
    att_dir = container.jobs.job_dir_path(job_id) / "attempts" / "att_1" / "shorts"
    att_dir.mkdir(parents=True, exist_ok=True)
    (att_dir / "00_00-00_10.mp4").write_bytes(b"R" * 400)

    # Seed non-Systran HuggingFace whisper cache + backend .venv to verify multi-path sizing
    from app.core.paths import project_root

    alt_whisper = dubbing_hf_cache_dir(create=True) / "hub" / "models--dropbox-dash--faster-whisper-large-v3-turbo"
    alt_whisper.mkdir(parents=True, exist_ok=True)
    (alt_whisper / "model.bin").write_bytes(b"T" * 700)

    fake_backend_venv = project_root() / "backend" / ".venv" / "Lib"
    fake_backend_venv.mkdir(parents=True, exist_ok=True)
    (fake_backend_venv / "pkg.bin").write_bytes(b"B" * 600)

    usage_resp = await async_client.get("/config/storage-usage")
    assert usage_resp.status_code == 200
    usage = usage_resp.json()
    assert usage["dubs_bytes"] >= 200
    assert usage["stems_bytes"] >= 300
    assert usage["archives_bytes"] >= 400
    assert usage["total_models_bytes"] > 0
    assert usage["total_app_bytes"] == usage["total_media_bytes"] + usage["total_models_bytes"]
    model_ids = {m["model_id"]: m for m in usage["models"]}
    assert model_ids["qwen3_tts"]["installed"] is True
    assert model_ids["whisper"]["installed"] is True
    assert model_ids["whisper"]["size_bytes"] >= 1200
    assert len(model_ids["whisper"]["paths"]) >= 2
    assert model_ids["venv_backend"]["installed"] is True
    assert model_ids["venv_backend"]["deletable"] is False
    assert model_ids["venv_backend"]["size_bytes"] >= 600

    # Non-deletable backend venv -> 400
    backend_del = await async_client.delete("/config/models/venv_backend")
    assert backend_del.status_code == 400

    # Unknown model_id -> 400
    bad_del = await async_client.delete("/config/models/nonexistent_model")
    assert bad_del.status_code == 400

    # Active dubbing lock -> 409 Conflict
    tok = container.runtime.create_cancel_token(job_id, "dubbing")
    locked_del = await async_client.delete("/config/models/qwen3_tts")
    assert locked_del.status_code == 409
    container.runtime.clear_cancel_token(job_id, "dubbing")
    assert tok is not None

    # Active transcription lock -> 409 on whisper
    container.runtime.create_cancel_token(job_id, "transcription")
    locked_w = await async_client.delete("/config/models/whisper")
    assert locked_w.status_code == 409
    container.runtime.clear_cancel_token(job_id, "transcription")

    # Individual model delete works cleanly
    ok_del = await async_client.delete("/config/models/qwen3_tts")
    assert ok_del.status_code == 200
    del_data = ok_del.json()
    assert del_data["ok"] is True
    assert del_data["model_id"] == "qwen3_tts"
    assert del_data["freed_bytes"] > 0

    # Deleting venv_base cascades to venv_qwen3 & venv_chatterbox
    base_del = await async_client.delete("/config/models/venv_base")
    assert base_del.status_code == 200
    assert set(base_del.json()["cleared_dependents"]) == {"venv_qwen3", "venv_chatterbox"}


# ---------------------------------------------------------------------------
# 4. Preflight 424 Gate, Full Dubbing Endpoint, Cue Repair, & SSE Isolation
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preflight_424_gate_and_full_dubbing_pipeline_with_sse_isolation(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    job_id, vdir, _ = _seed_downloaded_job(
        container, tmp_path, video_name="DubPipelineVid", status=JobStatus.DONE
    )
    _install_full_dubbing_mocks(container)

    # Preflight shows missing items before install
    pf_resp = await async_client.get(f"/jobs/{job_id}/dub/preflight?engine=qwen3_tts")
    assert pf_resp.status_code == 200
    pf_data = pf_resp.json()
    assert pf_data["ready"] is False
    assert len(pf_data["missing"]) >= 4

    # POST /dub without auto_install returns 424 DUBBING_DEPS_MISSING
    r_424 = await async_client.post(
        f"/jobs/{job_id}/dub",
        json={"target_lang": "pt-BR", "engine": "qwen3_tts", "auto_install": False},
    )
    assert r_424.status_code == 424
    body_424 = r_424.json()
    assert body_424["code"] == "DUBBING_DEPS_MISSING"
    assert body_424["preflight"]["ready"] is False

    # Seed installed env & start dubbing
    _seed_installed_dubbing_env("qwen3_tts")
    r_start = await async_client.post(
        f"/jobs/{job_id}/dub",
        json={"target_lang": "pt-BR", "engine": "qwen3_tts", "voice_mode": "auto"},
    )
    assert r_start.status_code == 200
    assert r_start.json()["started"] is True

    # Wait briefly for background task to complete (100% mocked, finishes in <200ms)
    for _ in range(100):
        m_resp = await async_client.get(f"/jobs/{job_id}/dub")
        m_data = m_resp.json()
        if (m_data.get("tracks") or {}).get("pt-BR", {}).get("status") == "ready":
            break
        await asyncio.sleep(0.02)

    m_resp = await async_client.get(f"/jobs/{job_id}/dub")
    assert m_resp.status_code == 200
    manifest = m_resp.json()
    assert manifest["active_lang"] == "pt-BR"
    track = manifest["tracks"]["pt-BR"]
    assert track["status"] == "ready"
    assert track["audio_url"] == f"/media/dubs/{job_id}/pt-BR/dub.audio.m4a"
    assert track["vtt_url"] == f"/media/dubs/{job_id}/pt-BR/dub.vtt"
    assert track["srt_url"] == f"/media/dubs/{job_id}/pt-BR/dub.srt"

    # Job Shorts status remains DONE (never clobbered by dubbing!)
    job_after = container.jobs.load_job(job_id)
    assert job_after.status == JobStatus.DONE
    assert "pt-BR" in (job_after.dubbed_languages or [])

    # Verify SSE event history contains dubbing_state & task="dubbing" progress events
    history = container.runtime.event_bus.get_history(job_id)
    dub_state_evts = [e for e in history if e.event == "dubbing_state"]
    assert len(dub_state_evts) >= 2
    assert dub_state_evts[-1].data["status"] == "ready"
    assert all(
        e.data.get("task") == "dubbing"
        for e in history
        if e.event == "progress"
    )


def test_proportional_subtitle_cue_repair_when_llm_omits_seg_subtitles() -> None:
    unit = DubbingUnit(
        unit_id="u1",
        speaker="SPEAKER_00",
        start=0.0,
        end=6.0,
        segment_ids=["1", "2"],
        text="First part. Second part.",
        dub_text="Primeira parte traduzida. Segunda parte traduzida.",
    )
    segs = [
        Segment(id=1, segment_id="1", start=0.0, end=2.5, text="First part."),
        Segment(id=2, segment_id="2", start=2.5, end=6.0, text="Second part."),
    ]
    repaired = repair_unit_segment_subtitles(unit, segs, raw_seg_subtitles=[], dub_text=unit.dub_text or "")
    assert len(repaired) == 2
    assert repaired[0].seg_id == "1"
    assert repaired[1].seg_id == "2"
    combined = f"{repaired[0].subtitle_text} {repaired[1].subtitle_text}"
    assert "Primeira" in combined and "Segunda" in combined


# ---------------------------------------------------------------------------
# 5. Parallel Download Failure Resilience (Cached Prep Reused)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_parallel_download_failure_preserves_prep_artifacts_and_emits_error_phase(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    job_id, vdir, _ = _seed_downloaded_job(container, tmp_path, video_name="ResilientVid")
    _install_full_dubbing_mocks(container, fail_download=True)

    # auto_install=True bypasses 424 and runs download + prep in parallel
    r_start = await async_client.post(
        f"/jobs/{job_id}/dub",
        json={"target_lang": "pt-BR", "engine": "qwen3_tts", "auto_install": True},
    )
    assert r_start.status_code == 200

    for _ in range(100):
        m = (await async_client.get(f"/jobs/{job_id}/dub")).json()
        if (m.get("tracks") or {}).get("pt-BR", {}).get("status") == "error":
            break
        await asyncio.sleep(0.02)

    history = container.runtime.event_bus.get_history(job_id)
    err_evts = [e for e in history if e.event == "dubbing_state" and e.data.get("status") == "error"]
    assert len(err_evts) >= 1
    assert err_evts[-1].data.get("error_phase") == "download"

    # Prep artifacts (translation/units) were saved on disk before download error!
    lang_dir = dubs_dir_path(vdir, create=False) / "pt-BR"
    assert (lang_dir / "dubbing.units.json").exists()
    assert (lang_dir / "dub.segments.json").exists()


# ---------------------------------------------------------------------------
# 6. 20s Preview, Preset 1/2 Export, Media Range 206, Send-to-Cuts, & Delete
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preview_export_media_streaming_send_to_cuts_and_delete(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    job_id, vdir, _ = _seed_downloaded_job(container, tmp_path, video_name="ExportVid")
    _seed_installed_dubbing_env("qwen3_tts")
    cmds = _install_full_dubbing_mocks(container)

    # 1. 20s Quick Preview
    p_resp = await async_client.post(
        f"/jobs/{job_id}/dub/preview",
        json={"target_lang": "pt-BR", "start_time": 1.0, "duration": 15.0},
    )
    assert p_resp.status_code == 200
    assert p_resp.json()["preview"] is True

    for _ in range(100):
        m = (await async_client.get(f"/jobs/{job_id}/dub")).json()
        if m.get("preview") and m["preview"].get("status") == "ready":
            break
        await asyncio.sleep(0.02)

    m = (await async_client.get(f"/jobs/{job_id}/dub")).json()
    assert m["preview"] is not None
    assert m["preview"]["audio_url"].endswith("/_preview/preview.audio.m4a")
    assert m["preview"]["vtt_url"].endswith("/_preview/preview.vtt")
    assert "pt-BR" not in (m.get("tracks") or {})  # preview does not pollute full tracks

    # Preview media routes (both semantic and canonical)
    r_prev_aud = await async_client.get(f"/media/dubs/{job_id}/pt-BR/preview-audio")
    assert r_prev_aud.status_code == 200
    r_prev_vtt = await async_client.get(f"/media/dubs/{job_id}/pt-BR/preview.vtt")
    assert r_prev_vtt.status_code == 200
    assert "WEBVTT" in r_prev_vtt.text

    # 2. Run Full Dubbing
    await async_client.post(f"/jobs/{job_id}/dub", json={"target_lang": "pt-BR"})
    for _ in range(100):
        m = (await async_client.get(f"/jobs/{job_id}/dub")).json()
        if (m.get("tracks") or {}).get("pt-BR", {}).get("status") == "ready":
            break
        await asyncio.sleep(0.02)

    # Media audio & subtitle routes + HTTP 206 Range
    r_aud = await async_client.get(
        f"/media/dubs/{job_id}/pt-BR/audio",
        headers={"Range": "bytes=0-7"},
    )
    assert r_aud.status_code == 206
    assert r_aud.headers["content-range"].startswith("bytes 0-7/")
    assert len(r_aud.content) == 8

    assert (await async_client.get(f"/media/dubs/{job_id}/pt-BR/subtitles.vtt")).status_code == 200
    assert (await async_client.get(f"/media/dubs/{job_id}/pt-BR/subtitles.srt")).status_code == 200

    # 3. Export Preset 1 (mov_text)
    exp1 = await async_client.post(
        f"/jobs/{job_id}/dub/pt-BR/export",
        json={"preset": "mov_text", "subtitles_enabled": True},
    )
    assert exp1.status_code == 200
    d1 = exp1.json()
    assert d1["ok"] is True
    assert d1["preset"] == "mov_text"
    assert d1["mp4_url"].endswith(".mp4")
    assert any("mov_text" in cmd for cmd in cmds)

    # Export download=1 + Range 206 via /export.mp4 alias
    r_dl = await async_client.get(f"/media/dubs/{job_id}/pt-BR/export.mp4?download=1")
    assert r_dl.status_code == 200
    assert "attachment" in r_dl.headers.get("content-disposition", "")

    # 4. Export Preset 2 (hardsub)
    cmds.clear()
    exp2 = await async_client.post(
        f"/jobs/{job_id}/dub/pt-BR/export",
        json={"preset": "hardsub", "subtitles_enabled": True},
    )
    assert exp2.status_code == 200
    assert exp2.json()["preset"] == "hardsub"
    assert any("-vf" in cmd and "ass=" in " ".join(cmd) for cmd in cmds)

    # 5. Send-to-Cuts (clean audio-muxed DOWNLOADED job, zero staging leftovers)
    stc = await async_client.post(f"/jobs/{job_id}/dub/pt-BR/send-to-cuts")
    assert stc.status_code == 200
    stc_data = stc.json()
    assert stc_data["ok"] is True
    new_job = stc_data["job"]
    assert new_job["status"] == "DOWNLOADED"
    assert stc_data["video_path"] == f"/media/videos/{new_job['job_id']}"
    assert stc_data["hasTranscription"] is True
    assert container.jobs.has_transcription(new_job["job_id"]) is True
    staging_dir = paths.data_dir() / "tmp_staging"
    assert not staging_dir.exists() or list(staging_dir.iterdir()) == []

    # 6. Delete dub track removes lang dir and cleans _stems
    del_resp = await async_client.delete(f"/jobs/{job_id}/dub/pt-BR")
    assert del_resp.status_code == 200
    assert del_resp.json()["ok"] is True
    assert "pt-BR" not in (del_resp.json()["manifest"].get("tracks") or {})
    assert not (dubs_dir_path(vdir, create=False) / "_stems").exists()


# ---------------------------------------------------------------------------
# 7. Cancel Dubbing & SSE Keep-Alive on DONE Job
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_cancel_dubbing_kills_worker_unloads_lmstudio_and_sse_stays_open(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    job_id, _, _ = _seed_downloaded_job(
        container, tmp_path, video_name="CancelVid", status=JobStatus.DONE
    )
    _seed_installed_dubbing_env("qwen3_tts")
    gate = asyncio.Event()
    _install_full_dubbing_mocks(container, slow_gate=gate)

    # Track LM Studio unload calls
    lms_calls: list[list[str]] = []

    async def _fake_lms_runner(args: list[str], timeout: float = 30.0) -> tuple[int, str, str]:
        lms_calls.append(list(args))
        return 0, "unloaded", ""

    container.lms_command_runner = _fake_lms_runner

    # Cancel when idle -> 404
    r_idle_cancel = await async_client.post(f"/jobs/{job_id}/dub/cancel")
    assert r_idle_cancel.status_code == 404

    # Start slow dubbing
    r_start = await async_client.post(f"/jobs/{job_id}/dub", json={"target_lang": "pt-BR"})
    assert r_start.status_code == 200

    # Wait until worker registers process PID
    for _ in range(100):
        if container.runtime.is_dubbing_active(job_id) and container.runtime._process_pids.get((job_id, "dubbing")):
            break
        await asyncio.sleep(0.01)

    assert container.runtime.is_dubbing_active(job_id) is True

    # Cancel active dubbing
    r_cancel = await async_client.post(f"/jobs/{job_id}/dub/cancel")
    assert r_cancel.status_code == 200
    assert r_cancel.json()["ok"] is True
    assert 998877 in container.runtime.killed_pids
    assert any("unload" in c for c in lms_calls)
    gate.set()

    # Wait for background task cleanup
    for _ in range(50):
        if not container.runtime.is_dubbing_active(job_id):
            break
        await asyncio.sleep(0.01)


@pytest.mark.asyncio
async def test_sse_events_remains_open_when_dubbing_active_on_done_job(
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    job_id, _, _ = _seed_downloaded_job(
        container, tmp_path, video_name="SSEDoneVid", status=JobStatus.DONE
    )
    container.runtime.create_cancel_token(job_id, "dubbing")

    app = create_app()
    transport = httpx.ASGITransport(app=app)

    async def _emit_later() -> None:
        await asyncio.sleep(0.05)
        container.runtime.publish_event(
            job_id,
            "dubbing_state",
            {"job_id": job_id, "lang": "pt-BR", "status": "ready", "percent": 100.0},
        )
        container.runtime.clear_cancel_token(job_id, "dubbing")
        container.runtime.event_bus.close_stream(job_id)

    emitter = asyncio.create_task(_emit_later())
    chunks: list[str] = []
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        async with client.stream("GET", f"/jobs/{job_id}/events?follow=true") as resp:
            assert resp.status_code == 200
            async for line in resp.aiter_lines():
                chunks.append(line)
    await emitter

    joined = "\n".join(chunks)
    assert "event: dubbing_state" in joined
    assert '"status": "ready"' in joined


# ---------------------------------------------------------------------------
# 8. 409 Conflict Locks Across All Endpoints During Active Dubbing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_409_conflict_locks_when_dubbing_is_active(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    job_id, _, _ = _seed_downloaded_job(container, tmp_path, video_name="LockVid")
    container.runtime.create_cancel_token(job_id, "dubbing")

    endpoints_and_methods: list[tuple[str, str, dict[str, Any] | None]] = [
        ("POST", f"/jobs/{job_id}/dub", {"target_lang": "pt-BR"}),
        ("POST", f"/jobs/{job_id}/dub/preview", {"target_lang": "pt-BR"}),
        ("POST", f"/jobs/{job_id}/dub/pt-BR/export", {"preset": "mov_text"}),
        ("POST", f"/jobs/{job_id}/dub/pt-BR/send-to-cuts", None),
        ("DELETE", f"/jobs/{job_id}/dub/pt-BR", None),
        ("POST", f"/jobs/{job_id}/run", {"include_render": False}),
        ("POST", f"/jobs/{job_id}/transcribe", None),
        ("POST", f"/jobs/{job_id}/render", {}),
        ("POST", f"/jobs/{job_id}/analyze", None),
        ("POST", f"/jobs/{job_id}/blocks", None),
        ("POST", f"/jobs/{job_id}/attempts/archive", {}),
        ("POST", f"/jobs/{job_id}/rename", {"new_name": "Renamed"}),
        ("PUT", f"/jobs/{job_id}/rename", {"new_name": "Renamed"}),
        ("POST", f"/videos/{job_id}/archive", None),
        ("DELETE", f"/videos/{job_id}", None),
    ]

    try:
        for method, path, payload in endpoints_and_methods:
            resp = await async_client.request(method, path, json=payload)
            assert resp.status_code == 409, f"Expected 409 for {method} {path}, got {resp.status_code}: {resp.text}"
    finally:
        container.runtime.clear_cancel_token(job_id, "dubbing")


# ---------------------------------------------------------------------------
# 9. Windows PermissionError 3-Retry Tombstone & Hidden Dir Skip
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_delete_video_windows_permission_error_3_retries_returns_409_without_ghost(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    job_id, vdir, _ = _seed_downloaded_job(container, tmp_path, video_name="LockedWinVid")

    # Seed internal dirs in base_dir to verify _collect_video_files ignores them
    base_dir = Path(settings.load_settings().media.base_dir)
    for hidden_name in (".trash_stale", "_stems", "_temp"):
        hd = base_dir / hidden_name
        hd.mkdir(parents=True, exist_ok=True)
        (hd / "video.mp4").write_bytes(b"FAKE")

    list_resp = await async_client.get("/videos")
    assert list_resp.status_code == 200
    listed_names = [item["job"]["video_name"] for item in list_resp.json()]
    assert "LockedWinVid" in listed_names
    assert ".trash_stale" not in listed_names
    assert "_stems" not in listed_names
    assert "_temp" not in listed_names

    # Case A: os.replace raises PermissionError on all 3 attempts -> 409, job.json & logs intact
    replace_attempts = 0
    real_replace = os.replace

    def _always_locked_replace(src: str, dst: str) -> None:
        nonlocal replace_attempts
        if Path(src).resolve() == vdir.resolve():
            replace_attempts += 1
            raise PermissionError(32, "The process cannot access the file because it is being used")
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", _always_locked_replace)
    r_locked = await async_client.delete(f"/videos/{job_id}")
    assert r_locked.status_code == 409
    assert replace_attempts == 3
    # No ghost video: job.json and source folder still exist
    assert container.jobs.load_job(job_id).job_id == job_id
    assert vdir.exists()

    # Case B: fails twice, succeeds on 3rd attempt -> 200 and cleans job_dir + logs_dir
    ldir = job_logs_dir(job_id)
    ldir.mkdir(parents=True, exist_ok=True)
    (ldir / "dubbing.log").write_text("log", encoding="utf-8")

    flaky_attempts = 0

    def _flaky_replace(src: str, dst: str) -> None:
        nonlocal flaky_attempts
        if Path(src).resolve() == vdir.resolve():
            flaky_attempts += 1
            if flaky_attempts < 3:
                raise PermissionError(32, "Locked briefly")
        real_replace(src, dst)

    monkeypatch.setattr(os, "replace", _flaky_replace)
    r_ok = await async_client.delete(f"/videos/{job_id}")
    assert r_ok.status_code == 200
    assert r_ok.json()["ok"] is True
    assert flaky_attempts == 3
    assert not vdir.exists()
    assert not container.jobs.job_dir_path(job_id, create=False).exists()
    assert not ldir.exists()


# ---------------------------------------------------------------------------
# 10. Per-Rendered-Cut Dubbing Pipeline, Auto .mp4 Export, & Range 206 Media
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_per_cut_dubbing_404_424_409_pipeline_export_and_range_streaming(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    # Backward compatibility: DubbingManifest without `cut_dubs` loads cleanly
    legacy_manifest = DubbingManifest.model_validate({"job_id": "legacy-job", "status": "idle", "tracks": {}})
    assert legacy_manifest.cut_dubs == {}

    job_id, vdir, _ = _seed_downloaded_job(
        container, tmp_path, video_name="CutDubVid", status=JobStatus.DONE
    )
    _install_full_dubbing_mocks(container)

    cut_1 = Cut(cut_id="cut-1", start=1.0, end=11.0, title="Hook Inicial", approved=True, status="approved")
    cut_unrendered = Cut(cut_id="cut-2", start=12.0, end=22.0, title="Ainda Não Renderizado", approved=True, status="approved")
    container.jobs.save_cuts(job_id, [cut_1, cut_unrendered])

    # Record parent full-video transcription before cut dubbing to verify zero overwrite
    parent_segs_before = [s.model_dump() for s in container.jobs.load_transcription_segments(job_id)]

    # 1. 404 when cut does not exist or its rendered short .mp4 is missing
    r_missing_cut = await async_client.post(
        f"/jobs/{job_id}/cuts/nonexistent-cut/dub",
        json={"target_lang": "pt-BR"},
    )
    assert r_missing_cut.status_code == 404

    r_unrendered = await async_client.post(
        f"/jobs/{job_id}/cuts/cut-2/dub",
        json={"target_lang": "pt-BR"},
    )
    assert r_unrendered.status_code == 404

    # Render cut-1 short .mp4 on disk
    shorts_dir = container.jobs.shorts_dir_path(job_id, create=True)
    short_file = build_cut_filename(cut_1.start, cut_1.end, cut_1.cut_id)
    (shorts_dir / short_file).write_bytes(b"FAKE_SHORT_MP4_DATA_" + b"X" * 128)

    # 2. 424 DUBBING_DEPS_MISSING when preflight is not ready and auto_install=False
    r_424 = await async_client.post(
        f"/jobs/{job_id}/cuts/cut-1/dub",
        json={"target_lang": "pt-BR", "engine": "qwen3_tts", "auto_install": False},
    )
    assert r_424.status_code == 424
    assert r_424.json()["code"] == "DUBBING_DEPS_MISSING"
    assert r_424.json()["preflight"]["ready"] is False

    # 3. 409 Conflict when dubbing is already active
    container.runtime.create_cancel_token(job_id, "dubbing")
    try:
        r_409 = await async_client.post(
            f"/jobs/{job_id}/cuts/cut-1/dub",
            json={"target_lang": "pt-BR"},
        )
        assert r_409.status_code == 409
    finally:
        container.runtime.clear_cancel_token(job_id, "dubbing")

    # 4. Seed installed dubbing env + mocked WhisperModel for isolated cut transcription
    _seed_installed_dubbing_env("qwen3_tts")

    class _FakeCutWhisperModel:
        def __init__(self, model_name: str, **kwargs: Any) -> None:
            self.model_name = model_name

        def transcribe(self, audio_path: str, **kwargs: Any):
            segs = [
                {
                    "start": 0.2,
                    "end": 4.5,
                    "text": "Short cut opening statement.",
                    "no_speech_prob": 0.01,
                    "avg_logprob": -0.1,
                    "compression_ratio": 1.0,
                },
                {
                    "start": 4.8,
                    "end": 9.4,
                    "text": "And here is the short conclusion.",
                    "no_speech_prob": 0.01,
                    "avg_logprob": -0.1,
                    "compression_ratio": 1.0,
                },
            ]
            return iter(segs), {"duration": 10.0}

    set_custom_whisper_model_factory(_FakeCutWhisperModel)
    try:
        r_start = await async_client.post(
            f"/jobs/{job_id}/cuts/cut-1/dub",
            json={
                "target_lang": "pt-BR",
                "engine": "qwen3_tts",
                "voice_mode": "auto",
                "subtitles_enabled": True,
                "subtitle_preset": "mov_text",
            },
        )
        assert r_start.status_code == 200
        start_payload = r_start.json()
        assert start_payload == {
            "started": True,
            "job_id": job_id,
            "cut_id": "cut-1",
            "lang": "pt-BR",
            "target_lang": "pt-BR",
            "engine": "qwen3_tts",
        }

        for _ in range(120):
            m_resp = await async_client.get(f"/jobs/{job_id}/dub")
            m_data = m_resp.json()
            cut_status = ((m_data.get("cut_dubs") or {}).get("cut-1") or {}).get("pt-BR", {}).get("status")
            if cut_status == "ready":
                break
            await asyncio.sleep(0.02)
    finally:
        set_custom_whisper_model_factory(None)

    # Verify manifest.cut_dubs[cut_id][lang] persisted cleanly without polluting manifest.tracks
    m_final = (await async_client.get(f"/jobs/{job_id}/dub")).json()
    assert m_final.get("tracks") == {}
    cut_track = m_final["cut_dubs"]["cut-1"]["pt-BR"]
    assert cut_track["status"] == "ready"
    assert cut_track["cut_id"] == "cut-1"
    assert cut_track["short_file"] == short_file
    assert cut_track["audio_url"] == f"/media/dubs/{job_id}/_cuts/cut-1/pt-BR/dub.audio.m4a"
    assert cut_track["vtt_url"] == f"/media/dubs/{job_id}/_cuts/cut-1/pt-BR/dub.vtt"
    assert cut_track["srt_url"] == f"/media/dubs/{job_id}/_cuts/cut-1/pt-BR/dub.srt"
    assert cut_track["exported_mp4_url"] == f"/media/dubs/{job_id}/_cuts/cut-1/pt-BR/short.pt-BR.dub.mp4"
    assert Path(cut_track["exported_mp4_path"]).exists()

    # Verify isolated .prep transcription & _stems, and parent transcription untouched
    cut_dir = dubs_dir_path(vdir, create=False) / "_cuts" / "cut-1"
    assert (cut_dir / ".prep" / "audio_16k.wav").exists()
    assert (cut_dir / ".prep" / "transcription.segments.json").exists()
    assert (cut_dir / ".prep" / "transcription.words.json").exists()
    assert (cut_dir / "_stems" / "speakers.json").exists()
    parent_segs_after = [s.model_dump() for s in container.jobs.load_transcription_segments(job_id)]
    assert parent_segs_after == parent_segs_before

    # Verify SSE dubbing_state events include cut_id & cut_title
    history = container.runtime.event_bus.get_history(job_id)
    cut_evts = [e for e in history if e.event == "dubbing_state" and e.data.get("cut_id") == "cut-1"]
    assert len(cut_evts) >= 2
    assert cut_evts[-1].data["status"] == "ready"
    assert cut_evts[-1].data["cut_title"] == "Hook Inicial"
    assert cut_evts[-1].data["cut_track"]["exported_mp4_url"] == cut_track["exported_mp4_url"]

    # Verify HTTP Range 206 + ?download=1 streaming for exported dubbed short .mp4 & artifacts
    mp4_url = f"/media/dubs/{job_id}/_cuts/cut-1/pt-BR/short.pt-BR.dub.mp4"
    r_range = await async_client.get(mp4_url, headers={"Range": "bytes=0-7"})
    assert r_range.status_code == 206
    assert r_range.headers["content-range"].startswith("bytes 0-7/")
    assert len(r_range.content) == 8

    r_dl = await async_client.get(f"{mp4_url}?download=1")
    assert r_dl.status_code == 200
    assert "attachment" in r_dl.headers.get("content-disposition", "")
    assert "short.pt-BR.dub.mp4" in r_dl.headers.get("content-disposition", "")

    assert (await async_client.get(f"/media/dubs/{job_id}/_cuts/cut-1/pt-BR/dub.audio.m4a")).status_code == 200
    r_vtt = await async_client.get(f"/media/dubs/{job_id}/_cuts/cut-1/pt-BR/dub.vtt")
    assert r_vtt.status_code == 200
    assert "WEBVTT" in r_vtt.text
    assert (await async_client.get(f"/media/dubs/{job_id}/_cuts/cut-1/pt-BR/dub.srt")).status_code == 200


# ---------------------------------------------------------------------------
# 11. LM Studio Storage Separation, Bundled Guard & Safe Model Deletion
# ---------------------------------------------------------------------------


def _seed_fake_lmstudio_root(
    tmp_path: Path,
) -> tuple[Path, Path, Path, Path, Any]:
    """Create an isolated fake LM Studio root in `tmp_path` with user + bundled models."""
    lm_root = tmp_path / "fake_lmstudio"
    lm_root.mkdir(parents=True, exist_ok=True)

    downloads_folder = tmp_path / "custom_lm_downloads"
    user_model_dir = downloads_folder / "google" / "gemma-4-e4b"
    user_model_dir.mkdir(parents=True, exist_ok=True)
    (user_model_dir / "gemma-4-e4b-Q4_K_M.gguf").write_bytes(b"G" * 1500)

    internal_dir = lm_root / ".internal"
    bundled_model_dir = internal_dir / "bundled-models" / "nomic-ai" / "nomic-embed-text-v1.5"
    bundled_model_dir.mkdir(parents=True, exist_ok=True)
    (bundled_model_dir / "nomic-embed-text-v1.5.gguf").write_bytes(b"N" * 800)

    (lm_root / "settings.json").write_text(
        json.dumps({"downloadsFolder": str(downloads_folder)}),
        encoding="utf-8",
    )
    (internal_dir / "model-index-cache.json").write_text(
        json.dumps(
            {
                "models": [
                    {
                        "indexedModelIdentifier": "google/gemma-4-e4b",
                        "containingDirSubpath": "google/gemma-4-e4b",
                        "sourceDirectoryType": "downloads",
                        "concreteModelDirAbsolutePath": str(user_model_dir),
                        "containingDirAbsolutePath": str(user_model_dir),
                    },
                    {
                        "indexedModelIdentifier": "nomic-ai/nomic-embed-text-v1.5",
                        "containingDirSubpath": "nomic-ai/nomic-embed-text-v1.5",
                        "sourceDirectoryType": "bundled",
                        "concreteModelDirAbsolutePath": str(bundled_model_dir),
                        "containingDirAbsolutePath": str(bundled_model_dir),
                    },
                ]
            }
        ),
        encoding="utf-8",
    )

    def _fake_lms_list_runner() -> list[dict[str, Any]]:
        return [
            {
                "modelKey": "google/gemma-4-e4b",
                "displayName": "Gemma 4 E4B",
                "type": "llm",
                "quantization": {"name": "Q4_K_M"},
                "sizeBytes": 1500,
                "path": "google/gemma-4-e4b/gemma-4-e4b-Q4_K_M.gguf",
            },
            {
                "modelKey": "nomic-ai/nomic-embed-text-v1.5",
                "displayName": "Nomic Embed Text v1.5",
                "type": "embedding",
                "quantization": "F16",
                "sizeBytes": 800,
                "path": "nomic-ai/nomic-embed-text-v1.5/nomic-embed-text-v1.5.gguf",
            },
        ]

    return lm_root, downloads_folder, user_model_dir, bundled_model_dir, _fake_lms_list_runner


def test_compute_app_storage_usage_separates_lmstudio_models_and_flags_bundled(
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    lm_root, _downloads_folder, _user_dir, _bundled_dir, fake_lms = _seed_fake_lmstudio_root(tmp_path)

    # Seed app-owned media & whisper model so total_app_bytes > 0
    _seed_downloaded_job(container, tmp_path, video_name="AppUsageVid", with_transcription=False)
    wdir = whisper_models_dir(create=True)
    (wdir / "model.bin").write_bytes(b"W" * 500)

    scanned_items, scanned_total = scan_lmstudio_models(
        lmstudio_root=lm_root,
        lms_list_runner=fake_lms,
    )
    assert scanned_total == 2300
    assert len(scanned_items) == 2

    summary = compute_app_storage_usage(
        lmstudio_root=lm_root,
        lms_list_runner=fake_lms,
    )
    assert isinstance(summary, StorageUsageSummary)
    assert summary.total_app_bytes > 0
    assert summary.total_app_bytes == summary.total_media_bytes + summary.total_models_bytes
    assert summary.lmstudio_models_bytes == 2300
    assert summary.total_with_lmstudio_bytes == summary.total_app_bytes + summary.lmstudio_models_bytes

    by_key = {item.model_key: item for item in summary.lmstudio_models}
    assert set(by_key.keys()) == {"google/gemma-4-e4b", "nomic-ai/nomic-embed-text-v1.5"}

    user_item = by_key["google/gemma-4-e4b"]
    assert isinstance(user_item, LmStudioModelStorageItem)
    assert user_item.bundled is False
    assert user_item.deletable is True
    assert user_item.size_bytes == 1500
    assert user_item.quantization == "Q4_K_M"

    bundled_item = by_key["nomic-ai/nomic-embed-text-v1.5"]
    assert isinstance(bundled_item, LmStudioModelStorageItem)
    assert bundled_item.bundled is True
    assert bundled_item.deletable is False
    assert bundled_item.size_bytes == 800
    assert bundled_item.model_type == "embedding"


def test_delete_lmstudio_model_guards_bundled_active_tasks_and_prunes_empty_publisher(
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    lm_root, downloads_folder, user_dir, bundled_dir, fake_lms = _seed_fake_lmstudio_root(tmp_path)
    job_id, _, _ = _seed_downloaded_job(container, tmp_path, video_name="LmsDeleteVid", with_transcription=False)

    # 1. Bundled model is rejected with ValueError and .internal/ remains untouched
    with pytest.raises(ValueError, match="embutido"):
        delete_lmstudio_model(
            "nomic-ai/nomic-embed-text-v1.5",
            lmstudio_root=lm_root,
            lms_list_runner=fake_lms,
            container=container,
        )
    assert bundled_dir.exists()
    assert (lm_root / ".internal" / "model-index-cache.json").exists()

    # 2. Unknown model is rejected with ValueError
    with pytest.raises(ValueError, match="não encontrado"):
        delete_lmstudio_model(
            "unknown/nonexistent-model",
            lmstudio_root=lm_root,
            lms_list_runner=fake_lms,
            container=container,
        )

    # 3. Active analysis task -> ModelInUseError
    container.runtime.create_cancel_token(job_id, "analysis")
    try:
        with pytest.raises(ModelInUseError) as exc_analysis:
            delete_lmstudio_model(
                "google/gemma-4-e4b",
                lmstudio_root=lm_root,
                lms_list_runner=fake_lms,
                container=container,
            )
        assert "analysis" in exc_analysis.value.active_tasks
        assert user_dir.exists()
    finally:
        container.runtime.clear_cancel_token(job_id, "analysis")

    # 4. Active dubbing task -> ModelInUseError
    container.runtime.create_cancel_token(job_id, "dubbing")
    try:
        with pytest.raises(ModelInUseError) as exc_dubbing:
            delete_lmstudio_model(
                "google/gemma-4-e4b",
                lmstudio_root=lm_root,
                lms_list_runner=fake_lms,
                container=container,
            )
        assert "dubbing" in exc_dubbing.value.active_tasks
        assert user_dir.exists()
    finally:
        container.runtime.clear_cancel_token(job_id, "dubbing")

    # 5. Idle deletion removes user model dir and prunes empty publisher folder without touching .internal/
    result = delete_lmstudio_model(
        "google/gemma-4-e4b",
        lmstudio_root=lm_root,
        lms_list_runner=fake_lms,
        container=container,
    )
    assert result["ok"] is True
    assert result["model_key"] == "google/gemma-4-e4b"
    assert result["freed_bytes"] == 1500
    assert str(user_dir) in result["deleted_paths"]
    assert not user_dir.exists()
    assert not (downloads_folder / "google").exists()
    assert downloads_folder.exists()
    assert bundled_dir.exists()
    assert (lm_root / ".internal" / "model-index-cache.json").exists()


def test_delete_lmstudio_model_http_route_returns_400_409_and_200(
    container: ServiceContainer,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    lm_root, downloads_folder, user_dir, bundled_dir, fake_lms = _seed_fake_lmstudio_root(tmp_path)
    job_id, _, _ = _seed_downloaded_job(container, tmp_path, video_name="LmsRouteVid", with_transcription=False)

    def _delegating_delete(model_key: str, *, container: ServiceContainer | None = None, **kwargs: Any) -> dict[str, Any]:
        return delete_lmstudio_model(
            model_key,
            lmstudio_root=lm_root,
            lms_list_runner=fake_lms,
            container=container,
        )

    monkeypatch.setattr(config_router, "delete_lmstudio_model", _delegating_delete)

    with TestClient(create_app()) as client:
        # 400 ValueError for bundled model
        resp_400 = client.delete("/config/lmstudio-models", params={"model_key": "nomic-ai/nomic-embed-text-v1.5"})
        assert resp_400.status_code == 400
        assert "embutido" in resp_400.json()["detail"]

        # 409 ModelInUseError when analysis task is active
        container.runtime.create_cancel_token(job_id, "analysis")
        try:
            resp_409 = client.delete("/config/lmstudio-models", params={"model_key": "google/gemma-4-e4b"})
            assert resp_409.status_code == 409
            assert "em uso" in resp_409.json()["detail"]
        finally:
            container.runtime.clear_cancel_token(job_id, "analysis")

        # 200 OK deletes user model safely
        resp_200 = client.delete("/config/lmstudio-models", params={"model_key": "google/gemma-4-e4b"})
        assert resp_200.status_code == 200
        payload = resp_200.json()
        assert payload["ok"] is True
        assert payload["model_key"] == "google/gemma-4-e4b"
        assert payload["freed_bytes"] == 1500
        assert not user_dir.exists()
        assert not (downloads_folder / "google").exists()
        assert bundled_dir.exists()


# ---------------------------------------------------------------------------
# 12. Storage Usage Filters Out Missing / 0-Byte Models & Venvs
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_compute_app_storage_usage_omits_missing_models_and_venvs(
    async_client: httpx.AsyncClient,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.infrastructure.dubbing import storage_manager

    fake_repo = tmp_path / "isolated_repo"
    fake_repo.mkdir(parents=True, exist_ok=True)
    empty_legacy_hf = tmp_path / "empty_legacy_hf"
    empty_lm_root = tmp_path / "empty_lmstudio"

    monkeypatch.setattr(
        storage_manager,
        "_legacy_cache_roots",
        lambda legacy_hf_hub_dir=None: (empty_legacy_hf, None, None),
    )

    paths.set_project_root_override(fake_repo)
    try:
        # Empty directory (0 bytes) must also be omitted so no 0 B cards appear
        dubbing_sep_cache_dir(create=True)

        empty_summary = compute_app_storage_usage(
            legacy_hf_hub_dir=empty_legacy_hf,
            lmstudio_root=empty_lm_root,
            lms_list_runner=lambda: [],
        )
        assert empty_summary.models == []
        assert empty_summary.total_models_bytes == 0

        # Seed ONLY whisper and venv_backend on disk
        wdir = whisper_models_dir(create=True)
        (wdir / "model.bin").write_bytes(b"W" * 500)

        fake_backend_venv = fake_repo / "backend" / ".venv" / "Lib"
        fake_backend_venv.mkdir(parents=True, exist_ok=True)
        (fake_backend_venv / "pkg.bin").write_bytes(b"B" * 600)

        summary = compute_app_storage_usage(
            legacy_hf_hub_dir=empty_legacy_hf,
            lmstudio_root=empty_lm_root,
            lms_list_runner=lambda: [],
        )
        assert [m.model_id for m in summary.models] == ["whisper", "venv_backend"]
        assert summary.total_models_bytes == 1100
        for item in summary.models:
            assert item.installed is True
            assert item.size_bytes > 0
            assert len(item.paths) > 0

        omitted_ids = {
            "qwen3_tts",
            "chatterbox",
            "demucs",
            "sherpa_onnx",
            "venv_base",
            "venv_qwen3",
            "venv_chatterbox",
        }
        assert omitted_ids.isdisjoint({m.model_id for m in summary.models})

        # HTTP endpoint /config/storage-usage exposes the exact same filtered list
        resp = await async_client.get("/config/storage-usage")
        assert resp.status_code == 200
        payload = resp.json()
        assert [m["model_id"] for m in payload["models"]] == ["whisper", "venv_backend"]
        assert payload["total_models_bytes"] == 1100
        assert all(m["installed"] is True and m["size_bytes"] > 0 for m in payload["models"])
    finally:
        paths.set_project_root_override(None)

