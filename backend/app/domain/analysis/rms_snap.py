"""Phase 4C Acoustic Snap: Pure-numpy 10ms RMS energy valley + zero-crossing alignment.

Implemented directly inside `app.domain.analysis` (zero dependency on `app.infrastructure.audio`).
Aligns cut boundaries `(start, end)` to word-level timestamps and snaps:
- `start` within `[t_start - 350ms, t_start + 50ms]`
- `end` within `[t_end - 50ms, t_end + 450ms]`
to the minimum 10ms RMS energy valley (breathing pause) and nearest waveform zero-crossing.
"""

from __future__ import annotations

import math
import wave
from pathlib import Path
from typing import Sequence

import numpy as np

from app.models.domain import WordTiming

DEFAULT_SAMPLE_RATE: int = 16000
RMS_FRAME_MS: int = 10
START_LOOKBACK_SEC: float = 0.350
START_LOOKAHEAD_SEC: float = 0.050
END_LOOKBACK_SEC: float = 0.0
END_LOOKAHEAD_SEC: float = 0.500
END_POST_SPEECH_CUSHION_SEC: float = 0.250


def compute_rms_10ms(
    pcm_samples: np.ndarray,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> np.ndarray:
    """Compute RMS energy in 10ms frames (`100 frames/second`)."""
    samples = np.asarray(pcm_samples, dtype=np.float32).reshape(-1)
    frame_len = max(1, int(round(sample_rate * (RMS_FRAME_MS / 1000.0))))
    if samples.size < frame_len:
        if samples.size == 0:
            return np.zeros(0, dtype=np.float32)
        val = float(np.sqrt(np.mean(samples * samples)))
        return np.array([val], dtype=np.float32)

    n_frames = samples.size // frame_len
    trimmed = samples[: n_frames * frame_len].reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(trimmed * trimmed, axis=1))
    return rms.astype(np.float32)


def find_nearest_zero_crossing(
    pcm_samples: np.ndarray,
    center_sample: int,
    search_radius_samples: int = 80,
) -> int:
    """Find the sample index closest to `center_sample` where the waveform crosses zero."""
    samples = np.asarray(pcm_samples, dtype=np.float32).reshape(-1)
    n = int(samples.size)
    if n == 0:
        return 0

    center = max(0, min(n - 1, int(center_sample)))
    lo = max(0, center - max(1, int(search_radius_samples)))
    hi = min(n - 1, center + max(1, int(search_radius_samples)))
    if hi <= lo:
        return center

    window = samples[lo : hi + 1]
    # Exact zero or sign change between consecutive samples
    signs = np.signbit(window)
    crossings = np.where((signs[:-1] != signs[1:]) | (np.abs(window[:-1]) <= 1e-7))[0]

    if crossings.size > 0:
        candidates: list[int] = []
        for idx in crossings:
            idx_a = lo + int(idx)
            idx_b = min(n - 1, idx_a + 1)
            chosen = idx_a if abs(samples[idx_a]) <= abs(samples[idx_b]) else idx_b
            candidates.append(chosen)
        best = min(candidates, key=lambda s: (abs(s - center), abs(float(samples[s]))))
        return int(best)

    # Fallback: sample with minimum absolute amplitude in the window
    min_rel = int(np.argmin(np.abs(window)))
    return lo + min_rel


def snap_timestamp_to_rms_valley(
    target_time: float,
    *,
    window_before_sec: float,
    window_after_sec: float,
    pcm_samples: np.ndarray | None = None,
    rms_10ms: np.ndarray | None = None,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> float:
    """Snap `target_time` to the lowest 10ms RMS energy frame in `[t - before, t + after]` and align to zero-crossing."""
    t = max(0.0, float(target_time))
    t_min = max(0.0, t - max(0.0, float(window_before_sec)))
    t_max = max(t_min, t + max(0.0, float(window_after_sec)))

    frame_sec = RMS_FRAME_MS / 1000.0
    frame_samples = max(1, int(round(sample_rate * frame_sec)))

    if rms_10ms is None and pcm_samples is not None:
        rms_10ms = compute_rms_10ms(pcm_samples, sample_rate=sample_rate)

    if rms_10ms is None or rms_10ms.size == 0:
        return round(t, 4)

    total_frames = int(rms_10ms.size)
    f_start = max(0, min(total_frames - 1, int(math.floor(t_min / frame_sec))))
    f_end = max(f_start, min(total_frames - 1, int(math.ceil(t_max / frame_sec))))

    window_rms = rms_10ms[f_start : f_end + 1]
    if window_rms.size == 0:
        return round(t, 4)

    valley_rel_idx = int(np.argmin(window_rms))
    valley_frame_idx = f_start + valley_rel_idx

    if pcm_samples is not None and pcm_samples.size > 0:
        center_sample = valley_frame_idx * frame_samples + (frame_samples // 2)
        zc_sample = find_nearest_zero_crossing(
            pcm_samples,
            center_sample=center_sample,
            search_radius_samples=frame_samples // 2,
        )
        snapped = float(zc_sample) / float(sample_rate)
        return round(max(t_min, min(t_max, snapped)), 4)

    snapped = (valley_frame_idx * frame_sec) + (frame_sec * 0.5)
    return round(max(t_min, min(t_max, snapped)), 4)


def _read_wav_slice_float32(
    wav_path: Path,
    start_sec: float,
    end_sec: float,
) -> tuple[np.ndarray, int, float] | None:
    """Read only `[start_sec, end_sec]` from a 16-bit PCM WAV file into a float32 numpy array."""
    if not wav_path.exists():
        return None
    try:
        with wave.open(str(wav_path), "rb") as wf:
            sr = wf.getframerate()
            n_channels = wf.getnchannels()
            sampwidth = wf.getsampwidth()
            total_frames = wf.getnframes()
            if sr <= 0 or total_frames <= 0 or sampwidth != 2:
                return None

            s_frame = max(0, min(total_frames - 1, int(math.floor(max(0.0, start_sec) * sr))))
            e_frame = max(s_frame + 1, min(total_frames, int(math.ceil(max(start_sec, end_sec) * sr))))
            wf.setpos(s_frame)
            raw_bytes = wf.readframes(e_frame - s_frame)
            pcm_i16 = np.frombuffer(raw_bytes, dtype=np.int16)
            if n_channels > 1:
                pcm_i16 = pcm_i16.reshape(-1, n_channels)[:, 0]
            pcm_f32 = pcm_i16.astype(np.float32) / 32768.0
            actual_start_sec = float(s_frame) / float(sr)
            return pcm_f32, sr, actual_start_sec
    except Exception:
        return None


def snap_cut_boundaries(
    start_time: float,
    end_time: float,
    *,
    words: Sequence[WordTiming] | None = None,
    pcm_samples: np.ndarray | None = None,
    rms_10ms: np.ndarray | None = None,
    audio_wav_path: Path | None = None,
    sample_rate: int = DEFAULT_SAMPLE_RATE,
) -> tuple[float, float]:
    """Align `(start_time, end_time)` to word boundaries and snap to 10ms RMS energy valleys + zero-crossing."""
    orig_start = max(0.0, float(start_time))
    t_start = orig_start
    t_end = max(t_start + 0.1, float(end_time))

    start_lookback = START_LOOKBACK_SEC
    effective_start_lookahead = START_LOOKAHEAD_SEC
    min_safe_start: float | None = None
    max_safe_start: float | None = None

    # 1. Word-level anchor refinement if word timings are available
    end_lookback = END_LOOKBACK_SEC
    end_lookahead = END_LOOKAHEAD_SEC
    if words:
        cut_words = [
            w
            for w in words
            if (0.5 * (float(w.start) + float(w.end)) >= t_start - 0.06)
            and (0.5 * (float(w.start) + float(w.end)) <= t_end + 0.06)
        ]
        if cut_words:
            first_word_obj = cut_words[0]
            first_w = float(first_word_obj.start)
            last_w = float(cut_words[-1].end)

            # Find latest word ending BEFORE first_w so lookback never pulls into the prior speaker/word
            prev_word_end: float | None = None
            for w in words:
                if w is first_word_obj:
                    continue
                we = float(w.end)
                if we <= first_w + 0.02 and float(w.start) < first_w:
                    if prev_word_end is None or we > prev_word_end:
                        prev_word_end = we

            if abs(first_w - t_start) <= 1.0:
                t_start = first_w
                # Eliminate +50ms opening consonant clipping whenever words & first_w are known
                effective_start_lookahead = 0.0

                if prev_word_end is not None and (first_w - 0.6) <= prev_word_end <= first_w + 0.02:
                    min_safe_start = min(first_w, prev_word_end + 0.03)
                    start_lookback = min(START_LOOKBACK_SEC, max(0.0, t_start - min_safe_start))

                if prev_word_end is not None:
                    pre_speech_gap = first_w - prev_word_end
                else:
                    pre_speech_gap = first_w - max(0.0, orig_start - START_LOOKBACK_SEC)

                if pre_speech_gap >= 0.05:
                    # Preserve a 20ms pre-onset margin so 30ms afade=in never attenuates the first consonant
                    max_safe_start = max(0.0, first_w - 0.02)
                    if min_safe_start is not None and min_safe_start > max_safe_start:
                        min_safe_start = max_safe_start

            # Find the earliest subsequent word after the cut's final word to avoid cutting into next speaker/topic
            next_word_start: float | None = None
            last_word_obj = cut_words[-1]
            for w in words:
                if w is last_word_obj:
                    continue
                ws = float(w.start)
                if ws >= last_w - 0.02 and float(w.end) > last_w + 0.02:
                    if next_word_start is None or ws < next_word_start:
                        next_word_start = ws

            if abs(last_w - t_end) <= 1.0 and last_w > t_start:
                # Hold a natural post-speech cushion (~250ms) instead of snapping shut on the final syllable,
                # clamped safely before the next spoken word starts.
                safe_max_end = last_w + END_LOOKAHEAD_SEC + 0.10
                if next_word_start is not None:
                    safe_max_end = min(safe_max_end, max(last_w + 0.04, next_word_start - 0.04))
                desired_end = min(safe_max_end, last_w + END_POST_SPEECH_CUSHION_SEC)
                t_end = max(last_w + 0.04, desired_end) if safe_max_end > last_w + 0.04 else safe_max_end
                # Allow RMS snap only within [last_w + small guard .. safe_max_end] so endings stay relaxed
                min_snap_end = min(t_end, last_w + 0.08)
                end_lookback = max(0.0, t_end - min_snap_end)
                end_lookahead = max(0.0, safe_max_end - t_end)

    start_search_target = min(t_start, max_safe_start) if max_safe_start is not None else t_start
    start_search_min = max(0.0, t_start - start_lookback)
    if min_safe_start is not None:
        start_search_min = max(start_search_min, min_safe_start)
    start_search_max = max(start_search_min, start_search_target + effective_start_lookahead)
    eff_start_before = max(0.0, start_search_target - start_search_min)
    eff_start_after = max(0.0, start_search_max - start_search_target)

    def _clamp_start(val: float) -> float:
        out = max(0.0, val)
        if min_safe_start is not None:
            out = max(min_safe_start, out)
        if max_safe_start is not None:
            out = min(max_safe_start, out)
        return out

    # 2. If in-memory PCM or RMS arrays are provided, snap directly against them
    if pcm_samples is not None or rms_10ms is not None:
        snapped_start = snap_timestamp_to_rms_valley(
            start_search_target,
            window_before_sec=eff_start_before,
            window_after_sec=eff_start_after,
            pcm_samples=pcm_samples,
            rms_10ms=rms_10ms,
            sample_rate=sample_rate,
        )
        snapped_start = _clamp_start(snapped_start)
        snapped_end = snap_timestamp_to_rms_valley(
            t_end,
            window_before_sec=end_lookback,
            window_after_sec=end_lookahead,
            pcm_samples=pcm_samples,
            rms_10ms=rms_10ms,
            sample_rate=sample_rate,
        )
        if snapped_end <= snapped_start:
            return round(_clamp_start(t_start), 3), round(t_end, 3)
        return round(snapped_start, 4), round(snapped_end, 4)

    # 3. Otherwise, if `audio_16k.wav` exists on disk, read bounded slices around t_start and t_end
    if audio_wav_path is not None and audio_wav_path.exists():
        start_slice = _read_wav_slice_float32(
            audio_wav_path,
            max(0.0, start_search_min - 0.05),
            start_search_max + 0.05,
        )
        if start_slice is not None:
            slice_pcm, sr, offset_sec = start_slice
            rel_snapped = snap_timestamp_to_rms_valley(
                max(0.0, start_search_target - offset_sec),
                window_before_sec=eff_start_before,
                window_after_sec=eff_start_after,
                pcm_samples=slice_pcm,
                sample_rate=sr,
            )
            t_start = _clamp_start(offset_sec + rel_snapped)
        else:
            t_start = _clamp_start(t_start)

        end_slice = _read_wav_slice_float32(
            audio_wav_path,
            max(0.0, t_end - end_lookback - 0.05),
            t_end + end_lookahead + 0.05,
        )
        if end_slice is not None:
            slice_pcm, sr, offset_sec = end_slice
            rel_snapped = snap_timestamp_to_rms_valley(
                t_end - offset_sec,
                window_before_sec=end_lookback,
                window_after_sec=end_lookahead,
                pcm_samples=slice_pcm,
                sample_rate=sr,
            )
            candidate_end = offset_sec + rel_snapped
            if candidate_end > t_start:
                t_end = candidate_end

        return round(t_start, 4), round(t_end, 4)

    t_start = _clamp_start(t_start)
    return round(t_start, 4), round(t_end, 4)
