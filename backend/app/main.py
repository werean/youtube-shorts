"""FastAPI application entrypoint (`uvicorn app.main:app`)."""

from __future__ import annotations

from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.routers import config as config_router
from app.api.routers import health as health_router
from app.api.routers import jobs as jobs_router
from app.api.routers import jobs_analysis as jobs_analysis_router
from app.api.routers import jobs_dubbing as jobs_dubbing_router
from app.api.routers import jobs_ingest as jobs_ingest_router
from app.api.routers import jobs_render as jobs_render_router
from app.api.routers import jobs_transcription as jobs_transcription_router
from app.api.routers import media as media_router
from app.api.routers import videos as videos_router
from app.application.job_lifecycle import JobNotFoundError
from app.core.paths import data_dir, sweep_trash_directories
from app.core.settings import archived_videos_dir, load_settings


@asynccontextmanager
async def _app_lifespan(_app: FastAPI) -> AsyncIterator[None]:
    try:
        s = load_settings()
        sweep_trash_directories(
            [
                Path(s.media.base_dir),
                archived_videos_dir(create=False),
                data_dir(),
            ]
        )
    except Exception:
        pass
    yield


def create_app() -> FastAPI:
    app = FastAPI(
        title="YouTube Shorts Local AI Studio API",
        version="2.0.0",
        description="100% Local AI Vertical Video Studio Backend (FastAPI + faster-whisper + LM Studio/Ollama + NVENC)",
        lifespan=_app_lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "*",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Accept-Ranges", "Content-Range", "Content-Length"],
    )

    @app.exception_handler(JobNotFoundError)
    async def job_not_found_handler(_request: Request, exc: JobNotFoundError) -> JSONResponse:
        return JSONResponse(status_code=404, content={"detail": str(exc)})

    @app.exception_handler(HTTPException)
    async def custom_http_exception_handler(_request: Request, exc: HTTPException) -> JSONResponse:
        if isinstance(exc.detail, dict):
            return JSONResponse(
                status_code=exc.status_code,
                content=exc.detail,
                headers=exc.headers,
            )
        return JSONResponse(
            status_code=exc.status_code,
            content={"detail": str(exc.detail)},
            headers=exc.headers,
        )

    # Core routers
    app.include_router(health_router.router)
    app.include_router(config_router.router)
    app.include_router(videos_router.router)
    app.include_router(media_router.router)

    # Modular Job routers (order is critical: batch routes in jobs_router mounted FIRST)
    app.include_router(jobs_router.router)
    app.include_router(jobs_ingest_router.router)
    app.include_router(jobs_transcription_router.router)
    app.include_router(jobs_analysis_router.router)
    app.include_router(jobs_render_router.router)
    app.include_router(jobs_dubbing_router.router)

    return app


app = create_app()
