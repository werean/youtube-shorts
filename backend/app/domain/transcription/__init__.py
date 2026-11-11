"""Stage 2 Transcription domain package."""

from app.domain.transcription.service import (
    FasterWhisperAdapter,
    RawWhisperSegment,
    RawWhisperWord,
    TranscriptionDomainService,
    build_plain_text,
    build_vtt_content,
    format_vtt_timestamp,
    get_transcription_service,
    is_hallucinated_segment,
    set_custom_whisper_model_factory,
    transcribe_job,
)

__all__ = [
    "FasterWhisperAdapter",
    "RawWhisperSegment",
    "RawWhisperWord",
    "TranscriptionDomainService",
    "build_plain_text",
    "build_vtt_content",
    "format_vtt_timestamp",
    "get_transcription_service",
    "is_hallucinated_segment",
    "set_custom_whisper_model_factory",
    "transcribe_job",
]
