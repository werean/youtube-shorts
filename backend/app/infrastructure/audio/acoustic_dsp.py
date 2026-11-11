"""Acoustic DSP: 10ms RMS energy curve, zero-crossing boundary snap, and 5-minute chunked MFCC/prosody speaker diarization."""

from __future__ import annotations

import math
import wave
from pathlib import Path
from typing import Sequence

import numpy as np
from scipy.fft import dct

from app.infrastructure.audio.pcm_extractor import SAMPLE_RATE_16K, read_wav_chunk_float32
from app.models.domain import Segment

DEFAULT_CHUNK_DURATION_SEC = 300.0  # 5 minutes per chunk (<150MB RAM invariant)
DEFAULT_RMS_WINDOW_MS = 10.0  # 100 windows/sec


def _to_float32_mono(samples: np.ndarray) -> np.ndarray:
    arr = np.asarray(samples)
    if arr.size == 0:
        return np.zeros(0, dtype=np.float32)
    if arr.ndim > 1:
        arr = arr.mean(axis=-1)
    if np.issubdtype(arr.dtype, np.integer):
        return arr.astype(np.float32) / 32768.0
    return arr.astype(np.float32, copy=False)


def compute_rms_energy_10ms(
    samples: np.ndarray,
    *,
    sample_rate: int = SAMPLE_RATE_16K,
    window_ms: float = DEFAULT_RMS_WINDOW_MS,
) -> np.ndarray:
    """Compute RMS energy in fixed 10ms windows (100 floats/second)."""
    mono = _to_float32_mono(samples)
    win_samples = max(1, int(round(sample_rate * (window_ms / 1000.0))))
    if mono.size == 0:
        return np.zeros(0, dtype=np.float32)

    n_full = mono.size // win_samples
    remainder = mono.size % win_samples
    parts: list[np.ndarray] = []

    if n_full > 0:
        framed = mono[: n_full * win_samples].reshape(n_full, win_samples)
        rms_full = np.sqrt(np.mean(framed * framed, axis=1, dtype=np.float32))
        parts.append(rms_full.astype(np.float32))

    if remainder > 0:
        tail = mono[n_full * win_samples :]
        tail_rms = float(np.sqrt(np.mean(tail * tail, dtype=np.float32)))
        parts.append(np.array([tail_rms], dtype=np.float32))

    if not parts:
        return np.zeros(0, dtype=np.float32)
    return np.concatenate(parts, axis=0)


def compute_rms_energy_from_wav(
    wav_path: str | Path,
    *,
    chunk_duration_sec: float = DEFAULT_CHUNK_DURATION_SEC,
    window_ms: float = DEFAULT_RMS_WINDOW_MS,
) -> tuple[np.ndarray, int]:
    """Stream a 16-bit PCM WAV file in 5-minute chunks and return `(rms_10ms, sample_rate)`."""
    path = Path(wav_path)
    if not path.exists():
        return np.zeros(0, dtype=np.float32), SAMPLE_RATE_16K

    chunks_rms: list[np.ndarray] = []
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate() or SAMPLE_RATE_16K
        n_channels = max(1, wf.getnchannels())
        total_frames = wf.getnframes()
        win_samples = max(1, int(round(sr * (window_ms / 1000.0))))
        # Ensure chunk size is an exact multiple of win_samples
        raw_chunk_frames = max(win_samples, int(round(chunk_duration_sec * sr)))
        chunk_frames = (raw_chunk_frames // win_samples) * win_samples

        frames_read = 0
        while frames_read < total_frames:
            to_read = min(chunk_frames, total_frames - frames_read)
            raw = wf.readframes(to_read)
            if not raw:
                break
            samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
            if n_channels > 1 and samples.size >= n_channels:
                samples = samples.reshape(-1, n_channels).mean(axis=1)
            chunk_rms = compute_rms_energy_10ms(samples, sample_rate=sr, window_ms=window_ms)
            if chunk_rms.size > 0:
                chunks_rms.append(chunk_rms)
            frames_read += to_read

    if not chunks_rms:
        return np.zeros(0, dtype=np.float32), sr
    return np.concatenate(chunks_rms, axis=0), sr


def find_rms_valley_time(
    rms_10ms: np.ndarray,
    center_sec: float,
    window_before_sec: float,
    window_after_sec: float,
    *,
    window_ms: float = DEFAULT_RMS_WINDOW_MS,
) -> float:
    """Find the timestamp (seconds) of the minimum RMS energy valley around `center_sec`."""
    if rms_10ms is None or rms_10ms.size == 0:
        return max(0.0, float(center_sec))

    step_sec = window_ms / 1000.0
    start_sec = max(0.0, float(center_sec) - max(0.0, float(window_before_sec)))
    end_sec = max(start_sec, float(center_sec) + max(0.0, float(window_after_sec)))

    start_idx = max(0, min(rms_10ms.size - 1, int(math.floor(start_sec / step_sec))))
    end_idx = max(start_idx, min(rms_10ms.size - 1, int(math.ceil(end_sec / step_sec))))

    window = rms_10ms[start_idx : end_idx + 1]
    if window.size == 0:
        return max(0.0, float(center_sec))

    min_rel_idx = int(np.argmin(window))
    valley_idx = start_idx + min_rel_idx
    # Center of the 10ms window
    valley_sec = (valley_idx + 0.5) * step_sec
    return round(max(0.0, valley_sec), 4)


def snap_to_zero_crossing(
    samples: np.ndarray,
    target_time_sec: float,
    *,
    sample_rate: int = SAMPLE_RATE_16K,
    search_radius_ms: float = 15.0,
) -> float:
    """Snap `target_time_sec` to the nearest zero-crossing in `samples` within `±search_radius_ms`."""
    mono = _to_float32_mono(samples)
    if mono.size < 2 or sample_rate <= 0:
        return round(max(0.0, float(target_time_sec)), 4)

    center_idx = max(0, min(mono.size - 1, int(round(max(0.0, target_time_sec) * sample_rate))))
    radius_samples = max(1, int(round(sample_rate * (search_radius_ms / 1000.0))))
    lo = max(0, center_idx - radius_samples)
    hi = min(mono.size - 1, center_idx + radius_samples)

    segment = mono[lo : hi + 1]
    if segment.size < 2:
        return round(center_idx / float(sample_rate), 4)

    # Zero-crossing occurs where consecutive samples have opposite signs or touch zero
    s0 = segment[:-1]
    s1 = segment[1:]
    zc_mask = (s0 * s1) <= 0.0
    zc_indices = np.nonzero(zc_mask)[0]

    if zc_indices.size > 0:
        abs_indices = lo + zc_indices
        # Pick the zero-crossing closest to center_idx; refine between i and i+1 by smaller magnitude
        nearest_pos = int(np.argmin(np.abs(abs_indices - center_idx)))
        idx_i = int(abs_indices[nearest_pos])
        if idx_i + 1 < mono.size and abs(float(mono[idx_i + 1])) < abs(float(mono[idx_i])):
            idx_i += 1
        return round(idx_i / float(sample_rate), 4)

    # Fallback: sample with minimum absolute amplitude in the search window
    min_amp_idx = lo + int(np.argmin(np.abs(segment)))
    return round(min_amp_idx / float(sample_rate), 4)


def snap_cut_boundaries_acoustic(
    start_sec: float,
    end_sec: float,
    *,
    rms_10ms: np.ndarray | None = None,
    samples: np.ndarray | None = None,
    wav_path: str | Path | None = None,
    sample_rate: int = SAMPLE_RATE_16K,
    start_window_before_sec: float = 0.35,
    start_window_after_sec: float = 0.05,
    end_window_before_sec: float = 0.05,
    end_window_after_sec: float = 0.45,
) -> tuple[float, float]:
    """Snap cut `[start_sec, end_sec]` to breathing silence valleys (RMS 10ms) + zero-crossing.

    Per ARCHITECTURE.md §3 Fase 4C:
    - Start search window: `[t_start - 350ms, t_start + 50ms]`
    - End search window: `[t_end - 50ms, t_end + 450ms]`
    """
    mono: np.ndarray | None = None
    if samples is not None:
        mono = _to_float32_mono(samples)

    if rms_10ms is None:
        if mono is not None and mono.size > 0:
            rms_10ms = compute_rms_energy_10ms(mono, sample_rate=sample_rate)
        elif wav_path is not None and Path(wav_path).exists():
            rms_10ms, sample_rate = compute_rms_energy_from_wav(wav_path)

    snapped_start = float(start_sec)
    snapped_end = float(end_sec)

    if rms_10ms is not None and rms_10ms.size > 0:
        snapped_start = find_rms_valley_time(
            rms_10ms,
            start_sec,
            window_before_sec=start_window_before_sec,
            window_after_sec=start_window_after_sec,
        )
        snapped_end = find_rms_valley_time(
            rms_10ms,
            end_sec,
            window_before_sec=end_window_before_sec,
            window_after_sec=end_window_after_sec,
        )

    if mono is not None and mono.size > 1:
        snapped_start = snap_to_zero_crossing(
            mono, snapped_start, sample_rate=sample_rate, search_radius_ms=15.0
        )
        snapped_end = snap_to_zero_crossing(
            mono, snapped_end, sample_rate=sample_rate, search_radius_ms=15.0
        )
    elif wav_path is not None and Path(wav_path).exists():
        start_chunk, sr = read_wav_chunk_float32(
            wav_path, max(0.0, snapped_start - 0.05), snapped_start + 0.05
        )
        if start_chunk.size > 1:
            chunk_origin = max(0.0, snapped_start - 0.05)
            rel_snapped = snap_to_zero_crossing(
                start_chunk, snapped_start - chunk_origin, sample_rate=sr, search_radius_ms=15.0
            )
            snapped_start = round(chunk_origin + rel_snapped, 4)

        end_chunk, sr = read_wav_chunk_float32(
            wav_path, max(0.0, snapped_end - 0.05), snapped_end + 0.05
        )
        if end_chunk.size > 1:
            chunk_origin = max(0.0, snapped_end - 0.05)
            rel_snapped = snap_to_zero_crossing(
                end_chunk, snapped_end - chunk_origin, sample_rate=sr, search_radius_ms=15.0
            )
            snapped_end = round(chunk_origin + rel_snapped, 4)

    if snapped_end <= snapped_start:
        return round(max(0.0, float(start_sec)), 4), round(max(float(start_sec) + 0.1, float(end_sec)), 4)

    return round(snapped_start, 4), round(snapped_end, 4)


# --- Lightweight MFCC + Prosody Speaker Diarization in 5-min Chunks ---


def _hz_to_mel(hz: float | np.ndarray) -> float | np.ndarray:
    return 2595.0 * np.log10(1.0 + np.asarray(hz) / 700.0)


def _mel_to_hz(mel: float | np.ndarray) -> float | np.ndarray:
    return 700.0 * (10.0 ** (np.asarray(mel) / 2595.0) - 1.0)


def _build_mel_filterbank(
    sample_rate: int = SAMPLE_RATE_16K,
    n_fft: int = 512,
    n_mels: int = 24,
    fmin: float = 80.0,
    fmax: float = 7600.0,
) -> np.ndarray:
    mel_min = float(_hz_to_mel(fmin))
    mel_max = float(_hz_to_mel(min(fmax, sample_rate / 2.0)))
    mel_points = np.linspace(mel_min, mel_max, n_mels + 2)
    hz_points = _mel_to_hz(mel_points)
    bin_points = np.floor((n_fft + 1) * hz_points / sample_rate).astype(int)

    n_freqs = n_fft // 2 + 1
    fbank = np.zeros((n_mels, n_freqs), dtype=np.float32)
    for m in range(1, n_mels + 1):
        f_left = int(bin_points[m - 1])
        f_center = int(bin_points[m])
        f_right = int(bin_points[m + 1])
        if f_center <= f_left:
            f_center = f_left + 1
        if f_right <= f_center:
            f_right = f_center + 1
        for k in range(f_left, min(f_center, n_freqs)):
            fbank[m - 1, k] = (k - f_left) / float(f_center - f_left)
        for k in range(f_center, min(f_right, n_freqs)):
            fbank[m - 1, k] = (f_right - k) / float(f_right - f_center)
    return fbank


_MEL_FBANK_CACHE: dict[tuple[int, int, int], np.ndarray] = {}


def _get_mel_filterbank(sample_rate: int = SAMPLE_RATE_16K, n_fft: int = 512, n_mels: int = 24) -> np.ndarray:
    key = (sample_rate, n_fft, n_mels)
    cached = _MEL_FBANK_CACHE.get(key)
    if cached is None:
        cached = _build_mel_filterbank(sample_rate=sample_rate, n_fft=n_fft, n_mels=n_mels)
        _MEL_FBANK_CACHE[key] = cached
    return cached


def _estimate_pitch_hz(mono: np.ndarray, sample_rate: int = SAMPLE_RATE_16K) -> float:
    """Estimate fundamental pitch (F0 in Hz) via autocorrelation in [75Hz, 400Hz]."""
    if mono.size < 400:
        return 150.0
    # Take up to 3200 samples (~200ms) from the highest-energy region
    slice_len = min(mono.size, 3200)
    sig = mono[:slice_len] - float(np.mean(mono[:slice_len]))
    energy = float(np.sum(sig * sig))
    if energy < 1e-7:
        return 150.0

    corr = np.correlate(sig, sig, mode="full")[sig.size - 1 :]
    min_lag = max(1, int(sample_rate / 400.0))
    max_lag = min(corr.size - 1, int(sample_rate / 75.0))
    if max_lag <= min_lag:
        return 150.0

    search = corr[min_lag : max_lag + 1]
    peak_lag = min_lag + int(np.argmax(search))
    return float(sample_rate) / float(peak_lag)


def extract_prosodic_feature_vector(
    samples: np.ndarray,
    *,
    sample_rate: int = SAMPLE_RATE_16K,
    n_mfcc: int = 13,
) -> np.ndarray:
    """Extract a 16-D acoustic feature vector `[13 MFCCs, norm_pitch, norm_centroid, zcr]`."""
    mono = _to_float32_mono(samples)
    if mono.size < 160:
        return np.zeros(n_mfcc + 3, dtype=np.float32)

    # Focus on active voice samples (up to 3 seconds max per segment boundary)
    max_samples = min(mono.size, sample_rate * 3)
    mono = mono[:max_samples]

    n_fft = 512
    frame_len = 400  # 25ms at 16kHz
    hop_len = 160  # 10ms at 16kHz

    if mono.size < frame_len:
        padded = np.zeros(frame_len, dtype=np.float32)
        padded[: mono.size] = mono
        frames = padded.reshape(1, frame_len)
    else:
        n_frames = 1 + (mono.size - frame_len) // hop_len
        strides = (mono.strides[0] * hop_len, mono.strides[0])
        frames = np.lib.stride_tricks.as_strided(
            mono, shape=(n_frames, frame_len), strides=strides
        ).copy()

    # Keep voiced/active frames above 10% of median frame energy
    frame_energies = np.mean(frames * frames, axis=1)
    max_energy = float(np.max(frame_energies)) if frame_energies.size > 0 else 0.0
    if max_energy < 1e-8:
        return np.zeros(n_mfcc + 3, dtype=np.float32)

    active_mask = frame_energies >= (max_energy * 0.05)
    if np.any(active_mask):
        frames = frames[active_mask]

    window = np.hanning(frame_len).astype(np.float32)
    windowed = frames * window
    mag_spec = np.abs(np.fft.rfft(windowed, n=n_fft, axis=1)).astype(np.float32)
    pow_spec = (mag_spec * mag_spec) / float(n_fft)

    fbank = _get_mel_filterbank(sample_rate=sample_rate, n_fft=n_fft, n_mels=24)
    mel_energy = np.dot(pow_spec, fbank.T)
    log_mel = np.log(np.maximum(mel_energy, 1e-10))
    mfcc_frames = dct(log_mel, type=2, axis=1, norm="ortho")[:, :n_mfcc]
    mean_mfcc = np.mean(mfcc_frames, axis=0).astype(np.float32)

    # Spectral centroid (normalized to [0, 1] by Nyquist)
    freqs = np.linspace(0.0, sample_rate / 2.0, mag_spec.shape[1], dtype=np.float32)
    denom = np.maximum(np.sum(mag_spec, axis=1), 1e-8)
    centroids = np.sum(mag_spec * freqs[None, :], axis=1) / denom
    norm_centroid = float(np.mean(centroids)) / float(sample_rate / 2.0)

    # Pitch F0 (normalized around [75, 400] Hz -> ~[0, 5])
    pitch_hz = _estimate_pitch_hz(mono, sample_rate=sample_rate)
    norm_pitch = (pitch_hz - 75.0) / 65.0

    # Zero-crossing rate
    signs = np.signbit(mono)
    zcr = float(np.mean(signs[:-1] != signs[1:])) if mono.size > 1 else 0.0

    feat = np.concatenate(
        [
            mean_mfcc,
            np.array([norm_pitch * 4.0, norm_centroid * 4.0, zcr * 4.0], dtype=np.float32),
        ]
    )
    return feat


def _acoustic_distance(v1: np.ndarray, v2: np.ndarray) -> float:
    """Combined cosine + normalized Euclidean prosodic distance between two segment vectors."""
    n1 = float(np.linalg.norm(v1))
    n2 = float(np.linalg.norm(v2))
    if n1 < 1e-6 or n2 < 1e-6:
        return 0.0
    cos_sim = float(np.dot(v1, v2) / (n1 * n2))
    cos_dist = max(0.0, 1.0 - cos_sim)
    # Emphasize pitch + spectral centroid components (last 3 elements)
    prosody_diff = float(np.linalg.norm(v1[-3:] - v2[-3:])) / 4.0
    return 0.55 * cos_dist + 0.45 * prosody_diff


def detect_speaker_shifts_chunked(
    segments: Sequence[Segment],
    *,
    audio_path: str | Path | None = None,
    samples: np.ndarray | None = None,
    sample_rate: int = SAMPLE_RATE_16K,
    chunk_duration_sec: float = DEFAULT_CHUNK_DURATION_SEC,
    shift_threshold: float = 0.28,
) -> list[str]:
    """Detect speaker labels (`SPEAKER_00`, `SPEAKER_01`) across segments using 5-minute audio chunks."""
    n_segs = len(segments)
    if n_segs == 0:
        return []
    if n_segs == 1:
        existing = getattr(segments[0], "speaker", None)
        return [existing or "SPEAKER_00"]

    mono_all: np.ndarray | None = _to_float32_mono(samples) if samples is not None else None
    has_wav = audio_path is not None and Path(audio_path).exists()

    # Extract feature vectors in 5-minute chunks so memory never exceeds one 5-min window
    features: list[np.ndarray] = [np.zeros(16, dtype=np.float32) for _ in range(n_segs)]

    if mono_all is not None and mono_all.size > 0:
        total_dur = mono_all.size / float(sample_rate)
        chunk_start = 0.0
        while chunk_start < total_dur + 1e-3:
            chunk_end = chunk_start + chunk_duration_sec
            c_lo = max(0, int(math.floor(chunk_start * sample_rate)))
            c_hi = min(mono_all.size, int(math.ceil(chunk_end * sample_rate)))
            chunk_samples = mono_all[c_lo:c_hi]
            for idx, seg in enumerate(segments):
                if seg.start >= chunk_start and seg.start < chunk_end:
                    s_lo = max(0, int(math.floor((seg.start - chunk_start) * sample_rate)))
                    s_hi = min(chunk_samples.size, int(math.ceil((seg.end - chunk_start) * sample_rate)))
                    if s_hi > s_lo:
                        features[idx] = extract_prosodic_feature_vector(
                            chunk_samples[s_lo:s_hi], sample_rate=sample_rate
                        )
            chunk_start = chunk_end
    elif has_wav and audio_path is not None:
        max_end = max(float(s.end) for s in segments)
        chunk_start = 0.0
        while chunk_start <= max_end + 1e-3:
            chunk_end = chunk_start + chunk_duration_sec
            chunk_samples, sr = read_wav_chunk_float32(audio_path, chunk_start, chunk_end + 5.0)
            if chunk_samples.size > 0:
                for idx, seg in enumerate(segments):
                    if seg.start >= chunk_start and seg.start < chunk_end:
                        s_lo = max(0, int(math.floor((seg.start - chunk_start) * sr)))
                        s_hi = min(chunk_samples.size, int(math.ceil((seg.end - chunk_start) * sr)))
                        if s_hi > s_lo:
                            features[idx] = extract_prosodic_feature_vector(
                                chunk_samples[s_lo:s_hi], sample_rate=sr
                            )
            chunk_start = chunk_end

    # Track 2 speaker centroids (`SPEAKER_00` and `SPEAKER_01`) with adaptive hysteresis
    labels: list[str] = ["SPEAKER_00"] * n_segs
    current_speaker = 0
    centroids: dict[int, np.ndarray] = {0: features[0].copy()}
    counts: dict[int, int] = {0: 1}

    for i in range(1, n_segs):
        prev_seg = segments[i - 1]
        curr_seg = segments[i]
        feat_prev = features[i - 1]
        feat_curr = features[i]

        dist_prev = _acoustic_distance(feat_prev, feat_curr)
        gap_sec = max(0.0, float(curr_seg.start) - float(prev_seg.end))
        prev_text = (prev_seg.text or "").strip()
        curr_text = (curr_seg.text or "").strip()

        # Discourse Q&A turn indicator boosts shift sensitivity
        qa_turn_bonus = 0.08 if (prev_text.endswith("?") or curr_text.startswith("-")) else 0.0
        pause_bonus = 0.05 if gap_sec >= 0.45 else 0.0
        effective_score = dist_prev + qa_turn_bonus + pause_bonus

        if np.linalg.norm(feat_curr) < 1e-6:
            # Silent / synthetic audio fallback: only switch on explicit Q&A dialogue turn with pause
            if prev_text.endswith("?") and gap_sec >= 0.4:
                current_speaker = 1 - current_speaker
            labels[i] = f"SPEAKER_{current_speaker:02d}"
            continue

        if 1 not in centroids:
            # Second speaker not yet initialized: check if distance crosses shift threshold
            if effective_score >= shift_threshold:
                current_speaker = 1
                centroids[1] = feat_curr.copy()
                counts[1] = 1
            else:
                c0 = centroids[0]
                n0 = counts[0]
                centroids[0] = (c0 * n0 + feat_curr) / float(n0 + 1)
                counts[0] = n0 + 1
        else:
            d0 = _acoustic_distance(feat_curr, centroids[0])
            d1 = _acoustic_distance(feat_curr, centroids[1])
            other_speaker = 1 - current_speaker
            d_curr = d0 if current_speaker == 0 else d1
            d_other = d1 if current_speaker == 0 else d0

            # Switch to the other speaker if closer to other centroid or strong transition jump
            if (d_other + 0.03 < d_curr) or (effective_score >= shift_threshold and d_other <= d_curr + 0.05):
                current_speaker = other_speaker

            c_active = centroids[current_speaker]
            n_active = counts[current_speaker]
            centroids[current_speaker] = (c_active * n_active + feat_curr) / float(n_active + 1)
            counts[current_speaker] = n_active + 1

        labels[i] = f"SPEAKER_{current_speaker:02d}"

    return labels


def assign_acoustic_speakers(
    segments: Sequence[Segment],
    *,
    audio_path: str | Path | None = None,
    samples: np.ndarray | None = None,
    sample_rate: int = SAMPLE_RATE_16K,
    chunk_duration_sec: float = DEFAULT_CHUNK_DURATION_SEC,
) -> list[Segment]:
    """Return a new list of `Segment` objects with `speaker` populated via chunked acoustic DSP."""
    if not segments:
        return []

    # Preserve pre-existing speaker annotations if all segments already have explicit speakers
    if all(bool(s.speaker) for s in segments):
        return [s.model_copy(deep=True) for s in segments]

    detected = detect_speaker_shifts_chunked(
        segments,
        audio_path=audio_path,
        samples=samples,
        sample_rate=sample_rate,
        chunk_duration_sec=chunk_duration_sec,
    )

    out: list[Segment] = []
    for seg, spk in zip(segments, detected):
        copy_seg = seg.model_copy(deep=True)
        if not copy_seg.speaker:
            copy_seg.speaker = spk
        out.append(copy_seg)
    return out


class AcousticSpeakerDiarizer:
    """Chunked acoustic speaker diarizer and RMS boundary snapper."""

    def __init__(self, *, chunk_duration_sec: float = DEFAULT_CHUNK_DURATION_SEC) -> None:
        self.chunk_duration_sec = chunk_duration_sec

    def diarize(
        self,
        segments: Sequence[Segment],
        *,
        audio_path: str | Path | None = None,
        samples: np.ndarray | None = None,
        sample_rate: int = SAMPLE_RATE_16K,
    ) -> list[Segment]:
        return assign_acoustic_speakers(
            segments,
            audio_path=audio_path,
            samples=samples,
            sample_rate=sample_rate,
            chunk_duration_sec=self.chunk_duration_sec,
        )
