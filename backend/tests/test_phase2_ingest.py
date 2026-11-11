"""Phase 2 Logical Tests: Native `yt_dlp` ingestion, `ffprobe` duration, chapters, local upload, SSE `/events`, `/rename`, and `/logs` (100% mocked, zero hardware/network)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest

from app.application.runtime_service import ServiceContainer
from app.domain.ingest import (
    FALLBACK_FORMAT_SELECTOR,
    PRIMARY_FORMAT_BY_RESOLUTION,
    set_custom_ytdlp_factory,
)
from app.infrastructure.audio.pcm_extractor import (
    probe_media_duration,
    set_custom_media_prober,
    set_custom_pcm_extractor,
    write_synthetic_pcm16_wav,
)


@pytest.fixture(autouse=True)
def reset_ingest_mocks():
    set_custom_ytdlp_factory(None)
    set_custom_media_prober(None)
    set_custom_pcm_extractor(None)
    yield
    set_custom_ytdlp_factory(None)
    set_custom_media_prober(None)
    set_custom_pcm_extractor(None)


@pytest.mark.asyncio
async def test_create_and_get_job_lifecycle(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    resp = await async_client.post(
        "/jobs",
        json={"youtube_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ"},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert "job" in payload
    job = payload["job"]
    job_id = job["job_id"]
    assert job["youtube_url"] == "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    assert job["status"] == "CREATED"

    # GET /jobs/:id returns Job at top-level
    get_resp = await async_client.get(f"/jobs/{job_id}")
    assert get_resp.status_code == 200
    fetched = get_resp.json()
    assert fetched["job_id"] == job_id
    assert fetched["status"] == "CREATED"

    # Missing job returns 404
    missing_resp = await async_client.get("/jobs/nonexistent_job_id")
    assert missing_resp.status_code == 404
    assert "detail" in missing_resp.json()


@pytest.mark.asyncio
async def test_ingest_youtube_extracts_chapters_duration_and_16k_wav(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    create_resp = await async_client.post(
        "/jobs",
        json={"youtube_url": "https://www.youtube.com/watch?v=test12345"},
    )
    job_id = create_resp.json()["job"]["job_id"]

    recorded_opts: list[dict[str, Any]] = []

    class FakeYoutubeDL:
        def __init__(self, opts: dict[str, Any]) -> None:
            self.opts = opts
            recorded_opts.append(opts)

        def __enter__(self) -> FakeYoutubeDL:
            return self

        def __exit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, Any]:
            assert download is True
            outtmpl = str(self.opts["outtmpl"])
            video_file = Path(outtmpl.replace("%(ext)s", "mp4"))
            video_file.parent.mkdir(parents=True, exist_ok=True)
            video_file.write_bytes(b"\x00\x00\x00\x18ftypmp42synthetic_video_bytes")

            for hook in self.opts.get("progress_hooks", []):
                hook(
                    {
                        "status": "downloading",
                        "downloaded_bytes": 5_000_000,
                        "total_bytes": 10_000_000,
                        "eta": 4,
                    }
                )
                hook({"status": "finished", "filename": str(video_file)})

            return {
                "id": "test12345",
                "title": "Podcast Economia Ep 42",
                "duration": 1840.0,
                "webpage_url": url,
                "chapters": [
                    {"title": "Introdução", "start_time": 0.0, "end_time": 120.5},
                    {"title": "Juros Compostos", "start_time": 120.5, "end_time": 980.0},
                    {"title": "Conclusão", "start_time": 980.0, "end_time": 1842.75},
                ],
            }

    set_custom_ytdlp_factory(FakeYoutubeDL)
    set_custom_media_prober(lambda _path: 1842.75)

    ingest_resp = await async_client.post(f"/jobs/{job_id}/ingest")
    assert ingest_resp.status_code == 200
    body = ingest_resp.json()

    assert body["video_path"] == f"/media/videos/{job_id}"
    assert body["job_id"] == job_id
    assert body["status"] == "DOWNLOADED"
    assert Path(body["full_path"]).exists()
    assert "Podcast Economia Ep 42" in body["full_path"]
    assert Path(body["metadata_path"]).exists()
    assert recorded_opts[0]["format"] == PRIMARY_FORMAT_BY_RESOLUTION["1080p"]

    # Verify job.json updated with video_duration_seconds and video_name
    loaded_job = container.jobs.load_job(job_id)
    assert loaded_job.status == "DOWNLOADED"
    assert loaded_job.video_name == "Podcast Economia Ep 42"
    assert loaded_job.video_duration_seconds == pytest.approx(1842.75)

    # Verify source.info.json persisted with chapters
    source_info = container.jobs.load_source_info(job_id)
    assert source_info is not None
    assert source_info["title"] == "Podcast Economia Ep 42"
    assert len(source_info["chapters"]) == 3
    assert source_info["chapters"][1]["title"] == "Juros Compostos"
    assert source_info["chapters"][1]["start_time"] == pytest.approx(120.5)

    # Verify audio_16k.wav extracted in {video_dir}/transcrições/audio_16k.wav
    wav_path = container.jobs.audio_16k_path(job_id)
    assert wav_path.exists()
    assert wav_path.parent.name == "transcrições"

    # Verify task logs endpoint
    logs_resp = await async_client.get(f"/jobs/{job_id}/logs/ingest")
    assert logs_resp.status_code == 200
    logs_data = logs_resp.json()
    assert logs_data["task"] == "ingest"
    assert any("Downloading" in line or "ready for playback" in line for line in logs_data["logs"])

    # Verify SSE events endpoint replays progress & state events
    sse_resp = await async_client.get(f"/jobs/{job_id}/events")
    assert sse_resp.status_code == 200
    assert "text/event-stream" in sse_resp.headers.get("content-type", "")
    sse_text = sse_resp.text
    assert "event: progress" in sse_text
    assert "event: state" in sse_text
    assert f'"job_id": "{job_id}"' in sse_text


@pytest.mark.asyncio
async def test_ingest_format_fallback_and_real_error_without_dummy_video(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    # 1. Test automatic fallback from 1080p selector to bestvideo+bestaudio/best
    r1 = await async_client.post("/jobs", json={"youtube_url": "https://youtu.be/fallback_vid"})
    job_id_1 = r1.json()["job"]["job_id"]
    attempted_formats: list[str] = []

    class FallbackYoutubeDL:
        def __init__(self, opts: dict[str, Any]) -> None:
            self.opts = opts
            attempted_formats.append(str(opts.get("format")))

        def __enter__(self) -> FallbackYoutubeDL:
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, Any]:
            if self.opts.get("format") != FALLBACK_FORMAT_SELECTOR:
                raise RuntimeError("Requested format is not available")
            outtmpl = str(self.opts["outtmpl"])
            vf = Path(outtmpl.replace("%(ext)s", "mp4"))
            vf.parent.mkdir(parents=True, exist_ok=True)
            vf.write_bytes(b"synthetic_fallback_mp4")
            return {"id": "fallback_vid", "title": "Fallback Video", "duration": 95.2}

    set_custom_ytdlp_factory(FallbackYoutubeDL)
    resp_ok = await async_client.post(f"/jobs/{job_id_1}/ingest")
    assert resp_ok.status_code == 200
    assert attempted_formats == [
        PRIMARY_FORMAT_BY_RESOLUTION["1080p"],
        FALLBACK_FORMAT_SELECTOR,
    ]

    # 2. Test complete failure sets job.status = ERROR and does NOT create dummy video
    r2 = await async_client.post("/jobs", json={"youtube_url": "https://youtu.be/broken_vid"})
    job_id_2 = r2.json()["job"]["job_id"]

    class FailingYoutubeDL:
        def __init__(self, opts: dict[str, Any]) -> None:
            self.opts = opts

        def __enter__(self) -> FailingYoutubeDL:
            return self

        def __exit__(self, *args: Any) -> None:
            pass

        def extract_info(self, url: str, download: bool = True) -> dict[str, Any]:
            raise RuntimeError("Private video unavailable")

    set_custom_ytdlp_factory(FailingYoutubeDL)
    resp_err = await async_client.post(f"/jobs/{job_id_2}/ingest")
    assert resp_err.status_code == 500
    assert "Ingestion failed" in resp_err.json()["detail"]

    failed_job = container.jobs.load_job(job_id_2)
    assert failed_job.status == "ERROR"
    assert container.jobs.find_source_video(job_id_2) is None


@pytest.mark.asyncio
async def test_local_upload_and_rename_post_and_put(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    set_custom_media_prober(lambda _p: 2845.4)

    # Missing file returns 400
    bad_upload = await async_client.post("/jobs/upload")
    assert bad_upload.status_code == 400

    # Valid multipart upload
    files = {"file": ("podcast_episodio_12.mp4", b"fake_mp4_binary_content", "video/mp4")}
    up_resp = await async_client.post("/jobs/upload", files=files)
    assert up_resp.status_code == 200
    up_data = up_resp.json()

    job = up_data["job"]
    job_id = job["job_id"]
    assert up_data["video_path"] == f"/media/videos/{job_id}"
    assert job["status"] == "DOWNLOADED"
    assert job["youtube_url"] == "[Local Upload] podcast_episodio_12.mp4"
    assert job["video_name"] == "podcast_episodio_12"
    assert job["video_duration_seconds"] == pytest.approx(2845.4)
    assert Path(job["source_video_path"]).exists()
    assert container.jobs.audio_16k_path(job_id).exists()

    # Rename via POST /jobs/:id/rename returns Job directly at top-level
    rename_post = await async_client.post(
        f"/jobs/{job_id}/rename",
        json={"new_name": "Entrevista Completa - Economia"},
    )
    assert rename_post.status_code == 200
    renamed_1 = rename_post.json()
    assert renamed_1["job_id"] == job_id
    assert renamed_1["video_name"] == "Entrevista Completa - Economia"
    assert Path(renamed_1["source_video_path"]).exists()
    assert "Entrevista Completa - Economia" in renamed_1["source_video_path"]

    # Rename via PUT /jobs/:id/rename also returns Job directly at top-level
    rename_put = await async_client.put(
        f"/jobs/{job_id}/rename",
        json={"new_name": "Corte Final Podcast"},
    )
    assert rename_put.status_code == 200
    renamed_2 = rename_put.json()
    assert renamed_2["job_id"] == job_id
    assert renamed_2["video_name"] == "Corte Final Podcast"
    assert Path(renamed_2["source_video_path"]).exists()

    # Empty new_name returns 400
    empty_rename = await async_client.post(f"/jobs/{job_id}/rename", json={"new_name": "   "})
    assert empty_rename.status_code == 400
    assert empty_rename.json()["detail"] == "new_name is required"

    # Invalid task log name returns 400
    bad_logs = await async_client.get(f"/jobs/{job_id}/logs/unknown_task")
    assert bad_logs.status_code == 400
    assert bad_logs.json()["detail"] == "Invalid task"


@pytest.mark.asyncio
async def test_pure_python_wav_header_duration_probe(tmp_path: Path) -> None:
    wav_file = tmp_path / "test_tone.wav"
    sr = 16000
    t = np.linspace(0.0, 2.5, int(sr * 2.5), endpoint=False, dtype=np.float32)
    samples = 0.5 * np.sin(2.0 * np.pi * 440.0 * t)
    write_synthetic_pcm16_wav(wav_file, samples, sample_rate=sr)

    dur = await probe_media_duration(wav_file)
    assert dur == pytest.approx(2.5, abs=0.01)
