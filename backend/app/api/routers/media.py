"""Media streaming router (`/media/videos/:job_id`, `/media/shorts/:job_id/:file`, `/media/dubs/*`) with HTTP Range 206 support."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Iterator

from fastapi import APIRouter, Query, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse

from app.application.job_lifecycle import JobNotFoundError
from app.application.runtime_service import get_container
from app.core.paths import dubs_dir_path
from app.domain.dubbing.manifest_store import load_dubbing_manifest

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
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".vtt": "text/vtt; charset=utf-8",
    ".srt": "application/x-subrip; charset=utf-8",
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


def build_video_stream_response(
    request: Request,
    file_path: Path,
    *,
    download: bool = False,
) -> Response:
    stat = file_path.stat()
    file_size = stat.st_size
    content_type = get_video_mime_type(file_path)
    base_headers: dict[str, str] = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "no-cache",
    }
    if download:
        safe_filename = file_path.name.replace('"', "_")
        base_headers["Content-Disposition"] = f'attachment; filename="{safe_filename}"'

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


def _is_safe_media_segment(segment: str) -> bool:
    if not segment or segment in {".", ".."}:
        return False
    if "/" in segment or "\\" in segment or "\x00" in segment:
        return False
    return True


@router.get("/shorts/{job_id}/attempts/{attempt_id}/{file}", response_model=None)
async def stream_attempt_short_video(
    job_id: str,
    attempt_id: str,
    file: str,
    request: Request,
) -> Response:
    if not (
        _is_safe_media_segment(job_id)
        and _is_safe_media_segment(attempt_id)
        and _is_safe_media_segment(file)
    ):
        return JSONResponse(status_code=400, content={"detail": "Invalid path segment"})

    container = get_container()
    try:
        shorts_dir = container.jobs.attempt_shorts_dir_path(job_id, attempt_id, create=False)
    except ValueError:
        return JSONResponse(status_code=400, content={"detail": "Invalid path segment"})

    base_resolved = shorts_dir.resolve()
    file_path = (shorts_dir / file).resolve()
    try:
        file_path.relative_to(base_resolved)
    except ValueError:
        return JSONResponse(status_code=400, content={"detail": "Invalid path segment"})

    if not file_path.exists() or not file_path.is_file():
        return JSONResponse(status_code=404, content={"detail": "Short not found"})

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


def _resolve_dub_lang_dir(job_id: str, lang: str) -> tuple[Path | None, Response | None]:
    if not (_is_safe_media_segment(job_id) and _is_safe_media_segment(lang)):
        return None, JSONResponse(status_code=400, content={"detail": "Invalid path segment"})
    container = get_container()
    try:
        job = container.jobs.load_job(job_id)
    except JobNotFoundError:
        return None, JSONResponse(status_code=404, content={"detail": f"Job {job_id} not found"})
    video_dir = container.video_dir(job_id, job.video_name)
    lang_dir = dubs_dir_path(video_dir, create=False) / lang
    return lang_dir, None


def _serve_dub_file(
    request: Request,
    base_dir: Path,
    target_path: Path,
    *,
    download: bool = False,
    not_found_detail: str = "Dubbing artifact not found",
) -> Response:
    base_resolved = base_dir.resolve()
    file_resolved = target_path.resolve()
    try:
        file_resolved.relative_to(base_resolved)
    except ValueError:
        return JSONResponse(status_code=400, content={"detail": "Invalid path segment"})

    if not file_resolved.exists() or not file_resolved.is_file():
        return JSONResponse(status_code=404, content={"detail": not_found_detail})

    return build_video_stream_response(request, file_resolved, download=download)


@router.get("/dubs/{job_id}/{lang}/audio", response_model=None)
async def stream_dub_audio(job_id: str, lang: str, request: Request) -> Response:
    lang_dir, err = _resolve_dub_lang_dir(job_id, lang)
    if err is not None or lang_dir is None:
        return err  # type: ignore[return-value]
    return _serve_dub_file(
        request,
        lang_dir,
        lang_dir / "dub.audio.m4a",
        not_found_detail="Dubbed audio not found",
    )


@router.get("/dubs/{job_id}/{lang}/preview-audio", response_model=None)
async def stream_dub_preview_audio(job_id: str, lang: str, request: Request) -> Response:
    lang_dir, err = _resolve_dub_lang_dir(job_id, lang)
    if err is not None or lang_dir is None:
        return err  # type: ignore[return-value]
    return _serve_dub_file(
        request,
        lang_dir,
        lang_dir / "_preview" / "preview.audio.m4a",
        not_found_detail="Preview audio not found",
    )


@router.get("/dubs/{job_id}/{lang}/subtitles.vtt", response_model=None)
async def stream_dub_subtitles_vtt(job_id: str, lang: str, request: Request) -> Response:
    lang_dir, err = _resolve_dub_lang_dir(job_id, lang)
    if err is not None or lang_dir is None:
        return err  # type: ignore[return-value]
    return _serve_dub_file(
        request,
        lang_dir,
        lang_dir / "dub.vtt",
        not_found_detail="Dubbed VTT subtitles not found",
    )


@router.get("/dubs/{job_id}/{lang}/subtitles.srt", response_model=None)
async def stream_dub_subtitles_srt(job_id: str, lang: str, request: Request) -> Response:
    lang_dir, err = _resolve_dub_lang_dir(job_id, lang)
    if err is not None or lang_dir is None:
        return err  # type: ignore[return-value]
    return _serve_dub_file(
        request,
        lang_dir,
        lang_dir / "dub.srt",
        not_found_detail="Dubbed SRT subtitles not found",
    )


@router.get("/dubs/{job_id}/{lang}/preview.vtt", response_model=None)
async def stream_dub_preview_vtt(job_id: str, lang: str, request: Request) -> Response:
    lang_dir, err = _resolve_dub_lang_dir(job_id, lang)
    if err is not None or lang_dir is None:
        return err  # type: ignore[return-value]
    return _serve_dub_file(
        request,
        lang_dir,
        lang_dir / "_preview" / "preview.vtt",
        not_found_detail="Preview VTT subtitles not found",
    )


@router.get("/dubs/{job_id}/{lang}/export.mp4", response_model=None)
async def stream_dub_exported_mp4(
    job_id: str,
    lang: str,
    request: Request,
    download: int = Query(default=0),
) -> Response:
    lang_dir, err = _resolve_dub_lang_dir(job_id, lang)
    if err is not None or lang_dir is None:
        return err  # type: ignore[return-value]

    candidates: list[Path] = []
    manifest = load_dubbing_manifest(job_id)
    if manifest is not None and lang in (manifest.tracks or {}):
        exp = getattr(manifest.tracks[lang], "exported_mp4_path", None)
        if exp:
            candidates.append(Path(str(exp)))

    candidates.extend(
        [
            lang_dir / "dub.video.mp4",
            lang_dir / f"video.{lang}.dub.mp4",
            lang_dir / f"video.{lang}.hardsub.mp4",
        ]
    )

    chosen = next((p for p in candidates if p.exists() and p.is_file()), candidates[0])
    return _serve_dub_file(
        request,
        lang_dir,
        chosen,
        download=bool(download),
        not_found_detail="Exported dubbed MP4 not found",
    )


@router.get("/dubs/{job_id}/{lang}/_preview/{file}", response_model=None)
async def stream_dub_preview_file(
    job_id: str,
    lang: str,
    file: str,
    request: Request,
) -> Response:
    if not _is_safe_media_segment(file):
        return JSONResponse(status_code=400, content={"detail": "Invalid path segment"})
    lang_dir, err = _resolve_dub_lang_dir(job_id, lang)
    if err is not None or lang_dir is None:
        return err  # type: ignore[return-value]
    return _serve_dub_file(
        request,
        lang_dir,
        lang_dir / "_preview" / file,
        not_found_detail="Preview file not found",
    )


@router.get("/dubs/{job_id}/_cuts/{cut_id}/{lang}/{file}", response_model=None)
async def stream_cut_dub_file(
    job_id: str,
    cut_id: str,
    lang: str,
    file: str,
    request: Request,
    download: int = Query(default=0),
) -> Response:
    if not (
        _is_safe_media_segment(job_id)
        and _is_safe_media_segment(cut_id)
        and _is_safe_media_segment(lang)
        and _is_safe_media_segment(file)
    ):
        return JSONResponse(status_code=400, content={"detail": "Invalid path segment"})

    container = get_container()
    try:
        job = container.jobs.load_job(job_id)
    except JobNotFoundError:
        return JSONResponse(status_code=404, content={"detail": f"Job {job_id} not found"})

    video_dir = container.video_dir(job_id, job.video_name)
    cut_lang_dir = dubs_dir_path(video_dir, create=False) / "_cuts" / cut_id / lang
    return _serve_dub_file(
        request,
        cut_lang_dir,
        cut_lang_dir / file,
        download=bool(download),
        not_found_detail="Cut dubbing file not found",
    )


@router.get("/dubs/{job_id}/{lang}/{file}", response_model=None)
async def stream_dub_file_by_name(
    job_id: str,
    lang: str,
    file: str,
    request: Request,
    download: int = Query(default=0),
) -> Response:
    if not _is_safe_media_segment(file):
        return JSONResponse(status_code=400, content={"detail": "Invalid path segment"})
    lang_dir, err = _resolve_dub_lang_dir(job_id, lang)
    if err is not None or lang_dir is None:
        return err  # type: ignore[return-value]
    return _serve_dub_file(
        request,
        lang_dir,
        lang_dir / file,
        download=bool(download),
        not_found_detail="Dubbing file not found",
    )
