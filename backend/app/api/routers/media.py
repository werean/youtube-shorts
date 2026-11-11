"""Media streaming router (`/media/videos/:job_id` and `/media/shorts/:job_id/:file`) with HTTP Range 206 support."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterator

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.application.job_lifecycle import JobNotFoundError
from app.application.runtime_service import get_container

router = APIRouter(prefix="/media", tags=["media"])

_RANGE_RE = re.compile(r"^bytes=(\d+)-(\d+)?$")
_CHUNK_SIZE = 64 * 1024

_MIME_TYPES: dict[str, str] = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".m4v": "video/x-m4v",
}


def get_video_mime_type(file_path: Path) -> str:
    return _MIME_TYPES.get(file_path.suffix.lower(), "application/octet-stream")


def _iter_file_range(file_path: Path, start: int, end: int) -> Iterator[bytes]:
    remaining = end - start + 1
    with open(file_path, "rb") as f:
        f.seek(start)
        while remaining > 0:
            chunk = f.read(min(_CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk


def build_video_stream_response(request: Request, file_path: Path) -> Response:
    stat = file_path.stat()
    file_size = stat.st_size
    content_type = get_video_mime_type(file_path)
    base_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
    }

    range_header = request.headers.get("range")
    if range_header:
        match = _RANGE_RE.match(range_header.strip())
        if not match:
            return Response(
                status_code=416,
                headers={
                    **base_headers,
                    "Content-Range": f"bytes */{file_size}",
                },
            )
        start = int(match.group(1))
        end = int(match.group(2)) if match.group(2) is not None else file_size - 1
        safe_end = min(end, file_size - 1)

        if file_size == 0 or start >= file_size or safe_end < start:
            return Response(
                status_code=416,
                headers={
                    **base_headers,
                    "Content-Range": f"bytes */{file_size}",
                },
            )

        chunk_size = safe_end - start + 1
        headers = {
            **base_headers,
            "Content-Range": f"bytes {start}-{safe_end}/{file_size}",
            "Content-Length": str(chunk_size),
        }
        return StreamingResponse(
            _iter_file_range(file_path, start, safe_end),
            status_code=206,
            media_type=content_type,
            headers=headers,
        )

    headers = {
        **base_headers,
        "Content-Length": str(file_size),
    }
    return StreamingResponse(
        _iter_file_range(file_path, 0, max(0, file_size - 1)) if file_size > 0 else iter((b"",)),
        status_code=200,
        media_type=content_type,
        headers=headers,
    )


@router.get("/videos/{job_id}", response_model=None)
async def stream_source_video(job_id: str, request: Request) -> Response:
    container = get_container()
    try:
        job = container.jobs.load_job(job_id)
    except JobNotFoundError:
        return JSONResponse(status_code=404, content={"detail": f"Job {job_id} not found"})

    file_path_str = job.source_video_path
    if file_path_str:
        file_path = Path(file_path_str)
        if not file_path.exists():
            fallback = container.jobs.find_source_video(job_id)
            if fallback is None:
                return JSONResponse(
                    status_code=404,
                    content={"detail": f"Video file not found at {file_path_str}"},
                )
            file_path = fallback
    else:
        fallback = container.jobs.find_source_video(job_id)
        if fallback is None:
            return JSONResponse(status_code=404, content={"detail": "Video path not set"})
        file_path = fallback

    return build_video_stream_response(request, file_path)


@router.get("/shorts/{job_id}/{file}", response_model=None)
async def stream_short_video(job_id: str, file: str, request: Request) -> Response:
    container = get_container()
    safe_file = Path(file).name
    shorts_dir = container.jobs.shorts_dir_path(job_id, create=False)
    file_path = shorts_dir / safe_file
    if not file_path.exists() or not file_path.is_file():
        return JSONResponse(status_code=404, content={"detail": "Short not found"})

    return build_video_stream_response(request, file_path)
