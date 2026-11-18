"""S0: sentence splitting from word timings (pure code, no LLM, no lexicon).

Rules: docs/analysis-v2/stage-contracts.md, section S0.
"""

from __future__ import annotations

from collections import Counter
from typing import Any, Sequence

from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.models import Sentence
from app.models.domain import Segment, WordTiming


def _percentile(values: Sequence[float], pct: float) -> float:
    ordered = sorted(values)
    if not ordered:
        return 0.0
    if len(ordered) == 1:
        return float(ordered[0])
    rank = (len(ordered) - 1) * pct / 100.0
    lo = int(rank)
    hi = min(lo + 1, len(ordered) - 1)
    frac = rank - lo
    return float(ordered[lo] + (ordered[hi] - ordered[lo]) * frac)


def _clamp_threshold(value: float) -> float:
    return min(max(value, C.PAUSE_THRESHOLD_MIN_SECONDS), C.PAUSE_THRESHOLD_MAX_SECONDS)


def _ends_with_terminal(token: str) -> bool:
    stripped = token.strip().rstrip(C.TRAILING_CLOSER_CHARS)
    return bool(stripped) and stripped[-1] in C.TERMINAL_PUNCTUATION_CHARS


def _effective_times(words: Sequence[WordTiming]) -> tuple[list[float], list[float]]:
    """Monotonic start times and end >= start, robust to overlapping/negative gaps."""
    starts: list[float] = []
    ends: list[float] = []
    prev_start = float("-inf")
    for w in words:
        s = max(float(w.start), prev_start)
        e = max(float(w.end), s)
        starts.append(s)
        ends.append(e)
        prev_start = s
    return starts, ends


def _majority_speaker(words: Sequence[WordTiming]) -> str | None:
    counts = Counter(w.speaker for w in words if w.speaker)
    if not counts:
        return None
    best = max(counts.values())
    for w in words:  # first speaker reaching the max wins ties
        if w.speaker and counts[w.speaker] == best:
            return w.speaker
    return None


def _build_from_words(words: Sequence[WordTiming]) -> tuple[list[Sentence], dict[str, Any]]:
    n = len(words)
    starts, ends = _effective_times(words)
    gap_after = [max(0.0, starts[i + 1] - ends[i]) for i in range(n - 1)]

    terminals = sum(1 for w in words if _ends_with_terminal(w.word))
    low_punct = (terminals * 100.0 / n) < C.LOW_PUNCTUATION_TERMINALS_PER_100_WORDS
    pct = C.PAUSE_PERCENTILE_LOW_PUNCTUATION if low_punct else C.PAUSE_PERCENTILE
    if gap_after:
        threshold = _clamp_threshold(_percentile(gap_after, pct))
    else:
        threshold = C.PAUSE_THRESHOLD_MAX_SECONDS
    meta = {"source": "words", "pause_threshold_seconds": threshold, "low_punctuation": low_punct}

    groups: list[tuple[int, int]] = []
    lo = 0
    for i in range(n):
        last = i == n - 1
        brk = last
        if not last:
            if gap_after[i] >= threshold:
                brk = True
            elif not low_punct and _ends_with_terminal(words[i].word):
                brk = True
        if brk:
            groups.append((lo, i))
            lo = i + 1

    def dur(g: tuple[int, int]) -> float:
        return max(ends[g[0] : g[1] + 1]) - starts[g[0]]

    def is_tiny(g: tuple[int, int]) -> bool:
        return dur(g) < C.MIN_SENTENCE_SECONDS or (g[1] - g[0] + 1) < C.MIN_SENTENCE_WORDS

    # Rule 4: merge tiny groups into the neighbour with the smallest pause
    # (never producing a group longer than the maximum).
    i = 0
    while i < len(groups):
        g = groups[i]
        if not is_tiny(g):
            i += 1
            continue
        options: list[tuple[float, int]] = []  # (pause, neighbour index)
        if i > 0 and dur((groups[i - 1][0], g[1])) <= C.MAX_SENTENCE_SECONDS:
            options.append((max(0.0, starts[g[0]] - ends[g[0] - 1]), i - 1))
        if i + 1 < len(groups) and dur((g[0], groups[i + 1][1])) <= C.MAX_SENTENCE_SECONDS:
            options.append((max(0.0, starts[groups[i + 1][0]] - ends[g[1]]), i + 1))
        if not options:
            i += 1
            continue
        # Smallest pause; on a tie prefer the shorter neighbour so runs of tiny sentences do not snowball.
        _, j = min(options, key=lambda o: (o[0], dur(groups[o[1]]), o[1]))
        a, b = min(i, j), max(i, j)
        groups[a : b + 1] = [(groups[a][0], groups[b][1])]
        i = a  # re-check the merged group

    # Rule 5: split sentences longer than the maximum at the largest internal pause.
    def split(g: tuple[int, int]) -> list[tuple[int, int]]:
        if g[0] == g[1] or dur(g) <= C.MAX_SENTENCE_SECONDS:
            return [g]
        cuts = [k for k in range(g[0], g[1]) if gap_after[k] > 0.0]
        if not cuts:
            return [g]
        good = [
            k
            for k in cuts
            if dur((g[0], k)) >= C.MIN_SENTENCE_SECONDS and dur((k + 1, g[1])) >= C.MIN_SENTENCE_SECONDS
        ]
        pool = good or cuts
        mid = (starts[g[0]] + max(ends[g[0] : g[1] + 1])) / 2.0
        k = min(pool, key=lambda c: (-gap_after[c], abs(ends[c] - mid)))
        return split((g[0], k)) + split((k + 1, g[1]))

    final: list[tuple[int, int]] = []
    for g in groups:
        final.extend(split(g))

    sentences: list[Sentence] = []
    for idx, g in enumerate(final, start=1):
        chunk = words[g[0] : g[1] + 1]
        s = starts[g[0]]
        e = max(max(ends[g[0] : g[1] + 1]), s + C.MIN_SENTENCE_DURATION_EPSILON)
        text = " ".join(t for t in (w.word.strip() for w in chunk) if t)
        sentences.append(
            Sentence(
                sentence_id=f"s{idx}",
                start=s,
                end=e,
                text=text,
                speaker=_majority_speaker(chunk),
                word_start=g[0],
                word_end=g[1],
            )
        )
    return sentences, meta


def _build_from_segments(segments: Sequence[Segment]) -> tuple[list[Sentence], dict[str, Any]]:
    usable = [s for s in segments if (s.text or "").strip()]
    gaps = [max(0.0, usable[i + 1].start - usable[i].end) for i in range(len(usable) - 1)]
    threshold = (
        _clamp_threshold(_percentile(gaps, C.PAUSE_PERCENTILE)) if gaps else C.PAUSE_THRESHOLD_MAX_SECONDS
    )
    meta = {"source": "segments", "pause_threshold_seconds": threshold, "low_punctuation": False}
    out: list[Sentence] = []
    prev_start = float("-inf")
    for idx, seg in enumerate(usable, start=1):
        s = max(float(seg.start), prev_start)
        e = max(float(seg.end), s + C.MIN_SENTENCE_DURATION_EPSILON)
        prev_start = s
        out.append(
            Sentence(
                sentence_id=f"s{idx}",
                start=s,
                end=e,
                text=seg.text.strip(),
                speaker=seg.speaker or None,
            )
        )
    return out, meta


def build_sentences(
    words: Sequence[WordTiming] | None,
    segments: Sequence[Segment] | None = None,
) -> tuple[list[Sentence], dict[str, Any]]:
    """Split a transcription into sentences. Falls back to segments when words are empty."""
    if words:
        return _build_from_words(words)
    if segments:
        return _build_from_segments(segments)
    return [], {
        "source": "words",
        "pause_threshold_seconds": C.PAUSE_THRESHOLD_MAX_SECONDS,
        "low_punctuation": False,
    }


def _index_of(sentences: Sequence[Sentence], sentence_id: str) -> int:
    for i, s in enumerate(sentences):
        if s.sentence_id == sentence_id:
            return i
    raise ValueError(f"unknown sentence id: {sentence_id}")


def sentences_between(sentences: Sequence[Sentence], start_id: str, end_id: str) -> list[Sentence]:
    """Sentences from start_id to end_id inclusive. Raises ValueError on unknown ids or reversed range."""
    a = _index_of(sentences, start_id)
    b = _index_of(sentences, end_id)
    if a > b:
        raise ValueError(f"start sentence {start_id} is after end sentence {end_id}")
    return list(sentences[a : b + 1])


def format_sentence_line(s: Sentence) -> str:
    """`s12 [SPEAKER_00]: text`; the bracket is omitted when there is no speaker."""
    if s.speaker:
        return f"{s.sentence_id} [{s.speaker}]: {s.text}"
    return f"{s.sentence_id}: {s.text}"


def nearest_sentence_boundary(sentences: Sequence[Sentence], t: float, *, side: str) -> Sentence:
    """Sentence whose start (side="start") or end (side="end") is nearest to t; ties go to the earlier one."""
    if side not in ("start", "end"):
        raise ValueError("side must be 'start' or 'end'")
    if not sentences:
        raise ValueError("no sentences")
    key = (lambda s: s.start) if side == "start" else (lambda s: s.end)
    return min(sentences, key=lambda s: abs(key(s) - t))
