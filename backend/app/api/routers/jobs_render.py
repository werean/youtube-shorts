"""FastAPI router for job vertical video rendering (`/jobs/{job_id}/render*` and `/jobs/{job_id}/renders*`)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Request
from fastapi.responses import JSONResponse

from app.api.routers.videos import default_open_folder_for_file
from app.application.job_lifecycle import JobNotFoundError
from app.application.runtime_service import get_container
from app.core.settings import archived_videos_dir, load_settings
from app.domain.rendering.rendering_service import (
    cancel_rendering_job,
    delete_rendered_file,
    get_rendering_service,
    list_render_output_urls,
)

router = APIRouter(prefix="/jobs", tags=["render"])


@router.post("/{job_id}/render", response_model=None)
async def start_render_cuts(
    job_id: str,
    background_tasks: BackgroundTasks,
    request: Request,
) -> Any:
    """Start rendering approved vertical cuts for `job_id` in background."""
    container = get_container()
    # Validate job exists (raises JobNotFoundError -> 404 if not found)
    job = container.jobs.load_job(job_id)

    conflict = container.runtime.conflicting_active_rendering_job_id(job_id)
    if conflict:
        return JSONResponse(
            status_code=409,
            content={
                "detail": (
                    f"Renderização já em andamento para outro vídeo ({conflict}). "
                    "Cancele a renderização anterior para começar uma nova."
                )
            },
        )

    # Optional cut_ids from request body
    cut_ids: list[str] | None = None
    try:
        body = await request.json()
        if isinstance(body, dict) and "cut_ids" in body and isinstance(body["cut_ids"], list):
            cut_ids = [str(cid) for cid in body["cut_ids"]]
    except Exception:
        pass

    service = get_rendering_service(container=container)

    async def _run_in_background() -> None:
        try:
            await service.render_job(job_id, cut_ids=cut_ids)
        except Exception as exc:
            # Errors are already logged to task_logs and job.status is set to ERROR
            pass

    background_tasks.add_task(_run_in_background)
    return {"started": True}


@router.post("/{job_id}/render/cancel", response_model=None)
async def cancel_render(job_id: str) -> Any:
    """Cancel active vertical video rendering for `job_id`."""
    container = get_container()
    container.jobs.load_job(job_id)

    cancelled = cancel_rendering_job(job_id, container=container)
    if not cancelled:
        return JSONResponse(
            status_code=404,
            content={"detail": "Rendering not running"},
        )

    return {"ok": True, "job_id": job_id}


@router.get("/{job_id}/renders", response_model=None)
async def get_renders(job_id: str) -> Any:
    """List relative streaming URLs for rendered shorts of `job_id`."""
    container = get_container()
    container.jobs.load_job(job_id)
    return list_render_output_urls(job_id, container=container)


@router.delete("/{job_id}/renders/{file}", response_model=None)
async def delete_render(job_id: str, file: str) -> Any:
    """Delete a rendered short file from `shorts/` directory."""
    container = get_container()
    container.jobs.load_job(job_id)

    deleted, safe_name = delete_rendered_file(job_id, file, container=container)
    if not deleted:
        return JSONResponse(
            status_code=404,
            content={"detail": "Render file not found"},
        )

    return {"ok": True, "file": safe_name}


@router.post("/{job_id}/renders/{file}/open-folder", response_model=None)
async def open_render_folder(job_id: str, file: str) -> Any:
    """Open OS file explorer focused on a rendered short file."""
    container = get_container()
    job = container.jobs.load_job(job_id)

    safe_name = Path(file).name
    shorts_dir = container.jobs.shorts_dir_path(job_id, create=False)
    target_path = shorts_dir / safe_name

    if not target_path.exists() or not target_path.is_file():
        return JSONResponse(
            status_code=404,
            content={"detail": "Render file not found"},
        )

    s = load_settings()
    allowed_roots = [
        Path(s.media.base_dir),
        archived_videos_dir(create=True),
        shorts_dir,
    ]
    opener = container.folder_opener or default_open_folder_for_file
    result = opener(target_path, allowed_roots)
    if not result.get("ok"):
        status_code = int(result.get("status_code") or 500)
        return JSONResponse(
            status_code=status_code,
            content={"detail": result.get("detail") or "Failed to open folder"},
        )

    return {"ok": True}
