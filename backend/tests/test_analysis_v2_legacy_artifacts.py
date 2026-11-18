"""Derived semantic.blocks.json / topic.segments.json (phase 4): properties over synthetic sentences and units.

100% mocked, no LLM. The sentences are language-free tokens; nothing here depends on a word list.
"""

from __future__ import annotations

import random
from typing import Sequence

import pytest

from app.application.runtime_service import ServiceContainer
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.legacy_artifacts import blocks_from_sentences, derive_legacy_artifacts
from app.domain.analysis.v2.models import Sentence, Unit
from app.models.domain import JobStatus, SemanticBlock, TopicSegment


def make_sentences(
    durations: Sequence[float],
    *,
    gap: float = 0.5,
    speakers: Sequence[str | None] | None = None,
    with_words: bool = True,
) -> list[Sentence]:
    out: list[Sentence] = []
    t, w = 0.0, 0
    for i, d in enumerate(durations):
        n_words = 5
        out.append(
            Sentence(
                sentence_id=f"s{i + 1}",
                start=t,
                end=t + d,
                text=f"tok{i} " * 4 + f"tok{i}",
                speaker=speakers[i] if speakers else None,
                word_start=w if with_words else None,
                word_end=w + n_words - 1 if with_words else None,
            )
        )
        t += d + gap
        w += n_words
    return out


def make_units(sentences: Sequence[Sentence], cuts: Sequence[int], kinds: Sequence[str] | None = None) -> list[Unit]:
    """Units over sentence index ranges split at `cuts` (indices where a new unit starts)."""
    edges = [0, *cuts, len(sentences)]
    units = []
    for n, (a, b) in enumerate(zip(edges, edges[1:]), start=1):
        units.append(
            Unit(
                unit_id=f"u{n}",
                start_sentence_id=sentences[a].sentence_id,
                end_sentence_id=sentences[b - 1].sentence_id,
                start=sentences[a].start,
                end=sentences[b - 1].end,
                label=f"label {n}",
                kind=kinds[n - 1] if kinds else "content",
            )
        )
    return units


def _covers_in_order(blocks: Sequence[SemanticBlock], sentences: Sequence[Sentence]) -> None:
    assert blocks[0].start == sentences[0].start and blocks[-1].end == sentences[-1].end
    for a, b in zip(blocks, blocks[1:]):
        assert a.end <= b.start  # order, no overlap
    for s in sentences:  # every sentence lies inside exactly one block
        assert sum(1 for b in blocks if b.start <= s.start and s.end <= b.end) == 1, s.sentence_id


@pytest.mark.parametrize("seed", range(12))
def test_block_invariants_over_random_inputs(seed: int) -> None:
    rng = random.Random(seed)
    n = rng.randint(1, 80)
    durations = [rng.choice([0.5, 2.0, 4.0, 9.0, 14.0, 40.0]) for _ in range(n)]
    sentences = make_sentences(durations)
    cuts = sorted(rng.sample(range(1, n), k=min(n - 1, rng.randint(0, 6)))) if n > 1 else []
    units = make_units(sentences, cuts)
    blocks = blocks_from_sentences(sentences, units)
    assert [b.block_id for b in blocks] == [f"b{i}" for i in range(1, len(blocks) + 1)]
    _covers_in_order(blocks, sentences)
    for b in blocks:
        inside = [s for s in sentences if b.start <= s.start and s.end <= b.end]
        # never crosses a unit boundary
        assert len({u.unit_id for s in inside for u in units if u.start <= s.start and s.end <= u.end}) == 1
        # within the maximum, except a single sentence longer than it
        assert b.end - b.start <= C.BLOCK_MAX_SECONDS or len(inside) == 1
        SemanticBlock.model_validate(b.model_dump())
    blocks2, topics = derive_legacy_artifacts(sentences, units)
    assert blocks2 == blocks
    assert [t.topic_id for t in topics] == [f"t{i}" for i in range(1, len(units) + 1)]
    flat = [bid for t in topics for bid in t.block_ids]
    assert flat == [b.block_id for b in blocks]  # every block in exactly one topic, in order


def test_blocks_close_at_target_and_split_before_the_maximum() -> None:
    sentences = make_sentences([5.0] * 10, gap=0.0)
    blocks = blocks_from_sentences(sentences, make_units(sentences, []))
    # 5 s sentences: a block closes once it reaches the target (3 sentences = 15 s >= 12 s)
    assert [round(b.end - b.start) for b in blocks] == [15, 15, 15, 5]
    long_ones = make_sentences([14.0, 14.0, 14.0], gap=0.0)  # target reached by one sentence
    assert len(blocks_from_sentences(long_ones, make_units(long_ones, []))) == 3
    tight = make_sentences([11.0, 11.0, 11.0], gap=0.0)  # 11 s < target; adding a second gives 22 s <= max
    assert [round(b.end - b.start) for b in blocks_from_sentences(tight, make_units(tight, []))] == [22, 11]
    near_max = make_sentences([11.0, 11.0, 11.0, 11.0], gap=3.0)  # 3rd sentence would end 39 s after the block start
    assert all(b.end - b.start <= C.BLOCK_MAX_SECONDS for b in blocks_from_sentences(near_max, make_units(near_max, [])))


def test_a_sentence_longer_than_the_maximum_is_its_own_block() -> None:
    sentences = make_sentences([3.0, 50.0, 3.0])
    blocks = blocks_from_sentences(sentences, make_units(sentences, []))
    assert [round(b.end - b.start) for b in blocks] == [3, 50, 3]


def test_block_fields_the_consumers_rely_on() -> None:
    sentences = make_sentences([6.0, 6.0, 6.0, 6.0], gap=0.0, speakers=["A", "B", "B", None])
    units = make_units(sentences, [2])
    blocks = blocks_from_sentences(sentences, units)
    assert len(blocks) == 2
    first, second = blocks
    assert first.is_topic_opener is True and second.is_topic_opener is True
    assert first.speaker == "A" and second.speaker == "B"  # 1-1 tie: the first to appear; majority otherwise
    assert first.signal_tags == [] and first.segment_ids == []
    assert first.text.split()[0] == "tok0" and "tok1" in first.text
    assert first.wpm == round(10 / (12.0 / 60.0), 1)
    dumped = first.model_dump()
    for key in ("block_id", "start", "end", "text", "segment_ids", "speaker", "is_topic_opener", "signal_tags", "wpm"):
        assert key in dumped


def test_speaker_is_the_majority() -> None:
    sentences = make_sentences([3.0, 3.0, 3.0], gap=0.0, speakers=["A", "B", "B"])
    (block,) = blocks_from_sentences(sentences, make_units(sentences, []))
    assert block.speaker == "B"


def test_only_the_first_block_of_a_unit_is_a_topic_opener() -> None:
    sentences = make_sentences([14.0] * 6, gap=0.0)
    blocks = blocks_from_sentences(sentences, make_units(sentences, [3]))
    assert [b.is_topic_opener for b in blocks] == [True, False, False, True, False, False]


def test_wpm_is_none_without_word_indices_and_speaker_none_without_speakers() -> None:
    sentences = make_sentences([6.0, 6.0], with_words=False)
    (block,) = blocks_from_sentences(sentences, make_units(sentences, []))
    assert block.wpm is None and block.speaker is None


def test_topics_fields() -> None:
    sentences = make_sentences([14.0] * 6, gap=0.0)
    units = make_units(sentences, [2, 4], kinds=["content", "non_content", "content"])
    blocks, topics = derive_legacy_artifacts(sentences, units)
    assert [t.topic_type for t in topics] == ["content", "ad_span", "content"]
    for t, u in zip(topics, units):
        TopicSegment.model_validate(t.model_dump())
        assert t.title == u.label and t.embedding_backend == "none"
        assert t.start == u.start and t.end == u.end
        assert t.blockCount == len(t.block_ids) == 2
        assert t.durationSeconds == round(u.end - u.start, 3)


def test_empty_inputs() -> None:
    assert blocks_from_sentences([], []) == []
    assert derive_legacy_artifacts([], []) == ([], [])


def test_sentences_outside_every_unit_still_form_blocks_without_crossing() -> None:
    sentences = make_sentences([3.0] * 6, gap=0.0)
    units = make_units(sentences[2:5], [])  # covers s3..s5 only (ids are s1..s3 in the slice, so remap)
    units[0].start_sentence_id, units[0].end_sentence_id = "s3", "s5"
    blocks = blocks_from_sentences(sentences, units)
    _covers_in_order(blocks, sentences)
    assert any(b.end <= sentences[2].start for b in blocks) and any(b.start >= sentences[5].start for b in blocks)


def test_non_latin_and_unpunctuated_text_is_handled_identically() -> None:
    texts = ["今日は天気がいい", "सुबह की चाय बहुत अच्छी", "kami masak nasi goreng", "مرحبا بكم جميعا"]
    sentences = [
        Sentence(sentence_id=f"s{i + 1}", start=i * 5.0, end=i * 5.0 + 4.5, text=t, word_start=i * 3, word_end=i * 3 + 2)
        for i, t in enumerate(texts)
    ]
    blocks = blocks_from_sentences(sentences, make_units(sentences, []))
    assert " ".join(b.text for b in blocks) == " ".join(texts)
    _covers_in_order(blocks, sentences)


def test_round_trip_through_the_jobs_store(container: ServiceContainer) -> None:
    job = container.jobs.create_job("https://www.youtube.com/watch?v=legacy", status=JobStatus.BUILDING_TOPICS)
    sentences = make_sentences([5.0, 7.0, 9.0, 11.0, 13.0, 4.0], speakers=["A"] * 6)
    units = make_units(sentences, [3], kinds=["content", "non_content"])
    blocks, topics = derive_legacy_artifacts(sentences, units)
    container.jobs.save_semantic_blocks(job.job_id, blocks)
    container.jobs.save_topic_segments(job.job_id, topics)
    assert container.jobs.load_semantic_blocks(job.job_id) == blocks
    assert container.jobs.load_topic_segments(job.job_id) == topics


def test_zero_duration_sentence_stays_in_its_owning_topic() -> None:
    # s2 has zero duration at the end of u1: a midpoint test would orphan it, ownership keeps it in t1.
    sentences = [
        Sentence(sentence_id="s1", start=0.0, end=12.0, text="a", word_start=0, word_end=0),
        Sentence(sentence_id="s2", start=12.0, end=12.0, text="b", word_start=1, word_end=1),
        Sentence(sentence_id="s3", start=13.0, end=20.0, text="c", word_start=2, word_end=2),
    ]
    units = make_units(sentences, [2])
    blocks, topics = derive_legacy_artifacts(sentences, units)
    flat = [bid for t in topics for bid in t.block_ids]
    assert sorted(flat) == sorted(b.block_id for b in blocks) and len(flat) == len(set(flat))

