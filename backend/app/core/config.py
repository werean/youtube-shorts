"""Calibrated hardware & local AI defaults for RTX 5070 (12 GB VRAM) + 32 GB RAM."""

from __future__ import annotations

import os
from typing import Any

PROMPT_VERSION = "v3"

SYSTEM_PROMPT_TEMPLATE = """You are an expert vertical video editor and narrative strategist for YouTube Shorts, Instagram Reels, and TikTok.

Your goal is to extract SELF-CONTAINED, HIGH-RETENTION cuts from a transcript divided into sequential semantic blocks (`id`, `start`, `end`, `speaker`, `text`).

CRITICAL narrative rule — TRUE BEGINNING, MIDDLE, AND END:
1. BEGINNING (Hook & Self-Contained Context):
   - The first block (`start_block_id`) MUST introduce the subject clearly without depending on prior conversation.
   - NEVER start on a block that begins with anaphoric or continuation markers ("because", "so", "that's why", "as I said", "and the second thing", "porque", "então", "como eu falei", "por isso").
   - In interviews/podcasts, if a guest's answer starts at block `b15` and the host's question is in `b14`, include `b14` as `start_block_id` so the viewer understands the question being answered.
2. MIDDLE (Development):
   - Include all consecutive blocks needed to develop the explanation, story, or argument without gaps.
3. END (Complete Resolution):
   - The last block (`end_block_id`) MUST deliver the conclusion, punchline, or final takeaway of that sub-topic.
   - NEVER stop in the middle of an explanation just to hit a target duration.

FLEXIBLE DURATION RULE (~90s Reference Average):
- Target a flexible average duration of ~90 seconds across cuts, NOT a rigid timer.
- Subject completeness ALWAYS takes priority over duration:
  - Fast, punchy insights or short source videos may naturally complete in 15 to 55 seconds.
  - Deep explanations or complete stories may naturally require 60 to 160 seconds to reach their real conclusion.

Return ONLY valid JSON matching the schema, ordered by `score` descending (0 to 100)."""

BOUNDARY_LOOKAROUND_PROMPT_TEMPLATE = """You are auditing candidate video cuts to guarantee each cut has a self-contained beginning and a complete ending.

For each candidate cut, you are given:
- `preceding_blocks`: up to 3 blocks immediately BEFORE `start_block_id`
- `first_blocks`: the opening blocks of the candidate cut
- `last_blocks`: the closing blocks of the candidate cut
- `following_blocks`: up to 3 blocks immediately AFTER `end_block_id`

Instructions:
1. If `first_blocks` starts mid-thought, depends on a question in `preceding_blocks`, or starts with a continuation word, move `adjusted_start_block_id` backward to the exact block in `preceding_blocks` where the thought/question actually begins. Otherwise keep `start_block_id`.
2. If `last_blocks` cuts off before the speaker finishes their conclusion and `following_blocks` finishes that exact thought, move `adjusted_end_block_id` forward to include the conclusion block. Otherwise keep `end_block_id`.
3. Set `is_complete_story` to false ONLY if the candidate cannot form a coherent thought even with the neighboring blocks.

Return ONLY valid JSON matching the schema."""

CUTS_RESPONSE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "cuts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "start_block_id": {"type": "string"},
                    "end_block_id": {"type": "string"},
                    "score": {"type": "number"},
                    "beginning_hook": {"type": "string"},
                    "middle_development": {"type": "string"},
                    "end_conclusion": {"type": "string"},
                    "hook_reason": {"type": "string"},
                    "content_reason": {"type": "string"},
                },
                "required": [
                    "title",
                    "start_block_id",
                    "end_block_id",
                    "score",
                    "beginning_hook",
                    "middle_development",
                    "end_conclusion",
                    "hook_reason",
                    "content_reason",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["cuts"],
    "additionalProperties": False,
}


class AppConfig:
    """Centralized configuration constants."""

    WHISPER_MODEL_NAME: str = "large-v3-turbo"
    WHISPER_COMPUTE_TYPE_CUDA: str = "int8_float16"
    WHISPER_COMPUTE_TYPE_CPU: str = "int8"
    WHISPER_CPU_THREADS: int = 8
    MIN_FREE_VRAM_GB_FOR_WHISPER: float = 2.2

    LMSTUDIO_BASE_URL: str = os.environ.get("LMSTUDIO_BASE_URL", "http://127.0.0.1:1234/v1")
    OLLAMA_BASE_URL: str = os.environ.get("OLLAMA_BASE_URL", "http://127.0.0.1:11434")
    OLLAMA_MODEL: str = os.environ.get("OLLAMA_MODEL", "qwen2.5:14b")
    OLLAMA_API_KEY: str = os.environ.get("OLLAMA_API_KEY", "")
    OLLAMA_TIMEOUT_SECONDS: int = 120
    EMBEDDING_MODEL: str = "nomic-embed-text"

    TARGET_CUT_DURATION_SECONDS: int = 90
    MAX_SUGGESTED_CUTS: int = 12
    ENABLE_BOUNDARY_LOOKAROUND: bool = True

    HOOK_MAX_FORWARD_ADJUST_SECONDS: float = 1.0
    HOOK_SILENCE_THRESHOLD_SECONDS: float = 0.5

    RENDER_WIDTH: int = 1080
    RENDER_HEIGHT: int = 1920
    RENDER_VIDEO_CODEC: str = "h264_nvenc"
    RENDER_AUDIO_CODEC: str = "aac"
    RENDER_VIDEO_PRESET: str = "p5"

    IO_CONCURRENCY: int = 2
    GPU_CONCURRENCY: int = 1
    RENDER_CONCURRENCY: int = 2
    MAX_TASK_LOG_LINES: int = 400


config = AppConfig()
