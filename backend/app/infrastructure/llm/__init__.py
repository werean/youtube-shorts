"""Unified local LLM & Embeddings infrastructure adapters (LM Studio + Ollama)."""

from app.infrastructure.llm.unified_adapter import (
    BOUNDARY_LOOKAROUND_JSON_SCHEMA,
    InvalidLLMJsonResponseError,
    LLMContextOverflowError,
    LLMEmptyResponseError,
    LLMOutputTruncatedError,
    LocalLLMUnavailableError,
    ProviderResolution,
    UnifiedLocalLLMAdapter,
)

__all__ = [
    "BOUNDARY_LOOKAROUND_JSON_SCHEMA",
    "InvalidLLMJsonResponseError",
    "LLMContextOverflowError",
    "LLMEmptyResponseError",
    "LLMOutputTruncatedError",
    "LocalLLMUnavailableError",
    "ProviderResolution",
    "UnifiedLocalLLMAdapter",
]
