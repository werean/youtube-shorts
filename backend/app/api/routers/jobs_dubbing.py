"""Job Dubbing API router (`/jobs/{job_id}/dub*`)."""

from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query
from fastapi.responses import JSONResponse

from app.application.job_lifecycle import ACTIVE_PROCESSING_STATUSES, JobNotFoundError
from app.application.runtime_service import ServiceContainer, get_container
from app.domain.dubbing.service import get_dubbing_service
from app.domain.rendering.rendering_service import build_cut_filename
from app.infrastructure.dubbing.env_manager import normalize_dubbing_engine

router = APIRouter(prefix="/jobs", tags=["jobs-dubbing"])


def _get_dub_task_registry(container: ServiceContainer) -> dict[str, asyncio.Task[Any]]:
    registry = getattr(container, "_dub_tasks", None)
    if not isinstance(registry, dict):
        registry = {}
        setattr(container, "_dub_tasks", registry)
    return registry


def _active_dub_task(container: ServiceContainer, job_id: str) -> asyncio.Task[Any] | None:
    task = _get_dub_task_registry(container).get(job_id)
    if task is not None and not task.done():
        return task
    return None


def _check_job_busy_reason(container: ServiceContainer, job_id: str, job: Any) -> str | None:
    if _active_dub_task(container, job_id) is not None or container.runtime.is_dubbing_active(job_id):
        return "dubbing"
    active = container.runtime.is_any_task_active(job_id)
    if active:
        return ", ".join(active)
    if getattr(job, "status", None) in ACTIVE_PROCESSING_STATUSES:
        status_val = job.status.value if hasattr(job.status, "value") else str(job.status)
        return status_val
    return None


def _resolve_dub_options(
    container: ServiceContainer,
    body: dict[str, Any] | None,
) -> tuple[str, str, str, bool, str, bool]:
    payload = body if isinstance(body, dict) else {}
    app_settings = container.load_settings()
    dub_cfg = app_settings.dubbing

    raw_lang = str(payload.get("target_lang") or "").strip()
    if raw_lang and raw_lang.lower() != "ask":
        target_lang = raw_lang
    elif dub_cfg.default_target_lang and dub_cfg.default_target_lang != "ask":
        target_lang = dub_cfg.default_target_lang
    else:
        target_lang = "pt-BR"

    raw_engine = payload.get("engine") or dub_cfg.engine
    resolved_engine = normalize_dubbing_engine(str(raw_engine))

    raw_voice_mode = str(payload.get("voice_mode") or dub_cfg.default_voice_mode or "auto").strip().lower()
    voice_mode = "single" if raw_voice_mode == "single" else "auto"

    sub_raw = payload.get("subtitles_enabled")
    subtitles_enabled = sub_raw if isinstance(sub_raw, bool) else bool(dub_cfg.default_subtitles_enabled)

    raw_preset = str(payload.get("subtitle_preset") or dub_cfg.default_subtitle_preset or "mov_text").strip().lower()
    subtitle_preset = "hardsub" if raw_preset == "hardsub" else "mov_text"

    auto_install = bool(payload.get("auto_install", False))
    return target_lang, resolved_engine, voice_mode, subtitles_enabled, subtitle_preset, auto_install


def _preflight_missing_response(preflight: dict[str, Any], detail: str) -> JSONResponse:
    return JSONResponse(
        status_code=424,
        content={
            "code": "DUBBING_DEPS_MISSING",
            "detail": detail,
            "preflight": preflight,
        },
    )


async def _launch_dub_background_task(
    container: ServiceContainer,
    job_id: str,
    coro_factory: Any,
    *,
    error_label: str = "Background task",
) -> None:
    registry = _get_dub_task_registry(container)

    async def _runner() -> None:
        try:
            await coro_factory()
        except Exception as exc:
            container.runtime.append_task_log(
                job_id,
                "dubbing",
                f"[dubbing] {error_label} ended with error: {exc}",
                level="ERROR",
            )
        finally:
            registry.pop(job_id, None)

    task = asyncio.create_task(_runner())
    registry[job_id] = task
    await asyncio.sleep(0)


@router.get("/{job_id}/dub", response_model=None)
async def get_job_dubbing_manifest(job_id: str) -> Any:
    """Return the persisted `DubbingManifest` (active_lang, tracks, preview) for `job_id`."""
    container = get_container()
    try:
        manifest = get_dubbing_service(container=container).get_manifest(job_id)
    except JobNotFoundError:
        raise
    return manifest.model_dump()


@router.get("/{job_id}/dub/preflight", response_model=None)
async def get_job_dubbing_preflight(
    job_id: str,
    engine: str | None = Query(default=None),
) -> Any:
    """Check isolated dubbing venvs, engine/Demucs/sherpa weights, and free disk space."""
    container = get_container()
    container.jobs.load_job(job_id)
    return get_dubbing_service(container=container).check_preflight(engine)


@router.post("/{job_id}/dub", response_model=None)
async def start_job_dubbing(
    job_id: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    """Start full local AI dubbing in background, enforcing 409 conflict & 424 preflight checks."""
    container = get_container()
    job = container.jobs.load_job(job_id)

    busy_reason = _check_job_busy_reason(container, job_id, job)
    if busy_reason:
        return JSONResponse(
            status_code=409,
            content={
                "detail": (
                    f"Já existe uma tarefa ativa ({busy_reason}) para este vídeo. "
                    "Aguarde a conclusão ou cancele antes de iniciar a dublagem."
                )
            },
        )

    source_video = container.jobs.find_source_video(job_id)
    if source_video is None or not source_video.exists():
        return JSONResponse(
            status_code=400,
            content={"detail": "Vídeo original não encontrado. Faça o download ou upload primeiro."},
        )

    (
        target_lang,
        resolved_engine,
        voice_mode,
        subtitles_enabled,
        subtitle_preset,
        auto_install,
    ) = _resolve_dub_options(container, body)

    service = get_dubbing_service(container=container)
    preflight = service.check_preflight(resolved_engine)
    if not preflight.get("ready", False) and not auto_install:
        return _preflight_missing_response(
            preflight,
            "Dependências de dublagem ausentes. Confirme o download para iniciar.",
        )

    await _launch_dub_background_task(
        container,
        job_id,
        lambda: service.dub_video(
            job_id,
            target_lang=target_lang,
            engine=resolved_engine,
            voice_mode=voice_mode,
            subtitles_enabled=subtitles_enabled,
            subtitle_preset=subtitle_preset,
        ),
        error_label="Background task",
    )

    return {
        "started": True,
        "job_id": job_id,
        "lang": target_lang,
        "target_lang": target_lang,
        "engine": resolved_engine,
    }


@router.post("/{job_id}/cuts/{cut_id}/dub", response_model=None)
async def start_cut_dubbing(
    job_id: str,
    cut_id: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    """Start isolated local AI dubbing for a specific rendered cut in background."""
    if not cut_id or cut_id in {".", ".."} or "/" in cut_id or "\\" in cut_id or "\x00" in cut_id:
        raise HTTPException(status_code=400, detail="Invalid cut_id")

    container = get_container()
    job = container.jobs.load_job(job_id)

    busy_reason = _check_job_busy_reason(container, job_id, job)
    if busy_reason:
        return JSONResponse(
            status_code=409,
            content={
                "detail": (
                    f"Já existe uma tarefa ativa ({busy_reason}) para este vídeo. "
                    "Aguarde a conclusão ou cancele antes de iniciar a dublagem."
                )
            },
        )

    cuts = container.jobs.load_cuts(job_id)
    cut = next((item for item in cuts if item.cut_id == cut_id or item.id == cut_id), None)
    if cut is None:
        return JSONResponse(
            status_code=404,
            content={"detail": f"Corte {cut_id} não encontrado."},
        )

    shorts_dir = container.jobs.shorts_dir_path(job_id, create=False)
    short_file = build_cut_filename(cut.start, cut.end, cut.cut_id)
    short_path = shorts_dir / short_file
    if not short_path.exists() or not short_path.is_file():
        return JSONResponse(
            status_code=404,
            content={
                "detail": (
                    f"Short renderizado não encontrado para o corte {cut_id} ({short_file}). "
                    "Renderize o corte antes de dublar."
                )
            },
        )

    (
        target_lang,
        resolved_engine,
        voice_mode,
        subtitles_enabled,
        subtitle_preset,
        auto_install,
    ) = _resolve_dub_options(container, body)

    service = get_dubbing_service(container=container)
    preflight = service.check_preflight(resolved_engine)
    if not preflight.get("ready", False) and not auto_install:
        return _preflight_missing_response(
            preflight,
            "Dependências de dublagem ausentes. Confirme o download para iniciar.",
        )

    await _launch_dub_background_task(
        container,
        job_id,
        lambda: service.dub_rendered_cut(
            job_id,
            cut_id,
            target_lang=target_lang,
            engine=resolved_engine,
            voice_mode=voice_mode,
            subtitles_enabled=subtitles_enabled,
            subtitle_preset=subtitle_preset,
        ),
        error_label=f"Cut {cut_id} background task",
    )

    return {
        "started": True,
        "job_id": job_id,
        "cut_id": cut_id,
        "lang": target_lang,
        "target_lang": target_lang,
        "engine": resolved_engine,
    }


@router.post("/{job_id}/dub/preview", response_model=None)
async def start_job_dubbing_preview(
    job_id: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    """Start isolated 20s quick dubbing preview in background."""
    container = get_container()
    job = container.jobs.load_job(job_id)

    busy_reason = _check_job_busy_reason(container, job_id, job)
    if busy_reason:
        return JSONResponse(
            status_code=409,
            content={
                "detail": (
                    f"Já existe uma tarefa ativa ({busy_reason}) para este vídeo. "
                    "Aguarde a conclusão ou cancele antes de gerar a prévia."
                )
            },
        )

    source_video = container.jobs.find_source_video(job_id)
    if source_video is None or not source_video.exists():
        return JSONResponse(
            status_code=400,
            content={"detail": "Vídeo original não encontrado. Faça o download ou upload primeiro."},
        )

    (
        target_lang,
        resolved_engine,
        voice_mode,
        _subtitles_enabled,
        _subtitle_preset,
        auto_install,
    ) = _resolve_dub_options(container, body)

    raw_start = body.get("start_time") if isinstance(body, dict) else None
    requested_start: float | None = None
    if raw_start is not None:
        try:
            requested_start = max(0.0, float(raw_start))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid start_time") from exc

    raw_duration = body.get("duration") if isinstance(body, dict) else None
    duration = 20.0
    if raw_duration is not None:
        try:
            duration = max(1.0, min(60.0, float(raw_duration)))
        except (TypeError, ValueError) as exc:
            raise HTTPException(status_code=400, detail="Invalid duration") from exc

    service = get_dubbing_service(container=container)
    preflight = service.check_preflight(resolved_engine)
    if not preflight.get("ready", False) and not auto_install:
        return _preflight_missing_response(
            preflight,
            "Dependências de dublagem ausentes. Confirme o download para gerar a prévia.",
        )

    await _launch_dub_background_task(
        container,
        job_id,
        lambda: service.preview_20s(
            job_id,
            target_lang=target_lang,
            requested_start=requested_start,
            duration=duration,
            engine=resolved_engine,
            voice_mode=voice_mode,
        ),
        error_label="Preview task",
    )

    return {
        "started": True,
        "job_id": job_id,
        "lang": target_lang,
        "target_lang": target_lang,
        "engine": resolved_engine,
        "preview": True,
    }


@router.post("/{job_id}/dub/cancel", response_model=None)
async def cancel_job_dubbing(job_id: str) -> Any:
    """Cooperatively cancel active dubbing, kill worker process tree, and unload LM Studio."""
    container = get_container()
    container.jobs.load_job(job_id)

    service = get_dubbing_service(container=container)
    cancelled = service.cancel_dubbing(job_id)
    active_task = _active_dub_task(container, job_id)
    if active_task is not None:
        cancelled = True

    if cancelled:
        lmstudio = getattr(container, "lmstudio", None)
        if lmstudio is not None:
            try:
                await lmstudio.unload_all()
            except Exception:
                pass
        return {"ok": True, "job_id": job_id}

    return JSONResponse(status_code=404, content={"detail": "Dubbing not running"})


@router.post("/{job_id}/dub/{lang}/export", response_model=None)
async def export_job_dub(
    job_id: str,
    lang: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    """Export full-length dubbed `.mp4` using Preset 1 (`mov_text`) or Preset 2 (`hardsub`)."""
    container = get_container()
    container.jobs.load_job(job_id)

    if _active_dub_task(container, job_id) is not None or container.runtime.is_dubbing_active(job_id):
        return JSONResponse(
            status_code=409,
            content={"detail": "Dublagem em andamento; aguarde ou cancele antes de exportar."},
        )

    payload = body if isinstance(body, dict) else {}
    raw_preset = payload.get("preset")
    preset = str(raw_preset).strip().lower() if raw_preset is not None else None
    raw_subs = payload.get("subtitles_enabled")
    subtitles_enabled = bool(raw_subs) if isinstance(raw_subs, bool) else None

    app_settings = container.load_settings()
    resolved_sub_enabled = (
        app_settings.dubbing.default_subtitles_enabled
        if subtitles_enabled is None
        else subtitles_enabled
    )

    service = get_dubbing_service(container=container)
    try:
        res = await service.export_dub(
            job_id,
            lang,
            preset=preset,
            subtitles_enabled=subtitles_enabled,
        )
    except FileNotFoundError as exc:
        return JSONResponse(status_code=404, content={"detail": str(exc)})
    except ValueError as exc:
        return JSONResponse(status_code=400, content={"detail": str(exc)})

    return {
        "ok": True,
        "job_id": job_id,
        "lang": lang,
        "mp4_url": f"/media/dubs/{job_id}/{lang}/{res.mp4_path.name}",
        "srt_url": f"/media/dubs/{job_id}/{lang}/dub.srt" if res.srt_path and res.srt_path.exists() else None,
        "vtt_url": f"/media/dubs/{job_id}/{lang}/dub.vtt" if res.vtt_path and res.vtt_path.exists() else None,
        "preset": res.preset,
        "subtitles_enabled": resolved_sub_enabled,
        "mp4_path": str(res.mp4_path),
        "video_codec_used": res.video_codec_used,
        "warnings": list(res.warnings),
    }


@router.post("/{job_id}/dub/{lang}/send-to-cuts", response_model=None)
async def send_dub_to_cuts(job_id: str, lang: str) -> Any:
    """Create a new clean `DOWNLOADED` job with dubbed audio and pre-seeded transcription for Shorts Cuts."""
    container = get_container()
    job = container.jobs.load_job(job_id)

    busy_reason = _check_job_busy_reason(container, job_id, job)
    if busy_reason:
        return JSONResponse(
            status_code=409,
            content={"detail": f"Não é possível enviar para Cortes enquanto há tarefa ativa ({busy_reason})."},
        )

    service = get_dubbing_service(container=container)
    try:
        res = await service.send_to_cuts(job_id, lang)
    except FileNotFoundError as exc:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    created_job = res.get("job")
    job_payload = created_job.model_dump() if hasattr(created_job, "model_dump") else created_job
    return {
        "ok": True,
        **res,
        "job": job_payload,
    }


@router.delete("/{job_id}/dub/{lang}", response_model=None)
async def delete_job_dub(job_id: str, lang: str) -> Any:
    """Delete a dubbed language track safely (`409` if dubbing is active)."""
    container = get_container()
    container.jobs.load_job(job_id)

    if _active_dub_task(container, job_id) is not None or container.runtime.is_dubbing_active(job_id):
        return JSONResponse(
            status_code=409,
            content={"detail": "Não é possível remover a dublagem enquanto ela está em execução."},
        )

    service = get_dubbing_service(container=container)
    try:
        manifest = service.delete_dub(job_id, lang)
    except RuntimeError as exc:
        return JSONResponse(status_code=409, content={"detail": str(exc)})

    return {
        "ok": True,
        "job_id": job_id,
        "lang": lang,
        "manifest": manifest.model_dump(),
    }
