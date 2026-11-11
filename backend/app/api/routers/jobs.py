"""Phase 7 Jobs Router: Batch Pipeline & 1-Click Pipeline Run (`/jobs/batch/*` and `/jobs/{job_id}/run`).

IMPORTANT:
Batch routes (`/batch/run`, `/batch/{batch_id}/status`, `/batch/{batch_id}/cancel`, `/batch/{batch_id}/continue`)
are mounted BEFORE `/{job_id}` routes so `/batch/*` is never matched as a job ID parameter.
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException

from app.api.routers import (
    jobs_analysis,
    jobs_ingest,
    jobs_render,
    jobs_transcription,
)
from app.application.job_lifecycle import JobNotFoundError
from app.application.orchestrator import (
    BatchStatus,
    get_batch_runner,
    run_job_pipeline,
)
from app.application.runtime_service import OperationCancelledError, get_container
from app.models.domain import JobStatus

router = APIRouter(prefix="/jobs", tags=["jobs"])


# ============================================================================
# 1. BATCH PIPELINE ROUTES (Mounted first: /jobs/batch/*)
# ============================================================================


@router.post("/batch/run", response_model=None)
async def run_batch_pipeline(
    body: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    """Start multi-video batch execution in background."""
    raw_job_ids = body.get("job_ids") or []
    if isinstance(raw_job_ids, str):
        job_ids = [raw_job_ids]
    elif isinstance(raw_job_ids, list):
        job_ids = [str(j).strip() for j in raw_job_ids if str(j).strip()]
    else:
        job_ids = []

    if not job_ids:
        raise HTTPException(status_code=400, detail="No job IDs provided")

    options = body.get("options")
    if not isinstance(options, dict):
        options = {}

    runner = get_batch_runner()
    batch = runner.start_batch(job_ids, options=options)
    return {"batch_id": batch.batch_id, "status": "started"}


@router.get("/batch/{batch_id}/status", response_model=None)
async def get_batch_pipeline_status(batch_id: str) -> dict[str, Any]:
    """Retrieve real-time batch execution progress and approval status."""
    runner = get_batch_runner()
    status = runner.get_batch_status(batch_id)
    if not status:
        raise HTTPException(status_code=404, detail="Batch process not found")
    return status.model_dump()


@router.post("/batch/{batch_id}/cancel", response_model=None)
async def cancel_batch_pipeline(batch_id: str) -> dict[str, Any]:
    """Cancel batch processing and immediately propagate cooperative cancellation to active job."""
    runner = get_batch_runner()
    status = runner.get_batch_status(batch_id)
    if not status:
        raise HTTPException(status_code=404, detail="Batch process not found")

    runner.cancel_batch(batch_id)
    return {"status": "cancelled"}


@router.post("/batch/{batch_id}/continue", response_model=None)
async def continue_batch_pipeline(batch_id: str) -> dict[str, Any]:
    """Resume batch pipeline execution after user curation or interrupted state."""
    runner = get_batch_runner()
    status = runner.get_batch_status(batch_id)
    if not status:
        raise HTTPException(status_code=404, detail="Batch process not found")

    runner.continue_batch(batch_id)
    return {"status": "continued"}


# ============================================================================
# 2. 1-CLICK PIPELINE RUN ROUTE (/jobs/{job_id}/run)
# ============================================================================


@router.post("/{job_id}/run", response_model=None)
async def run_single_job_pipeline(
    job_id: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    """Run full 1-click sequential processing pipeline for a job."""
    include_render = bool(body.get("include_render", True))
    try:
        job = await run_job_pipeline(job_id, include_render=include_render)
        return job.model_dump()
    except JobNotFoundError:
        raise
    except OperationCancelledError as exc:
        raise HTTPException(status_code=409, detail="Pipeline cancelled") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/{job_id}/cancel", response_model=None)
async def cancel_job_pipeline(job_id: str) -> dict[str, Any]:
    """Cooperative cancellation for any active task on job_id (1-click, ingest, transcribe, render)."""
    c = get_container()
    try:
        job = c.jobs.load_job(job_id)
    except JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found")

    # 1. Trigger runtime cancel for all tasks registered to job_id and kill subprocess trees
    c.runtime.request_cancel(job_id)

    # 2. Cleanup any partial render/download files
    c.runtime.cleanup_partial_files(job_id)

    # 3. Reset job status to DOWNLOADED (if downloaded video exists) or CREATED (if never ingested)
    source_video = c.jobs.find_source_video(job_id)
    new_status = JobStatus.DOWNLOADED if (source_video and source_video.exists()) else JobStatus.CREATED
    c.jobs.update_job_status(job_id, new_status)

    # 4. Append cancellation log & publish SSE events
    c.runtime.append_task_log(job_id, "orchestrator", "[orchestrator] Operação cancelada pelo usuário")
    c.runtime.publish_progress(
        job_id,
        status=new_status.value,
        task="orchestrator",
        percent=0.0,
        eta_seconds=0,
        message="Operação cancelada pelo usuário",
    )
    c.runtime.publish_state_change(job_id, new_status.value, "Operação cancelada pelo usuário")

    return {
        "ok": True,
        "job_id": job_id,
        "status": "cancelled",
        "new_status": new_status.value,
    }


# All modular job routers in exact priority order
all_job_routers = (
    router,
    jobs_ingest.router,
    jobs_transcription.router,
    jobs_analysis.router,
    jobs_render.router,
)
