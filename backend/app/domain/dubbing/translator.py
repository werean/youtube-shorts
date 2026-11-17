"""Dual-JSON local LLM dubbing translator, deterministic subtitle repair/wrapping, VTT/SRT generator, and condensation helper."""

from __future__ import annotations

import asyncio
import json
import math
import re
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Sequence

from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.infrastructure.llm.unified_adapter import UnifiedLocalLLMAdapter
from app.infrastructure.storage.atomic_store import atomic_write_json, atomic_write_text
from app.models.domain import DubbingSegmentSubtitle, DubbingUnit, Segment, WordTiming

if TYPE_CHECKING:
    pass

TARGET_LANGUAGE_NAMES: dict[str, str] = {
    "pt-BR": "Português (Brasil)",
    "en": "English",
    "es": "Español",
}

TARGET_LANGUAGE_ISO_639_2: dict[str, str] = {
    "pt-BR": "por",
    "en": "eng",
    "es": "spa",
}

# Approximate natural spoken character rate (chars/sec) for TTS duration budget guidance
TARGET_CHARS_PER_SECOND: dict[str, float] = {
    "pt-BR": 14.5,
    "en": 15.0,
    "es": 14.5,
}

MAX_SUBTITLE_LINE_CHARS = 42
MAX_SUBTITLE_LINES = 2
MAX_SUBTITLE_CUE_SECONDS = 6.0
DEFAULT_BATCH_SIZE = 5
DEFAULT_CONTEXT_WINDOW = 2

DUBBING_TRANSLATION_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "units": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "unit_id": {"type": "string"},
                    "dub_text": {"type": "string"},
                    "segment_subtitles": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "seg_id": {"type": "string"},
                                "subtitle_text": {"type": "string"},
                            },
                            "required": ["seg_id", "subtitle_text"],
                            "additionalProperties": False,
                        },
                    },
                },
                "required": ["unit_id", "dub_text", "segment_subtitles"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["units"],
    "additionalProperties": False,
}

DUBBING_CONDENSE_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "unit_id": {"type": "string"},
        "condensed_dub_text": {"type": "string"},
    },
    "required": ["unit_id", "condensed_dub_text"],
    "additionalProperties": False,
}


@dataclass
class FormattedSubtitleCue:
    """A formatted subtitle cue wrapped to <= 42 chars/line, max 2 lines, and <= 6.0s."""

    cue_id: str
    start: float
    end: float
    text: str
    speaker: str | None = None


@dataclass
class DubbingTranslationResult:
    """Output of translating all dubbing units for a target language."""

    target_lang: str
    units: list[DubbingUnit]
    segment_subtitles: list[DubbingSegmentSubtitle]
    cues: list[FormattedSubtitleCue]
    vtt_content: str
    srt_content: str
    dub_segments: list[Segment]
    dub_words: list[WordTiming]


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


def _format_vtt_ts(seconds: float) -> str:
    ms_total = max(0, int(round(float(seconds) * 1000.0)))
    hours, rem = divmod(ms_total, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{ms:03d}"


def _format_srt_ts(seconds: float) -> str:
    ms_total = max(0, int(round(float(seconds) * 1000.0)))
    hours, rem = divmod(ms_total, 3_600_000)
    minutes, rem = divmod(rem, 60_000)
    secs, ms = divmod(rem, 1000)
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{ms:03d}"


def wrap_subtitle_lines(
    text: str,
    *,
    max_chars_per_line: int = MAX_SUBTITLE_LINE_CHARS,
    max_lines: int = MAX_SUBTITLE_LINES,
) -> list[str]:
    """Wrap subtitle text cleanly into <= `max_lines` lines of <= `max_chars_per_line` chars."""
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    if not cleaned:
        return []
    if len(cleaned) <= max_chars_per_line:
        return [cleaned]

    words = cleaned.split(" ")
    if max_lines == 2 and len(words) >= 2:
        # Pick the most balanced 2-line split where both lines fit <= max_chars_per_line
        best_split: tuple[int, str, str] | None = None
        for idx in range(1, len(words)):
            l1 = " ".join(words[:idx])
            l2 = " ".join(words[idx:])
            if len(l1) <= max_chars_per_line and len(l2) <= max_chars_per_line:
                diff = abs(len(l1) - len(l2))
                if best_split is None or diff < best_split[0]:
                    best_split = (diff, l1, l2)
        if best_split is not None:
            return [best_split[1], best_split[2]]

    lines: list[str] = []
    current = ""
    for w in words:
        candidate = f"{current} {w}".strip() if current else w
        if len(candidate) <= max_chars_per_line:
            current = candidate
        else:
            if current:
                lines.append(current)
                current = w
            else:
                lines.append(w[:max_chars_per_line])
                current = ""
            if len(lines) >= max_lines:
                break

    if current and len(lines) < max_lines:
        lines.append(current)
    return lines[:max_lines]


def _split_text_proportionally(
    text: str,
    weights: Sequence[float],
) -> list[str]:
    """Distribute `text` across `len(weights)` buckets at word/punctuation boundaries."""
    n = len(weights)
    if n == 0:
        return []
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    if n == 1:
        return [cleaned]
    if not cleaned:
        return [""] * n

    words = cleaned.split(" ")
    if len(words) <= 1:
        return [cleaned] + [""] * (n - 1)

    safe_weights = [max(0.05, float(w)) for w in weights]
    total_weight = sum(safe_weights)

    # Cumulative character end positions of each word
    word_cum_chars: list[int] = []
    acc = 0
    for idx, w in enumerate(words):
        acc += len(w) + (1 if idx > 0 else 0)
        word_cum_chars.append(acc)
    total_chars = max(1, word_cum_chars[-1])

    results: list[str] = []
    start_word_idx = 0
    cum_weight = 0.0

    for bucket_idx in range(n - 1):
        cum_weight += safe_weights[bucket_idx]
        remaining_buckets = (n - 1) - bucket_idx
        max_end_idx = len(words) - remaining_buckets
        if start_word_idx >= max_end_idx:
            # Not enough words left for 1 word per bucket; hand out 1 if possible
            if start_word_idx < len(words):
                results.append(words[start_word_idx])
                start_word_idx += 1
            else:
                results.append("")
            continue

        target_char = total_chars * (cum_weight / total_weight)
        best_end = start_word_idx + 1
        best_score = float("inf")
        for end_idx in range(start_word_idx + 1, max_end_idx + 1):
            char_pos = word_cum_chars[end_idx - 1]
            dist = abs(char_pos - target_char)
            last_word = words[end_idx - 1]
            # Prefer snapping to sentence/clause punctuation near the proportional target
            bonus = 0.0
            if last_word.endswith((".", "!", "?", ";", ":")):
                bonus = 18.0
            elif last_word.endswith(","):
                bonus = 10.0
            score = dist - bonus
            if score < best_score:
                best_score = score
                best_end = end_idx

        results.append(" ".join(words[start_word_idx:best_end]))
        start_word_idx = best_end

    results.append(" ".join(words[start_word_idx:]))
    return [r.strip() for r in results]


def repair_unit_segment_subtitles(
    unit: DubbingUnit,
    unit_segments: Sequence[Segment | dict[str, Any]],
    raw_seg_subtitles: Sequence[dict[str, Any]],
    dub_text: str,
) -> list[DubbingSegmentSubtitle]:
    """Ensure every Whisper segment in `unit` has a non-empty, balanced `DubbingSegmentSubtitle`."""
    if not unit_segments:
        return []

    sub_map: dict[str, str] = {}
    ordered_raw_texts: list[str] = []
    for item in raw_seg_subtitles:
        if not isinstance(item, dict):
            continue
        sid = str(item.get("seg_id") or item.get("segment_id") or "").strip()
        txt = re.sub(r"\s+", " ", str(item.get("subtitle_text") or "").strip())
        if sid:
            sub_map[sid] = txt
        if txt:
            ordered_raw_texts.append(txt)

    resolved_pairs: list[tuple[str, float, float, str, str]] = []
    missing_or_empty = False
    for idx, seg in enumerate(unit_segments, start=1):
        sid = _seg_id(seg, idx)
        st = float(_seg_field(seg, "start", unit.start))
        en = max(st + 0.05, float(_seg_field(seg, "end", unit.end)))
        orig_txt = str(_seg_field(seg, "text", "") or "").strip()
        sub_txt = sub_map.get(sid, "")
        if not sub_txt and not unit.passthrough_original:
            missing_or_empty = True
        resolved_pairs.append((sid, st, en, orig_txt, sub_txt))

    if missing_or_empty and not unit.passthrough_original:
        merged_text = " ".join(ordered_raw_texts).strip()
        if not merged_text:
            merged_text = re.sub(r"\s+", " ", str(dub_text or unit.text or "")).strip()
        weights = [max(0.1, en - st) for _sid, st, en, _orig, _sub in resolved_pairs]
        distributed = _split_text_proportionally(merged_text, weights)
        repaired: list[DubbingSegmentSubtitle] = []
        for (sid, st, en, orig_txt, _sub), new_txt in zip(resolved_pairs, distributed):
            repaired.append(
                DubbingSegmentSubtitle(
                    seg_id=sid,
                    start=round(st, 3),
                    end=round(en, 3),
                    original_text=orig_txt,
                    subtitle_text=new_txt or orig_txt,
                )
            )
        return repaired

    return [
        DubbingSegmentSubtitle(
            seg_id=sid,
            start=round(st, 3),
            end=round(en, 3),
            original_text=orig_txt,
            subtitle_text=sub_txt,
        )
        for sid, st, en, orig_txt, sub_txt in resolved_pairs
    ]


def format_subtitle_cues(
    segment_subtitles: Sequence[DubbingSegmentSubtitle],
    *,
    speaker_by_seg_id: dict[str, str] | None = None,
    max_chars_per_line: int = MAX_SUBTITLE_LINE_CHARS,
    max_lines: int = MAX_SUBTITLE_LINES,
    max_cue_seconds: float = MAX_SUBTITLE_CUE_SECONDS,
) -> list[FormattedSubtitleCue]:
    """Split cues > `6.0s` or > `84` chars and wrap every cue to `<= 42 chars/line`, max 2 lines."""
    max_cue_chars = max_chars_per_line * max_lines
    cues: list[FormattedSubtitleCue] = []
    cue_idx = 0

    for sub in segment_subtitles:
        cleaned = re.sub(r"\s+", " ", str(sub.subtitle_text or "")).strip()
        if not cleaned:
            continue
        st = float(sub.start)
        en = max(st + 0.1, float(sub.end))
        dur = en - st
        spk = speaker_by_seg_id.get(sub.seg_id) if speaker_by_seg_id else None

        n_by_dur = int(math.ceil(dur / max_cue_seconds)) if dur > max_cue_seconds else 1
        n_by_len = int(math.ceil(len(cleaned) / float(max_cue_chars - 6))) if len(cleaned) > max_cue_chars else 1
        n_splits = max(1, n_by_dur, n_by_len)

        words = cleaned.split(" ")
        n_splits = min(n_splits, max(1, len(words)))

        if n_splits == 1:
            wrapped = wrap_subtitle_lines(
                cleaned, max_chars_per_line=max_chars_per_line, max_lines=max_lines
            )
            if wrapped:
                cue_idx += 1
                cues.append(
                    FormattedSubtitleCue(
                        cue_id=f"c{cue_idx:04d}",
                        start=round(st, 3),
                        end=round(en, 3),
                        text="\n".join(wrapped),
                        speaker=spk,
                    )
                )
            continue

        parts = _split_text_proportionally(cleaned, [1.0] * n_splits)
        parts = [p for p in parts if p]
        if not parts:
            continue

        char_weights = [max(1, len(p)) for p in parts]
        total_w = float(sum(char_weights))
        cursor = st
        for p_idx, part_txt in enumerate(parts):
            part_dur = dur * (char_weights[p_idx] / total_w)
            p_end = en if p_idx == len(parts) - 1 else min(en, cursor + part_dur)
            wrapped = wrap_subtitle_lines(
                part_txt, max_chars_per_line=max_chars_per_line, max_lines=max_lines
            )
            if wrapped:
                cue_idx += 1
                cues.append(
                    FormattedSubtitleCue(
                        cue_id=f"c{cue_idx:04d}",
                        start=round(cursor, 3),
                        end=round(max(cursor + 0.1, p_end), 3),
                        text="\n".join(wrapped),
                        speaker=spk,
                    )
                )
            cursor = p_end

    return cues


def generate_dub_vtt(
    cues: Sequence[FormattedSubtitleCue],
    *,
    window_start: float | None = None,
    window_end: float | None = None,
) -> str:
    """Render WebVTT (`WEBVTT`) preserving absolute timestamps (optionally filtered to a preview window)."""
    lines = ["WEBVTT", ""]
    for cue in cues:
        if not cue.text.strip():
            continue
        if window_start is not None and cue.end <= window_start:
            continue
        if window_end is not None and cue.start >= window_end:
            continue
        st = max(window_start, cue.start) if window_start is not None else cue.start
        en = min(window_end, cue.end) if window_end is not None else cue.end
        if en <= st:
            continue
        lines.append(f"{_format_vtt_ts(st)} --> {_format_vtt_ts(en)}")
        lines.append(cue.text)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def generate_dub_srt(
    cues: Sequence[FormattedSubtitleCue],
    *,
    window_start: float | None = None,
    window_end: float | None = None,
) -> str:
    """Render clean UTF-8 (no-BOM) SubRip `.srt` content."""
    lines: list[str] = []
    idx = 0
    for cue in cues:
        if not cue.text.strip():
            continue
        if window_start is not None and cue.end <= window_start:
            continue
        if window_end is not None and cue.start >= window_end:
            continue
        st = max(window_start, cue.start) if window_start is not None else cue.start
        en = min(window_end, cue.end) if window_end is not None else cue.end
        if en <= st:
            continue
        idx += 1
        lines.append(str(idx))
        lines.append(f"{_format_srt_ts(st)} --> {_format_srt_ts(en)}")
        lines.append(cue.text)
        lines.append("")
    return "\n".join(lines).rstrip() + "\n" if lines else ""


def build_dub_segments_and_words(
    segment_subtitles: Sequence[DubbingSegmentSubtitle],
    *,
    speaker_by_seg_id: dict[str, str] | None = None,
) -> tuple[list[Segment], list[WordTiming]]:
    """Convert `DubbingSegmentSubtitle`s into `Segment` and proportional `WordTiming` lists for `dub.segments.json` / `dub.words.json`."""
    dub_segments: list[Segment] = []
    dub_words: list[WordTiming] = []

    for idx, sub in enumerate(segment_subtitles, start=1):
        txt = re.sub(r"\s+", " ", str(sub.subtitle_text or "")).strip()
        if not txt:
            continue
        spk = speaker_by_seg_id.get(sub.seg_id) if speaker_by_seg_id else None
        st = round(float(sub.start), 3)
        en = round(max(st + 0.05, float(sub.end)), 3)
        seg_id = sub.seg_id or f"s{idx}"
        dub_segments.append(
            Segment(
                segment_id=seg_id,
                start=st,
                end=en,
                text=txt,
                speaker=spk,
            )
        )
        tokens = txt.split(" ")
        n_tok = len(tokens)
        dur = en - st
        weights = [max(1, len(tok)) for tok in tokens]
        total_w = float(sum(weights))
        cursor = st
        for t_i, tok in enumerate(tokens):
            w_dur = dur * (weights[t_i] / total_w)
            w_end = en if t_i == n_tok - 1 else min(en, cursor + w_dur)
            dub_words.append(
                WordTiming(
                    word=tok,
                    start=round(cursor, 3),
                    end=round(max(cursor + 0.02, w_end), 3),
                    probability=1.0,
                    speaker=spk,
                    segment_id=seg_id,
                )
            )
            cursor = w_end

    return dub_segments, dub_words


def _build_translation_prompts(
    batch_units: Sequence[DubbingUnit],
    all_units: Sequence[DubbingUnit],
    segments_by_id: dict[str, Segment | dict[str, Any]],
    target_lang: str,
) -> tuple[str, str]:
    lang_label = TARGET_LANGUAGE_NAMES.get(target_lang, target_lang)
    cps = TARGET_CHARS_PER_SECOND.get(target_lang, 14.5)

    idx_by_id = {u.unit_id: i for i, u in enumerate(all_units)}
    first_idx = idx_by_id.get(batch_units[0].unit_id, 0)
    last_idx = idx_by_id.get(batch_units[-1].unit_id, len(all_units) - 1)

    context_before = [
        {"unit_id": u.unit_id, "speaker": u.speaker, "text": u.text}
        for u in all_units[max(0, first_idx - DEFAULT_CONTEXT_WINDOW) : first_idx]
        if not u.passthrough_original
    ]
    context_after = [
        {"unit_id": u.unit_id, "speaker": u.speaker, "text": u.text}
        for u in all_units[last_idx + 1 : min(len(all_units), last_idx + 1 + DEFAULT_CONTEXT_WINDOW)]
        if not u.passthrough_original
    ]

    units_payload: list[dict[str, Any]] = []
    for u in batch_units:
        dur = max(0.3, float(u.end) - float(u.start))
        target_max_chars = max(12, int(round(dur * cps)))
        seg_items: list[dict[str, Any]] = []
        for sid in u.segment_ids:
            seg_obj = segments_by_id.get(sid)
            if seg_obj is not None:
                seg_items.append(
                    {
                        "seg_id": sid,
                        "start": round(float(_seg_field(seg_obj, "start", u.start)), 3),
                        "end": round(float(_seg_field(seg_obj, "end", u.end)), 3),
                        "text": str(_seg_field(seg_obj, "text", "") or "").strip(),
                    }
                )
        if not seg_items:
            seg_items.append(
                {
                    "seg_id": u.unit_id,
                    "start": round(float(u.start), 3),
                    "end": round(float(u.end), 3),
                    "text": u.text,
                }
            )
        units_payload.append(
            {
                "unit_id": u.unit_id,
                "speaker": u.speaker,
                "duration_s": round(dur, 2),
                "target_max_chars": target_max_chars,
                "segments": seg_items,
            }
        )

    system_prompt = (
        f"You are an expert audiovisual dubbing translator and subtitler targeting {lang_label} ({target_lang}).\n"
        "Translate each unit in `units_to_translate` (using `context_before` and `context_after` strictly as read-only context).\n"
        "For EVERY unit, return BOTH:\n"
        "1. `dub_text`: Natural spoken script for TTS voice acting in "
        f"{lang_label}. Expand ALL numbers, dates, percentages, ordinals, and symbols into spoken words "
        "(e.g. '2026' -> 'dois mil e vinte e seis' / 'twenty twenty-six', '50%' -> 'cinquenta por cento'), "
        "spell out tricky acronyms phonetically if needed, and keep length near `target_max_chars` so speech fits the slot.\n"
        "2. `segment_subtitles`: 1-to-1 array `{ seg_id, subtitle_text }` matching every input `seg_id` and its exact timing. "
        "Keep compact numerals/acronyms for easy reading (no TTS phonetic spelling).\n"
        "Return ONLY valid JSON matching the schema."
    )

    user_payload = {
        "target_lang": target_lang,
        "context_before": context_before,
        "units_to_translate": units_payload,
        "context_after": context_after,
    }
    return system_prompt, json.dumps(user_payload, ensure_ascii=False, indent=2)


async def _shielded_lms_cleanup(container: ServiceContainer, *, job_id: str | None = None) -> None:
    lmstudio = getattr(container, "lmstudio", None)
    if lmstudio is None or not lmstudio.cli_enabled():
        return
    try:
        await asyncio.shield(lmstudio.unload_all())
    except Exception:
        pass
    try:
        await asyncio.shield(lmstudio.stop_server())
    except Exception:
        pass


async def translate_dubbing_units(
    units: Sequence[DubbingUnit],
    segments: Sequence[Segment | dict[str, Any]],
    target_lang: str,
    *,
    job_id: str | None = None,
    container: ServiceContainer | None = None,
    llm_adapter: UnifiedLocalLLMAdapter | None = None,
    cancel_token: CancelToken | None = None,
    batch_size: int = DEFAULT_BATCH_SIZE,
    on_progress: Callable[[float, str], None] | None = None,
) -> DubbingTranslationResult:
    """Translate speech `DubbingUnit`s in a single dual-JSON pass inside `gpu_slot` + `lmstudio.stage`.

    Produces natural phonetic `dub_text` AND segment-aligned `segment_subtitles` with deterministic
    Python repair, `<= 42 chars/line × 2 lines` wrapping, `<= 6.0s` cue splitting, `.vtt`, and `.srt`.
    """
    c = container or get_container()
    adapter = llm_adapter or UnifiedLocalLLMAdapter(container=c)

    segments_by_id: dict[str, Segment | dict[str, Any]] = {}
    speaker_by_seg_id: dict[str, str] = {}
    for idx, seg in enumerate(segments, start=1):
        sid = _seg_id(seg, idx)
        segments_by_id[sid] = seg

    speech_units = [u for u in units if not u.passthrough_original and (u.text or "").strip()]
    for u in units:
        for sid in u.segment_ids:
            speaker_by_seg_id[sid] = u.speaker

    translated_by_uid: dict[str, dict[str, Any]] = {}

    if speech_units:
        batches = [
            speech_units[i : i + max(1, batch_size)]
            for i in range(0, len(speech_units), max(1, batch_size))
        ]
        total_batches = len(batches)

        async with c.scheduler.gpu_slot("dubbing_translate"):
            lmstudio = getattr(c, "lmstudio", None)
            stage_ctx = (
                lmstudio.stage(model_type="llm", job_id=job_id, task_log="dubbing")
                if lmstudio is not None
                else None
            )
            try:
                if stage_ctx is not None:
                    await stage_ctx.__aenter__()

                for b_idx, batch in enumerate(batches):
                    if cancel_token is not None:
                        cancel_token.raise_if_cancelled()

                    sys_prompt, usr_prompt = _build_translation_prompts(
                        batch, units, segments_by_id, target_lang
                    )
                    parsed, _raw = await adapter.chat_json(
                        sys_prompt,
                        usr_prompt,
                        json_schema=DUBBING_TRANSLATION_JSON_SCHEMA,
                        schema_name="dubbing_translation",
                        temperature=0.2,
                        acquire_gpu_slot=False,
                        cancel_token=cancel_token,
                    )
                    if cancel_token is not None:
                        cancel_token.raise_if_cancelled()

                    items = parsed.get("units", []) if isinstance(parsed, dict) else []
                    for item in items:
                        if isinstance(item, dict) and item.get("unit_id"):
                            translated_by_uid[str(item["unit_id"])] = item

                    if on_progress is not None:
                        pct = ((b_idx + 1) / float(total_batches)) * 100.0
                        on_progress(
                            pct,
                            f"[dubbing] Tradução LLM ({target_lang}): lote {b_idx + 1}/{total_batches}",
                        )
            finally:
                if stage_ctx is not None:
                    try:
                        await asyncio.shield(stage_ctx.__aexit__(None, None, None))
                    except Exception:
                        await _shielded_lms_cleanup(c, job_id=job_id)

    updated_units: list[DubbingUnit] = []
    all_seg_subs: list[DubbingSegmentSubtitle] = []

    for u in units:
        u_segs = [segments_by_id[sid] for sid in u.segment_ids if sid in segments_by_id]
        if u.passthrough_original:
            updated_units.append(
                DubbingUnit(
                    unit_id=u.unit_id,
                    speaker=u.speaker,
                    start=u.start,
                    end=u.end,
                    segment_ids=list(u.segment_ids),
                    text=u.text,
                    dub_text=u.text,
                    passthrough_original=True,
                )
            )
            for seg_obj in u_segs:
                sid = _seg_id(seg_obj, 1)
                all_seg_subs.append(
                    DubbingSegmentSubtitle(
                        seg_id=sid,
                        start=round(float(_seg_field(seg_obj, "start", u.start)), 3),
                        end=round(float(_seg_field(seg_obj, "end", u.end)), 3),
                        original_text=str(_seg_field(seg_obj, "text", "") or "").strip(),
                        subtitle_text=str(_seg_field(seg_obj, "text", "") or "").strip(),
                    )
                )
            continue

        tr = translated_by_uid.get(u.unit_id, {})
        dub_txt = re.sub(r"\s+", " ", str(tr.get("dub_text") or u.dub_text or u.text or "")).strip()
        raw_seg_subs = tr.get("segment_subtitles") if isinstance(tr.get("segment_subtitles"), list) else []

        repaired_subs = repair_unit_segment_subtitles(u, u_segs, raw_seg_subs, dub_txt)
        if not repaired_subs and u.segment_ids:
            repaired_subs = [
                DubbingSegmentSubtitle(
                    seg_id=u.segment_ids[0],
                    start=round(u.start, 3),
                    end=round(u.end, 3),
                    original_text=u.text,
                    subtitle_text=dub_txt,
                )
            ]
        all_seg_subs.extend(repaired_subs)

        updated_units.append(
            DubbingUnit(
                unit_id=u.unit_id,
                speaker=u.speaker,
                start=u.start,
                end=u.end,
                segment_ids=list(u.segment_ids),
                text=u.text,
                dub_text=dub_txt,
                passthrough_original=False,
            )
        )

    cues = format_subtitle_cues(all_seg_subs, speaker_by_seg_id=speaker_by_seg_id)
    vtt_content = generate_dub_vtt(cues)
    srt_content = generate_dub_srt(cues)
    dub_segments, dub_words = build_dub_segments_and_words(
        all_seg_subs, speaker_by_seg_id=speaker_by_seg_id
    )

    return DubbingTranslationResult(
        target_lang=target_lang,
        units=updated_units,
        segment_subtitles=all_seg_subs,
        cues=cues,
        vtt_content=vtt_content,
        srt_content=srt_content,
        dub_segments=dub_segments,
        dub_words=dub_words,
    )


async def condense_dub_unit_text(
    unit: DubbingUnit,
    target_lang: str,
    *,
    target_chars: int | None = None,
    job_id: str | None = None,
    container: ServiceContainer | None = None,
    llm_adapter: UnifiedLocalLLMAdapter | None = None,
    cancel_token: CancelToken | None = None,
    acquire_gpu_slot: bool = True,
) -> str:
    """Single-pass LLM condensation helper (`target_chars * 0.78`) when TTS duration overflows 1.20x."""
    if cancel_token is not None:
        cancel_token.raise_if_cancelled()

    source_txt = re.sub(r"\s+", " ", str(unit.dub_text or unit.text or "")).strip()
    if not source_txt:
        return ""

    desired_chars = (
        max(8, int(target_chars))
        if target_chars is not None
        else max(8, int(round(len(source_txt) * 0.78)))
    )
    lang_label = TARGET_LANGUAGE_NAMES.get(target_lang, target_lang)

    c = container or get_container()
    adapter = llm_adapter or UnifiedLocalLLMAdapter(container=c)

    system_prompt = (
        f"You are a dubbing script editor for {lang_label} ({target_lang}).\n"
        f"Shorten the spoken `dub_text` to AT MOST {desired_chars} characters while preserving the exact meaning, "
        "natural spoken tone, and expanded numbers/words for TTS.\n"
        "Return ONLY valid JSON matching the schema."
    )
    user_prompt = json.dumps(
        {
            "unit_id": unit.unit_id,
            "target_lang": target_lang,
            "target_max_chars": desired_chars,
            "dub_text": source_txt,
        },
        ensure_ascii=False,
    )

    async def _run_call() -> str:
        lmstudio = getattr(c, "lmstudio", None)
        stage_ctx = (
            lmstudio.stage(model_type="llm", job_id=job_id, task_log="dubbing")
            if lmstudio is not None and acquire_gpu_slot
            else None
        )
        try:
            if stage_ctx is not None:
                await stage_ctx.__aenter__()
            parsed, _raw = await adapter.chat_json(
                system_prompt,
                user_prompt,
                json_schema=DUBBING_CONDENSE_JSON_SCHEMA,
                schema_name="dubbing_condense",
                temperature=0.2,
                acquire_gpu_slot=False,
                cancel_token=cancel_token,
            )
            if isinstance(parsed, dict):
                condensed = re.sub(
                    r"\s+", " ", str(parsed.get("condensed_dub_text") or "")
                ).strip()
                if condensed:
                    return condensed
        finally:
            if stage_ctx is not None:
                try:
                    await asyncio.shield(stage_ctx.__aexit__(None, None, None))
                except Exception:
                    await _shielded_lms_cleanup(c, job_id=job_id)
        return source_txt

    if acquire_gpu_slot and not c.scheduler.gpu_mutex.locked:
        async with c.scheduler.gpu_slot("dubbing_translate"):
            return await _run_call()
    return await _run_call()


def save_translation_artifacts(
    output_dir: str | Path,
    result: DubbingTranslationResult,
) -> dict[str, Path]:
    """Persist `dubbing.units.json`, `dub.segments.json`, `dub.words.json`, `dub.txt`, `dub.vtt`, `dub.srt`."""
    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    plain_text = "\n".join(s.text for s in result.dub_segments if s.text.strip()).strip()
    return {
        "units": atomic_write_json(out / "dubbing.units.json", list(result.units)),
        "segments": atomic_write_json(out / "dub.segments.json", list(result.dub_segments)),
        "words": atomic_write_json(out / "dub.words.json", list(result.dub_words)),
        "txt": atomic_write_text(out / "dub.txt", plain_text + ("\n" if plain_text else "")),
        "vtt": atomic_write_text(out / "dub.vtt", result.vtt_content),
        "srt": atomic_write_text(out / "dub.srt", result.srt_content),
    }


__all__ = [
    "DUBBING_CONDENSE_JSON_SCHEMA",
    "DUBBING_TRANSLATION_JSON_SCHEMA",
    "DubbingTranslationResult",
    "FormattedSubtitleCue",
    "MAX_SUBTITLE_CUE_SECONDS",
    "MAX_SUBTITLE_LINES",
    "MAX_SUBTITLE_LINE_CHARS",
    "TARGET_CHARS_PER_SECOND",
    "TARGET_LANGUAGE_ISO_639_2",
    "TARGET_LANGUAGE_NAMES",
    "build_dub_segments_and_words",
    "condense_dub_unit_text",
    "format_subtitle_cues",
    "generate_dub_srt",
    "generate_dub_vtt",
    "repair_unit_segment_subtitles",
    "save_translation_artifacts",
    "translate_dubbing_units",
    "wrap_subtitle_lines",
]
