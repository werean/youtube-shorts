"""Analysis v2, S0 (sentences) and the v2 artifact helpers of the jobs store. 100% logical."""

from __future__ import annotations

import json

import pytest

from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.models import Sentence
from app.domain.analysis.v2.sentences import (
    build_sentences,
    format_sentence_line,
    nearest_sentence_boundary,
    sentences_between,
)
from app.models.domain import Segment, WordTiming


def _words(tokens, *, step=0.4, dur=0.3, pauses=None, start=0.0, speaker=None):
    """tokens -> WordTiming list; pauses = {index: extra pause after word index}."""
    pauses = pauses or {}
    out, t = [], start
    for i, tok in enumerate(tokens):
        out.append(WordTiming(word=tok, start=t, end=t + dur, speaker=speaker))
        t += step + pauses.get(i, 0.0)
    return out


def _assert_invariants(words, sentences):
    assert sentences
    covered = []
    prev_start = float("-inf")
    for s in sentences:
        assert s.start < s.end
        assert s.start >= prev_start
        prev_start = s.start
        assert s.word_start is not None and s.word_end is not None
        covered.extend(range(s.word_start, s.word_end + 1))
    assert covered == list(range(len(words)))
    ids = [s.sentence_id for s in sentences]
    assert ids == [f"s{i}" for i in range(1, len(ids) + 1)]


def _text_with_punct():
    toks = []
    for i in range(12):
        toks += [f"palavra{i}a", f"palavra{i}b", f"palavra{i}c", f"palavra{i}d."]
    return toks


def test_with_punctuation_splits_on_terminals():
    words = _words(_text_with_punct(), step=0.5, dur=0.4)
    sents, meta = build_sentences(words)
    _assert_invariants(words, sents)
    assert meta["source"] == "words"
    assert meta["low_punctuation"] is False
    assert len(sents) == 12
    assert all(s.text.endswith(".") for s in sents)


def test_closing_quote_after_terminal_counts():
    toks = ["um", "dois", "tres", 'quatro."', "cinco", "seis", "sete", "oito!)"] * 10
    words = _words(toks, step=0.5, dur=0.4)
    sents, _ = build_sentences(words)
    _assert_invariants(words, sents)
    assert len(sents) == 20


def test_no_punctuation_uses_pauses_and_low_mode():
    toks = [f"kata{i}" for i in range(100)]
    pauses = {i: 2.0 for i in range(4, 99, 5)}  # a long pause every 5 words (clamps the threshold)
    words = _words(toks, pauses=pauses)
    sents, meta = build_sentences(words)
    _assert_invariants(words, sents)
    assert meta["low_punctuation"] is True
    assert len(sents) == 20
    assert all(s.word_end - s.word_start == 4 for s in sents)


def test_other_language_turkish_and_indonesian():
    tr = "Bugün hava çok güzel. Yarın yağmur yağacak mı? Bilmiyorum ama umuyorum. Şimdi eve gidiyoruz!".split()
    toks = tr * 5
    words = _words(toks, step=0.45, dur=0.35)
    sents, meta = build_sentences(words)
    _assert_invariants(words, sents)
    assert meta["low_punctuation"] is False
    assert len(sents) == 20
    ind = [f"kalimat{i}" for i in range(60)]
    words2 = _words(ind, pauses={i: 1.0 for i in range(5, 60, 6)})
    sents2, _ = build_sentences(words2)
    _assert_invariants(words2, sents2)
    assert len(sents2) == 10


def test_sixty_seconds_without_pause_stays_one_sentence():
    toks = [f"w{i}" for i in range(150)]
    words = _words(toks, step=0.4, dur=0.4)  # zero gaps for 60 s
    sents, _ = build_sentences(words)
    _assert_invariants(words, sents)
    assert len(sents) == 1
    assert sents[0].end - sents[0].start > C.MAX_SENTENCE_SECONDS


def test_long_stretch_with_small_pauses_is_split_recursively():
    toks = [f"w{i}" for i in range(150)]
    # tiny pauses (below any threshold) at several places inside a 60 s run
    words = _words(toks, step=0.4, dur=0.39, pauses={i: 0.05 for i in range(0, 150, 7)})
    sents, _ = build_sentences(words)
    _assert_invariants(words, sents)
    assert len(sents) > 1
    assert all(s.end - s.start <= C.MAX_SENTENCE_SECONDS for s in sents)


def test_single_word():
    words = [WordTiming(word="oi", start=1.0, end=1.5)]
    sents, meta = build_sentences(words)
    _assert_invariants(words, sents)
    assert len(sents) == 1 and sents[0].text == "oi"
    assert C.PAUSE_THRESHOLD_MIN_SECONDS <= meta["pause_threshold_seconds"] <= C.PAUSE_THRESHOLD_MAX_SECONDS


def test_zero_length_single_word_has_positive_duration():
    sents, _ = build_sentences([WordTiming(word="x", start=2.0, end=2.0)])
    assert sents[0].start < sents[0].end


def test_empty_input():
    sents, meta = build_sentences([])
    assert sents == []
    assert meta["source"] == "words"
    assert build_sentences(None, None)[0] == []
    assert build_sentences(None, [])[0] == []


def test_segments_fallback():
    segs = [
        Segment(start=0.0, end=3.0, text=" Primeira frase. ", speaker="SPEAKER_01"),
        Segment(start=3.5, end=7.0, text="Segunda frase."),
        Segment(start=7.0, end=7.0, text="   "),
        Segment(start=8.0, end=8.0, text="Zero"),
    ]
    sents, meta = build_sentences([], segs)
    assert meta["source"] == "segments"
    assert [s.text for s in sents] == ["Primeira frase.", "Segunda frase.", "Zero"]
    assert sents[0].speaker == "SPEAKER_01" and sents[1].speaker is None
    assert all(s.start < s.end for s in sents)
    assert [s.sentence_id for s in sents] == ["s1", "s2", "s3"]


def test_words_preferred_over_segments():
    words = _words(["a", "b", "c", "d."], step=0.5)
    sents, meta = build_sentences(words, [Segment(start=0, end=1, text="ignored")])
    assert meta["source"] == "words"
    assert sents[0].text == "a b c d."


def test_overlapping_and_negative_gap_words_are_robust():
    words = [
        WordTiming(word="alfa", start=0.0, end=1.0),
        WordTiming(word="beta", start=0.5, end=0.9),  # overlaps
        WordTiming(word="gama", start=0.2, end=0.4),  # starts before previous start
        WordTiming(word="delta.", start=1.0, end=1.6),
        WordTiming(word="eps", start=1.7, end=2.4),
        WordTiming(word="zeta", start=2.4, end=3.0),
        WordTiming(word="eta", start=3.0, end=3.5),
        WordTiming(word="teta.", start=3.5, end=4.2),
    ]
    sents, _ = build_sentences(words)
    _assert_invariants(words, sents)


def test_zero_gaps_everywhere():
    words = [WordTiming(word=f"p{i}", start=i * 0.3, end=(i + 1) * 0.3) for i in range(40)]
    sents, meta = build_sentences(words)
    _assert_invariants(words, sents)
    assert meta["pause_threshold_seconds"] == C.PAUSE_THRESHOLD_MIN_SECONDS


def test_empty_tokens_keep_index_coverage():
    toks = ["a", " ", "b", "", "c.", "d", "e", "f."]
    words = _words(toks, step=0.5)
    sents, _ = build_sentences(words)
    _assert_invariants(words, sents)
    assert "  " not in sents[0].text


@pytest.mark.parametrize("gap", [0.0, 5.0, 30.0])
def test_threshold_inside_clamp(gap):
    toks = [f"w{i}" for i in range(60)]
    words = _words(toks, pauses={i: gap for i in range(5, 60, 6)})
    _, meta = build_sentences(words)
    assert C.PAUSE_THRESHOLD_MIN_SECONDS <= meta["pause_threshold_seconds"] <= C.PAUSE_THRESHOLD_MAX_SECONDS


def test_huge_pauses_hit_upper_clamp():
    toks = [f"w{i}" for i in range(60)]
    words = _words(toks, pauses={i: 30.0 for i in range(0, 60, 2)})
    _, meta = build_sentences(words)
    assert meta["pause_threshold_seconds"] == C.PAUSE_THRESHOLD_MAX_SECONDS


def test_tiny_sentences_merge_with_closest_neighbour():
    toks = ["um", "dois", "tres", "quatro.", "ok.", "cinco", "seis", "sete", "oito."]
    # "ok." is tiny; the pause before it is smaller than the pause after it.
    words = _words(toks, step=0.5, dur=0.4, pauses={3: 0.0, 4: 0.3})
    sents, _ = build_sentences(words)
    _assert_invariants(words, sents)
    texts = [s.text for s in sents]
    assert "um dois tres quatro. ok." in texts
    assert not any(t == "ok." for t in texts)


def test_tiny_sentence_not_merged_when_it_would_exceed_max():
    toks = [f"w{i}" for i in range(48)] + ["fim."]  # 48*0.5 = 24 s then 1 word
    words = _words(toks, step=0.5, dur=0.5, pauses={47: 0.2})
    sents, _ = build_sentences(words)
    _assert_invariants(words, sents)


def test_long_sentence_split_at_largest_pause():
    toks = [f"w{i}" for i in range(60)]
    pauses = {19: 0.1, 29: 0.9, 40: 0.2}  # no terminals; threshold clamps at >= 0.4
    words = _words(toks, step=0.5, dur=0.4, pauses=pauses)
    sents, _ = build_sentences(words)
    _assert_invariants(words, sents)
    assert all(s.end - s.start <= C.MAX_SENTENCE_SECONDS for s in sents)
    assert any(s.word_end == 29 for s in sents)


def test_speaker_majority_and_none():
    words = _words(["a", "b", "c", "d."], step=0.5)
    words[0].speaker = "A"
    words[1].speaker = "B"
    words[2].speaker = "B"
    sents, _ = build_sentences(words)
    assert sents[0].speaker == "B"
    sents2, _ = build_sentences(_words(["a", "b", "c", "d."], step=0.5))
    assert sents2[0].speaker is None


def _sample():
    return [
        Sentence(sentence_id="s1", start=0.0, end=2.0, text="um", speaker="SPEAKER_00"),
        Sentence(sentence_id="s2", start=2.5, end=5.0, text="dois"),
        Sentence(sentence_id="s3", start=6.0, end=9.0, text="tres"),
    ]


def test_format_sentence_line():
    s = _sample()
    assert format_sentence_line(s[0]) == "s1 [SPEAKER_00]: um"
    assert format_sentence_line(s[1]) == "s2: dois"


def test_sentences_between():
    s = _sample()
    assert [x.sentence_id for x in sentences_between(s, "s1", "s2")] == ["s1", "s2"]
    assert [x.sentence_id for x in sentences_between(s, "s3", "s3")] == ["s3"]
    with pytest.raises(ValueError):
        sentences_between(s, "s3", "s1")
    with pytest.raises(ValueError):
        sentences_between(s, "s1", "s9")


def test_nearest_sentence_boundary():
    s = _sample()
    assert nearest_sentence_boundary(s, 2.4, side="start").sentence_id == "s2"
    assert nearest_sentence_boundary(s, 5.2, side="end").sentence_id == "s2"
    assert nearest_sentence_boundary(s, -10, side="start").sentence_id == "s1"
    assert nearest_sentence_boundary(s, 100, side="end").sentence_id == "s3"
    # tie goes to the earlier sentence
    assert nearest_sentence_boundary(s, 1.25, side="start").sentence_id == "s1"
    with pytest.raises(ValueError):
        nearest_sentence_boundary([], 1.0, side="start")
    with pytest.raises(ValueError):
        nearest_sentence_boundary(s, 1.0, side="middle")


@pytest.mark.parametrize(
    "name",
    ["sentences", "video_brief", "units", "scored_candidates"],
)
def test_job_store_roundtrip_each_v2_artifact(container, name):
    job = container.jobs.create_job("https://example.test/v")
    job_id = job.job_id
    jobs = container.jobs
    load = getattr(jobs, f"load_{name}")
    save = getattr(jobs, f"save_{name}")
    path_fn = getattr(jobs, f"{name}_path")
    assert load(job_id) is None
    payload = {"version": 1, "items": [{"texto": "açaí ünïcode", "n": 1}]}
    written = save(job_id, payload)
    assert written == path_fn(job_id)
    assert load(job_id) == payload
    assert json.loads(written.read_text(encoding="utf-8")) == payload
    assert not list(written.parent.glob("*.tmp"))
    save(job_id, {"version": 1, "items": []})  # overwrite is atomic and replaces
    assert load(job_id)["items"] == []


def test_job_store_v2_file_names(container):
    job_id = container.jobs.create_job("https://example.test/v").job_id
    j = container.jobs
    assert j.sentences_path(job_id).name == "sentences.json"
    assert j.video_brief_path(job_id).name == "video.brief.json"
    assert j.units_path(job_id).name == "units.json"
    assert j.scored_candidates_path(job_id).name == "candidates.scored.json"


def test_tie_between_neighbours_does_not_snowball_short_sentences():
    tokens = []
    for _ in range(100):
        tokens += ["x", "x."]
    words = []
    t = 0.0
    for i, tok in enumerate(tokens):
        words.append(WordTiming(word=tok, start=t, end=t + 0.2))
        t += 0.2 + (0.15 if i % 2 else 0.05)
    sents, _ = build_sentences(words)
    counts = [s.word_end - s.word_start + 1 for s in sents]
    assert max(counts) <= 20, counts
