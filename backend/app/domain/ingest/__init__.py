"""Stage 1 Ingest domain package."""

from app.domain.ingest.service import (
    FALLBACK_FORMAT_SELECTOR,
    PRIMARY_FORMAT_BY_RESOLUTION,
    IngestDomainService,
    YtDlpNativeAdapter,
    build_source_video_info,
    get_ingest_service,
    ingest_video,
    normalize_chapters,
    set_custom_ytdlp_factory,
)

__all__ = [
    "FALLBACK_FORMAT_SELECTOR",
    "PRIMARY_FORMAT_BY_RESOLUTION",
    "IngestDomainService",
    "YtDlpNativeAdapter",
    "build_source_video_info",
    "get_ingest_service",
    "ingest_video",
    "normalize_chapters",
    "set_custom_ytdlp_factory",
]
