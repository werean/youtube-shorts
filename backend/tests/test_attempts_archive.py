"""Phase/Feature Tests: Nested Archived Attempts (`data/jobs/<job_id>/attempts/<attempt_id>/`)."""

from __future__ import annotations

import asyncio
from pathlib import Path

import httpx
import pytest

from app.application.runtime_service import ServiceContainer
from app.core.paths import job_dir
from app.models.domain import (
    Cut,
    JobStatus,
    Segment,
    SemanticBlock,
    TopicSegment,
    WordTiming,
)


def _seed_full_job_artifacts(
    container: ServiceContainer,
    *,
    job_id: str = "job_arch_1",
    video_name: str = "Podcast_Teste",
    status: JobStatus = JobStatus.DONE,
) -> dict[str, Path]:
    """Create a synthetic downloaded/analyzed/rendered job entirely in tmp_path."""
    video_dir = container.video_dir(job_id, video_name)
    video_dir.mkdir(parents=True, exist_ok=True)
    source_video = video_dir / "video.mp4"
    source_video.write_bytes(b"FAKE_SOURCE_VIDEO_BYTES")

    container.jobs.create_job(
        "https://www.youtube.com/watch?v=archtest",
        status=status,
        job_id=job_id,
        source_video_path=str(source_video),
        source_file_name="video.mp4",
        video_name=video_name,
        video_duration_seconds=184.5,
    )

    # Audio 16kHz WAV (must survive reset_active=True)
    audio_wav = container.jobs.audio_16k_path(job_id)
    audio_wav.write_bytes(b"RIFF_FAKE_WAV_16K")

    # Transcription artifacts
    container.jobs.save_transcription_segments(
        job_id,
        [
            Segment(segment_id="s1", start=0.0, end=5.0, text="Primeiro segmento.", speaker="SPEAKER_00"),
            Segment(segment_id="s2", start=5.0, end=10.0, text="Segundo segmento.", speaker="SPEAKER_01"),
        ],
    )
    container.jobs.save_transcription_words(
        job_id,
        [
            WordTiming(word="Primeiro", start=0.0, end=0.5, segment_id="s1", speaker="SPEAKER_00"),
            WordTiming(word="segmento.", start=0.5, end=1.2, segment_id="s1", speaker="SPEAKER_00"),
        ],
    )
    container.jobs.save_transcription_text(job_id, "Primeiro segmento.\nSegundo segmento.")
    container.jobs.save_transcription_vtt(
        job_id,
        "WEBVTT\n\n00:00.000 --> 00:05.000\nPrimeiro segmento.\n",
    )

    # Blocks, topics, and cuts
    container.jobs.save_semantic_blocks(
        job_id,
        [SemanticBlock(block_id="b1", start=0.0, end=10.0, text="Primeiro segmento. Segundo segmento.", segment_ids=["s1", "s2"])],
    )
    container.jobs.save_topic_segments(
        job_id,
        [TopicSegment(topic_id="t1", start=0.0, end=10.0, block_ids=["b1"], blockCount=1, durationSeconds=10.0, title="Abertura")],
    )
    container.jobs.save_cuts(
        job_id,
        [
            Cut(cut_id="c1", block_ids=["b1"], start=0.0, end=10.0, title="Corte 1", status="approved", score=9.2),
            Cut(cut_id="c2", block_ids=["b1"], start=2.0, end=8.0, title="Corte 2", status="pending", score=7.1),
        ],
    )

    # Rendered .mp4 shorts
    shorts_dir = container.jobs.shorts_dir_path(job_id, create=True)
    short1 = shorts_dir / "00_00-00_10.mp4"
    short1_bytes = b"SHORT_ATTEMPT_HEADER_" + bytes(i % 256 for i in range(256))
    short1.write_bytes(short1_bytes)

    return {
        "source_video": source_video,
        "audio_wav": audio_wav,
        "short1": short1,
    }


@pytest.mark.asyncio
async def test_archive_rejects_missing_active_and_empty_jobs(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    # 1. Missing job -> 404
    r_missing = await async_client.post("/jobs/does_not_exist/attempts/archive", json={})
    assert r_missing.status_code == 404

    # 2. Empty job (no transcription, no cuts, no renders) -> 400
    container.jobs.create_job(
        "https://www.youtube.com/watch?v=empty1",
        status=JobStatus.DOWNLOADED,
        job_id="job_empty",
    )
    r_empty = await async_client.post("/jobs/job_empty/attempts/archive", json={"label": "Vazio"})
    assert r_empty.status_code == 400

    # 3. Actively processing statuses -> 409
    active_statuses = [
        JobStatus.DOWNLOADING,
        JobStatus.TRANSCRIBING,
        JobStatus.BUILDING_BLOCKS,
        JobStatus.BUILDING_TOPICS,
        JobStatus.ANALYZING,
        JobStatus.RENDERING,
    ]
    for idx, active_status in enumerate(active_statuses):
        jid = f"job_busy_{idx}"
        _seed_full_job_artifacts(container, job_id=jid, video_name=f"Busy_{idx}", status=active_status)
        r_busy = await async_client.post(f"/jobs/{jid}/attempts/archive", json={})
        assert r_busy.status_code == 409, f"Expected 409 for status {active_status.value}"


@pytest.mark.asyncio
async def test_archive_attempt_reset_active_and_detail_lifecycle(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    paths_map = _seed_full_job_artifacts(container, job_id="job_arch_1", video_name="Video_Alpha")

    # Initial videos list has attempts_count=0 and backward-compatible fields
    r_vid_before = await async_client.get("/videos")
    assert r_vid_before.status_code == 200
    v_items_before = r_vid_before.json()
    assert len(v_items_before) == 1
    assert v_items_before[0]["job_id"] == "job_arch_1"
    assert v_items_before[0]["hasTranscription"] is True
    assert v_items_before[0]["hasAnalysis"] is True
    assert v_items_before[0]["attempts_count"] == 0

    # Archive with reset_active=True (default)
    r_arch = await async_client.post(
        "/jobs/job_arch_1/attempts/archive",
        json={"label": "Rodada 1 - Qwen 14B"},
    )
    assert r_arch.status_code == 200
    payload = r_arch.json()
    attempt = payload["attempt"]
    job = payload["job"]
    attempts = payload["attempts"]

    assert attempt["job_id"] == "job_arch_1"
    assert attempt["label"] == "Rodada 1 - Qwen 14B"
    assert attempt["status"] == "DONE"
    assert attempt["video_duration_seconds"] == 184.5
    assert attempt["cuts_count"] == 2
    assert attempt["approved_count"] == 1
    assert attempt["rendered_count"] == 1
    assert attempt["rendered_files"] == ["00_00-00_10.mp4"]
    attempt_id = attempt["attempt_id"]
    expected_url = f"/media/shorts/job_arch_1/attempts/{attempt_id}/00_00-00_10.mp4"
    assert attempt["rendered_urls"] == [expected_url]
    assert attempt["has_transcription"] is True
    assert attempt["created_at"]
    assert attempt["archived_at"]
    assert len(attempts) == 1

    # Active job state reset to DOWNLOADED, active artifacts cleared, audio_16k.wav & source preserved
    assert job["status"] == "DOWNLOADED"
    assert container.jobs.load_job("job_arch_1").status == JobStatus.DOWNLOADED
    assert not container.jobs.semantic_blocks_path("job_arch_1").exists()
    assert not container.jobs.topic_segments_path("job_arch_1").exists()
    assert not container.jobs.cuts_path("job_arch_1").exists()
    assert not container.jobs.has_transcription("job_arch_1")
    assert not container.jobs.transcription_words_path("job_arch_1", for_write=False).exists()
    assert not container.jobs.transcription_text_path("job_arch_1", for_write=False).exists()
    assert not container.jobs.transcription_vtt_path("job_arch_1", for_write=False).exists()
    assert not paths_map["short1"].exists()  # Moved out of active shorts/
    assert paths_map["audio_wav"].exists()   # audio_16k.wav intact!
    assert paths_map["source_video"].exists()  # source video intact!

    # Active renders endpoint now empty
    r_active_renders = await async_client.get("/jobs/job_arch_1/renders")
    assert r_active_renders.status_code == 200
    assert r_active_renders.json() == []

    # Snapshot files exist on disk under data/jobs/<job_id>/attempts/<attempt_id>/
    att_dir = job_dir("job_arch_1") / "attempts" / attempt_id
    assert (att_dir / "attempt.json").exists()
    assert (att_dir / "semantic.blocks.json").exists()
    assert (att_dir / "topic.segments.json").exists()
    assert (att_dir / "cuts.suggested.json").exists()
    assert (att_dir / "transcription" / "transcription.segments.json").exists()
    assert (att_dir / "transcription" / "transcription.words.json").exists()
    assert (att_dir / "transcription" / "transcription.txt").exists()
    assert (att_dir / "transcription" / "transcription.vtt").exists()
    assert (att_dir / "shorts" / "00_00-00_10.mp4").exists()

    # GET /jobs/{job_id}/attempts/{attempt_id}
    r_detail = await async_client.get(f"/jobs/job_arch_1/attempts/{attempt_id}")
    assert r_detail.status_code == 200
    detail = r_detail.json()
    assert detail["attempt"]["attempt_id"] == attempt_id
    assert len(detail["cuts"]) == 2
    assert detail["cuts"][0]["cut_id"] == "c1"
    assert detail["transcription"] is not None
    assert detail["transcription"]["text"] == "Primeiro segmento.\nSegundo segmento."
    assert len(detail["transcription"]["segments"]) == 2
    assert len(detail["transcription"]["words"]) == 2
    assert "WEBVTT" in detail["transcription"]["vtt"]
    assert detail["transcription"]["available_formats"] == {
        "segments": True,
        "text": True,
        "vtt": True,
    }
    assert detail["renders"] == [expected_url]

    # GET /videos reflects attempts_count == 1
    r_vid_after = await async_client.get("/videos")
    assert r_vid_after.status_code == 200
    assert r_vid_after.json()[0]["attempts_count"] == 1
    assert r_vid_after.json()[0]["hasTranscription"] is False
    assert r_vid_after.json()[0]["hasAnalysis"] is False


@pytest.mark.asyncio
async def test_attempts_ordering_non_reset_media_range_and_delete(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    _seed_full_job_artifacts(container, job_id="job_multi", video_name="Multi_Video", status=JobStatus.WAITING_APPROVAL)

    # Attempt 1 with reset_active=False (copies shorts, keeps active files)
    r_a1 = await async_client.post(
        "/jobs/job_multi/attempts/archive",
        json={"reset_active": False},
    )
    assert r_a1.status_code == 200
    att1 = r_a1.json()["attempt"]
    att1_id = att1["attempt_id"]
    assert att1["label"] == "Tentativa 1"
    assert container.jobs.load_job("job_multi").status == JobStatus.WAITING_APPROVAL
    assert container.jobs.has_transcription("job_multi") is True

    # Small delay to guarantee distinct archived_at timestamp
    await asyncio.sleep(0.01)

    # Attempt 2 (resets active, auto-label)
    r_a2 = await async_client.post(
        "/jobs/job_multi/attempts/archive",
        json={"label": "Segunda Rodada", "reset_active": True},
    )
    assert r_a2.status_code == 200
    att2 = r_a2.json()["attempt"]
    att2_id = att2["attempt_id"]

    # GET /jobs/{job_id}/attempts -> newest-first
    r_list = await async_client.get("/jobs/job_multi/attempts")
    assert r_list.status_code == 200
    listed = r_list.json()
    assert [a["attempt_id"] for a in listed] == [att2_id, att1_id]

    # Media streaming with HTTP Range 206 on archived attempt short
    short_url = f"/media/shorts/job_multi/attempts/{att2_id}/00_00-00_10.mp4"
    expected_bytes = b"SHORT_ATTEMPT_HEADER_" + bytes(i % 256 for i in range(256))

    r_full = await async_client.get(short_url)
    assert r_full.status_code == 200
    assert r_full.headers["accept-ranges"] == "bytes"
    assert r_full.content == expected_bytes

    r_range = await async_client.get(short_url, headers={"Range": "bytes=0-20"})
    assert r_range.status_code == 206
    assert r_range.headers["content-range"] == f"bytes 0-20/{len(expected_bytes)}"
    assert r_range.content == expected_bytes[:21]

    r_416 = await async_client.get(short_url, headers={"Range": "bytes=9999-10000"})
    assert r_416.status_code == 416

    r_not_found_file = await async_client.get(f"/media/shorts/job_multi/attempts/{att2_id}/missing.mp4")
    assert r_not_found_file.status_code == 404

    # Path traversal protection
    secret_file = tmp_path / "secret.mp4"
    secret_file.write_bytes(b"TOP_SECRET")
    for bad_url in (
        f"/media/shorts/job_multi/attempts/{att2_id}/..",
        f"/media/shorts/job_multi/attempts/%2e%2e/00_00-00_10.mp4",
        f"/media/shorts/job_multi/attempts/{att2_id}/%2e%2e%2fsecret.mp4",
    ):
        r_bad = await async_client.get(bad_url)
        assert r_bad.status_code in (400, 404)
        assert b"TOP_SECRET" not in r_bad.content

    # Delete attempt 1 atomically
    r_del = await async_client.delete(f"/jobs/job_multi/attempts/{att1_id}")
    assert r_del.status_code == 200
    del_body = r_del.json()
    assert del_body["ok"] is True
    assert del_body["attempt_id"] == att1_id
    assert [a["attempt_id"] for a in del_body["attempts"]] == [att2_id]

    # Detail & delete on removed attempt -> 404
    r_detail_404 = await async_client.get(f"/jobs/job_multi/attempts/{att1_id}")
    assert r_detail_404.status_code == 404
    r_del_404 = await async_client.delete(f"/jobs/job_multi/attempts/{att1_id}")
    assert r_del_404.status_code == 404


@pytest.mark.asyncio
async def test_attempt_detail_without_transcription_returns_none(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    container.jobs.create_job(
        "https://www.youtube.com/watch?v=notrans",
        status=JobStatus.WAITING_APPROVAL,
        job_id="job_no_trans",
    )
    container.jobs.save_cuts(
        "job_no_trans",
        [Cut(cut_id="c1", block_ids=["b1"], start=1.0, end=20.0, status="approved")],
    )

    r_arch = await async_client.post("/jobs/job_no_trans/attempts/archive", json={"label": "Só cortes"})
    assert r_arch.status_code == 200
    att_id = r_arch.json()["attempt"]["attempt_id"]

    r_detail = await async_client.get(f"/jobs/job_no_trans/attempts/{att_id}")
    assert r_detail.status_code == 200
    body = r_detail.json()
    assert body["transcription"] is None
    assert len(body["cuts"]) == 1
    assert body["renders"] == []
