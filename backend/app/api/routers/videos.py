"""Video library router (`/videos/*`)."""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse

from app.application.job_lifecycle import (
    ACTIVE_PROCESSING_STATUSES,
    JobNotFoundError,
    utc_now_iso,
)
from app.application.runtime_service import get_container
from app.core.paths import is_hidden_or_internal_dir_name, job_logs_dir
from app.core.settings import (
    archived_videos_dir,
    get_archived_video_dir,
    get_video_dir,
    load_settings,
)
from app.models.domain import Job, JobStatus
from app.models.schemas import VideoRecord

router = APIRouter(prefix="/videos", tags=["videos"])

VIDEO_EXTENSIONS = {".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".flv"}


def _is_video_file(file_name: str) -> bool:
    return Path(file_name).suffix.lower() in VIDEO_EXTENSIONS


def _collect_video_files(root_dir: Path, archived: bool) -> list[dict[str, Any]]:
    if not root_dir.exists():
        return []
    results: list[dict[str, Any]] = []
    for entry in sorted(root_dir.iterdir(), key=lambda p: p.name):
        if not archived and entry.name == "_archived":
            continue
        if is_hidden_or_internal_dir_name(entry.name):
            continue
        if not entry.is_dir():
            continue
        video_file: Path | None = None
        # Priority 1: inner file named 'video.*'
        for inner in sorted(entry.iterdir(), key=lambda p: p.name):
            if inner.is_file() and inner.name.startswith("video.") and _is_video_file(inner.name):
                video_file = inner
                break
        # Priority 2: any valid video file
        if video_file is None:
            for inner in sorted(entry.iterdir(), key=lambda p: p.name):
                if inner.is_file() and _is_video_file(inner.name):
                    video_file = inner
                    break

        if video_file is not None:
            results.append(
                {
                    "file_name": video_file.name,
                    "file_path": video_file,
                    "video_name": entry.name,
                }
            )
    return results


def _normalize_path_key(p: str | Path) -> str:
    return os.path.normcase(os.path.normpath(str(p)))


def _list_videos_from_dir(root_dir: Path, archived: bool) -> list[dict[str, Any]]:
    container = get_container()
    items = _collect_video_files(root_dir, archived)
    jobs_by_path: dict[str, Job] = {}
    for job in container.jobs.list_jobs():
        if job.source_video_path:
            jobs_by_path[_normalize_path_key(job.source_video_path)] = job

    records: list[VideoRecord] = []
    for item in items:
        fpath: Path = item["file_path"]
        fname: str = item["file_name"]
        vname: str = item["video_name"]
        key = _normalize_path_key(fpath)
        job = jobs_by_path.get(key)
        if job is None:
            job = container.jobs.create_job(
                youtube_url=f"[Local Video] {vname}",
                status=JobStatus.DOWNLOADED,
                source_video_path=str(fpath),
                source_file_name=fname,
                video_name=vname,
            )
            jobs_by_path[key] = job

        records.append(
            VideoRecord(
                job=job,
                job_id=job.job_id,
                video_path=f"/media/videos/{job.job_id}",
                archived=archived,
                hasTranscription=container.jobs.has_transcription(job.job_id),
                hasAnalysis=container.jobs.has_analysis(job.job_id),
                attempts_count=container.jobs.count_attempts(job.job_id),
            )
        )

    records.sort(key=lambda r: (r.job.created_at if r.job else ""))
    return [r.model_dump() for r in records]


def _is_subpath(parent_dir: Path, child_path: Path) -> bool:
    try:
        child_path.resolve().relative_to(parent_dir.resolve())
        return True
    except ValueError:
        return False


def default_open_folder_for_file(
    file_path: Path,
    allowed_roots: list[Path] | None = None,
) -> dict[str, Any]:
    if not file_path or not str(file_path).strip():
        return {"ok": False, "detail": "Invalid path", "status_code": 400}

    resolved = file_path.resolve()
    if not resolved.exists():
        return {"ok": False, "detail": "File not found", "status_code": 404}
    if not resolved.is_file():
        return {"ok": False, "detail": "Path is not a file", "status_code": 400}

    if allowed_roots:
        if not any(_is_subpath(root, resolved) for root in allowed_roots):
            return {"ok": False, "detail": "Path not allowed", "status_code": 400}

    if os.name != "nt":
        return {
            "ok": False,
            "detail": "Open Folder is only supported on Windows",
            "status_code": 500,
        }

    try:
        subprocess.Popen(["explorer.exe", "/select,", str(resolved)])
        return {"ok": True}
    except Exception as exc:
        return {"ok": False, "detail": str(exc) or "Failed to open folder", "status_code": 500}


@router.get("")
async def list_active_videos(
    limit: int | None = Query(default=None, ge=1),
    offset: int = Query(default=0, ge=0),
) -> list[dict[str, Any]]:
    base_dir = Path(load_settings().media.base_dir)
    items = _list_videos_from_dir(base_dir, archived=False)
    if offset > 0:
        items = items[offset:]
    if limit is not None:
        items = items[:limit]
    return items


@router.get("/archived")
async def list_archived_videos() -> list[dict[str, Any]]:
    arch_dir = archived_videos_dir(create=True)
    return _list_videos_from_dir(arch_dir, archived=True)


@router.post("/{job_id}/archive", response_model=None)
async def archive_video(job_id: str) -> Any:
    container = get_container()
    try:
        job = container.jobs.load_job(job_id)
    except JobNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "Video not found"})

    active_tasks = container.runtime.is_any_task_active(job_id)
    if active_tasks or job.status in ACTIVE_PROCESSING_STATUSES:
        reason = ", ".join(active_tasks) or str(job.status.value if hasattr(job.status, "value") else job.status)
        return JSONResponse(
            status_code=409,
            content={"detail": f"Não é possível arquivar enquanto há processamento ativo ({reason})."},
        )

    video_name = job.video_name or job_id
    video_dir = get_video_dir(job_id, video_name)
    if not video_dir.exists():
        return JSONResponse(status_code=404, content={"detail": "Video not found"})

    target_dir = get_archived_video_dir(video_name, create=False)
    target_dir.parent.mkdir(parents=True, exist_ok=True)
    if target_dir.exists():
        shutil.rmtree(target_dir, ignore_errors=True)
    shutil.move(str(video_dir), str(target_dir))

    for f in sorted(target_dir.iterdir(), key=lambda p: p.name):
        if f.is_file() and f.name.startswith("video."):
            job.source_video_path = str(f)
            break

    job.updated_at = utc_now_iso()
    container.jobs.save_job(job)
    return {"ok": True, "job_id": job_id}


async def _atomic_trash_and_remove_dir(
    target_dir: Path,
    trash_root: Path,
    job_id: str,
) -> Path | None:
    """Atomically move `target_dir` to a `.trash_*` tombstone with 3x150ms retries before deletion."""
    if not target_dir.exists():
        return None

    trash_root.mkdir(parents=True, exist_ok=True)
    trash_path = trash_root / f".trash_{job_id}_{uuid.uuid4().hex[:8]}"
    last_err: OSError | None = None
    for attempt in range(3):
        try:
            os.replace(str(target_dir), str(trash_path))
            return trash_path
        except PermissionError as exc:
            last_err = exc
            if attempt < 2:
                await asyncio.sleep(0.15)
        except OSError as exc:
            last_err = exc
            if attempt < 2:
                await asyncio.sleep(0.15)
    raise last_err or PermissionError(f"Directory locked: {target_dir}")


@router.delete("/{job_id}", response_model=None)
async def delete_video(job_id: str) -> Any:
    container = get_container()
    try:
        job = container.jobs.load_job(job_id)
    except JobNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "Video not found"})

    active_tasks = container.runtime.is_any_task_active(job_id)
    if active_tasks or job.status in ACTIVE_PROCESSING_STATUSES:
        reason = ", ".join(active_tasks) or str(job.status.value if hasattr(job.status, "value") else job.status)
        return JSONResponse(
            status_code=409,
            content={
                "detail": (
                    f"Não é possível excluir enquanto há processamento ativo ({reason}). "
                    "Cancele a tarefa antes de excluir."
                )
            },
        )

    base_dir = Path(load_settings().media.base_dir).resolve()
    arch_root = archived_videos_dir(create=False).resolve()

    video_name = job.video_name or job_id
    active_dir = get_video_dir(job_id, video_name)
    arch_dir = get_archived_video_dir(video_name, create=False)

    candidates: list[tuple[Path, Path]] = []
    seen_keys: set[str] = set()

    def _add_candidate(d: Path, trash_root: Path) -> None:
        try:
            resolved = d.resolve()
        except OSError:
            resolved = d
        if resolved == base_dir or resolved == arch_root:
            return
        key = os.path.normcase(os.path.normpath(str(resolved)))
        if key not in seen_keys:
            seen_keys.add(key)
            candidates.append((d, trash_root))

    if job.source_video_path:
        svp_dir = Path(job.source_video_path).parent
        svp_parent = svp_dir.parent.resolve() if svp_dir.parent else base_dir
        _add_candidate(svp_dir, svp_parent)

    _add_candidate(active_dir, base_dir)
    _add_candidate(arch_dir, arch_root)

    trash_paths: list[Path] = []
    for target_dir, trash_root in candidates:
        if not target_dir.exists():
            continue
        try:
            moved_trash = await _atomic_trash_and_remove_dir(target_dir, trash_root, job_id)
            if moved_trash is not None:
                trash_paths.append(moved_trash)
        except OSError:
            return JSONResponse(
                status_code=409,
                content={
                    "detail": (
                        "Arquivo de vídeo ainda está em uso pelo player ou sistema operacional. "
                        "Aguarde um instante e tente excluir novamente."
                    )
                },
            )

    for tp in trash_paths:
        shutil.rmtree(tp, ignore_errors=True)

    container.jobs.delete_render_outputs(job_id)
    jdir = container.jobs.job_dir_path(job_id, create=False)
    if jdir.exists():
        shutil.rmtree(jdir, ignore_errors=True)

    ldir = job_logs_dir(job_id)
    if ldir.exists():
        shutil.rmtree(ldir, ignore_errors=True)

    container.jobs.invalidate_caches(job_id)
    return {"ok": True, "job_id": job_id}


@router.post("/{job_id}/open-folder", response_model=None)
async def open_video_folder(job_id: str) -> Any:
    container = get_container()
    try:
        job = container.jobs.load_job(job_id)
    except JobNotFoundError:
        return JSONResponse(status_code=404, content={"detail": "Video not found"})

    if not job.source_video_path:
        return JSONResponse(status_code=404, content={"detail": "Video path not set"})

    s = load_settings()
    allowed_roots = [Path(s.media.base_dir), archived_videos_dir(create=True)]
    opener = container.folder_opener or default_open_folder_for_file
    result = opener(Path(job.source_video_path), allowed_roots)
    if not result.get("ok"):
        status_code = int(result.get("status_code") or 500)
        return JSONResponse(
            status_code=status_code,
            content={"detail": result.get("detail") or "Failed to open folder"},
        )
    return {"ok": True}
