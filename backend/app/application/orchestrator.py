"""Phase 7 1-Click Pipeline Orchestrator and Batch Pipeline Runner.

Provides:
- `run_job_pipeline`: Single-job sequential 1-click execution:
  ingest -> transcribe -> semantic blocks -> topic segments -> analyze -> render -> DONE.
  Supports starting from CREATED/PENDING (downloads source) or DOWNLOADED (skips download).
  Emits real-time progress events and logs at every stage.
- `BatchRunner`: Multi-job batch runner supporting:
  - Background asynchronous execution
  - Real-time status reporting with approval gating (`preApprove`)
  - Immediate cooperative cancellation propagation (`request_cancel`)
  - Resumption from next pending job (`continue_batch`)
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

from pydantic import BaseModel, Field

from app.application.job_lifecycle import JobNotFoundError
from app.application.runtime_service import (
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.domain.analysis.narrative_miner import analyze_job
from app.domain.ingest.service import ingest_video
from app.domain.rendering.rendering_service import get_rendering_service
from app.domain.segmentation.semantic_blocks import build_semantic_blocks
from app.domain.segmentation.topic_segmentation import build_topic_segments
from app.domain.transcription.service import transcribe_job
from app.models.domain import Job, JobStatus


def _publish_step(
    c: ServiceContainer,
    job_id: str,
    task: str,
    status: JobStatus | str,
    percent: float,
    message: str,
) -> None:
    """Helper to append orchestrator log and publish SSE progress event."""
    c.runtime.append_task_log(job_id, "orchestrator", f"[orchestrator] {message}")
    c.runtime.publish_progress(
        job_id,
        status=str(status),
        task=task,
        percent=percent,
        message=message,
    )


async def run_job_pipeline(
    job_id: str,
    include_render: bool = True,
    container: ServiceContainer | None = None,
) -> Job:
    """Execute the full 1-click pipeline sequentially for a job.

    Supports resuming from any current stage:
    - CREATED / PENDING -> Ingests video -> DOWNLOADED
    - DOWNLOADED -> Transcribes with Whisper -> BUILDING_BLOCKS
    - BUILDING_BLOCKS -> Groups semantic blocks -> BUILDING_TOPICS
    - BUILDING_TOPICS -> Segments topics with TextTiling -> ANALYZING
    - ANALYZING -> LLM narrative mining & snap -> WAITING_APPROVAL
    - WAITING_APPROVAL (if include_render=True) -> Virtual Cameraman 9:16 + NVENC -> DONE
    """
    c = container or get_container()
    job = c.jobs.load_job(job_id)

    _publish_step(
        c,
        job_id,
        task="ingest",
        status=job.status,
        percent=5.0,
        message=f"Iniciando pipeline 1-clique (include_render={include_render})...",
    )

    try:
        # Step 1: Ingest (if not already downloaded)
        source_video = c.jobs.find_source_video(job_id)
        is_pending_status = str(job.status).upper() in ("CREATED", "PENDING", "DOWNLOADING")
        if is_pending_status or not source_video:
            if not job.youtube_url and not source_video:
                raise ValueError(f"Job {job_id} has no source video or YouTube URL to ingest")
            if job.youtube_url:
                _publish_step(
                    c,
                    job_id,
                    task="ingest",
                    status=JobStatus.DOWNLOADING,
                    percent=10.0,
                    message="Step 1/5: Ingestando vídeo do YouTube...",
                )
                await ingest_video(job_id, container=c)
                job = c.jobs.load_job(job_id)

        # Step 2: Transcription
        if job.status == JobStatus.DOWNLOADED:
            _publish_step(
                c,
                job_id,
                task="transcription",
                status=JobStatus.TRANSCRIBING,
                percent=30.0,
                message="Step 2/5: Transcrevendo áudio com faster-whisper...",
            )
            await transcribe_job(job_id, container=c)
            job = c.jobs.load_job(job_id)

        # Step 3: Semantic Blocks
        if job.status == JobStatus.BUILDING_BLOCKS:
            _publish_step(
                c,
                job_id,
                task="transcription",
                status=JobStatus.BUILDING_BLOCKS,
                percent=50.0,
                message="Step 3/5: Construindo blocos semânticos de discurso...",
            )
            await build_semantic_blocks(job_id, container=c)
            job = c.jobs.load_job(job_id)

        # Step 4: Topic Segments (TextTiling)
        if job.status == JobStatus.BUILDING_TOPICS:
            _publish_step(
                c,
                job_id,
                task="transcription",
                status=JobStatus.BUILDING_TOPICS,
                percent=65.0,
                message="Step 4/5: Identificando limites de tópicos contextuais...",
            )
            await build_topic_segments(job_id, container=c)
            job = c.jobs.load_job(job_id)

        # Step 5: LLM Narrative Analysis & Cut Mining
        if job.status == JobStatus.ANALYZING:
            _publish_step(
                c,
                job_id,
                task="render",
                status=JobStatus.ANALYZING,
                percent=80.0,
                message="Step 5/5: Minerando cortes narrativos com LLM local...",
            )
            await analyze_job(job_id, container=c)
            job = c.jobs.load_job(job_id)

        # Step 6: Rendering (Optional)
        if include_render and job.status == JobStatus.WAITING_APPROVAL:
            _publish_step(
                c,
                job_id,
                task="render",
                status=JobStatus.RENDERING,
                percent=90.0,
                message="Step 6/6: Renderizando cortes verticais 9:16 com Cinegrafista Virtual...",
            )
            await get_rendering_service().render_job(job_id)
            job = c.jobs.load_job(job_id)

        _publish_step(
            c,
            job_id,
            task="render" if include_render else "transcription",
            status=job.status,
            percent=100.0,
            message="Pipeline 1-clique concluído com sucesso!",
        )
        return job

    except OperationCancelledError:
        c.runtime.append_task_log(job_id, "orchestrator", "[orchestrator] Pipeline cancelado cooperativamente")
        c.runtime.publish_state_change(job_id, JobStatus.DOWNLOADED, "Pipeline cancelado cooperativamente")
        return c.jobs.load_job(job_id)

    except Exception as exc:
        c.runtime.append_task_log(job_id, "orchestrator", f"[orchestrator] ✗ Pipeline error: {exc}")
        c.jobs.update_job_status(job_id, JobStatus.ERROR)
        c.runtime.publish_state_change(job_id, JobStatus.ERROR, str(exc))
        raise


class BatchStatus(BaseModel):
    """Batch progress and status report compatible with contracts.ts BatchPipelineProgress."""

    batch_id: str
    total: int = 0
    completed: int = 0
    failed: int = 0
    current_job_id: str = ""
    current_job_index: int = 0
    current_step: str = ""
    is_running: bool = True
    waiting_for_approval: bool = False
    pending_cuts: list[Any] | None = None
    completed_jobs: list[str] = Field(default_factory=list)
    failed_jobs: list[dict[str, str]] = Field(default_factory=list)
    jobs: list[str] = Field(default_factory=list)
    options: dict[str, Any] = Field(default_factory=dict)


class BatchRunner:
    """Manages multi-job batch pipeline execution, status, cancellation and resumption."""

    def __init__(self, container: ServiceContainer | None = None) -> None:
        self.container = container
        self._batches: dict[str, BatchStatus] = {}
        self._tasks: dict[str, asyncio.Task[Any]] = {}
        self._approval_events: dict[str, asyncio.Event] = {}

    def start_batch(
        self,
        job_ids: list[str],
        options: dict[str, Any] | None = None,
    ) -> BatchStatus:
        """Create and begin executing a batch pipeline in background."""
        clean_ids = [str(jid).strip() for jid in job_ids if str(jid).strip()]
        if not clean_ids:
            raise ValueError("No job IDs provided")

        batch_id = f"batch_{int(time.time() * 1000)}"
        opts = options or {}

        status = BatchStatus(
            batch_id=batch_id,
            total=len(clean_ids),
            completed=0,
            failed=0,
            current_job_id="",
            current_job_index=0,
            current_step="started",
            is_running=True,
            waiting_for_approval=False,
            completed_jobs=[],
            failed_jobs=[],
            jobs=clean_ids,
            options=opts,
        )

        self._batches[batch_id] = status
        self._approval_events[batch_id] = asyncio.Event()

        task = asyncio.create_task(self._process_batch(batch_id))
        self._tasks[batch_id] = task
        return status

    def get_batch_status(self, batch_id: str) -> BatchStatus | None:
        """Retrieve the progress/status of a batch."""
        return self._batches.get(batch_id)

    def cancel_batch(self, batch_id: str) -> bool:
        """Cancel a batch execution and immediately propagate cooperative cancellation to active job."""
        status = self._batches.get(batch_id)
        if not status:
            return False

        status.is_running = False
        status.waiting_for_approval = False
        status.current_step = "cancelled"

        # Wake up any approval wait loop
        event = self._approval_events.get(batch_id)
        if event is not None:
            event.set()

        # Immediately propagate cancellation to active running job
        if status.current_job_id:
            c = self.container or get_container()
            c.runtime.request_cancel(status.current_job_id)

        return True

    def continue_batch(self, batch_id: str) -> bool:
        """Resume batch execution after approval or resume interrupted batch."""
        status = self._batches.get(batch_id)
        if not status:
            return False

        if status.waiting_for_approval:
            status.waiting_for_approval = False
            status.pending_cuts = None
            event = self._approval_events.get(batch_id)
            if event is not None:
                event.set()
            return True

        if not status.is_running:
            # Check if there are pending jobs left to process
            pending_exists = any(
                jid not in status.completed_jobs and not any(f["job_id"] == jid for f in status.failed_jobs)
                for jid in status.jobs
            )
            if pending_exists:
                status.is_running = True
                status.current_step = "resuming"
                self._approval_events[batch_id] = asyncio.Event()
                task = asyncio.create_task(self._process_batch(batch_id))
                self._tasks[batch_id] = task
                return True

        return True

    async def _process_batch(self, batch_id: str) -> None:
        """Internal worker executing batch pipeline across jobs."""
        status = self._batches.get(batch_id)
        if not status:
            return

        c = self.container or get_container()
        opts = status.options
        do_transcription = bool(opts.get("transcription", True))
        do_analysis = bool(opts.get("analysis", True))
        do_render = bool(opts.get("render", True))
        pre_approve = bool(opts.get("preApprove", False))

        for idx, job_id in enumerate(status.jobs):
            if not status.is_running:
                break

            if job_id in status.completed_jobs:
                continue

            status.current_job_index = idx
            status.current_job_id = job_id

            try:
                job = c.jobs.load_job(job_id)

                # Ingestion if needed
                source_video = c.jobs.find_source_video(job_id)
                is_pending = str(job.status).upper() in ("CREATED", "PENDING", "DOWNLOADING")
                if is_pending or not source_video:
                    if job.youtube_url:
                        status.current_step = "ingest"
                        await ingest_video(job_id, container=c)
                        job = c.jobs.load_job(job_id)

                # Step 1: Transcription
                if do_transcription:
                    if not status.is_running:
                        break
                    status.current_step = "transcription"
                    if job.status == JobStatus.DOWNLOADED:
                        await transcribe_job(job_id, container=c)
                        job = c.jobs.load_job(job_id)

                # Step 2: Semantic blocks & topic segments & analysis
                if do_analysis:
                    if not status.is_running:
                        break
                    status.current_step = "semantic_blocks"
                    if job.status == JobStatus.BUILDING_BLOCKS:
                        await build_semantic_blocks(job_id, container=c)
                        job = c.jobs.load_job(job_id)

                    if not status.is_running:
                        break
                    status.current_step = "topic_segments"
                    if job.status == JobStatus.BUILDING_TOPICS:
                        await build_topic_segments(job_id, container=c)
                        job = c.jobs.load_job(job_id)

                    if not status.is_running:
                        break
                    status.current_step = "analysis"
                    if job.status == JobStatus.ANALYZING:
                        await analyze_job(job_id, container=c)
                        job = c.jobs.load_job(job_id)

                    # Pre-approval gate
                    if pre_approve:
                        status.current_step = "waiting_approval"
                        status.waiting_for_approval = True
                        try:
                            cuts = c.jobs.load_cuts(job_id)
                            status.pending_cuts = [
                                ct.model_dump() if hasattr(ct, "model_dump") else ct for ct in cuts
                            ]
                        except Exception:
                            status.pending_cuts = []

                        event = self._approval_events.get(batch_id)
                        while status.waiting_for_approval and status.is_running:
                            if event is not None:
                                try:
                                    await asyncio.wait_for(event.wait(), timeout=0.5)
                                    event.clear()
                                except asyncio.TimeoutError:
                                    pass
                            else:
                                await asyncio.sleep(0.5)

                        if not status.is_running:
                            break
                        status.pending_cuts = None
                        status.waiting_for_approval = False

                # Step 3: Render
                if do_render and do_analysis:
                    if not status.is_running:
                        break
                    status.current_step = "rendering"
                    if job.status == JobStatus.WAITING_APPROVAL:
                        await get_rendering_service().render_job(job_id)
                        job = c.jobs.load_job(job_id)

                if job_id not in status.completed_jobs:
                    status.completed_jobs.append(job_id)
                    status.completed = len(status.completed_jobs)

            except OperationCancelledError:
                if not status.is_running:
                    break
            except Exception as exc:
                status.failed_jobs.append({"job_id": job_id, "error": str(exc)})
                status.failed = len(status.failed_jobs)

        status.is_running = False
        if len(status.completed_jobs) == len(status.jobs):
            status.current_step = "completed"
        elif not status.is_running and status.current_step != "completed":
            status.current_step = "cancelled"


_GLOBAL_BATCH_RUNNER: BatchRunner | None = None


def get_batch_runner(container: ServiceContainer | None = None) -> BatchRunner:
    """Return singleton BatchRunner instance."""
    global _GLOBAL_BATCH_RUNNER
    if _GLOBAL_BATCH_RUNNER is None:
        _GLOBAL_BATCH_RUNNER = BatchRunner(container=container)
    elif container is not None:
        _GLOBAL_BATCH_RUNNER.container = container
    return _GLOBAL_BATCH_RUNNER


def reset_batch_runner() -> None:
    """Reset batch runner for clean test state."""
    global _GLOBAL_BATCH_RUNNER
    _GLOBAL_BATCH_RUNNER = None
