"""Dynamic word-by-word `.ass` (Advanced SubStation Alpha) subtitle generator.

Supports:
- Active word highlight (`subtitle_style = "word_highlight"`) and sentence mode (`"sentence"`).
- Vertical safe-zone positioning (`PlayResX: 1080`, `PlayResY: 1920`, `MarginV: 280`).
- Deterministic time-warping synchronization (`TimelineMapper`) when `trim_internal_silence = True`
  (removing internal dead pauses `> 1.2s` while keeping `.ass` word timestamps and camera keyframes 100% aligned).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Literal, Sequence

from app.models.domain import Segment, WordTiming

SubtitleStyle = Literal["word_highlight", "sentence"]

DEFAULT_SILENCE_TRIM_THRESHOLD_SECONDS: float = 1.2
DEFAULT_SILENCE_PAD_SECONDS: float = 0.15
DEFAULT_MAX_WORDS_PER_CHUNK: int = 4
DEFAULT_CHUNK_GAP_BREAK_SECONDS: float = 0.45


@dataclass
class KeptTimeInterval:
    """An interval `[rel_start, rel_end]` (in seconds relative to `cut_start`) retained in output."""

    rel_start: float
    rel_end: float
    out_start: float
    out_end: float

    @property
    def duration(self) -> float:
        return max(0.0, self.rel_end - self.rel_start)


@dataclass
class TimelineMapper:
    """Maps timestamps between original cut time and compacted output time (for `trim_internal_silence`)."""

    cut_start: float
    cut_end: float
    trim_enabled: bool = False
    intervals: list[KeptTimeInterval] = field(default_factory=list)

    @property
    def original_duration(self) -> float:
        return max(0.0, float(self.cut_end) - float(self.cut_start))

    @property
    def compacted_duration(self) -> float:
        if not self.intervals:
            return self.original_duration
        return float(self.intervals[-1].out_end)

    def remap_relative(self, rel_t: float) -> float:
        """Map `rel_t` (seconds from `cut_start`) into compacted output time `[0, compacted_duration]`."""
        t = max(0.0, min(self.original_duration, float(rel_t)))
        if not self.trim_enabled or not self.intervals:
            return t

        for iv in self.intervals:
            if t <= iv.rel_start:
                return iv.out_start
            if iv.rel_start <= t <= iv.rel_end:
                return iv.out_start + (t - iv.rel_start)

        return self.intervals[-1].out_end

    def remap_absolute(self, abs_t: float) -> float:
        """Map absolute source video timestamp `abs_t` into compacted output time."""
        return self.remap_relative(float(abs_t) - float(self.cut_start))


def build_timeline_mapper(
    cut_start: float,
    cut_end: float,
    words: Sequence[WordTiming] = (),
    segments: Sequence[Segment] = (),
    *,
    trim_internal_silence: bool = False,
    min_silence_duration: float = DEFAULT_SILENCE_TRIM_THRESHOLD_SECONDS,
    pad_seconds: float = DEFAULT_SILENCE_PAD_SECONDS,
) -> TimelineMapper:
    """Compute kept speech intervals inside `[cut_start, cut_end]` and build a `TimelineMapper`."""
    c_start = float(cut_start)
    c_end = max(c_start, float(cut_end))
    total_dur = max(0.0, c_end - c_start)

    if not trim_internal_silence or total_dur <= min_silence_duration:
        return TimelineMapper(
            cut_start=c_start,
            cut_end=c_end,
            trim_enabled=False,
            intervals=[KeptTimeInterval(rel_start=0.0, rel_end=total_dur, out_start=0.0, out_end=total_dur)],
        )

    # Collect relative speech spans inside [0, total_dur]
    raw_spans: list[tuple[float, float]] = []
    for w in words:
        ws = float(w.start)
        we = float(w.end)
        if we <= c_start or ws >= c_end:
            continue
        rs = max(0.0, ws - c_start - pad_seconds)
        re = min(total_dur, we - c_start + pad_seconds)
        if re > rs:
            raw_spans.append((rs, re))

    if not raw_spans and segments:
        for seg in segments:
            ss = float(seg.start)
            se = float(seg.end)
            if se <= c_start or ss >= c_end:
                continue
            rs = max(0.0, ss - c_start - pad_seconds)
            re = min(total_dur, se - c_start + pad_seconds)
            if re > rs:
                raw_spans.append((rs, re))

    if not raw_spans:
        return TimelineMapper(
            cut_start=c_start,
            cut_end=c_end,
            trim_enabled=False,
            intervals=[KeptTimeInterval(rel_start=0.0, rel_end=total_dur, out_start=0.0, out_end=total_dur)],
        )

    raw_spans.sort(key=lambda sp: (sp[0], sp[1]))

    # Merge spans separated by less than `min_silence_duration - 2*pad_seconds`
    effective_gap_threshold = max(0.1, float(min_silence_duration) - 2.0 * float(pad_seconds))
    merged: list[list[float]] = [[raw_spans[0][0], raw_spans[0][1]]]
    for rs, re in raw_spans[1:]:
        prev_start, prev_end = merged[-1]
        if rs - prev_end <= effective_gap_threshold:
            merged[-1][1] = max(prev_end, re)
        else:
            merged.append([rs, re])

    # If leading/trailing silences are shorter than `min_silence_duration`, extend to boundaries
    if merged[0][0] < min_silence_duration:
        merged[0][0] = 0.0
    if total_dur - merged[-1][1] < min_silence_duration:
        merged[-1][1] = total_dur

    intervals: list[KeptTimeInterval] = []
    out_cursor = 0.0
    for rs, re in merged:
        dur = max(0.0, re - rs)
        if dur <= 1e-4:
            continue
        intervals.append(
            KeptTimeInterval(
                rel_start=round(rs, 4),
                rel_end=round(re, 4),
                out_start=round(out_cursor, 4),
                out_end=round(out_cursor + dur, 4),
            )
        )
        out_cursor += dur

    if not intervals:
        intervals = [KeptTimeInterval(rel_start=0.0, rel_end=total_dur, out_start=0.0, out_end=total_dur)]

    did_trim = len(intervals) > 1 or abs(intervals[0].duration - total_dur) > 0.05
    return TimelineMapper(
        cut_start=c_start,
        cut_end=c_end,
        trim_enabled=did_trim,
        intervals=intervals,
    )


def format_ass_timestamp(seconds: float) -> str:
    """Format seconds into ASS timestamp `H:MM:SS.cc` (centiseconds)."""
    clamped = max(0.0, float(seconds))
    total_cs = int(round(clamped * 100.0))
    cs = total_cs % 100
    total_s = total_cs // 100
    s = total_s % 60
    total_m = total_s // 60
    m = total_m % 60
    h = total_m // 60
    return f"{h}:{m:02d}:{s:02d}.{cs:02d}"


def _escape_ass_text(text: str) -> str:
    """Escape special ASS override characters in raw word tokens."""
    return (
        str(text or "")
        .replace("\\", "")
        .replace("{", "(")
        .replace("}", ")")
        .replace("\r", " ")
        .replace("\n", " ")
        .strip()
    )


def synthesize_words_from_segments(
    segments: Sequence[Segment],
    cut_start: float,
    cut_end: float,
) -> list[WordTiming]:
    """Synthesize proportional `WordTiming` entries from `Segment`s when `transcription.words.json` is absent."""
    synthesized: list[WordTiming] = []
    for seg in segments:
        s_start = max(float(cut_start), float(seg.start))
        s_end = min(float(cut_end), float(seg.end))
        if s_end <= s_start:
            continue
        tokens = [tok.strip() for tok in str(seg.text or "").split() if tok.strip()]
        if not tokens:
            continue
        dur = (s_end - s_start) / float(len(tokens))
        for idx, tok in enumerate(tokens):
            w_start = s_start + idx * dur
            w_end = w_start + dur
            synthesized.append(
                WordTiming(
                    word=tok,
                    start=round(w_start, 3),
                    end=round(w_end, 3),
                    probability=1.0,
                    speaker=seg.speaker,
                    segment_id=seg.segment_id,
                )
            )
    return synthesized


def _group_words_into_chunks(
    words: Sequence[WordTiming],
    *,
    max_words_per_chunk: int = DEFAULT_MAX_WORDS_PER_CHUNK,
    gap_break_seconds: float = DEFAULT_CHUNK_GAP_BREAK_SECONDS,
) -> list[list[WordTiming]]:
    """Group consecutive words into readable 3-5 word chunks broken at natural pauses or sentence punctuation."""
    chunks: list[list[WordTiming]] = []
    current: list[WordTiming] = []

    for w in words:
        token = _escape_ass_text(w.word)
        if not token:
            continue
        if current:
            gap = float(w.start) - float(current[-1].end)
            prev_text = _escape_ass_text(current[-1].word)
            ends_sentence = prev_text.endswith((".", "!", "?", ":", ";"))
            if len(current) >= max_words_per_chunk or gap >= gap_break_seconds or ends_sentence:
                chunks.append(current)
                current = []
        current.append(w)

    if current:
        chunks.append(current)
    return chunks


def generate_ass_subtitles(
    words: Sequence[WordTiming],
    *,
    cut_start: float,
    cut_end: float,
    segments: Sequence[Segment] = (),
    subtitle_style: SubtitleStyle = "word_highlight",
    timeline_mapper: TimelineMapper | None = None,
    trim_internal_silence: bool = False,
    play_res_x: int = 1080,
    play_res_y: int = 1920,
    margin_v: int = 280,
) -> str:
    """Generate a complete `.ass` subtitle script for a cut in `[cut_start, cut_end]`."""
    mapper = timeline_mapper or build_timeline_mapper(
        cut_start=cut_start,
        cut_end=cut_end,
        words=words,
        segments=segments,
        trim_internal_silence=trim_internal_silence,
    )

    cut_words = [
        WordTiming(
            word=w.word,
            start=max(float(cut_start), float(w.start)),
            end=min(float(cut_end), float(w.end)),
            probability=w.probability,
            speaker=w.speaker,
            segment_id=w.segment_id,
        )
        for w in words
        if float(w.end) > float(cut_start) and float(w.start) < float(cut_end) and _escape_ass_text(w.word)
    ]

    if not cut_words and segments:
        cut_words = synthesize_words_from_segments(segments, cut_start, cut_end)

    cut_words.sort(key=lambda w: (float(w.start), float(w.end)))

    header_lines = [
        "[Script Info]",
        "Title: YouTube Shorts Dynamic Captions",
        "ScriptType: v4.00+",
        f"PlayResX: {int(play_res_x)}",
        f"PlayResY: {int(play_res_y)}",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        f"Style: Default,Arial,64,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,"
        f"-1,0,0,0,100,100,0,0,1,4,2,2,80,80,{int(margin_v)},1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]

    chunks = _group_words_into_chunks(cut_words)
    dialogue_lines: list[str] = []

    for chunk in chunks:
        if not chunk:
            continue

        if subtitle_style == "sentence":
            t_start = mapper.remap_absolute(chunk[0].start)
            t_end = max(t_start + 0.08, mapper.remap_absolute(chunk[-1].end))
            text_line = " ".join(_escape_ass_text(w.word) for w in chunk)
            dialogue_lines.append(
                f"Dialogue: 0,{format_ass_timestamp(t_start)},{format_ass_timestamp(t_end)},"
                f"Default,,0,0,0,,{text_line}"
            )
            continue

        # "word_highlight": emit one event per active word in the chunk with karaoke/pop highlight
        tokens = [_escape_ass_text(w.word) for w in chunk]
        for active_idx, active_word in enumerate(chunk):
            w_start = mapper.remap_absolute(active_word.start)
            if active_idx + 1 < len(chunk):
                next_start = mapper.remap_absolute(chunk[active_idx + 1].start)
                raw_end = mapper.remap_absolute(active_word.end)
                # Bridge micro-gaps (< 0.15s) inside the same chunk so caption doesn't flicker
                w_end = next_start if (0.0 <= next_start - raw_end <= 0.15) else raw_end
            else:
                w_end = mapper.remap_absolute(active_word.end)

            w_end = max(w_start + 0.05, w_end)

            rendered_parts: list[str] = []
            for j, tok in enumerate(tokens):
                if j == active_idx:
                    rendered_parts.append(f"{{\\c&H0000FFFF&\\fscx112\\fscy112\\b1}}{tok}{{\\r}}")
                else:
                    rendered_parts.append(tok)

            line_text = " ".join(rendered_parts)
            dialogue_lines.append(
                f"Dialogue: 0,{format_ass_timestamp(w_start)},{format_ass_timestamp(w_end)},"
                f"Default,,0,0,0,,{line_text}"
            )

    return "\n".join(header_lines + dialogue_lines) + "\n"


def write_ass_subtitle_file(
    target_path: str | Path,
    words: Sequence[WordTiming],
    *,
    cut_start: float,
    cut_end: float,
    segments: Sequence[Segment] = (),
    subtitle_style: SubtitleStyle = "word_highlight",
    timeline_mapper: TimelineMapper | None = None,
    trim_internal_silence: bool = False,
) -> Path:
    """Generate and write UTF-8 `.ass` subtitle file to `target_path`."""
    out_path = Path(target_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    content = generate_ass_subtitles(
        words,
        cut_start=cut_start,
        cut_end=cut_end,
        segments=segments,
        subtitle_style=subtitle_style,
        timeline_mapper=timeline_mapper,
        trim_internal_silence=trim_internal_silence,
    )
    out_path.write_text(content, encoding="utf-8")
    return out_path
