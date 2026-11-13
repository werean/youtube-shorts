"""Phase 7 1-Click Pipeline Orchestrator and Batch Pipeline Runner.

Provides:
- `run_job_pipeline`: Single-job sequential 1-click execution:
  ingest -> transcribe -> semantic blocks -> topic segments -> analyze -> render -> DONE.
  Supports starting from CREATED/PENDING (downloads source) or DOWNLOADED (skips download).
  Emits real-time progress events and persistent stage logs at every stage.
- `BatchRunner`: Multi-job batch runner supporting:
  - Background asynchronous execution
  - Real-time status reporting with approval gating (`preApprove`)
  - Immediate cooperative cancellation propagation (`request_cancel`)
  - Resumption from next pending job (`continue_batch`)
"""

from __future__ import annotations

import asyncio
import inspect
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


def _status_str(status: JobStatus | str) -> str:
    s = status.value if hasattr(status, "value") else str(status)
    if s.startswith("JobStatus."):
        s = s.split(".", 1)[1]
    return s


def _count_result_items(res: Any, attr: str) -> int | None:
    if res is None:
        return None
    if isinstance(res, dict):
        items = res.get(attr)
        return len(items) if isinstance(items, (list, tuple)) else None
    if isinstance(res, (list, tuple)):
        return len(res)
    items = getattr(res, attr, None)
    return len(items) if isinstance(items, (list, tuple)) else None


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
        status=_status_str(status),
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
    cancel_token = c.runtime.create_cancel_token(job_id, "orchestrator")
    pipeline_t0 = time.perf_counter()
    current_stage = "orchestrator"

    c.runtime.log_stage_start(
        job_id,
        "orchestrator",
        inputs={
            "include_render": include_render,
            "initial_status": _status_str(job.status),
            "youtube_url": job.youtube_url,
            "source_video_path": job.source_video_path,
            "video_duration_seconds": job.video_duration_seconds,
        },
        message=f"Starting 1-click pipeline (include_render={include_render})",
    )

    _publish_step(
        c,
        job_id,
        task="ingest",
        status=job.status,
        percent=5.0,
        message=f"Iniciando pipeline 1-clique (include_render={include_render})...",
    )

    def _check_cancelled() -> None:
        if cancel_token.is_set() or c.runtime.is_cancel_requested(job_id):
            raise OperationCancelledError("Pipeline cancelado cooperativamente")

    try:
        _check_cancelled()

        # Recover cleanly if re-running a job previously left in ERROR
        source_video = c.jobs.find_source_video(job_id)
        if _status_str(job.status) == JobStatus.ERROR.value:
            if source_video and source_video.exists():
                updates: dict[str, Any] = {}
                if not job.source_video_path:
                    updates["source_video_path"] = str(source_video)
                if not job.video_duration_seconds:
                    from app.infrastructure.audio.pcm_extractor import probe_media_duration

                    probed = await probe_media_duration(source_video)
                    if probed and probed > 0:
                        updates["video_duration_seconds"] = probed
                if c.jobs.load_cuts(job_id):
                    recovered_status = JobStatus.WAITING_APPROVAL
                elif c.jobs.load_topic_segments(job_id):
                    recovered_status = JobStatus.ANALYZING
                elif c.jobs.load_semantic_blocks(job_id):
                    recovered_status = JobStatus.BUILDING_TOPICS
                elif c.jobs.has_transcription(job_id):
                    recovered_status = JobStatus.BUILDING_BLOCKS
                else:
                    recovered_status = JobStatus.DOWNLOADED
                updates["status"] = recovered_status
                job = c.jobs.update_job(job_id, updates)
            else:
                job = c.jobs.update_job_status(job_id, JobStatus.CREATED)
            c.runtime.append_task_log(
                job_id,
                "orchestrator",
                f"[orchestrator] Recovered job from ERROR to {_status_str(job.status)}",
            )

        # Step 1/5: Ingest (if not already downloaded)
        is_pending_status = job.status in (JobStatus.CREATED, JobStatus.DOWNLOADING) or str(
            job.status
        ).upper() in ("CREATED", "PENDING", "DOWNLOADING")
        if is_pending_status or not source_video:
            if not job.youtube_url and not source_video:
                raise ValueError(f"Job {job_id} has no source video or YouTube URL to ingest")
            if job.youtube_url:
                current_stage = "ingest"
                t0 = time.perf_counter()
                c.runtime.log_stage_start(
                    job_id,
                    "ingest",
                    inputs={
                        "youtube_url": job.youtube_url,
                        "status": _status_str(job.status),
                    },
                    message="Step 1/5: Ingesting video",
                )
                _publish_step(
                    c,
                    job_id,
                    task="ingest",
                    status=JobStatus.DOWNLOADING,
                    percent=10.0,
                    message="Step 1/5: Ingestando vídeo do YouTube...",
                )
                ingest_res = await ingest_video(job_id, container=c)
                job = c.jobs.load_job(job_id)
                c.runtime.log_stage_end(
                    job_id,
                    "ingest",
                    duration_ms=(time.perf_counter() - t0) * 1000,
                    outputs={
                        "status": _status_str(job.status),
                        "video_name": job.video_name,
                        "source_video_path": job.source_video_path,
                        "video_duration_seconds": job.video_duration_seconds,
                        "video_path": ingest_res.get("video_path") if isinstance(ingest_res, dict) else None,
                    },
                    message="Step 1/5: Ingest complete",
                )
        else:
            c.runtime.append_task_log(
                job_id,
                "orchestrator",
                f"[orchestrator] Step 1/5 (ingest): skipped (status={_status_str(job.status)}, source={source_video})",
            )

        _check_cancelled()

        # Step 2/5: Transcription
        if job.status == JobStatus.DOWNLOADED:
            current_stage = "transcription"
            t0 = time.perf_counter()
            c.runtime.log_stage_start(
                job_id,
                "transcription",
                inputs={
                    "source_video_path": job.source_video_path,
                    "video_duration_seconds": job.video_duration_seconds,
                },
                message="Step 2/5: Transcribing audio with faster-whisper",
            )
            _publish_step(
                c,
                job_id,
                task="transcription",
                status=JobStatus.TRANSCRIBING,
                percent=30.0,
                message="Step 2/5: Transcrevendo áudio com faster-whisper...",
            )
            tr_res = await transcribe_job(job_id, container=c)
            job = c.jobs.load_job(job_id)
            c.runtime.log_stage_end(
                job_id,
                "transcription",
                duration_ms=(time.perf_counter() - t0) * 1000,
                outputs={
                    "status": _status_str(job.status),
                    "segments_count": _count_result_items(tr_res, "segments"),
                },
                message="Step 2/5: Transcription complete",
            )

        _check_cancelled()

        # Step 3/5: Semantic Blocks
        if job.status == JobStatus.BUILDING_BLOCKS:
            current_stage = "blocks"
            t0 = time.perf_counter()
            c.runtime.log_stage_start(
                job_id,
                "blocks",
                inputs={"status": _status_str(job.status)},
                message="Step 3/5: Building discourse-aware semantic blocks",
            )
            _publish_step(
                c,
                job_id,
                task="blocks",
                status=JobStatus.BUILDING_BLOCKS,
                percent=50.0,
                message="Step 3/5: Construindo blocos semânticos de discurso...",
            )
            blocks_res = build_semantic_blocks(job_id, container=c)
            if inspect.isawaitable(blocks_res):
                blocks_res = await blocks_res
            job = c.jobs.load_job(job_id)
            c.runtime.log_stage_end(
                job_id,
                "blocks",
                duration_ms=(time.perf_counter() - t0) * 1000,
                outputs={
                    "status": _status_str(job.status),
                    "blocks_count": len(blocks_res) if isinstance(blocks_res, (list, tuple)) else None,
                },
                message="Step 3/5: Semantic blocks complete",
            )

        _check_cancelled()

        # Step 4/5: Topic Segments (TextTiling)
        should_run_topics = job.status == JobStatus.BUILDING_TOPICS or (
            job.status == JobStatus.ANALYZING and not c.jobs.load_topic_segments(job_id)
        )
        if should_run_topics:
            current_stage = "topics"
            t0 = time.perf_counter()
            c.runtime.log_stage_start(
                job_id,
                "topics",
                inputs={
                    "status": _status_str(job.status),
                    "video_duration_seconds": job.video_duration_seconds,
                },
                message="Step 4/5: Building contextual topic segments",
            )
            _publish_step(
                c,
                job_id,
                task="topics",
                status=JobStatus.BUILDING_TOPICS,
                percent=65.0,
                message="Step 4/5: Identificando limites de tópicos contextuais...",
            )
            topics_res = await build_topic_segments(job_id, container=c)
            job = c.jobs.load_job(job_id)
            c.runtime.log_stage_end(
                job_id,
                "topics",
                duration_ms=(time.perf_counter() - t0) * 1000,
                outputs={
                    "status": _status_str(job.status),
                    "topics_count": len(topics_res) if isinstance(topics_res, (list, tuple)) else None,
                },
                message="Step 4/5: Topic segmentation complete",
            )

        _check_cancelled()

        # Step 5/5: LLM Narrative Analysis & Cut Mining
        if job.status == JobStatus.ANALYZING:
            current_stage = "analysis"
            t0 = time.perf_counter()
            c.runtime.log_stage_start(
                job_id,
                "analysis",
                inputs={
                    "status": _status_str(job.status),
                    "video_duration_seconds": job.video_duration_seconds,
                },
                message="Step 5/5: Mining narrative cuts with local LLM",
            )
            _publish_step(
                c,
                job_id,
                task="analysis",
                status=JobStatus.ANALYZING,
                percent=80.0,
                message="Step 5/5: Minerando cortes narrativos com LLM local...",
            )
            analysis_res = await analyze_job(job_id, container=c)
            job = c.jobs.load_job(job_id)
            c.runtime.log_stage_end(
                job_id,
                "analysis",
                duration_ms=(time.perf_counter() - t0) * 1000,
                outputs={
                    "status": _status_str(job.status),
                    "cuts_count": _count_result_items(analysis_res, "cuts"),
                },
                message="Step 5/5: Narrative analysis complete",
            )

        _check_cancelled()

        # Step 6/6: Rendering (Optional)
        if include_render and job.status == JobStatus.WAITING_APPROVAL:
            current_stage = "render"
            t0 = time.perf_counter()
            c.runtime.log_stage_start(
                job_id,
                "render",
                inputs={
                    "status": _status_str(job.status),
                    "source_video_path": job.source_video_path,
                },
                message="Step 6/6: Rendering 9:16 vertical cuts",
            )
            _publish_step(
                c,
                job_id,
                task="render",
                status=JobStatus.RENDERING,
                percent=90.0,
                message="Step 6/6: Renderizando cortes verticais 9:16 com Cinegrafista Virtual...",
            )
            render_res = await get_rendering_service().render_job(job_id)
            job = c.jobs.load_job(job_id)
            c.runtime.log_stage_end(
                job_id,
                "render",
                duration_ms=(time.perf_counter() - t0) * 1000,
                outputs={
                    "status": _status_str(job.status),
                    "rendered_count": len(render_res) if isinstance(render_res, (list, tuple)) else None,
                    "rendered_files": list(render_res) if isinstance(render_res, (list, tuple)) else None,
                },
                message="Step 6/6: Rendering complete",
            )

        if not include_render:
            if _status_str(job.status) != JobStatus.WAITING_APPROVAL.value:
                job = c.jobs.update_job_status(job_id, JobStatus.WAITING_APPROVAL)

        c.runtime.log_stage_end(
            job_id,
            "orchestrator",
            duration_ms=(time.perf_counter() - pipeline_t0) * 1000,
            outputs={
                "final_status": _status_str(job.status),
                "include_render": include_render,
            },
            message="1-click pipeline completed successfully",
        )
        if not include_render:
            curation_msg = "Cortes prontos para curadoria — revise e aprove antes de renderizar"
            _publish_step(
                c,
                job_id,
                task="analysis",
                status=JobStatus.WAITING_APPROVAL,
                percent=100.0,
                message=curation_msg,
            )
            c.runtime.publish_state_change(job_id, JobStatus.WAITING_APPROVAL, curation_msg)
        else:
            _publish_step(
                c,
                job_id,
                task="render",
                status=job.status,
                percent=100.0,
                message="Pipeline 1-clique concluído com sucesso!",
            )
        return job

    except OperationCancelledError:
        c.runtime.append_task_log(
            job_id,
            "orchestrator",
            f"[orchestrator] Pipeline cancelado cooperativamente na etapa '{current_stage}'",
            level="WARNING",
        )
        c.runtime.publish_progress(
            job_id,
            status=JobStatus.DOWNLOADED.value,
            task="orchestrator",
            percent=0.0,
            message="Pipeline cancelado cooperativamente",
        )
        c.runtime.publish_state_change(job_id, JobStatus.DOWNLOADED, "Pipeline cancelado cooperativamente")
        return c.jobs.load_job(job_id)

    except Exception as exc:
        c.runtime.log_exception(
            job_id,
            current_stage,
            exc,
            message=f"Pipeline failed during stage '{current_stage}'",
            context={
                "pipeline": "1-click",
                "failed_stage": current_stage,
                "include_render": include_render,
                "elapsed_ms": round((time.perf_counter() - pipeline_t0) * 1000, 2),
            },
            include_env_diagnostics=True,
        )
        if current_stage != "orchestrator":
            c.runtime.log_exception(
                job_id,
                "orchestrator",
                exc,
                message=f"1-click pipeline aborted due to failure in stage '{current_stage}'",
                context={"failed_stage": current_stage, "include_render": include_render},
                include_env_diagnostics=False,
            )
        c.jobs.update_job_status(job_id, JobStatus.ERROR)
        c.runtime.publish_progress(
            job_id,
            status=JobStatus.ERROR.value,
            task="orchestrator",
            percent=0.0,
            message=f"Erro no pipeline ({current_stage}): {exc}",
        )
        c.runtime.publish_state_change(job_id, JobStatus.ERROR, str(exc))
        raise
    finally:
        c.runtime.clear_cancel_token(job_id, "orchestrator")


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

        c = self.container or get_container()
        c.runtime.log_stage_start(
            batch_id,
            "batch",
            inputs={"job_ids": clean_ids, "options": opts},
            message=f"Batch started with {len(clean_ids)} job(s)",
        )
        for jid in clean_ids:
            c.runtime.append_task_log(
                jid,
                "batch",
                f"[batch] Job queued in batch {batch_id} (options={opts})",
            )

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

        c = self.container or get_container()
        c.runtime.append_task_log(
            batch_id,
            "batch",
            f"[batch] Cancellation requested for batch {batch_id} (active_job={status.current_job_id})",
            level="WARNING",
        )

        # Immediately propagate cancellation to active running job
        if status.current_job_id:
            c.runtime.append_task_log(
                status.current_job_id,
                "batch",
                f"[batch] Cancellation propagated from batch {batch_id}",
                level="WARNING",
            )
            c.runtime.request_cancel(status.current_job_id)

        return True

    def continue_batch(self, batch_id: str) -> bool:
        """Resume batch execution after approval or resume interrupted batch."""
        status = self._batches.get(batch_id)
        if not status:
            return False

        c = self.container or get_container()
        if status.waiting_for_approval:
            status.waiting_for_approval = False
            status.pending_cuts = None
            c.runtime.append_task_log(
                batch_id,
                "batch",
                f"[batch] Approval granted, continuing batch {batch_id} (job={status.current_job_id})",
            )
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
                c.runtime.append_task_log(
                    batch_id,
                    "batch",
                    f"[batch] Resuming interrupted batch {batch_id}",
                )
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
        batch_t0 = time.perf_counter()

        for idx, job_id in enumerate(status.jobs):
            if not status.is_running:
                break

            if job_id in status.completed_jobs:
                continue

            status.current_job_index = idx
            status.current_job_id = job_id
            active_stage = "batch"
            job_t0 = time.perf_counter()

            c.runtime.log_stage_start(
                job_id,
                "batch",
                inputs={"batch_id": batch_id, "job_index": idx, "options": opts},
                message=f"Batch {batch_id} processing job {idx + 1}/{len(status.jobs)}",
            )

            try:
                job = c.jobs.load_job(job_id)

                # Step 1/5: Ingestion if needed
                source_video = c.jobs.find_source_video(job_id)
                is_pending = job.status in (JobStatus.CREATED, JobStatus.DOWNLOADING) or str(
                    job.status
                ).upper() in ("CREATED", "PENDING", "DOWNLOADING")
                if is_pending or not source_video:
                    if job.youtube_url:
                        active_stage = "ingest"
                        status.current_step = "ingest"
                        t0 = time.perf_counter()
                        c.runtime.log_stage_start(
                            job_id,
                            "ingest",
                            inputs={"youtube_url": job.youtube_url, "batch_id": batch_id},
                            message="Batch Step 1/5: Ingesting video",
                        )
                        ingest_res = await ingest_video(job_id, container=c)
                        job = c.jobs.load_job(job_id)
                        c.runtime.log_stage_end(
                            job_id,
                            "ingest",
                            duration_ms=(time.perf_counter() - t0) * 1000,
                            outputs={
                                "status": _status_str(job.status),
                                "video_duration_seconds": job.video_duration_seconds,
                                "video_path": ingest_res.get("video_path")
                                if isinstance(ingest_res, dict)
                                else None,
                            },
                            message="Batch Step 1/5: Ingest complete",
                        )

                # Step 2/5: Transcription
                if do_transcription:
                    if not status.is_running:
                        break
                    status.current_step = "transcription"
                    if job.status == JobStatus.DOWNLOADED:
                        active_stage = "transcription"
                        t0 = time.perf_counter()
                        c.runtime.log_stage_start(
                            job_id,
                            "transcription",
                            inputs={
                                "source_video_path": job.source_video_path,
                                "video_duration_seconds": job.video_duration_seconds,
                                "batch_id": batch_id,
                            },
                            message="Batch Step 2/5: Transcribing audio",
                        )
                        tr_res = await transcribe_job(job_id, container=c)
                        job = c.jobs.load_job(job_id)
                        c.runtime.log_stage_end(
                            job_id,
                            "transcription",
                            duration_ms=(time.perf_counter() - t0) * 1000,
                            outputs={
                                "status": _status_str(job.status),
                                "segments_count": _count_result_items(tr_res, "segments"),
                            },
                            message="Batch Step 2/5: Transcription complete",
                        )

                # Step 3/5, 4/5, 5/5: Semantic blocks & topic segments & analysis
                if do_analysis:
                    if not status.is_running:
                        break
                    status.current_step = "semantic_blocks"
                    if job.status == JobStatus.BUILDING_BLOCKS:
                        active_stage = "blocks"
                        t0 = time.perf_counter()
                        c.runtime.log_stage_start(
                            job_id,
                            "blocks",
                            inputs={"status": _status_str(job.status), "batch_id": batch_id},
                            message="Batch Step 3/5: Building semantic blocks",
                        )
                        b_res = build_semantic_blocks(job_id, container=c)
                        if inspect.isawaitable(b_res):
                            b_res = await b_res
                        job = c.jobs.load_job(job_id)
                        c.runtime.log_stage_end(
                            job_id,
                            "blocks",
                            duration_ms=(time.perf_counter() - t0) * 1000,
                            outputs={
                                "status": _status_str(job.status),
                                "blocks_count": len(b_res) if isinstance(b_res, (list, tuple)) else None,
                            },
                            message="Batch Step 3/5: Semantic blocks complete",
                        )

                    if not status.is_running:
                        break
                    status.current_step = "topic_segments"
                    should_run_topics = job.status == JobStatus.BUILDING_TOPICS or (
                        job.status == JobStatus.ANALYZING and not c.jobs.load_topic_segments(job_id)
                    )
                    if should_run_topics:
                        active_stage = "topics"
                        t0 = time.perf_counter()
                        c.runtime.log_stage_start(
                            job_id,
                            "topics",
                            inputs={"status": _status_str(job.status), "batch_id": batch_id},
                            message="Batch Step 4/5: Building topic segments",
                        )
                        t_res = await build_topic_segments(job_id, container=c)
                        job = c.jobs.load_job(job_id)
                        c.runtime.log_stage_end(
                            job_id,
                            "topics",
                            duration_ms=(time.perf_counter() - t0) * 1000,
                            outputs={
                                "status": _status_str(job.status),
                                "topics_count": len(t_res) if isinstance(t_res, (list, tuple)) else None,
                            },
                            message="Batch Step 4/5: Topic segmentation complete",
                        )

                    if not status.is_running:
                        break
                    status.current_step = "analysis"
                    if job.status == JobStatus.ANALYZING:
                        active_stage = "analysis"
                        t0 = time.perf_counter()
                        c.runtime.log_stage_start(
                            job_id,
                            "analysis",
                            inputs={"status": _status_str(job.status), "batch_id": batch_id},
                            message="Batch Step 5/5: Analyzing narrative cuts",
                        )
                        a_res = await analyze_job(job_id, container=c)
                        job = c.jobs.load_job(job_id)
                        c.runtime.log_stage_end(
                            job_id,
                            "analysis",
                            duration_ms=(time.perf_counter() - t0) * 1000,
                            outputs={
                                "status": _status_str(job.status),
                                "cuts_count": _count_result_items(a_res, "cuts"),
                            },
                            message="Batch Step 5/5: Narrative analysis complete",
                        )

                    # Pre-approval gate
                    if pre_approve:
                        status.current_step = "waiting_approval"
                        status.waiting_for_approval = True
                        c.runtime.append_task_log(
                            job_id,
                            "batch",
                            f"[batch] Waiting for user approval before rendering (batch={batch_id})",
                        )
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

                # Step 6/6: Render
                if do_render and do_analysis:
                    if not status.is_running:
                        break
                    status.current_step = "rendering"
                    if job.status == JobStatus.WAITING_APPROVAL:
                        active_stage = "render"
                        t0 = time.perf_counter()
                        c.runtime.log_stage_start(
                            job_id,
                            "render",
                            inputs={"status": _status_str(job.status), "batch_id": batch_id},
                            message="Batch Step 6/6: Rendering 9:16 vertical cuts",
                        )
                        r_res = await get_rendering_service().render_job(job_id)
                        job = c.jobs.load_job(job_id)
                        c.runtime.log_stage_end(
                            job_id,
                            "render",
                            duration_ms=(time.perf_counter() - t0) * 1000,
                            outputs={
                                "status": _status_str(job.status),
                                "rendered_count": len(r_res) if isinstance(r_res, (list, tuple)) else None,
                            },
                            message="Batch Step 6/6: Rendering complete",
                        )

                if job_id not in status.completed_jobs:
                    status.completed_jobs.append(job_id)
                    status.completed = len(status.completed_jobs)

                c.runtime.log_stage_end(
                    job_id,
                    "batch",
                    duration_ms=(time.perf_counter() - job_t0) * 1000,
                    outputs={"batch_id": batch_id, "final_status": _status_str(job.status)},
                    message=f"Job finished in batch {batch_id}",
                )

            except OperationCancelledError:
                c.runtime.append_task_log(
                    job_id,
                    "batch",
                    f"[batch] Job cancelled cooperatively during stage '{active_stage}'",
                    level="WARNING",
                )
                if not status.is_running:
                    break
            except Exception as exc:
                c.runtime.log_exception(
                    job_id,
                    active_stage,
                    exc,
                    message=f"Batch {batch_id} failed on job '{job_id}' during stage '{active_stage}'",
                    context={
                        "batch_id": batch_id,
                        "job_id": job_id,
                        "job_index": idx,
                        "current_step": status.current_step,
                        "failed_stage": active_stage,
                    },
                    include_env_diagnostics=True,
                )
                if active_stage != "batch":
                    c.runtime.log_exception(
                        job_id,
                        "batch",
                        exc,
                        message=f"Batch job '{job_id}' failed at stage '{active_stage}'",
                        context={"batch_id": batch_id, "failed_stage": active_stage},
                        include_env_diagnostics=False,
                    )
                c.runtime.log_exception(
                    batch_id,
                    "batch",
                    exc,
                    message=f"Batch {batch_id} failure on job '{job_id}' at '{status.current_step}'",
                    context={
                        "job_id": job_id,
                        "job_index": idx,
                        "current_step": status.current_step,
                        "failed_stage": active_stage,
                    },
                    include_env_diagnostics=False,
                )
                try:
                    c.jobs.update_job_status(job_id, JobStatus.ERROR)
                except Exception:
                    pass
                status.failed_jobs.append({"job_id": job_id, "error": str(exc)})
                status.failed = len(status.failed_jobs)

        status.is_running = False
        if len(status.completed_jobs) == len(status.jobs):
            status.current_step = "completed"
        elif not status.is_running and status.current_step != "completed":
            status.current_step = "cancelled"

        c.runtime.log_stage_end(
            batch_id,
            "batch",
            duration_ms=(time.perf_counter() - batch_t0) * 1000,
            outputs={
                "final_step": status.current_step,
                "completed": status.completed,
                "failed": status.failed,
                "failed_jobs": status.failed_jobs,
            },
            message=f"Batch {batch_id} finished ({status.current_step})",
        )


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
