"""Stage 3 & Stage 4 API router (`/jobs/{job_id}/blocks`, `/analyze`, `/cuts*`)."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import JSONResponse

from app.application.runtime_service import get_container
from app.domain.analysis.narrative_miner import (
    CutNotFoundError,
    analyze_job,
    approve_all_cuts,
    approve_cut,
    list_cuts,
    reject_all_cuts,
    reject_cut,
    replace_cuts,
)
from app.domain.segmentation.semantic_blocks import build_semantic_blocks
from app.domain.segmentation.topic_segmentation import build_topic_segments
from app.infrastructure.llm.unified_adapter import (
    InvalidLLMJsonResponseError,
    LocalLLMUnavailableError,
)
from app.models.domain import Cut, SemanticBlock

router = APIRouter(prefix="/jobs", tags=["jobs-analysis"])


@router.post("/{job_id}/blocks", response_model=list[SemanticBlock])
async def create_job_semantic_blocks(job_id: str) -> list[SemanticBlock]:
    """Run Stage 3 discourse-aware semantic blocks + contextual TextTiling topic segmentation."""
    container = get_container()
    lmstudio = getattr(container, "lmstudio", None)
    try:
        if lmstudio is not None and lmstudio.cli_enabled():
            async with lmstudio.pipeline_session(job_id=job_id, task_log="topics"):
                blocks = build_semantic_blocks(job_id, container=container)
                await build_topic_segments(job_id, container=container)
                return blocks
        blocks = build_semantic_blocks(job_id, container=container)
        await build_topic_segments(job_id, container=container)
        return blocks
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{job_id}/analyze")
async def analyze_job_cuts(job_id: str) -> Any:
    """Auto-prepare blocks/topics if missing, run 3-phase narrative arc mining, and save `cuts.suggested.json`."""
    container = get_container()
    lmstudio = getattr(container, "lmstudio", None)
    try:
        if lmstudio is not None and lmstudio.cli_enabled():
            async with lmstudio.pipeline_session(job_id=job_id, task_log="analysis"):
                return await analyze_job(job_id, container=container)
        return await analyze_job(job_id, container=container)
    except LocalLLMUnavailableError as exc:
        return JSONResponse(status_code=exc.status_code, content=exc.to_dict())
    except InvalidLLMJsonResponseError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/{job_id}/cuts", response_model=list[Cut])
async def get_job_cuts(job_id: str) -> list[Cut]:
    """Return suggested/curated cuts saved in `cuts.suggested.json`."""
    return list_cuts(job_id)


@router.put("/{job_id}/cuts")
async def update_job_cuts(
    job_id: str,
    payload: Any = Body(default=None),
) -> dict[str, Any]:
    """Replace the canonical `cuts.suggested.json` artifact with the submitted array."""
    if not isinstance(payload, dict) or not isinstance(payload.get("cuts"), list):
        raise HTTPException(status_code=400, detail="cuts must be an array")
    try:
        cuts = replace_cuts(job_id, payload["cuts"])
        return {"ok": True, "cuts": cuts}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/{job_id}/cuts/approve-all", response_model=list[Cut])
async def approve_all_job_cuts(job_id: str) -> list[Cut]:
    """Atomically approve all cuts for `job_id` and set job status to `WAITING_APPROVAL`."""
    return approve_all_cuts(job_id)


@router.post("/{job_id}/cuts/reject-all", response_model=list[Cut])
async def reject_all_job_cuts(job_id: str) -> list[Cut]:
    """Atomically reject all cuts for `job_id` and set job status to `WAITING_APPROVAL`."""
    return reject_all_cuts(job_id)


@router.post("/{job_id}/cuts/{cut_id}/approve", response_model=Cut)
async def approve_job_cut(job_id: str, cut_id: str) -> Cut:
    """Atomically set a specific cut's status to `'approved'`."""
    try:
        return approve_cut(job_id, cut_id)
    except CutNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("/{job_id}/cuts/{cut_id}/reject", response_model=Cut)
async def reject_job_cut(job_id: str, cut_id: str) -> Cut:
    """Atomically set a specific cut's status to `'rejected'`."""
    try:
        return reject_cut(job_id, cut_id)
    except CutNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
