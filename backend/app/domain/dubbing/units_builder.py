"""Dubbing units builder, clean speaker reference selector, and 20s preview window detector."""

from __future__ import annotations

import io
import math
import re
import shutil
import subprocess
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Sequence

import numpy as np

from app.infrastructure.audio.acoustic_dsp import compute_rms_energy_from_wav
from app.infrastructure.storage.atomic_store import atomic_write_json, read_json
from app.models.domain import DubbingUnit, Segment, WordTiming

DEFAULT_SOFT_UNIT_SECONDS = 18.0
DEFAULT_HARD_UNIT_SECONDS = 22.0
DEFAULT_SILENCE_BREAK_SECONDS = 1.2
DEFAULT_MIN_REF_SECONDS = 6.0
DEFAULT_MAX_REF_SECONDS = 12.0
DEFAULT_MIN_FALLBACK_REF_SECONDS = 2.5
DEFAULT_MIN_SNR_DB = 10.0
DEFAULT_OVERLAP_MARGIN_SECONDS = 0.15
DEFAULT_PROBE_AHEAD_SECONDS = 45.0

_NON_SPEECH_TAG_RE = re.compile(
    r"(\[[^\]]*?(m[úu]sica|music|aplausos|applause|risos|laughter|sil[êe]ncio|silence|singing|instrumental|som|sound|noise|ru[íi]do)[^\]]*\]"
    r"|\([^\)]*?(m[úu]sica|music|aplausos|applause|singing|instrumental)[^\)]*\))",
    re.IGNORECASE,
)
_MUSIC_GLYPH_RE = re.compile(r"[♪♫♬]")
_PUNCT_ONLY_RE = re.compile(r"^[\s\W_]+$", re.UNICODE)
_END_SENTENCE_PUNCT = (".", "!", "?", ";", ":", "…")
_CLAUSE_PUNCT = (",", "—", "-")


@dataclass
class SpeakerReferenceResult:
    """Result of selecting a clean reference audio clip for a speaker.

    Supports 2-tuple unpacking (`ref_path, ref_text = select_clean_speaker_reference(...)`)
    as well as inspecting `.x_vector_only`, `.needs_probe_ahead`, `.snr_db`, and `.clean_duration`.
    """

    ref_path: Path | None
    ref_text: str
    speaker_id: str = "SPEAKER_00"
    ref_start: float = 0.0
    ref_end: float = 0.0
    clean_duration: float = 0.0
    snr_db: float = 0.0
    x_vector_only: bool = False
    needs_probe_ahead: bool = False
    warnings: list[str] = field(default_factory=list)

    def __iter__(self):
        yield self.ref_path
        yield self.ref_text


def _seg_field(seg: Any, key: str, default: Any = None) -> Any:
    if isinstance(seg, dict):
        return seg.get(key, default)
    return getattr(seg, key, default)


def _seg_id(seg: Any, fallback_idx: int) -> str:
    raw = _seg_field(seg, "segment_id")
    if raw is None or str(raw).strip() == "":
        raw = _seg_field(seg, "id")
    if raw is None or str(raw).strip() == "":
        return f"s{fallback_idx}"
    return str(raw)


def is_passthrough_segment(seg: Segment | dict[str, Any]) -> bool:
    """Return True for music, singing, non-speech tags, empty text, or high no_speech_prob."""
    raw_nsp = _seg_field(seg, "no_speech_prob")
    if raw_nsp is not None:
        try:
            if float(raw_nsp) > 0.65:
                return True
        except (TypeError, ValueError):
            pass

    text = str(_seg_field(seg, "text", "") or "").strip()
    if not text:
        return True
    if _MUSIC_GLYPH_RE.search(text):
        return True
    stripped = _NON_SPEECH_TAG_RE.sub("", text).strip()
    if not stripped or _PUNCT_ONLY_RE.match(stripped):
        return True
    return False


def _normalize_speaker_turns(
    speakers: Sequence[dict[str, Any]] | dict[str, Any] | None,
) -> list[tuple[float, float, str]]:
    if not speakers:
        return []
    raw_items: Any = speakers
    if isinstance(speakers, dict):
        raw_items = speakers.get("segments") or speakers.get("turns") or speakers.get("speakers") or []
    if not isinstance(raw_items, list):
        return []
    turns: list[tuple[float, float, str]] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        spk = str(item.get("speaker") or item.get("speaker_id") or "").strip()
        if not spk:
            continue
        try:
            st = float(item.get("start", 0.0))
            en = float(item.get("end", st))
        except (TypeError, ValueError):
            continue
        if en > st:
            turns.append((st, en, spk))
    turns.sort(key=lambda t: (t[0], t[1]))
    return turns


def _resolve_segment_speaker(
    start: float,
    end: float,
    existing_speaker: str | None,
    turns: Sequence[tuple[float, float, str]],
    voice_mode: str,
) -> str:
    if str(voice_mode or "auto").strip().lower() == "single":
        return "SPEAKER_00"
    if turns:
        overlap_by_spk: dict[str, float] = {}
        for t_start, t_end, spk in turns:
            ov = min(end, t_end) - max(start, t_start)
            if ov > 0.0:
                overlap_by_spk[spk] = overlap_by_spk.get(spk, 0.0) + ov
        if overlap_by_spk:
            return max(overlap_by_spk.items(), key=lambda kv: kv[1])[0]
        # Nearest turn fallback if no direct overlap
        mid = 0.5 * (start + end)
        nearest_spk = min(
            turns,
            key=lambda t: 0.0 if t[0] <= mid <= t[1] else min(abs(mid - t[0]), abs(mid - t[1])),
        )[2]
        if nearest_spk:
            return nearest_spk
    if existing_speaker and str(existing_speaker).strip():
        return str(existing_speaker).strip()
    return "SPEAKER_00"


def _split_long_single_segment(
    seg_id: str,
    start: float,
    end: float,
    text: str,
    speaker: str,
    words: Sequence[WordTiming | dict[str, Any]],
    *,
    soft_max_seconds: float,
    hard_max_seconds: float,
) -> list[dict[str, Any]]:
    """Split an unusually long (>22s) single Whisper segment at word/punctuation boundaries."""
    seg_words = [
        w
        for w in words
        if float(_seg_field(w, "end", 0.0)) > start
        and float(_seg_field(w, "start", 0.0)) < end
        and str(_seg_field(w, "word", "") or "").strip()
    ]
    if not seg_words:
        # Proportional text split fallback
        n_chunks = max(2, int(math.ceil((end - start) / soft_max_seconds)))
        tokens = text.split()
        if len(tokens) < n_chunks:
            return [
                {
                    "speaker": speaker,
                    "start": round(start, 3),
                    "end": round(end, 3),
                    "segment_ids": [seg_id],
                    "text": text,
                    "passthrough_original": False,
                }
            ]
        chunks: list[dict[str, Any]] = []
        per_chunk = max(1, len(tokens) // n_chunks)
        total_dur = end - start
        idx = 0
        for c_i in range(n_chunks):
            next_idx = len(tokens) if c_i == n_chunks - 1 else min(len(tokens), idx + per_chunk)
            part_tokens = tokens[idx:next_idx]
            if not part_tokens:
                continue
            c_start = start + total_dur * (idx / len(tokens))
            c_end = start + total_dur * (next_idx / len(tokens))
            chunks.append(
                {
                    "speaker": speaker,
                    "start": round(c_start, 3),
                    "end": round(c_end, 3),
                    "segment_ids": [seg_id],
                    "text": " ".join(part_tokens),
                    "passthrough_original": False,
                }
            )
            idx = next_idx
        return chunks

    seg_words.sort(key=lambda w: float(_seg_field(w, "start", 0.0)))
    chunks = []
    cur: list[Any] = []
    cur_start = float(_seg_field(seg_words[0], "start", start))

    for w in seg_words:
        w_start = max(start, float(_seg_field(w, "start", start)))
        w_end = min(end, float(_seg_field(w, "end", w_start)))
        w_text = str(_seg_field(w, "word", "") or "").strip()
        if not cur:
            cur = [(w_start, w_end, w_text)]
            cur_start = w_start
            continue

        prev_end = cur[-1][1]
        prev_text = cur[-1][2]
        projected_dur = w_end - cur_start
        pause_gap = w_start - prev_end
        should_break = False

        if projected_dur > hard_max_seconds:
            should_break = True
        elif projected_dur > soft_max_seconds and (
            prev_text.endswith(_END_SENTENCE_PUNCT)
            or prev_text.endswith(_CLAUSE_PUNCT)
            or pause_gap >= 0.25
        ):
            should_break = True

        if should_break:
            chunks.append(
                {
                    "speaker": speaker,
                    "start": round(cur_start, 3),
                    "end": round(prev_end, 3),
                    "segment_ids": [seg_id],
                    "text": " ".join(item[2] for item in cur).strip(),
                    "passthrough_original": False,
                }
            )
            cur = [(w_start, w_end, w_text)]
            cur_start = w_start
        else:
            cur.append((w_start, w_end, w_text))

    if cur:
        chunks.append(
            {
                "speaker": speaker,
                "start": round(cur_start, 3),
                "end": round(cur[-1][1], 3),
                "segment_ids": [seg_id],
                "text": " ".join(item[2] for item in cur).strip(),
                "passthrough_original": False,
            }
        )
    return chunks


def build_dubbing_units(
    segments: Sequence[Segment | dict[str, Any]],
    *,
    words: Sequence[WordTiming | dict[str, Any]] = (),
    speakers: Sequence[dict[str, Any]] | dict[str, Any] | None = None,
    voice_mode: str = "auto",
    soft_max_seconds: float = DEFAULT_SOFT_UNIT_SECONDS,
    hard_max_seconds: float = DEFAULT_HARD_UNIT_SECONDS,
    silence_break_seconds: float = DEFAULT_SILENCE_BREAK_SECONDS,
) -> list[DubbingUnit]:
    """Group Whisper segments into speaker-coherent, duration-capped `DubbingUnit`s.

    - Breaks cleanly on every speaker change (unless `voice_mode == "single"`).
    - Caps units at `18.0s` (hard cap `22.0s` at nearest punctuation/pause).
    - Preserves `segment_ids` mapping back to exact original Whisper segments.
    - Marks music/singing/non-speech spans as `passthrough_original = True`.
    """
    if not segments:
        return []

    turns = _normalize_speaker_turns(speakers)
    normalized_segs: list[dict[str, Any]] = []

    for idx, seg in enumerate(segments, start=1):
        sid = _seg_id(seg, idx)
        st = max(0.0, float(_seg_field(seg, "start", 0.0)))
        en = max(st, float(_seg_field(seg, "end", st)))
        txt = str(_seg_field(seg, "text", "") or "").strip()
        existing_spk = _seg_field(seg, "speaker")
        passthrough = is_passthrough_segment(seg)
        spk = (
            "ORIGINAL"
            if passthrough
            else _resolve_segment_speaker(st, en, existing_spk, turns, voice_mode)
        )
        normalized_segs.append(
            {
                "segment_id": sid,
                "start": st,
                "end": en,
                "text": txt,
                "speaker": spk,
                "passthrough": passthrough,
            }
        )

    normalized_segs.sort(key=lambda s: (s["start"], s["end"]))

    raw_units: list[dict[str, Any]] = []
    cur_group: list[dict[str, Any]] = []

    def _flush_group() -> None:
        if not cur_group:
            return
        first = cur_group[0]
        last = cur_group[-1]
        is_pt = first["passthrough"]
        joined_text = " ".join(item["text"] for item in cur_group if item["text"]).strip()
        raw_units.append(
            {
                "speaker": first["speaker"] if not is_pt else "ORIGINAL",
                "start": round(first["start"], 3),
                "end": round(last["end"], 3),
                "segment_ids": [item["segment_id"] for item in cur_group],
                "text": joined_text,
                "passthrough_original": is_pt,
            }
        )
        cur_group.clear()

    for seg in normalized_segs:
        seg_dur = seg["end"] - seg["start"]

        # Single segment exceeds hard max -> flush existing group and split if speech
        if not seg["passthrough"] and seg_dur > hard_max_seconds:
            _flush_group()
            raw_units.extend(
                _split_long_single_segment(
                    seg["segment_id"],
                    seg["start"],
                    seg["end"],
                    seg["text"],
                    seg["speaker"],
                    words,
                    soft_max_seconds=soft_max_seconds,
                    hard_max_seconds=hard_max_seconds,
                )
            )
            continue

        if not cur_group:
            cur_group.append(seg)
            continue

        prev = cur_group[-1]
        group_start = cur_group[0]["start"]
        projected_dur = seg["end"] - group_start
        gap = seg["start"] - prev["end"]

        must_break = False
        if seg["passthrough"] != prev["passthrough"]:
            must_break = True
        elif not seg["passthrough"] and str(voice_mode).lower() != "single" and seg["speaker"] != prev["speaker"]:
            must_break = True
        elif gap >= silence_break_seconds:
            must_break = True
        elif projected_dur > hard_max_seconds:
            must_break = True
        elif projected_dur > soft_max_seconds:
            prev_text = prev["text"].rstrip()
            if prev_text.endswith(_END_SENTENCE_PUNCT) or prev_text.endswith(_CLAUSE_PUNCT) or gap >= 0.35:
                must_break = True

        if must_break:
            _flush_group()
        cur_group.append(seg)

    _flush_group()

    units: list[DubbingUnit] = []
    for idx, item in enumerate(raw_units, start=1):
        units.append(
            DubbingUnit(
                unit_id=f"u{idx:04d}",
                speaker=item["speaker"],
                start=float(item["start"]),
                end=float(item["end"]),
                segment_ids=list(item["segment_ids"]),
                text=item["text"],
                dub_text="",
                passthrough_original=bool(item["passthrough_original"]),
            )
        )
    return units


def save_dubbing_units(output_path: str | Path, units: Sequence[DubbingUnit]) -> Path:
    """Persist `dubbing.units.json` atomically."""
    return atomic_write_json(output_path, list(units))


def load_dubbing_units(units_path: str | Path) -> list[DubbingUnit]:
    """Load `dubbing.units.json` into `DubbingUnit` models."""
    path = Path(units_path)
    if not path.exists():
        return []
    raw = read_json(path)
    if not isinstance(raw, list):
        return []
    return [DubbingUnit.model_validate(item) for item in raw]


def _load_audio_mono_float32(audio_path: str | Path) -> tuple[np.ndarray, int]:
    """Load `.wav` (pure stdlib) or `.flac`/`.m4a`/other (via soundfile or ffmpeg pipe) as mono float32."""
    path = Path(audio_path)
    if not path.exists():
        return np.zeros(0, dtype=np.float32), 16000

    if path.suffix.lower() == ".wav":
        try:
            with wave.open(str(path), "rb") as wf:
                sr = wf.getframerate() or 16000
                ch = max(1, wf.getnchannels())
                sw = wf.getsampwidth()
                raw = wf.readframes(wf.getnframes())
            if sw == 2:
                arr = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
            elif sw == 4:
                arr = np.frombuffer(raw, dtype="<i4").astype(np.float32) / 2147483648.0
            else:
                arr = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) / 128.0 - 1.0
            if ch > 1 and arr.size >= ch:
                arr = arr.reshape(-1, ch).mean(axis=1)
            return arr, sr
        except Exception:
            pass

    try:
        import soundfile as sf  # type: ignore

        data, sr = sf.read(str(path), dtype="float32", always_2d=False)
        arr = np.asarray(data, dtype=np.float32)
        if arr.ndim > 1:
            arr = arr.mean(axis=1)
        return arr, int(sr)
    except Exception:
        pass

    ffmpeg_bin = shutil.which("ffmpeg")
    if ffmpeg_bin:
        proc = subprocess.run(
            [
                ffmpeg_bin,
                "-v",
                "error",
                "-i",
                str(path),
                "-ac",
                "1",
                "-ar",
                "24000",
                "-f",
                "wav",
                "-acodec",
                "pcm_s16le",
                "pipe:1",
            ],
            capture_output=True,
            timeout=120,
            check=False,
        )
        if proc.returncode == 0 and len(proc.stdout) > 44:
            with wave.open(io.BytesIO(proc.stdout), "rb") as wf:
                sr = wf.getframerate() or 24000
                raw = wf.readframes(wf.getnframes())
            arr = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
            return arr, sr

    return np.zeros(0, dtype=np.float32), 16000


def _write_mono_wav_float32(target_path: Path, samples: np.ndarray, sample_rate: int) -> Path:
    target_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = target_path.with_name(f"{target_path.name}.tmp")
    clipped = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    int16_arr = (clipped * 32767.0).astype("<i2")
    with wave.open(str(tmp_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(int16_arr.tobytes())
    tmp_path.replace(target_path)
    return target_path


def _subtract_intervals(
    span: tuple[float, float],
    blocked: Sequence[tuple[float, float]],
) -> list[tuple[float, float]]:
    """Subtract blocked intervals from `[span[0], span[1]]`."""
    pieces: list[tuple[float, float]] = [span]
    for b_start, b_end in blocked:
        next_pieces: list[tuple[float, float]] = []
        for p_start, p_end in pieces:
            if b_end <= p_start or b_start >= p_end:
                next_pieces.append((p_start, p_end))
                continue
            if b_start > p_start:
                next_pieces.append((p_start, b_start))
            if b_end < p_end:
                next_pieces.append((b_end, p_end))
        pieces = next_pieces
        if not pieces:
            break
    return [(s, e) for s, e in pieces if e - s > 0.05]


def _extract_reference_text(
    ref_start: float,
    ref_end: float,
    words: Sequence[WordTiming | dict[str, Any]],
    transcription_segments: Sequence[Segment | dict[str, Any]],
) -> str:
    if words:
        picked = [
            str(_seg_field(w, "word", "") or "").strip()
            for w in words
            if float(_seg_field(w, "end", 0.0)) >= ref_start + 0.02
            and float(_seg_field(w, "start", 0.0)) <= ref_end - 0.02
            and str(_seg_field(w, "word", "") or "").strip()
        ]
        if picked:
            return " ".join(picked).strip()

    if transcription_segments:
        picked_segs = [
            str(_seg_field(s, "text", "") or "").strip()
            for s in transcription_segments
            if float(_seg_field(s, "end", 0.0)) > ref_start
            and float(_seg_field(s, "start", 0.0)) < ref_end
            and not is_passthrough_segment(s)
        ]
        if picked_segs:
            return " ".join(picked_segs).strip()
    return ""


def select_clean_speaker_reference(
    vocals_path: str | Path,
    no_vocals_path: str | Path | None,
    diarized_segments: Sequence[dict[str, Any] | Segment],
    speaker_id: str,
    *,
    output_dir: str | Path | None = None,
    min_duration: float = DEFAULT_MIN_REF_SECONDS,
    max_duration: float = DEFAULT_MAX_REF_SECONDS,
    min_clean_fallback: float = DEFAULT_MIN_FALLBACK_REF_SECONDS,
    min_snr_db: float = DEFAULT_MIN_SNR_DB,
    overlap_margin: float = DEFAULT_OVERLAP_MARGIN_SECONDS,
    words: Sequence[WordTiming | dict[str, Any]] = (),
    transcription_segments: Sequence[Segment | dict[str, Any]] = (),
    ref_lang: str | None = None,
    time_offset: float = 0.0,
) -> SpeakerReferenceResult:
    """Select a clean 6–12s speaker reference clip (`SNR > +10dB` vs `no_vocals`, zero overlap `±0.15s`).

    Writes `{speaker_id}_ref.wav` and `{speaker_id}_ref.json` in `output_dir` when provided.
    Flags `needs_probe_ahead=True` and `x_vector_only=True` if clean speech < `2.5s`.
    """
    vocals, v_sr = _load_audio_mono_float32(vocals_path)
    no_vocals = np.zeros(0, dtype=np.float32)
    nv_sr = v_sr
    if no_vocals_path is not None and Path(no_vocals_path).exists():
        no_vocals, nv_sr = _load_audio_mono_float32(no_vocals_path)

    if vocals.size == 0 or v_sr <= 0:
        return SpeakerReferenceResult(
            ref_path=None,
            ref_text="",
            speaker_id=speaker_id,
            clean_duration=0.0,
            snr_db=0.0,
            x_vector_only=True,
            needs_probe_ahead=True,
            warnings=[f"Vocals audio empty or unreadable for {speaker_id}"],
        )

    audio_dur = vocals.size / float(v_sr)

    target_spans: list[tuple[float, float]] = []
    other_blocked: list[tuple[float, float]] = []

    for seg in diarized_segments:
        st = float(_seg_field(seg, "start", 0.0)) - time_offset
        en = float(_seg_field(seg, "end", st)) - time_offset
        if en <= 0.0 or st >= audio_dur:
            continue
        st = max(0.0, st)
        en = min(audio_dur, en)
        if en <= st:
            continue

        seg_spk = str(_seg_field(seg, "speaker") or _seg_field(seg, "speaker_id") or "").strip()
        if seg_spk == speaker_id and not is_passthrough_segment(seg):
            target_spans.append((st, en))
        elif seg_spk and seg_spk != speaker_id:
            other_blocked.append((max(0.0, st - overlap_margin), min(audio_dur, en + overlap_margin)))

    # Fallback: if no segments matched speaker_id (e.g. single-speaker raw stems), use non-passthrough segments
    if not target_spans and speaker_id == "SPEAKER_00":
        for seg in transcription_segments:
            if is_passthrough_segment(seg):
                continue
            st = max(0.0, float(_seg_field(seg, "start", 0.0)) - time_offset)
            en = min(audio_dur, float(_seg_field(seg, "end", st)) - time_offset)
            if en > st:
                target_spans.append((st, en))

    clean_candidates: list[tuple[float, float]] = []
    for sp in target_spans:
        clean_candidates.extend(_subtract_intervals(sp, other_blocked))

    # Merge adjacent clean candidates belonging to the same speaker when separated by brief pauses (< 0.45s)
    clean_candidates.sort(key=lambda c: c[0])
    merged_clean: list[tuple[float, float]] = []
    for st, en in clean_candidates:
        if merged_clean and st - merged_clean[-1][1] <= 0.45:
            # Ensure merging doesn't cross an overlap block
            gap_blocked = any(b_s < st and b_e > merged_clean[-1][1] for b_s, b_e in other_blocked)
            if not gap_blocked:
                merged_clean[-1] = (merged_clean[-1][0], max(merged_clean[-1][1], en))
                continue
        merged_clean.append((st, en))

    def _measure_snr(st: float, en: float) -> float:
        s_i = max(0, min(vocals.size - 1, int(round(st * v_sr))))
        e_i = max(s_i + 1, min(vocals.size, int(round(en * v_sr))))
        v_slice = vocals[s_i:e_i]
        v_rms = float(np.sqrt(np.mean(v_slice * v_slice))) if v_slice.size else 0.0
        if no_vocals.size == 0 or nv_sr <= 0:
            return 40.0 if v_rms > 1e-4 else 0.0
        ns_i = max(0, min(no_vocals.size - 1, int(round(st * nv_sr))))
        ne_i = max(ns_i + 1, min(no_vocals.size, int(round(en * nv_sr))))
        nv_slice = no_vocals[ns_i:ne_i]
        nv_rms = float(np.sqrt(np.mean(nv_slice * nv_slice))) if nv_slice.size else 0.0
        return 20.0 * math.log10((v_rms + 1e-9) / (nv_rms + 1e-9))

    scored: list[tuple[float, float, float, float]] = []
    for st, en in merged_clean:
        dur = en - st
        if dur < 0.35:
            continue
        # Slide/crop window to max_duration if longer
        cand_st = st
        cand_en = min(en, st + max_duration)
        if dur > max_duration:
            # Try sub-windows of size ~10s to pick highest SNR
            best_sub = (st, st + min(max_duration, 10.0), _measure_snr(st, st + min(max_duration, 10.0)))
            step = 1.0
            cur_t = st
            win_len = min(max_duration, 10.0)
            while cur_t + win_len <= en + 1e-6:
                s_db = _measure_snr(cur_t, cur_t + win_len)
                if s_db > best_sub[2]:
                    best_sub = (cur_t, cur_t + win_len, s_db)
                cur_t += step
            cand_st, cand_en, snr_val = best_sub
        else:
            snr_val = _measure_snr(cand_st, cand_en)
        scored.append((cand_st, cand_en, cand_en - cand_st, snr_val))

    if not scored:
        return SpeakerReferenceResult(
            ref_path=None,
            ref_text="",
            speaker_id=speaker_id,
            clean_duration=0.0,
            snr_db=0.0,
            x_vector_only=True,
            needs_probe_ahead=True,
            warnings=[f"No clean speech spans found for {speaker_id}"],
        )

    # Prefer candidates meeting SNR > +10dB and >= min_duration (6.0s)
    ideal = [c for c in scored if c[3] >= min_snr_db and c[2] >= min_duration]
    if ideal:
        chosen_st, chosen_en, chosen_dur, chosen_snr = max(
            ideal, key=lambda c: (c[3], min(c[2], max_duration))
        )
        selected_slices = [(chosen_st, chosen_en)]
    else:
        # Combine top high-SNR clean spans up to max_duration if single span is < min_duration
        good_snr = [c for c in scored if c[3] >= min_snr_db]
        pool = good_snr if good_snr else scored
        pool_sorted = sorted(pool, key=lambda c: (c[2], c[3]), reverse=True)
        selected_slices = []
        acc_dur = 0.0
        snr_weighted = 0.0
        for c_st, c_en, c_dur, c_snr in pool_sorted:
            if acc_dur >= min_duration:
                break
            take = min(c_dur, max_duration - acc_dur)
            if take < 0.4:
                continue
            selected_slices.append((c_st, c_st + take))
            acc_dur += take
            snr_weighted += c_snr * take
        selected_slices.sort(key=lambda s: s[0])
        chosen_st = selected_slices[0][0]
        chosen_en = selected_slices[-1][1]
        chosen_dur = acc_dur
        chosen_snr = snr_weighted / max(acc_dur, 1e-6)

    warnings: list[str] = []
    needs_probe_ahead = chosen_dur < min_clean_fallback
    x_vector_only = False
    if chosen_snr < min_snr_db:
        warnings.append(
            f"Clean reference SNR for {speaker_id} is {chosen_snr:.1f} dB (< +{min_snr_db:.1f} dB)."
        )
    if needs_probe_ahead:
        x_vector_only = True
        warnings.append(
            f"Clean speech for {speaker_id} is {chosen_dur:.2f}s (< {min_clean_fallback:.1f}s); "
            "probe_ahead / x_vector_only fallback flagged."
        )

    # Concatenate selected audio slices into reference WAV
    audio_parts = []
    for sl_st, sl_en in selected_slices:
        s_i = max(0, int(round(sl_st * v_sr)))
        e_i = min(vocals.size, int(round(sl_en * v_sr)))
        if e_i > s_i:
            audio_parts.append(vocals[s_i:e_i])
    ref_samples = np.concatenate(audio_parts, axis=0) if audio_parts else np.zeros(0, dtype=np.float32)

    if len(selected_slices) == 1:
        abs_st = selected_slices[0][0] + time_offset
        abs_en = selected_slices[0][1] + time_offset
        ref_text = _extract_reference_text(abs_st, abs_en, words, transcription_segments)
    else:
        texts = [
            _extract_reference_text(s + time_offset, e + time_offset, words, transcription_segments)
            for s, e in selected_slices
        ]
        ref_text = " ".join(t for t in texts if t).strip()
        abs_st = chosen_st + time_offset
        abs_en = chosen_en + time_offset

    if not ref_text:
        x_vector_only = True

    ref_path: Path | None = None
    if output_dir is not None and ref_samples.size > 0:
        out_dir = Path(output_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        safe_spk = re.sub(r"[^A-Za-z0-9_-]", "_", speaker_id) or "SPEAKER_00"
        ref_path = _write_mono_wav_float32(out_dir / f"{safe_spk}_ref.wav", ref_samples, v_sr)
        atomic_write_json(
            out_dir / f"{safe_spk}_ref.json",
            {
                "speaker_id": speaker_id,
                "ref_start": round(abs_st, 3),
                "ref_end": round(abs_en, 3),
                "clean_duration": round(chosen_dur, 3),
                "snr_db": round(chosen_snr, 2),
                "ref_text": ref_text,
                "ref_lang": ref_lang,
                "x_vector_only": x_vector_only,
                "needs_probe_ahead": needs_probe_ahead,
            },
        )

    return SpeakerReferenceResult(
        ref_path=ref_path,
        ref_text=ref_text,
        speaker_id=speaker_id,
        ref_start=round(abs_st, 3),
        ref_end=round(abs_en, 3),
        clean_duration=round(chosen_dur, 3),
        snr_db=round(chosen_snr, 2),
        x_vector_only=x_vector_only,
        needs_probe_ahead=needs_probe_ahead,
        warnings=warnings,
    )


def detect_preview_window(
    segments: Sequence[Segment | dict[str, Any]],
    requested_start: float | None,
    duration: float = 20.0,
    *,
    video_duration: float | None = None,
    audio_path: str | Path | None = None,
) -> tuple[float, float]:
    """Select `[preview_start, preview_end]` for a 20s quick preview.

    When `requested_start is None`, skips intro music/silence and picks the first window
    containing real spoken speech.
    """
    dur = max(1.0, float(duration))

    if requested_start is not None:
        start = max(0.0, float(requested_start))
        if video_duration is not None and video_duration > 0:
            if video_duration <= dur:
                return 0.0, round(float(video_duration), 3)
            start = min(start, max(0.0, float(video_duration) - dur))
        end = start + dur
        if video_duration is not None and video_duration > 0:
            end = min(float(video_duration), end)
        return round(start, 3), round(end, 3)

    speech_segs = [
        (
            max(0.0, float(_seg_field(s, "start", 0.0))),
            max(0.0, float(_seg_field(s, "end", 0.0))),
        )
        for s in segments
        if not is_passthrough_segment(s)
        and float(_seg_field(s, "end", 0.0)) > float(_seg_field(s, "start", 0.0))
    ]
    speech_segs.sort(key=lambda pair: pair[0])

    chosen_start: float | None = None
    if speech_segs:
        # Prefer the first speech segment whose [start, start + dur] window has >= 2.0s of speech
        for st, en in speech_segs:
            win_end = st + dur
            speech_inside = sum(
                max(0.0, min(win_end, s_en) - max(st, s_st))
                for s_st, s_en in speech_segs
            )
            if speech_inside >= 2.0:
                chosen_start = st
                break
        if chosen_start is None:
            chosen_start = speech_segs[0][0]
    elif audio_path is not None and Path(audio_path).exists():
        # RMS energy scan fallback (first 90s) when no transcript exists yet
        rms_10ms, _sr = compute_rms_energy_from_wav(audio_path)
        if rms_10ms.size > 0:
            scan_limit = min(rms_10ms.size, 9000)
            baseline = float(np.median(rms_10ms[:scan_limit]))
            thresh = max(0.015, baseline * 2.5)
            # Require at least 20 consecutive 10ms frames (200ms) above threshold
            run = 0
            for idx in range(scan_limit):
                if float(rms_10ms[idx]) >= thresh:
                    run += 1
                    if run >= 20:
                        chosen_start = max(0.0, (idx - 19) * 0.01)
                        break
                else:
                    run = 0

    start = max(0.0, chosen_start if chosen_start is not None else 0.0)
    if video_duration is not None and video_duration > 0:
        if video_duration <= dur:
            return 0.0, round(float(video_duration), 3)
        start = min(start, max(0.0, float(video_duration) - dur))
        end = min(float(video_duration), start + dur)
    else:
        end = start + dur

    return round(start, 3), round(end, 3)


__all__ = [
    "DEFAULT_HARD_UNIT_SECONDS",
    "DEFAULT_MAX_REF_SECONDS",
    "DEFAULT_MIN_FALLBACK_REF_SECONDS",
    "DEFAULT_MIN_REF_SECONDS",
    "DEFAULT_MIN_SNR_DB",
    "DEFAULT_OVERLAP_MARGIN_SECONDS",
    "DEFAULT_PROBE_AHEAD_SECONDS",
    "DEFAULT_SILENCE_BREAK_SECONDS",
    "DEFAULT_SOFT_UNIT_SECONDS",
    "SpeakerReferenceResult",
    "build_dubbing_units",
    "detect_preview_window",
    "is_passthrough_segment",
    "load_dubbing_units",
    "save_dubbing_units",
    "select_clean_speaker_reference",
]
