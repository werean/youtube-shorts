"""Tests proving code review findings and validating architectural contract fixes."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from app.application.runtime_service import ServiceContainer
from app.domain.analysis.narrative_miner import analyze_job, approve_cut, reject_cut
from app.models.domain import JobStatus, Cut, NarrativeArc


@pytest.mark.asyncio
async def test_code_review_cut_narrative_arc_and_contract_fields(
    container: ServiceContainer,
    async_client: httpx.AsyncClient,
) -> None:
    """Issue 1: Cut objects must have id, duration, approved, rejected, reasoning, and narrative_arc."""
    c = container
    job = c.jobs.create_job("https://www.youtube.com/watch?v=review_cut_test")
    job_id = job.job_id

    # Create dummy video & audio files so prerequisites pass
    vdir = c.jobs.video_dir_path(job_id)
    vdir.mkdir(parents=True, exist_ok=True)
    (vdir / "video.mp4").write_bytes(b"dummy")
    tdir = c.jobs.transcriptions_dir_path(job_id)
    tdir.mkdir(parents=True, exist_ok=True)
    (tdir / "audio_16k.wav").write_bytes(b"RIFFdummyWAVEfmt ")
    (tdir / "transcription.segments.json").write_text(
        '[{"id": 0, "seek": 0, "start": 0.0, "end": 10.0, "text": "Primeiro segmento teste", "tokens": [], "temperature": 0.0, "avg_logprob": -0.1, "compression_ratio": 1.0, "no_speech_prob": 0.0}]',
        encoding="utf-8",
    )
    c.jobs.update_job(job_id, {"video_duration_seconds": 60.0})
    c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)

    # Run analysis with mock LLM using block b1
    mock_llm_response = {
        "cuts": [
            {
                "title": "Corte de Alta Conversao",
                "start_block_id": "b1",
                "end_block_id": "b1",
                "score": 9.5,
                "hook": "Voce sabia disso?",
                "development": "Aqui explicamos o conteudo em detalhes",
                "climax": "Este e o momento chave da revelacao",
                "resolution": "Portanto essa e a conclusao definitiva",
                "reasoning": "Otimo gancho e conclusao natural",
            }
        ]
    }

    with patch("app.infrastructure.llm.unified_adapter.UnifiedLocalLLMAdapter.chat_json", return_value=(mock_llm_response, "{}")):
        res = await analyze_job(job_id, container=c)
        cuts = c.jobs.load_cuts(job_id)

    assert len(cuts) >= 1
    cut = cuts[0]

    # Verify contracts compatibility
    assert hasattr(cut, "narrative_arc") and cut.narrative_arc is not None, "Cut must have narrative_arc"
    assert cut.narrative_arc.hook == "Voce sabia disso?", "narrative_arc.hook must be populated"
    assert cut.narrative_arc.development == "Aqui explicamos o conteudo em detalhes", "narrative_arc.development must be populated"
    assert cut.narrative_arc.climax == "Este e o momento chave da revelacao", "narrative_arc.climax must be populated"
    assert cut.narrative_arc.resolution == "Portanto essa e a conclusao definitiva", "narrative_arc.resolution must be populated"
    assert cut.id == cut.cut_id, "Cut must have id alias matching cut_id"
    assert cut.duration is not None and cut.duration > 0, "Cut must have duration"
    assert cut.approved is False, "Initial approved flag must be False"
    assert cut.rejected is False, "Initial rejected flag must be False"

    # Test approve_cut
    approved = approve_cut(job_id, cut.cut_id, container=c)
    assert approved.status == "approved"
    assert approved.approved is True, "approve_cut must set approved = True"
    assert approved.rejected is False

    # Test reject_cut
    rejected = reject_cut(job_id, cut.cut_id, container=c)
    assert rejected.status == "rejected"
    assert rejected.rejected is True, "reject_cut must set rejected = True"
    assert rejected.approved is False


@pytest.mark.asyncio
async def test_code_review_sse_stream_stays_open_and_receives_events(
    container: ServiceContainer,
    async_client: httpx.AsyncClient,
) -> None:
    """Issue 2: SSE stream must accurately deliver state and progress events without premature disconnect."""
    c = container
    job = c.jobs.create_job("https://www.youtube.com/watch?v=review_sse_test")
    job_id = job.job_id
    c.jobs.update_job_status(job_id, JobStatus.BUILDING_BLOCKS)

    # 1. Test live subscriber receiving published events
    async with c.runtime.event_bus.subscribe(job_id) as queue:
        c.runtime.publish_event(job_id, "custom_progress", {"percent": 55.0, "message": "Still alive"})
        evt = await asyncio.wait_for(queue.get(), timeout=1.0)
        assert evt is not None
        assert evt.event == "custom_progress"
        assert evt.data["percent"] == 55.0

    # 2. Test endpoint replays both initial state and published events
    resp = await async_client.get(f"/jobs/{job_id}/events")
    assert resp.status_code == 200
    assert "text/event-stream" in resp.headers.get("content-type", "")
    assert "event: state" in resp.text
    assert "BUILDING_BLOCKS" in resp.text
    assert "event: custom_progress" in resp.text
    assert "Still alive" in resp.text


@pytest.mark.asyncio
async def test_code_review_run_endpoint_accepts_empty_body(
    container: ServiceContainer,
    async_client: httpx.AsyncClient,
) -> None:
    """Issue 3: POST /jobs/{id}/run must accept empty body without 422 error."""
    c = container
    job = c.jobs.create_job("https://www.youtube.com/watch?v=review_empty_body_test")
    job_id = job.job_id
    c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)

    # Mock domain functions to avoid heavy work
    with patch("app.application.orchestrator.ingest_video", return_value={}), \
         patch("app.application.orchestrator.transcribe_job", return_value={}), \
         patch("app.application.orchestrator.build_semantic_blocks", return_value=[]), \
         patch("app.application.orchestrator.build_topic_segments", return_value=[]), \
         patch("app.application.orchestrator.analyze_job", return_value=[]):

        # Call with empty bytes body
        resp = await async_client.post(f"/jobs/{job_id}/run", content=b"")
        assert resp.status_code != 422, f"POST /jobs/{job_id}/run should not fail with 422 on empty body: {resp.text}"


def test_code_review_video_file_collector_detects_non_video_prefix_files(
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    """Issue 4: Videos named interview.mp4, podcast.webm must be collected even if not named video.*."""
    from app.api.routers.videos import _collect_video_files

    root_dir = tmp_path / "uploads"
    folder_a = root_dir / "PodcastEpisode1"
    folder_a.mkdir(parents=True, exist_ok=True)
    (folder_a / "podcast_ep1.mp4").write_bytes(b"dummy")

    folder_b = root_dir / "StandardVideo"
    folder_b.mkdir(parents=True, exist_ok=True)
    (folder_b / "video.mp4").write_bytes(b"dummy")

    files = _collect_video_files(root_dir, archived=False)
    collected_names = [f["video_name"] for f in files]

    assert "PodcastEpisode1" in collected_names, "Video folder with non-'video.*' filename must be detected"
    assert "StandardVideo" in collected_names
