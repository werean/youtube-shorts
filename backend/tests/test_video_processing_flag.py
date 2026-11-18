"""Logical tests for VideoRecord.is_processing and OperationRuntimeService.is_job_actively_processing."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import httpx
import pytest

from app.application.orchestrator import BatchRunner
from app.application.runtime_service import ServiceContainer
from app.domain.rendering.rendering_service import get_rendering_service
from app.models.domain import Cut, Job, JobStatus


def _create_disk_video_job(
    container: ServiceContainer,
    *,
    job_id: str,
    video_name: str,
    status: JobStatus,
) -> Job:
    video_dir = container.video_dir(job_id, video_name)
    video_dir.mkdir(parents=True, exist_ok=True)
    video_file = video_dir / "video.mp4"
    video_file.write_bytes(b"FAKE_MP4_BYTES")
    return container.jobs.create_job(
        f"https://www.youtube.com/watch?v={job_id}",
        status=status,
        job_id=job_id,
        source_video_path=str(video_file),
        source_file_name="video.mp4",
        video_name=video_name,
        video_duration_seconds=60.0,
    )


@pytest.mark.asyncio
async def test_stale_processing_status_on_disk_returns_is_processing_false(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    _create_disk_video_job(
        container,
        job_id="job_stale_blocks",
        video_name="Video_Stale_Blocks",
        status=JobStatus.BUILDING_BLOCKS,
    )
    _create_disk_video_job(
        container,
        job_id="job_stale_analyzing",
        video_name="Video_Stale_Analyzing",
        status=JobStatus.ANALYZING,
    )

    resp = await async_client.get("/videos")
    assert resp.status_code == 200
    items = {item["job_id"]: item for item in resp.json()}

    assert items["job_stale_blocks"]["job"]["status"] == "BUILDING_BLOCKS"
    assert items["job_stale_blocks"]["is_processing"] is False

    assert items["job_stale_analyzing"]["job"]["status"] == "ANALYZING"
    assert items["job_stale_analyzing"]["is_processing"] is False


@pytest.mark.asyncio
async def test_active_cancel_token_sets_is_processing_true(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    _create_disk_video_job(
        container,
        job_id="job_tok",
        video_name="Video_Token",
        status=JobStatus.ANALYZING,
    )

    token = container.runtime.create_cancel_token("job_tok", "analysis")
    resp = await async_client.get("/videos")
    assert resp.status_code == 200
    by_id = {item["job_id"]: item for item in resp.json()}
    assert by_id["job_tok"]["is_processing"] is True

    # Once token is cancelled/set and no pid/batch is active, is_processing becomes False
    token.set()
    resp_after = await async_client.get("/videos")
    assert resp_after.status_code == 200
    by_id_after = {item["job_id"]: item for item in resp_after.json()}
    assert by_id_after["job_tok"]["is_processing"] is False


@pytest.mark.asyncio
async def test_active_process_pid_sets_is_processing_true(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    _create_disk_video_job(
        container,
        job_id="job_pid",
        video_name="Video_Pid",
        status=JobStatus.RENDERING,
    )

    container.runtime.register_process("job_pid", "render", 42424)
    resp = await async_client.get("/videos")
    assert resp.status_code == 200
    by_id = {item["job_id"]: item for item in resp.json()}
    assert by_id["job_pid"]["is_processing"] is True

    container.runtime.unregister_process("job_pid", "render", 42424)
    resp_after = await async_client.get("/videos")
    assert resp_after.status_code == 200
    by_id_after = {item["job_id"]: item for item in resp_after.json()}
    assert by_id_after["job_pid"]["is_processing"] is False


@pytest.mark.asyncio
async def test_running_batch_current_job_id_sets_is_processing_true(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    _create_disk_video_job(
        container,
        job_id="job_batch_active",
        video_name="Video_Batch_Active",
        status=JobStatus.BUILDING_BLOCKS,
    )
    _create_disk_video_job(
        container,
        job_id="job_batch_other",
        video_name="Video_Batch_Other",
        status=JobStatus.BUILDING_BLOCKS,
    )

    # Batch entry with explicit status="running"
    container.runtime._batches["batch_explicit"] = SimpleNamespace(  # type: ignore[assignment]
        status="running",
        current_job_id="job_batch_active",
    )

    resp = await async_client.get("/videos")
    assert resp.status_code == 200
    by_id = {item["job_id"]: item for item in resp.json()}
    assert by_id["job_batch_active"]["is_processing"] is True
    assert by_id["job_batch_other"]["is_processing"] is False

    # Non-running batch status must not report is_processing=True
    container.runtime._batches["batch_explicit"] = SimpleNamespace(  # type: ignore[assignment]
        status="completed",
        current_job_id="job_batch_active",
    )
    resp_done = await async_client.get("/videos")
    assert resp_done.status_code == 200
    by_id_done = {item["job_id"]: item for item in resp_done.json()}
    assert by_id_done["job_batch_active"]["is_processing"] is False

    # BatchPipelineProgress created via create_batch_progress (is_running=True)
    container.runtime.create_batch_progress("batch_progress", ["job_batch_other"])
    resp_prog = await async_client.get("/videos")
    assert resp_prog.status_code == 200
    by_id_prog = {item["job_id"]: item for item in resp_prog.json()}
    assert by_id_prog["job_batch_other"]["is_processing"] is True

    container.runtime.mark_batch_not_running("batch_progress", cascade_cancel=False)
    resp_stopped = await async_client.get("/videos")
    assert resp_stopped.status_code == 200
    by_id_stopped = {item["job_id"]: item for item in resp_stopped.json()}
    assert by_id_stopped["job_batch_other"]["is_processing"] is False


@pytest.mark.asyncio
async def test_batch_runner_syncs_runtime_batches_across_stages(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    _create_disk_video_job(
        container,
        job_id="job_runner_sync",
        video_name="Video_Runner_Sync",
        status=JobStatus.BUILDING_BLOCKS,
    )

    observed_during_blocks: list[bool] = []
    observed_during_topics: list[bool] = []
    observed_during_analysis: list[bool] = []
    observed_during_render: list[bool] = []
    reached_approval = asyncio.Event()

    def fake_blocks(jid: str, container: ServiceContainer | None = None):
        c = container or ServiceContainer()
        observed_during_blocks.append(c.runtime.is_job_actively_processing(jid))
        c.jobs.update_job_status(jid, JobStatus.BUILDING_TOPICS)
        return []

    async def fake_topics(jid: str, container: ServiceContainer | None = None):
        c = container or ServiceContainer()
        observed_during_topics.append(c.runtime.is_job_actively_processing(jid))
        c.jobs.update_job_status(jid, JobStatus.ANALYZING)
        return []

    async def fake_analyze(jid: str, container: ServiceContainer | None = None):
        c = container or ServiceContainer()
        observed_during_analysis.append(c.runtime.is_job_actively_processing(jid))
        c.jobs.save_cuts(
            jid,
            [Cut(cut_id="c1", block_ids=["b1"], start=0.0, end=20.0, status="suggested")],
        )
        c.jobs.update_job_status(jid, JobStatus.WAITING_APPROVAL)
        return []

    async def fake_render(jid: str, cut_ids=None):
        observed_during_render.append(container.runtime.is_job_actively_processing(jid))
        container.jobs.update_job_status(jid, JobStatus.DONE)
        return []

    runner = BatchRunner(container=container)
    with patch("app.application.orchestrator.build_semantic_blocks", side_effect=fake_blocks), \
         patch("app.application.orchestrator.build_topic_segments", side_effect=fake_topics), \
         patch("app.application.orchestrator.analyze_job", side_effect=fake_analyze), \
         patch.object(get_rendering_service(), "render_job", side_effect=fake_render):
        status = runner.start_batch(
            ["job_runner_sync"],
            {"transcription": False, "analysis": True, "render": True, "preApprove": True},
        )
        batch_id = status.batch_id

        for _ in range(40):
            await asyncio.sleep(0.02)
            curr = runner.get_batch_status(batch_id)
            if curr and curr.waiting_for_approval:
                reached_approval.set()
                break

        assert reached_approval.is_set()
        # While waiting for user approval, job is NOT actively processing on backend
        resp_wait = await async_client.get("/videos")
        assert resp_wait.status_code == 200
        by_id_wait = {item["job_id"]: item for item in resp_wait.json()}
        assert by_id_wait["job_runner_sync"]["is_processing"] is False
        assert getattr(container.runtime.get_batch_progress(batch_id), "status", None) == "waiting_approval"

        runner.continue_batch(batch_id)
        await runner._tasks[batch_id]

    assert observed_during_blocks == [True]
    assert observed_during_topics == [True]
    assert observed_during_analysis == [True]
    assert observed_during_render == [True]

    resp_final = await async_client.get("/videos")
    assert resp_final.status_code == 200
    by_id_final = {item["job_id"]: item for item in resp_final.json()}
    assert by_id_final["job_runner_sync"]["is_processing"] is False
    assert getattr(container.runtime.get_batch_progress(batch_id), "status", None) == "completed"


@pytest.mark.asyncio
async def test_jobs_analysis_routes_register_and_clear_cancel_tokens(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    _create_disk_video_job(
        container,
        job_id="job_direct_analysis",
        video_name="Video_Direct_Analysis",
        status=JobStatus.BUILDING_BLOCKS,
    )

    blocks_active_flag: list[bool] = []
    analyze_active_flag: list[bool] = []

    def fake_blocks(jid: str, container: ServiceContainer | None = None):
        blocks_active_flag.append(container.runtime.is_job_actively_processing(jid))
        return []

    async def fake_topics(jid: str, container: ServiceContainer | None = None):
        return []

    async def fake_analyze_fail(jid: str, container: ServiceContainer | None = None):
        analyze_active_flag.append(container.runtime.is_job_actively_processing(jid))
        raise ValueError("Simulated analysis failure")

    with patch("app.api.routers.jobs_analysis.build_semantic_blocks", side_effect=fake_blocks), \
         patch("app.api.routers.jobs_analysis.build_topic_segments", side_effect=fake_topics):
        r_blocks = await async_client.post("/jobs/job_direct_analysis/blocks")
        assert r_blocks.status_code == 200

    assert blocks_active_flag == [True]
    assert container.runtime.is_job_actively_processing("job_direct_analysis") is False

    with patch("app.api.routers.jobs_analysis.analyze_job", side_effect=fake_analyze_fail):
        r_analyze = await async_client.post("/jobs/job_direct_analysis/analyze")
        assert r_analyze.status_code == 400

    assert analyze_active_flag == [True]
    # Even when analyze raises an error, finally clears the token
    assert container.runtime.is_job_actively_processing("job_direct_analysis") is False
    resp_after = await async_client.get("/videos")
    assert resp_after.status_code == 200
    by_id = {item["job_id"]: item for item in resp_after.json()}
    assert by_id["job_direct_analysis"]["is_processing"] is False
