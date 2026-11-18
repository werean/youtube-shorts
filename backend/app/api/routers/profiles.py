"""Profile routes (phase 1: watermark of the local profile).

`:profile_id` accepts only the aliases `active` and `p_local` in this phase. Routes that write are local-only.
Error envelope: `{ "detail": "<pt-BR text>", "code"?: "..." }`.
"""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse

from app.api.local_only import require_local_ui
from app.domain.profiles import profile_store as ps
from app.domain.profiles import watermark as wm

router = APIRouter(prefix="/profiles", tags=["profiles"])


def _error(status: int, detail: str, code: str | None = None) -> HTTPException:
    payload: dict[str, Any] = {"detail": detail}
    if code:
        payload["code"] = code
    return HTTPException(status_code=status, detail=payload)


def _resolve(profile_id: str) -> None:
    try:
        ps.resolve_profile_id(profile_id)
    except ps.ProfileNotFoundError:
        raise _error(404, "Profile not found") from None


def _profile_unreadable(exc: ps.ProfileUnreadableError) -> HTTPException:
    return _error(409, str(exc), "profile_unreadable")


@router.get("/{profile_id}/watermark", response_model=None)
async def get_watermark(profile_id: str) -> dict[str, Any]:
    _resolve(profile_id)
    try:
        return wm.build_watermark_settings()
    except ps.ProfileUnreadableError as exc:
        raise _profile_unreadable(exc) from None


@router.put("/{profile_id}/watermark", response_model=None, dependencies=[Depends(require_local_ui)])
async def put_watermark(profile_id: str, request: Request) -> dict[str, Any]:
    _resolve(profile_id)
    try:
        raw = await request.body()
        try:
            body: Any = json.loads(raw) if raw.strip() else {}
        except ValueError:
            raise wm.WatermarkPatchError("Corpo inválido.") from None
        patch = wm.parse_watermark_patch(body)
        profile = wm.apply_watermark_patch(patch)
        return wm.build_watermark_settings(profile)
    except wm.WatermarkPatchError as exc:
        raise _error(400, str(exc)) from None
    except wm.WatermarkMissingError as exc:
        raise _error(400, exc.detail, "watermark_missing") from None
    except ps.ProfileUnreadableError as exc:
        raise _profile_unreadable(exc) from None


@router.post("/{profile_id}/watermark/image", response_model=None, dependencies=[Depends(require_local_ui)])
async def upload_watermark_image(
    profile_id: str,
    file: UploadFile | None = File(default=None),
) -> dict[str, Any]:
    _resolve(profile_id)
    if file is None:
        raise _error(400, wm.MSG_FORMAT, "invalid_image")
    # Read at most limit + 1 bytes so an oversized upload is never loaded whole into memory.
    data = await file.read(wm.MAX_IMAGE_BYTES + 1)
    try:
        profile = await run_in_threadpool(wm.store_watermark_image, data)
        return wm.build_watermark_settings(profile)
    except wm.InvalidWatermarkImageError as exc:
        raise _error(400, str(exc), "invalid_image") from None
    except ps.ProfileUnreadableError as exc:
        raise _profile_unreadable(exc) from None
    except OSError:
        raise _error(409, "Não foi possível alterar a imagem agora. Tente novamente.", "image_busy") from None


@router.get("/{profile_id}/watermark/image", response_model=None)
async def get_watermark_image(profile_id: str) -> FileResponse:
    _resolve(profile_id)
    # Fixed server-built path: never a path read from profile.json.
    if not ps.watermark_image_exists():
        raise _error(404, "Watermark not found")
    return FileResponse(ps.watermark_image_path(), media_type="image/png")


@router.delete("/{profile_id}/watermark/image", response_model=None, dependencies=[Depends(require_local_ui)])
async def delete_watermark_image(profile_id: str) -> dict[str, Any]:
    _resolve(profile_id)
    try:
        profile = wm.remove_watermark_image()
        return wm.build_watermark_settings(profile)
    except ps.ProfileUnreadableError as exc:
        raise _profile_unreadable(exc) from None
    except OSError:
        raise _error(409, "Não foi possível alterar a imagem agora. Tente novamente.", "image_busy") from None
