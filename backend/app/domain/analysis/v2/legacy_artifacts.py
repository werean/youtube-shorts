"""Canonical legacy artifacts derived from the v2 sentences and units (phase 4, no lexical rules).

`semantic.blocks.json` and `topic.segments.json` keep their v1 shape (same pydantic models) but are built
here from `sentences.json` and `units.json`: duration and unit boundaries only, never a word list.
Used when the optional `analysis_v2.derive_legacy_artifacts` toggle is on.
"""

from __future__ import annotations

from collections import Counter
from typing import Sequence

from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.models import Sentence, Unit
from app.models.domain import SemanticBlock, TopicSegment

# TopicSegment.topic_type / embedding_backend values written by this module (structural tags, not transcript words).
_TOPIC_CONTENT = "content"
_TOPIC_AD = "ad_span"
_NON_CONTENT_KIND = "non_content"
_EMBEDDING_BACKEND_NONE = "none"


def _unit_index_by_sentence(sentences: Sequence[Sentence], units: Sequence[Unit]) -> list[int]:
    """Unit index per sentence (by sentence id range); sentences outside every unit get -1."""
    position = {s.sentence_id: i for i, s in enumerate(sentences)}
    owner = [-1] * len(sentences)
    for u_idx, u in enumerate(units):
        a, b = position.get(u.start_sentence_id), position.get(u.end_sentence_id)
        if a is None or b is None or b < a:
            continue
        for i in range(a, b + 1):
            if owner[i] == -1:
                owner[i] = u_idx
    return owner


def _majority_speaker(group: Sequence[Sentence]) -> str | None:
    counts = Counter(s.speaker for s in group if s.speaker)
    if not counts:
        return None
    best = max(counts.values())
    for s in group:  # ties: the first speaker to appear
        if s.speaker and counts[s.speaker] == best:
            return s.speaker
    return None


def _wpm(group: Sequence[Sentence]) -> float | None:
    """Words per minute from the word index ranges of the sentences; None without them or without duration."""
    total = 0
    for s in group:
        if s.word_start is None or s.word_end is None:
            return None
        total += max(0, s.word_end - s.word_start + 1)
    duration = group[-1].end - group[0].start
    if total <= 0 or duration <= 0:
        return None
    return round(total / (duration / 60.0), 1)


def _group_sentences(
    sentences: Sequence[Sentence], units: Sequence[Unit]
) -> list[tuple[list[Sentence], bool, int]]:
    """Consecutive sentences grouped into blocks: (sentences, first block of its unit, owning unit index or -1).

    A block closes once its duration reaches ``BLOCK_TARGET_SECONDS``, before a sentence that would push it past
    ``BLOCK_MAX_SECONDS``; it never crosses a unit boundary. There is deliberately no pause or speaker rule: S0
    already ends a sentence at a long pause, and the block keeps the majority speaker (the legacy field is a single
    value), so duration and unit boundaries are enough for these compatibility artifacts.
    A sentence longer than the maximum is a block of its own (the only case where a block exceeds the maximum).
    """
    owner = _unit_index_by_sentence(sentences, units)
    groups: list[tuple[list[Sentence], bool, int]] = []
    current: list[Sentence] = []
    current_opener = True
    current_owner = -1
    prev_owner: int | None = None

    def close() -> None:
        nonlocal current, current_opener
        if current:
            groups.append((current, current_opener, current_owner))
            current, current_opener = [], False

    for s, o in zip(sentences, owner):
        if prev_owner is not None and o != prev_owner:
            close()
            current_opener = True
        elif current and s.end - current[0].start > C.BLOCK_MAX_SECONDS:
            close()
        if not current:
            current_owner = o
        current.append(s)
        prev_owner = o
        if current[-1].end - current[0].start >= C.BLOCK_TARGET_SECONDS:
            close()
    close()
    return groups


def _block_from_group(n: int, group: Sequence[Sentence], opener: bool) -> SemanticBlock:
    return SemanticBlock(
        block_id=f"b{n}",
        start=group[0].start,
        end=group[-1].end,
        text=" ".join(s.text.strip() for s in group if s.text.strip()),
        segment_ids=[],
        speaker=_majority_speaker(group),
        is_topic_opener=opener,
        signal_tags=[],
        wpm=_wpm(group),
    )


def blocks_from_sentences(sentences: Sequence[Sentence], units: Sequence[Unit]) -> list[SemanticBlock]:
    """Group consecutive sentences into blocks b1..bN (see `_group_sentences` for the closing rules)."""
    return [_block_from_group(n, g, opener) for n, (g, opener, _o) in enumerate(_group_sentences(sentences, units), start=1)]


def derive_legacy_artifacts(
    sentences: Sequence[Sentence], units: Sequence[Unit]
) -> tuple[list[SemanticBlock], list[TopicSegment]]:
    """Blocks b1..bN and one topic per unit (t1..tN, ordered by time).

    A block belongs to the topic of the unit that owns its sentences (the same ownership that decides
    `is_topic_opener`), so each block lands in exactly one topic, or in none when its sentences are outside every unit.
    """
    groups = _group_sentences(sentences, units)
    blocks = [_block_from_group(n, g, opener) for n, (g, opener, _o) in enumerate(groups, start=1)]
    order = sorted(range(len(units)), key=lambda i: (units[i].start, units[i].end))
    topics: list[TopicSegment] = []
    for n, u_idx in enumerate(order, start=1):
        u = units[u_idx]
        ids = [b.block_id for b, (_g, _op, o) in zip(blocks, groups) if o == u_idx]
        topics.append(
            TopicSegment(
                topic_id=f"t{n}",
                start=u.start,
                end=u.end,
                block_ids=ids,
                blockCount=len(ids),
                durationSeconds=round(u.end - u.start, C.CUT_TIME_DECIMALS),
                title=u.label or None,
                embedding_backend=_EMBEDDING_BACKEND_NONE,
                topic_type=_TOPIC_AD if u.kind == _NON_CONTENT_KIND else _TOPIC_CONTENT,
            )
        )
    return blocks, topics
