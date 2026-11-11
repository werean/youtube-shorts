"""Phase 3 Transcription Routes (`/jobs/{job_id}/transcribe`, `/cancel`, `/transcription`, `/transcription/{format}`)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException

from app.application.job_lifecycle import JobNotFoundError
from app.application.runtime_service import OperationCancelledError, get_container
from app.domain.transcription.service import get_transcription_service

router = APIRouter(tags=["jobs-transcription"])

VALID_DELETE_FORMATS: frozenset[str] = frozenset({"segments", "text", "vtt", "json", "txt"})


@router.post("/jobs/{job_id}/transcribe")
async def transcribe_job_route(job_id: str) -> dict[str, Any]:
    try:
        result = await get_transcription_service().transcribe_job(job_id)
        return result.model_dump()
    except JobNotFoundError:
        raise
    except OperationCancelledError as exc:
        raise HTTPException(status_code=409, detail="Transcription cancelled") from exc
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/jobs/{job_id}/transcribe/cancel")
async def cancel_transcription_route(job_id: str) -> dict[str, Any]:
    cancelled = get_transcription_service().cancel_transcription(job_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="Transcription not running")
    return {
        "ok": True,
        "job_id": job_id,
    }


@router.get("/jobs/{job_id}/transcription")
async def get_transcription_route(job_id: str) -> dict[str, Any]:
    response = get_transcription_service().get_transcription(job_id)
    if response is None:
        raise HTTPException(status_code=404, detail="Transcription not found")
    return response.model_dump()


@router.delete("/jobs/{job_id}/transcription")
async def delete_all_transcription_route(job_id: str) -> dict[str, Any]:
    c = get_container()
    try:
        any_deleted, available_formats = c.jobs.delete_transcription_artifacts(job_id, fmt=None)
    except JobNotFoundError:
        raise HTTPException(status_code=404, detail="Transcription not found")

    if not any_deleted:
        raise HTTPException(status_code=404, detail="Transcription not found")

    return {
        "ok": True,
        "job_id": job_id,
        "available_formats": available_formats.model_dump(),
    }


@router.delete("/jobs/{job_id}/transcription/{format}")
async def delete_transcription_format_route(job_id: str, format: str) -> dict[str, Any]:
    normalized = (format or "").strip().lower()
    if normalized not in VALID_DELETE_FORMATS:
        raise HTTPException(status_code=400, detail="Invalid format")

    c = get_container()
    try:
        any_deleted, available_formats = c.jobs.delete_transcription_artifacts(
            job_id, fmt=normalized
        )
    except JobNotFoundError:
        raise HTTPException(status_code=404, detail="Transcription not found")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid format")

    if not any_deleted:
        raise HTTPException(status_code=404, detail="Transcription not found")

    return {
        "ok": True,
        "job_id": job_id,
        "available_formats": available_formats.model_dump(),
    }
