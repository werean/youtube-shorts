"""Stage 3A: Discourse-aware semantic block grouping (`semantic.blocks.json`).

Groups word/segment-level transcription into coherent discourse blocks (`5s`–`20s`, max `30s`)
while enforcing:
- Opening-blocking connectives (PT/EN): never starts a new block on continuation or anaphoric
  connectives ("mas", "porém", "então", "porque", "however", "therefore", etc.) or lowercase.
- Topic-opener & Q&A triggers: opens a new block on speaker shifts, question-to-answer
  transitions, pauses >= 0.65s after sentence boundaries, or explicit discourse topic markers.
- Word timing alignment from `transcription.words.json` when available.
"""

from __future__ import annotations

import re
from typing import Sequence

from app.application.runtime_service import ServiceContainer, get_container
from app.models.domain import JobStatus, Segment, SemanticBlock, WordTiming

TARGET_MIN_SECONDS: float = 5.0
TARGET_MAX_SECONDS: float = 20.0
HARD_MAX_SECONDS: float = 30.0
EMERGENCY_MAX_SECONDS: float = 60.0
PAUSE_THRESHOLD_SECONDS: float = 0.65
LONG_PAUSE_THRESHOLD_SECONDS: float = 1.2
SENTENCE_BOUNDARIES: tuple[str, ...] = (".", "!", "?", "…")

BLOCKING_OPENING_CONNECTIVES_PT_EN: tuple[str, ...] = (
    # Portuguese continuation / dependent / anaphoric connectives
    "porque",
    "por que",
    "então",
    "entao",
    "mas",
    "porém",
    "porem",
    "contudo",
    "entretanto",
    "todavia",
    "como eu disse",
    "como eu falei",
    "como falei",
    "como disse",
    "como vimos",
    "e aí",
    "e ai",
    "ou seja",
    "portanto",
    "por isso",
    "dessa forma",
    "desse modo",
    "assim",
    "logo",
    "além disso",
    "alem disso",
    "inclusive",
    "aliás",
    "alias",
    "sendo assim",
    "consequentemente",
    "embora",
    "apesar disso",
    "isso acontece",
    "essa segunda",
    "esse segundo",
    "e o segundo",
    "e a segunda",
    # English continuation / dependent / anaphoric connectives
    "because",
    "so",
    "but",
    "however",
    "therefore",
    "thus",
    "hence",
    "consequently",
    "furthermore",
    "moreover",
    "nevertheless",
    "nonetheless",
    "as i said",
    "as i mentioned",
    "that's why",
    "that is why",
    "in other words",
    "and then",
    "and the second",
    "which means",
    "even though",
)

TOPIC_OPENER_MARKERS_PT_EN: tuple[str, ...] = (
    # Portuguese topic transition markers
    "agora falando sobre",
    "vamos falar sobre",
    "o primeiro ponto",
    "o segundo ponto",
    "o terceiro ponto",
    "outro ponto",
    "muita gente me pergunta",
    "muita gente acha",
    "outro erro muito comum",
    "um erro muito comum",
    "mudando de assunto",
    "em primeiro lugar",
    "em segundo lugar",
    "a grande questão",
    "a pergunta que fica",
    "deixa eu te contar",
    "vou te explicar",
    # English topic transition markers
    "now talking about",
    "let's talk about",
    "the first point",
    "the second point",
    "the third point",
    "another common mistake",
    "a lot of people ask",
    "moving on to",
    "first of all",
    "the big question is",
)

_LEADING_PUNCT_RE = re.compile(r"^[\s\"'“”‘’«»\-–—….,;:()\[\]]+")


def _strip_leading_punctuation(text: str) -> str:
    return _LEADING_PUNCT_RE.sub("", (text or "").strip())


def ends_sentence(text: str) -> bool:
    """Return True if text ends with terminal sentence punctuation."""
    trimmed = (text or "").strip().rstrip("\"'”’)]")
    if not trimmed:
        return False
    return trimmed.endswith(SENTENCE_BOUNDARIES)


def starts_with_blocking_connective(text: str) -> bool:
    """Return True if `text` starts with a dependent PT/EN connective or lowercase continuation."""
    cleaned = _strip_leading_punctuation(text)
    if not cleaned:
        return True

    # Check if the first alphabetic character is lowercase (mid-sentence continuation)
    for ch in cleaned:
        if ch.isalpha():
            if ch.islower():
                # Even if lowercase, check whether it's an explicit topic opener
                low_check = cleaned.lower()
                if any(low_check.startswith(m) for m in TOPIC_OPENER_MARKERS_PT_EN):
                    break
                return True
            break

    low = cleaned.lower()
    for conn in BLOCKING_OPENING_CONNECTIVES_PT_EN:
        if low == conn:
            return True
        if low.startswith(conn):
            rest = low[len(conn) :]
            if not rest or rest[0] in (" ", ",", ";", ":", ".", "!", "?", "—", "-"):
                return True

    return False


def is_topic_opener_text(text: str) -> bool:
    """Return True if `text` begins with a discourse topic-opener phrase."""
    cleaned = _strip_leading_punctuation(text).lower()
    if not cleaned:
        return False
    for marker in TOPIC_OPENER_MARKERS_PT_EN:
        if cleaned.startswith(marker):
            return True
    return False


def align_block_bounds_with_words(
    segments: Sequence[Segment],
    words: Sequence[WordTiming] | None = None,
) -> tuple[float, float]:
    """Refine block `(start, end)` using word-level timestamps when available."""
    if not segments:
        return 0.0, 0.0

    raw_start = float(segments[0].start)
    raw_end = float(segments[-1].end)
    if not words:
        return round(raw_start, 3), round(raw_end, 3)

    seg_ids = {s.segment_id for s in segments if s.segment_id}
    matched_words = [
        w
        for w in words
        if (w.segment_id and w.segment_id in seg_ids)
        or (w.start >= raw_start - 0.15 and w.end <= raw_end + 0.15)
    ]
    if not matched_words:
        return round(raw_start, 3), round(raw_end, 3)

    aligned_start = float(matched_words[0].start)
    aligned_end = float(matched_words[-1].end)
    if aligned_end <= aligned_start:
        return round(raw_start, 3), round(raw_end, 3)
    return round(aligned_start, 3), round(aligned_end, 3)


def group_segments_into_semantic_blocks(
    segments: Sequence[Segment],
    words: Sequence[WordTiming] | None = None,
) -> list[SemanticBlock]:
    """Group segments into discourse-aware SemanticBlock items (`b1`, `b2`, ...)."""
    if not segments:
        return []

    blocks: list[SemanticBlock] = []
    current_segments: list[Segment] = []
    current_is_opener: bool = True

    def _finalize_current() -> None:
        nonlocal current_segments, current_is_opener
        if not current_segments:
            return

        block_text = " ".join(s.text.strip() for s in current_segments if s.text.strip()).strip()
        b_start, b_end = align_block_bounds_with_words(current_segments, words)
        block_id = f"b{len(blocks) + 1}"

        # Dominant or first speaker in the block
        speakers = [s.speaker for s in current_segments if s.speaker]
        speaker = speakers[0] if speakers else None

        blocks.append(
            SemanticBlock(
                block_id=block_id,
                start=b_start,
                end=b_end,
                text=block_text,
                segment_ids=[s.segment_id for s in current_segments],
                speaker=speaker,
                is_topic_opener=bool(current_is_opener),
            )
        )
        current_segments = []
        current_is_opener = False

    for seg in segments:
        if not current_segments:
            current_segments.append(seg)
            current_is_opener = (
                len(blocks) == 0
                or is_topic_opener_text(seg.text)
                or not starts_with_blocking_connective(seg.text)
            )
            continue

        prev = current_segments[-1]
        pause = max(0.0, float(seg.start) - float(prev.end))
        block_start = float(current_segments[0].start)
        block_end = float(prev.end)
        current_duration = block_end - block_start
        projected_duration = float(seg.end) - block_start

        prev_ended_sentence = ends_sentence(prev.text)
        prev_is_question = prev.text.strip().endswith("?")
        speaker_changed = bool(
            seg.speaker and prev.speaker and seg.speaker.strip() != prev.speaker.strip()
        )
        has_topic_marker = is_topic_opener_text(seg.text)
        blocked_opening = starts_with_blocking_connective(seg.text)

        should_close = False
        next_is_opener = False

        if blocked_opening:
            # Never start a new block on a dependent connective unless emergency cap is exceeded
            if projected_duration >= EMERGENCY_MAX_SECONDS:
                should_close = True
                next_is_opener = False
        else:
            if speaker_changed and current_duration >= 1.5:
                should_close = True
                next_is_opener = True
            elif has_topic_marker and current_duration >= 2.0:
                should_close = True
                next_is_opener = True
            elif prev_is_question and current_duration >= 2.5:
                should_close = True
                next_is_opener = True
            elif pause >= LONG_PAUSE_THRESHOLD_SECONDS and current_duration >= TARGET_MIN_SECONDS:
                should_close = True
                next_is_opener = True
            elif current_duration >= TARGET_MIN_SECONDS and prev_ended_sentence and pause >= PAUSE_THRESHOLD_SECONDS:
                should_close = True
                next_is_opener = pause >= LONG_PAUSE_THRESHOLD_SECONDS
            elif projected_duration >= TARGET_MAX_SECONDS and (
                prev_ended_sentence or pause >= PAUSE_THRESHOLD_SECONDS or projected_duration >= HARD_MAX_SECONDS
            ):
                should_close = True
                next_is_opener = has_topic_marker or pause >= LONG_PAUSE_THRESHOLD_SECONDS

        if should_close:
            _finalize_current()
            current_segments.append(seg)
            current_is_opener = next_is_opener or has_topic_marker or speaker_changed
        else:
            current_segments.append(seg)

    _finalize_current()
    return blocks


def build_semantic_blocks(
    job_id: str,
    *,
    container: ServiceContainer | None = None,
) -> list[SemanticBlock]:
    """Load transcription artifacts for `job_id`, build discourse-aware semantic blocks, and persist `semantic.blocks.json`."""
    c = container or get_container()
    c.jobs.load_job(job_id)
    c.jobs.update_job_status(job_id, JobStatus.BUILDING_BLOCKS)
    c.runtime.log_stage_start(
        job_id,
        "blocks",
        message="[segmentation] Construindo blocos semânticos conscientes de discurso...",
    )
    c.runtime.publish_state_change(
        job_id,
        status=JobStatus.BUILDING_BLOCKS.value,
        message="[segmentation] Construindo blocos semânticos conscientes de discurso...",
    )

    try:
        segments = c.jobs.load_transcription_segments(job_id)
        if not segments:
            raise ValueError(f"No transcription segments available for job {job_id}")

        words = c.jobs.load_transcription_words(job_id)
        blocks = group_segments_into_semantic_blocks(segments, words=words)
        c.jobs.save_semantic_blocks(job_id, blocks)
        c.jobs.update_job_status(job_id, JobStatus.BUILDING_TOPICS)
        c.runtime.log_stage_end(
            job_id,
            "blocks",
            message=f"[segmentation] {len(blocks)} blocos semânticos gerados",
        )
        return blocks
    except Exception as exc:
        c.runtime.log_exception(
            job_id,
            "blocks",
            exc,
            message="[segmentation] Erro ao construir blocos semânticos",
        )
        c.jobs.update_job_status(job_id, JobStatus.ERROR)
        c.runtime.publish_state_change(
            job_id, JobStatus.ERROR.value, f"[segmentation] {exc}"
        )
        raise
