"""Phase 2 Job Lifecycle & Ingest Routes (`/jobs`, `/jobs/upload`, `/jobs/{job_id}`, `/events`, `/rename`, `/ingest`, `/logs/{task}`)."""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator

import re

from fastapi import APIRouter, Body, Depends, File, HTTPException, Query, Request, UploadFile
from fastapi.responses import JSONResponse, StreamingResponse

from app.api.local_only import require_local_ui
from app.api.routers.videos import attach_last_error, default_open_directory, default_open_folder_for_file
from app.application.job_lifecycle import JobNotFoundError
from app.core import paths
from app.application.runtime_service import JobEvent, VALID_TASK_NAMES, get_container
from app.domain.ingest.service import get_ingest_service

router = APIRouter(tags=["jobs-ingest"])


@router.post("/jobs")
async def create_job(body: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    youtube_url = str(body.get("youtube_url") or "").strip()
    if not youtube_url:
        raise HTTPException(status_code=400, detail="youtube_url is required")
    c = get_container()
    job = c.jobs.create_job(youtube_url)
    return {"job": job.model_dump()}


@router.post("/jobs/upload")
async def upload_job(file: UploadFile | None = File(default=None)) -> dict[str, Any]:
    if file is None or not file.filename:
        raise HTTPException(status_code=400, detail="No file uploaded")
    try:
        content = await file.read()
        result = await get_ingest_service().upload_local_video(
            filename=file.filename,
            content=content,
        )
        job = result["job"]
        return {
            "job": job.model_dump() if hasattr(job, "model_dump") else job,
            "video_path": result["video_path"],
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc) or "Internal server error") from exc


@router.get("/jobs/{job_id}")
async def get_job(job_id: str) -> dict[str, Any]:
    c = get_container()
    job = c.jobs.load_job(job_id)
    return attach_last_error(job.model_dump()) or {}


@router.get("/jobs/{job_id}/events")
async def stream_job_events(
    job_id: str,
    request: Request,
    follow: bool = Query(default=False),
) -> StreamingResponse:
    c = get_container()
    job = c.jobs.load_job(job_id)

    accept_header = request.headers.get("accept", "").lower()
    is_browser_eventsource = "text/event-stream" in accept_header
    query_follow_param = request.query_params.get("follow")
    if query_follow_param is not None:
        should_follow = query_follow_param.lower() in ("true", "1", "yes")
    else:
        should_follow = is_browser_eventsource or follow

    async def _sse_generator() -> AsyncIterator[str]:
        async with c.runtime.event_bus.subscribe(job_id, replay_history=True) as queue:
            # If no state event is in history, emit the current job state first
            has_state_event = any(e.event == "state" for e in c.runtime.event_bus.get_history(job_id))
            if not has_state_event:
                initial = JobEvent(
                    job_id=job_id,
                    event="state",
                    data={
                        "job_id": job_id,
                        "status": c.runtime._normalize_status(job.status),
                        "message": "",
                    },
                )
                yield initial.format_sse()

            while not queue.empty():
                evt = queue.get_nowait()
                if evt is None:
                    return
                yield evt.format_sse()

            # If not in continuous follow mode, exit after initial / history replay
            if not should_follow:
                return

            # Continue streaming live events while client is connected
            idle_ping_counter = 0
            while True:
                try:
                    evt = await asyncio.wait_for(queue.get(), timeout=1.0)
                    if evt is None:
                        break
                    yield evt.format_sse()
                except asyncio.TimeoutError:
                    idle_ping_counter += 1
                    if idle_ping_counter >= 15:
                        idle_ping_counter = 0
                        yield ": keep-alive\n\n"

                    # Only exit if the job reached terminal state and queue is drained
                    try:
                        latest_job = c.jobs.load_job(job_id)
                        if latest_job.status in (JobStatus.DONE, JobStatus.ERROR) and queue.empty():
                            break
                    except Exception:
                        pass
                    continue

    return StreamingResponse(
        _sse_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


async def _handle_rename_job(job_id: str, body: dict[str, Any]) -> dict[str, Any]:
    new_name_raw = body.get("new_name") if isinstance(body, dict) else None
    new_name = str(new_name_raw).strip() if isinstance(new_name_raw, str) else ""
    if not new_name:
        raise HTTPException(status_code=400, detail="new_name is required")
    c = get_container()
    try:
        job = c.jobs.rename_video(job_id, new_name)
        return job.model_dump()
    except JobNotFoundError:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc) or "Failed to rename video") from exc


@router.post("/jobs/{job_id}/rename")
async def rename_job_post(
    job_id: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    return await _handle_rename_job(job_id, body)


@router.put("/jobs/{job_id}/rename")
async def rename_job_put(
    job_id: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    return await _handle_rename_job(job_id, body)


@router.post("/jobs/{job_id}/ingest")
async def ingest_job_route(job_id: str) -> dict[str, Any]:
    try:
        return await get_ingest_service().ingest_job(job_id)
    except JobNotFoundError:
        raise
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


_JOB_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


@router.post(
    "/jobs/{job_id}/logs/open-folder",
    response_model=None,
    dependencies=[Depends(require_local_ui)],
)
async def open_job_logs_folder(job_id: str) -> Any:
    """Open the job's logs folder in the OS file explorer (`erro.log` selected when it exists).

    Local-only (it launches a program on the host). The id must be a plain token and the resolved folder must
    stay inside `{media.base_dir}/logs`, so no other path can ever be opened.
    """
    if not _JOB_ID_RE.fullmatch(job_id):
        return JSONResponse(status_code=400, content={"detail": "Invalid job id"})

    container = get_container()
    try:
        container.jobs.load_job(job_id)
    except JobNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "Job not found"})

    logs_root = paths.logs_dir()
    folder = paths.job_logs_dir(job_id)
    try:
        folder.resolve().relative_to(logs_root.resolve())
    except ValueError:
        return JSONResponse(status_code=400, content={"detail": "Invalid job id"})
    folder.mkdir(parents=True, exist_ok=True)

    error_file = paths.job_error_log_path(job_id)
    if error_file.is_file():
        opener = container.folder_opener or default_open_folder_for_file
        result = opener(error_file, [logs_root])
    else:
        dir_opener = container.dir_opener or default_open_directory
        result = dir_opener(folder, [logs_root])
    if not result.get("ok"):
        return JSONResponse(
            status_code=int(result.get("status_code") or 500),
            content={"detail": result.get("detail") or "Failed to open folder"},
        )
    return {"ok": True}


@router.get("/jobs/{job_id}/logs/{task}")
async def get_job_task_logs(job_id: str, task: str) -> dict[str, Any]:
    if task not in VALID_TASK_NAMES:
        raise HTTPException(status_code=400, detail="Invalid task")
    c = get_container()
    logs = c.runtime.get_task_logs(job_id, task)
    return {
        "task": task,
        "logs": logs,
    }
