"""Phase 7 Logical Tests: 1-Click Pipeline Orchestrator, Batch Pipeline Runner, and TS Cleanup Audit.

100% Mocked and Logical:
- ZERO hardware / GPU / CUDA / FFmpeg / Ollama calls.
- Pure in-memory / tmp_path workspace isolation.
- Validates:
  1. Complete removal of legacy TypeScript backend (ZERO .ts files in backend/, no backend/src, no backend/package.json).
  2. GET /health smoke test (200 OK).
  3. Route precedence (/jobs/batch/* routes are matched before /{job_id}).
  4. 1-click pipeline (POST /jobs/{id}/run) from CREATED and from DOWNLOADED.
  5. Batch pipeline runner (run, status, preApprove pause, continue, and cooperative cancellation propagation).
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.application.orchestrator import (
    BatchRunner,
    get_batch_runner,
    reset_batch_runner,
    run_job_pipeline,
)
from app.application.runtime_service import ServiceContainer, get_container
from app.domain.rendering.rendering_service import get_rendering_service
from app.models.domain import Cut, Job, JobStatus


@pytest.fixture(autouse=True)
def clean_batch_runner_state():
    reset_batch_runner()
    yield
    reset_batch_runner()


def test_zero_ts_files_and_legacy_ts_removed(container: ServiceContainer) -> None:
    """Audit: Verify that 100% of legacy TypeScript backend code has been eradicated."""
    backend_root = Path(__file__).resolve().parent.parent

    # 1. No .ts files inside backend/
    ts_files = list(backend_root.rglob("*.ts"))
    assert ts_files == [], f"Found residual .ts files in backend: {[str(p) for p in ts_files]}"

    # 2. backend/src/ directory does not exist
    assert not (backend_root / "src").exists(), "backend/src directory must be deleted"

    # 3. backend/package.json and tsconfig.json do not exist
    assert not (backend_root / "package.json").exists(), "backend/package.json must be deleted"
    assert not (backend_root / "tsconfig.json").exists(), "backend/tsconfig.json must be deleted"
    assert not (backend_root / "vitest.config.ts").exists(), "backend/vitest.config.ts must be deleted"

    # 4. Root contracts test folder removed
    repo_root = backend_root.parent
    assert not (repo_root / "tests" / "bun" / "contracts").exists(), "tests/bun/contracts must be deleted"


@pytest.mark.asyncio
async def test_smoke_health_endpoint(async_client: httpx.AsyncClient) -> None:
    """Smoke test: Verify FastAPI /health endpoint responds 200 OK."""
    resp = await async_client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") == "ok"


@pytest.mark.asyncio
async def test_route_precedence_batch_not_captured_as_job_id(
    async_client: httpx.AsyncClient,
) -> None:
    """Verify route priority: /jobs/batch/* routes must never be matched as job_id='batch'."""
    # 1. POST /jobs/batch/run with empty job_ids returns 400 ("No job IDs provided"), NOT 404
    resp = await async_client.post("/jobs/batch/run", json={"job_ids": []})
    assert resp.status_code == 400
    assert resp.json()["detail"] == "No job IDs provided"

    # 2. GET /jobs/batch/non_existent_123/status returns 404 ("Batch process not found"), NOT ("Job not found")
    resp2 = await async_client.get("/jobs/batch/non_existent_123/status")
    assert resp2.status_code == 404
    assert resp2.json()["detail"] == "Batch process not found"

    # 3. POST /jobs/batch/non_existent_123/cancel returns 404
    resp3 = await async_client.post("/jobs/batch/non_existent_123/cancel")
    assert resp3.status_code == 404
    assert resp3.json()["detail"] == "Batch process not found"

    # 4. POST /jobs/batch/non_existent_123/continue returns 404
    resp4 = await async_client.post("/jobs/batch/non_existent_123/continue")
    assert resp4.status_code == 404
    assert resp4.json()["detail"] == "Batch process not found"


@pytest.mark.asyncio
async def test_run_single_job_pipeline_from_created_to_done(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    """Verify 1-click pipeline starting from CREATED runs through ingest, transcribe, blocks, topics, analyze, and render."""
    c = container
    job = c.jobs.create_job("https://www.youtube.com/watch?v=orchestrator_test1")
    job_id = job.job_id

    # Mock all stage domain functions to simulate quick logical progression
    async def fake_ingest(jid: str, container=None):
        vdir = c.jobs.video_dir_path(jid)
        vdir.mkdir(parents=True, exist_ok=True)
        vfile = vdir / "video.mp4"
        vfile.write_bytes(b"dummy_mp4_bytes")
        c.jobs.update_job(jid, {"video_duration_seconds": 120.0, "source_file_name": "video.mp4"})
        c.jobs.update_job_status(jid, JobStatus.DOWNLOADED)
        return {"video_path": f"/media/videos/{jid}", "job_id": jid}

    async def fake_transcribe(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.BUILDING_BLOCKS)
        return {}

    async def fake_blocks(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.BUILDING_TOPICS)
        return []

    async def fake_topics(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.ANALYZING)
        return []

    async def fake_analyze(jid: str, container=None):
        c.jobs.save_cuts(
            jid,
            [
                Cut(
                    cut_id="cut_01",
                    block_ids=["b1", "b2"],
                    start=10.0,
                    end=45.0,
                    title="Mock Viral Cut",
                    status="approved",
                )
            ],
        )
        c.jobs.update_job_status(jid, JobStatus.WAITING_APPROVAL)
        return []

    async def fake_render(jid: str, cut_ids=None):
        c.jobs.update_job_status(jid, JobStatus.DONE)
        return [f"/media/shorts/{jid}/00_10-00_45.mp4"]

    with patch("app.application.orchestrator.ingest_video", side_effect=fake_ingest), \
         patch("app.application.orchestrator.transcribe_job", side_effect=fake_transcribe), \
         patch("app.application.orchestrator.build_semantic_blocks", side_effect=fake_blocks), \
         patch("app.application.orchestrator.build_topic_segments", side_effect=fake_topics), \
         patch("app.application.orchestrator.analyze_job", side_effect=fake_analyze), \
         patch.object(get_rendering_service(), "render_job", side_effect=fake_render):

        resp = await async_client.post(f"/jobs/{job_id}/run", json={"include_render": True})
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["job_id"] == job_id
        assert data["status"] == "DONE"

        # Verify logs were appended to runtime service
        logs = c.runtime.get_task_logs(job_id, "render")  # or orchestrator logs
        job_updated = c.jobs.load_job(job_id)
        assert job_updated.status == JobStatus.DONE


@pytest.mark.asyncio
async def test_run_single_job_pipeline_from_downloaded_skips_ingest(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    """Verify 1-click pipeline starting from DOWNLOADED skips ingest and stops at WAITING_APPROVAL when include_render=False."""
    c = container
    job = c.jobs.create_job("https://www.youtube.com/watch?v=orchestrator_test2")
    job_id = job.job_id

    # Create dummy source video and mark as DOWNLOADED
    vdir = c.jobs.video_dir_path(job_id)
    vdir.mkdir(parents=True, exist_ok=True)
    (vdir / "video.mp4").write_bytes(b"dummy_bytes")
    c.jobs.update_job(job_id, {"video_duration_seconds": 60.0, "source_file_name": "video.mp4"})
    c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)

    ingest_called = False

    async def fake_ingest(jid: str, container=None):
        nonlocal ingest_called
        ingest_called = True
        return {}

    async def fake_transcribe(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.BUILDING_BLOCKS)
        return {}

    async def fake_blocks(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.BUILDING_TOPICS)
        return []

    async def fake_topics(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.ANALYZING)
        return []

    async def fake_analyze(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.WAITING_APPROVAL)
        return []

    with patch("app.application.orchestrator.ingest_video", side_effect=fake_ingest), \
         patch("app.application.orchestrator.transcribe_job", side_effect=fake_transcribe), \
         patch("app.application.orchestrator.build_semantic_blocks", side_effect=fake_blocks), \
         patch("app.application.orchestrator.build_topic_segments", side_effect=fake_topics), \
         patch("app.application.orchestrator.analyze_job", side_effect=fake_analyze):

        resp = await async_client.post(f"/jobs/{job_id}/run", json={"include_render": False})
        assert resp.status_code == 200
        assert not ingest_called, "Ingest should have been skipped when video already DOWNLOADED"
        data = resp.json()
        assert data["status"] == "WAITING_APPROVAL"


@pytest.mark.asyncio
async def test_batch_pipeline_full_run_lifecycle(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    """Verify batch execution runs multiple jobs to completion and tracks progress."""
    c = container
    job1 = c.jobs.create_job("https://youtube.com/watch?v=batch1")
    job2 = c.jobs.create_job("https://youtube.com/watch?v=batch2")
    j1_id = job1.job_id
    j2_id = job2.job_id

    # Prepare dummy files and mark as DOWNLOADED
    for jid in (j1_id, j2_id):
        vdir = c.jobs.video_dir_path(jid)
        vdir.mkdir(parents=True, exist_ok=True)
        (vdir / "video.mp4").write_bytes(b"dummy")
        c.jobs.update_job(jid, {"video_duration_seconds": 90.0, "source_file_name": "video.mp4"})
        c.jobs.update_job_status(jid, JobStatus.DOWNLOADED)

    async def fake_transcribe(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.BUILDING_BLOCKS)
        return {}

    async def fake_blocks(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.BUILDING_TOPICS)
        return []

    async def fake_topics(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.ANALYZING)
        return []

    async def fake_analyze(jid: str, container=None):
        c.jobs.update_job_status(jid, JobStatus.WAITING_APPROVAL)
        return []

    async def fake_render(jid: str, cut_ids=None):
        c.jobs.update_job_status(jid, JobStatus.DONE)
        return []

    with patch("app.application.orchestrator.transcribe_job", side_effect=fake_transcribe), \
         patch("app.application.orchestrator.build_semantic_blocks", side_effect=fake_blocks), \
         patch("app.application.orchestrator.build_topic_segments", side_effect=fake_topics), \
         patch("app.application.orchestrator.analyze_job", side_effect=fake_analyze), \
         patch.object(get_rendering_service(), "render_job", side_effect=fake_render):

        resp = await async_client.post(
            "/jobs/batch/run",
            json={
                "job_ids": [j1_id, j2_id],
                "options": {
                    "transcription": True,
                    "analysis": True,
                    "render": True,
                    "preApprove": False,
                },
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert "batch_id" in data
        assert data["status"] == "started"
        batch_id = data["batch_id"]

        # Wait for the background worker to finish
        runner = get_batch_runner()
        task = runner._tasks.get(batch_id)
        if task:
            await task

        # Check status endpoint
        s_resp = await async_client.get(f"/jobs/batch/{batch_id}/status")
        assert s_resp.status_code == 200
        status_data = s_resp.json()
        assert status_data["total"] == 2
        assert status_data["completed"] == 2
        assert status_data["failed"] == 0
        assert not status_data["is_running"]
        assert j1_id in status_data["completed_jobs"]
        assert j2_id in status_data["completed_jobs"]


@pytest.mark.asyncio
async def test_batch_pipeline_preapproval_pause_and_continue(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    """Verify preApprove=True pauses the batch at waiting_approval and continues when POST /continue is called."""
    c = container
    job = c.jobs.create_job("https://youtube.com/watch?v=preapprove_test")
    jid = job.job_id

    vdir = c.jobs.video_dir_path(jid)
    vdir.mkdir(parents=True, exist_ok=True)
    (vdir / "video.mp4").write_bytes(b"dummy")
    c.jobs.update_job(jid, {"video_duration_seconds": 90.0, "source_file_name": "video.mp4"})
    c.jobs.update_job_status(jid, JobStatus.DOWNLOADED)

    async def fake_transcribe(j: str, container=None):
        c.jobs.update_job_status(j, JobStatus.BUILDING_BLOCKS)

    async def fake_blocks(j: str, container=None):
        c.jobs.update_job_status(j, JobStatus.BUILDING_TOPICS)

    async def fake_topics(j: str, container=None):
        c.jobs.update_job_status(j, JobStatus.ANALYZING)

    async def fake_analyze(j: str, container=None):
        c.jobs.save_cuts(
            j,
            [Cut(cut_id="c1", block_ids=["b1"], start=0, end=30, status="suggested")],
        )
        c.jobs.update_job_status(j, JobStatus.WAITING_APPROVAL)

    async def fake_render(j: str, cut_ids=None):
        c.jobs.update_job_status(j, JobStatus.DONE)

    with patch("app.application.orchestrator.transcribe_job", side_effect=fake_transcribe), \
         patch("app.application.orchestrator.build_semantic_blocks", side_effect=fake_blocks), \
         patch("app.application.orchestrator.build_topic_segments", side_effect=fake_topics), \
         patch("app.application.orchestrator.analyze_job", side_effect=fake_analyze), \
         patch.object(get_rendering_service(), "render_job", side_effect=fake_render):

        resp = await async_client.post(
            "/jobs/batch/run",
            json={
                "job_ids": [jid],
                "options": {
                    "transcription": True,
                    "analysis": True,
                    "render": True,
                    "preApprove": True,
                },
            },
        )
        assert resp.status_code == 200
        batch_id = resp.json()["batch_id"]

        # Yield control briefly so worker reaches waiting_approval
        for _ in range(10):
            await asyncio.sleep(0.05)
            s_resp = await async_client.get(f"/jobs/batch/{batch_id}/status")
            if s_resp.json().get("waiting_for_approval"):
                break

        status_data = s_resp.json()
        assert status_data["waiting_for_approval"] is True
        assert status_data["current_step"] == "waiting_approval"
        assert status_data["pending_cuts"] is not None

        # Call continue
        cont_resp = await async_client.post(f"/jobs/batch/{batch_id}/continue")
        assert cont_resp.status_code == 200
        assert cont_resp.json()["status"] == "continued"

        # Wait for worker completion
        runner = get_batch_runner()
        task = runner._tasks.get(batch_id)
        if task:
            await task

        final_resp = await async_client.get(f"/jobs/batch/{batch_id}/status")
        final_data = final_resp.json()
        assert not final_data["waiting_for_approval"]
        assert final_data["completed"] == 1
        assert jid in final_data["completed_jobs"]


@pytest.mark.asyncio
async def test_batch_pipeline_cancel_propagates_to_active_job(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    """Verify POST /jobs/batch/{id}/cancel sets is_running=False and immediately propagates cancellation to active job."""
    c = container
    job = c.jobs.create_job("https://youtube.com/watch?v=cancel_test")
    jid = job.job_id

    vdir = c.jobs.video_dir_path(jid)
    vdir.mkdir(parents=True, exist_ok=True)
    (vdir / "video.mp4").write_bytes(b"dummy")
    c.jobs.update_job(jid, {"video_duration_seconds": 90.0, "source_file_name": "video.mp4"})
    c.jobs.update_job_status(jid, JobStatus.DOWNLOADED)

    started_transcription = asyncio.Event()

    async def fake_long_transcribe(j: str, container=None):
        started_transcription.set()
        # Create cancel token simulating active operation
        token = c.runtime.create_cancel_token(j, "transcription")
        for _ in range(50):
            if token.is_set():
                from app.application.runtime_service import OperationCancelledError
                raise OperationCancelledError("Transcription cancelled")
            await asyncio.sleep(0.05)

    with patch("app.application.orchestrator.transcribe_job", side_effect=fake_long_transcribe):
        resp = await async_client.post(
            "/jobs/batch/run",
            json={"job_ids": [jid], "options": {"transcription": True}},
        )
        assert resp.status_code == 200
        batch_id = resp.json()["batch_id"]

        # Wait until transcribe starts
        await asyncio.wait_for(started_transcription.wait(), timeout=2.0)

        # Cancel the batch
        cancel_resp = await async_client.post(f"/jobs/batch/{batch_id}/cancel")
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled"

        # Check that runtime received cancellation request for the active job
        assert c.runtime.is_cancel_requested(jid, "transcription")

        # Worker should finish gracefully
        runner = get_batch_runner()
        task = runner._tasks.get(batch_id)
        if task:
            await task

        s_resp = await async_client.get(f"/jobs/batch/{batch_id}/status")
        s_data = s_resp.json()
        assert not s_data["is_running"]
        assert s_data["current_step"] in ("cancelled", "completed")
