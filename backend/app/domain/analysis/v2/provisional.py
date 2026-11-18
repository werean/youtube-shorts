"""Phase-2 stand-ins for S1 (brief) and S2 (units). No LLM.

Phase 3 replaces them with LLM stages; they stay as the documented fallbacks
(pipeline-v2 "Falhas": S1 failure -> minimal brief, S2 failure -> units from topics).
"""

from __future__ import annotations

from typing import Sequence

from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.models import Brief, Sentence, Unit, UnitSeconds
from app.models.domain import TopicSegment

# TopicSegment.topic_type value produced by the v1 segmentation for advertising spans.
# It is a structural tag emitted by our own code, not a word of the transcript.
_AD_TOPIC_TYPE = "ad_span"


def provisional_brief() -> Brief:
    """Brief without LLM: default unit seconds and empty text fields."""
    return Brief(
        unit_seconds=UnitSeconds(
            min=C.DEFAULT_UNIT_SECONDS_MIN,
            typical=C.DEFAULT_UNIT_SECONDS_TYPICAL,
            max=C.DEFAULT_UNIT_SECONDS_MAX,
        )
    )


def _topic_index_for(mid: float, topics: Sequence[TopicSegment]) -> int | None:
    """Index of the first topic (in start order) whose [start, end) holds `mid`; the last topic is inclusive."""
    last = len(topics) - 1
    for i, t in enumerate(topics):
        if t.start <= mid < t.end or (i == last and t.start <= mid <= t.end):
            return i
    return None


def units_from_topics(topics: Sequence[TopicSegment], sentences: Sequence[Sentence]) -> list[Unit]:
    """One unit per run of sentences that fall in the same topic.

    Each sentence belongs to the topic holding its midpoint, so a topic boundary inside a sentence
    snaps to a sentence boundary. Sentences outside every topic form their own `content` runs, which
    guarantees full coverage without gaps or overlap. `ad_span` topics become `non_content`.
    """
    if not sentences:
        return []
    ordered = sorted(topics, key=lambda t: (t.start, t.end))

    keys: list[int | None] = []
    for s in sentences:
        keys.append(_topic_index_for((s.start + s.end) / 2.0, ordered) if ordered else None)

    runs: list[tuple[int | None, int, int]] = []  # (topic index, first sentence idx, last sentence idx)
    for i, k in enumerate(keys):
        if runs and runs[-1][0] == k:
            runs[-1] = (k, runs[-1][1], i)
        else:
            runs.append((k, i, i))

    units: list[Unit] = []
    for n, (k, a, b) in enumerate(runs, start=1):
        topic = ordered[k] if k is not None else None
        is_ad = bool(topic is not None and (topic.topic_type or "") == _AD_TOPIC_TYPE)
        units.append(
            Unit(
                unit_id=f"u{n}",
                start_sentence_id=sentences[a].sentence_id,
                end_sentence_id=sentences[b].sentence_id,
                start=sentences[a].start,
                end=sentences[b].end,
                label=(topic.title or topic.topic_id) if topic is not None else "",
                kind="non_content" if is_ad else "content",
            )
        )
    return units
