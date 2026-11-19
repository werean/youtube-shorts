"""Batch retry from a job left in ERROR (100% mocked, no hardware).

Covers the recovery shared with the single-job path, and the pre-approval gate never hanging
when there is nothing to approve.
"""

from __future__ import annotations

import asyncio
from typing import Any
from unittest.mock import patch

import pytest

from app.application.orchestrator import get_batch_runner, reset_batch_runner, run_job_pipeline
from app.application.runtime_service import ServiceContainer
from app.domain.rendering.rendering_service import get_rendering_service
from app.models.domain import Cut, JobStatus

OPTS = {"transcription": True, "analysis": True, "render": True, "preApprove": True}


@pytest.fixture(autouse=True)
def _clean_runner():
    reset_batch_runner()
    yield
    reset_batch_runner()


def _make_error_job(
    c: ServiceContainer,
    *,
    video: bool = True,
    transcription: bool = False,
    blocks: bool = False,
    topics: bool = False,
    cuts: bool = False,
) -> str:
    jid = c.jobs.create_job("https://youtube.com/watch?v=retry_err").job_id
    if video:
        vdir = c.jobs.video_dir_path(jid)
        vdir.mkdir(parents=True, exist_ok=True)
        (vdir / "video.mp4").write_bytes(b"dummy")
        c.jobs.update_job(jid, {"video_duration_seconds": 90.0, "source_file_name": "video.mp4"})
    if transcription:
        c.jobs.save_transcription_segments(jid, [])
    if blocks:
        c.jobs.save_semantic_blocks(jid, [{"block_id": "b1", "start": 0, "end": 30, "text": "x"}])
    if topics:
        c.jobs.save_topic_segments(jid, [{"topic_id": "t1", "start": 0, "end": 30}])
    if cuts:
        c.jobs.save_cuts(jid, [Cut(cut_id="old", block_ids=["b1"], start=0, end=30, status="suggested")])
    c.jobs.update_job_status(jid, JobStatus.ERROR)
    return jid


class _Stages:
    """Mocked stages that advance the job status and record which ones ran."""

    def __init__(self, c: ServiceContainer, *, produce_cuts: bool = True, analyze_error: bool = False):
        self.c = c
        self.calls: list[str] = []
        self.produce_cuts = produce_cuts
        self.analyze_error = analyze_error

    async def ingest(self, jid: str, container=None):
        self.calls.append("ingest")
        vdir = self.c.jobs.video_dir_path(jid)
        vdir.mkdir(parents=True, exist_ok=True)
        (vdir / "video.mp4").write_bytes(b"dummy")
        self.c.jobs.update_job(jid, {"video_duration_seconds": 90.0, "source_file_name": "video.mp4"})
        self.c.jobs.update_job_status(jid, JobStatus.DOWNLOADED)
        return {}

    async def transcribe(self, jid: str, container=None):
        self.calls.append("transcribe")
        self.c.jobs.update_job_status(jid, JobStatus.BUILDING_BLOCKS)
        return {}

    async def blocks(self, jid: str, container=None):
        self.calls.append("blocks")
        self.c.jobs.update_job_status(jid, JobStatus.BUILDING_TOPICS)
        return []

    async def topics(self, jid: str, container=None):
        self.calls.append("topics")
        self.c.jobs.update_job_status(jid, JobStatus.ANALYZING)
        return []

    async def analyze(self, jid: str, container=None):
        self.calls.append("analyze")
        if self.analyze_error:
            self.c.jobs.update_job_status(jid, JobStatus.ERROR)
            return []
        if self.produce_cuts:
            self.c.jobs.save_cuts(
                jid, [Cut(cut_id="c1", block_ids=["b1"], start=0, end=30, status="suggested")]
            )
        else:
            self.c.jobs.save_cuts(jid, [])
        self.c.jobs.update_job_status(jid, JobStatus.WAITING_APPROVAL)
        return []

    async def render(self, jid: str, cut_ids=None, **kwargs: Any):
        self.calls.append("render")
        self.c.jobs.update_job_status(jid, JobStatus.DONE)
        return []

    def patches(self):
        return (
            patch("app.application.orchestrator.ingest_video", side_effect=self.ingest),
            patch("app.application.orchestrator.transcribe_job", side_effect=self.transcribe),
            patch("app.application.orchestrator.build_semantic_blocks", side_effect=self.blocks),
            patch("app.application.orchestrator.build_topic_segments", side_effect=self.topics),
            patch("app.application.orchestrator.analyze_job", side_effect=self.analyze),
            patch.object(get_rendering_service(), "render_job", side_effect=self.render),
        )


async def _run_batch(c: ServiceContainer, stages: _Stages, jid: str, *, approve: bool, opts=None):
    runner = get_batch_runner(c)
    ps = stages.patches()
    for p in ps:
        p.start()
    try:
        batch = runner.start_batch([jid], options=opts or OPTS)
        if approve:
            for _ in range(100):
                await asyncio.sleep(0.05)
                if batch.waiting_for_approval:
                    break
            assert batch.waiting_for_approval, "batch never reached waiting approval"
            assert batch.pending_cuts, "pending cuts must be exposed"
            runner.continue_batch(batch.batch_id)
        await asyncio.wait_for(runner._tasks[batch.batch_id], timeout=10)
    finally:
        for p in ps:
            p.stop()
    return batch


@pytest.mark.asyncio
async def test_error_with_topics_runs_analysis_and_reaches_approval(container: ServiceContainer) -> None:
    jid = _make_error_job(container, transcription=True, blocks=True, topics=True)
    stages = _Stages(container)
    batch = await _run_batch(container, stages, jid, approve=True)
    assert stages.calls == ["analyze", "render"]
    assert batch.completed_jobs == [jid] and not batch.failed_jobs
    assert container.jobs.load_job(jid).status == JobStatus.DONE
    assert "Recovered job from ERROR to ANALYZING" in " ".join(
        str(x) for x in container.runtime.get_task_logs(jid, "batch")
    )


@pytest.mark.asyncio
async def test_error_with_only_transcription_runs_blocks_topics_analysis(container: ServiceContainer) -> None:
    jid = _make_error_job(container, transcription=True)
    stages = _Stages(container)
    batch = await _run_batch(container, stages, jid, approve=True)
    assert stages.calls == ["blocks", "topics", "analyze", "render"]
    assert batch.completed_jobs == [jid]


@pytest.mark.asyncio
async def test_error_with_only_source_video_runs_from_transcription(container: ServiceContainer) -> None:
    jid = _make_error_job(container)
    stages = _Stages(container)
    batch = await _run_batch(container, stages, jid, approve=True)
    assert stages.calls == ["transcribe", "blocks", "topics", "analyze", "render"]
    assert batch.completed_jobs == [jid]


@pytest.mark.asyncio
async def test_error_without_source_video_goes_through_ingest(container: ServiceContainer) -> None:
    jid = _make_error_job(container, video=False)
    stages = _Stages(container)
    batch = await _run_batch(container, stages, jid, approve=True)
    assert stages.calls == ["ingest", "transcribe", "blocks", "topics", "analyze", "render"]
    assert batch.completed_jobs == [jid]


@pytest.mark.asyncio
async def test_error_with_old_cuts_goes_to_approval_without_reanalysis(container: ServiceContainer) -> None:
    """Documents current semantics (same as the single-job path): old cuts -> WAITING_APPROVAL."""
    jid = _make_error_job(container, transcription=True, blocks=True, topics=True, cuts=True)
    stages = _Stages(container)
    batch = await _run_batch(container, stages, jid, approve=True)
    assert stages.calls == ["render"]
    assert batch.completed_jobs == [jid]


@pytest.mark.asyncio
async def test_gate_does_not_hang_when_analysis_leaves_error(container: ServiceContainer) -> None:
    jid = _make_error_job(container, transcription=True, blocks=True, topics=True)
    stages = _Stages(container, analyze_error=True)
    batch = await _run_batch(container, stages, jid, approve=False)
    assert stages.calls == ["analyze"]
    assert not batch.completed_jobs
    assert len(batch.failed_jobs) == 1
    assert batch.failed_jobs[0]["job_id"] == jid
    assert "Nenhum corte foi gerado para aprovar" in batch.failed_jobs[0]["error"]
    assert not batch.waiting_for_approval and not batch.is_running
    assert container.jobs.load_job(jid).status == JobStatus.ERROR


@pytest.mark.asyncio
async def test_gate_does_not_hang_when_no_step_ran(container: ServiceContainer) -> None:
    """Job in an unrelated status (nothing to resume) must fail fast instead of waiting forever."""
    jid = _make_error_job(container, transcription=True, blocks=True, topics=True)
    container.jobs.update_job_status(jid, JobStatus.DONE)
    stages = _Stages(container)
    batch = await _run_batch(container, stages, jid, approve=False)
    assert stages.calls == []
    assert len(batch.failed_jobs) == 1
    assert "Nenhum corte foi gerado para aprovar" in batch.failed_jobs[0]["error"]


@pytest.mark.asyncio
async def test_gate_zero_cuts_finishes_without_render(container: ServiceContainer) -> None:
    jid = _make_error_job(container, transcription=True, blocks=True, topics=True)
    stages = _Stages(container, produce_cuts=False)
    batch = await _run_batch(container, stages, jid, approve=False)
    assert stages.calls == ["analyze"]
    assert batch.completed_jobs == [jid] and not batch.failed_jobs
    logs = " ".join(str(x) for x in container.runtime.get_task_logs(jid, "batch"))
    assert "nenhum corte" in logs


@pytest.mark.asyncio
async def test_normal_flow_without_error_unchanged(container: ServiceContainer) -> None:
    jid = _make_error_job(container)
    container.jobs.update_job_status(jid, JobStatus.DOWNLOADED)
    stages = _Stages(container)
    batch = await _run_batch(container, stages, jid, approve=True)
    assert stages.calls == ["transcribe", "blocks", "topics", "analyze", "render"]
    assert batch.completed_jobs == [jid]
    logs = " ".join(str(x) for x in container.runtime.get_task_logs(jid, "batch"))
    assert "Recovered job from ERROR" not in logs


@pytest.mark.asyncio
async def test_single_job_path_still_recovers(container: ServiceContainer) -> None:
    jid = _make_error_job(container, transcription=True, blocks=True, topics=True)
    stages = _Stages(container)
    ps = stages.patches()
    for p in ps:
        p.start()
    try:
        job = await run_job_pipeline(jid, include_render=False, container=container)
    finally:
        for p in ps:
            p.stop()
    assert stages.calls == ["analyze"]
    assert job.status == JobStatus.WAITING_APPROVAL
