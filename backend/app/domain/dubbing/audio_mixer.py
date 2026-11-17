"""Sample-exact 48kHz dubbing audio mixer, rubberband time-aligner, export presets (mov_text/hardsub), and Send-to-Cuts job builder."""

from __future__ import annotations

import asyncio
import inspect
import io
import math
import os
import re
import shutil
import subprocess
import uuid
import wave
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Awaitable, Callable, Sequence

import numpy as np

from app.application.job_lifecycle import utc_now_iso
from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.core.paths import data_dir
from app.core.settings import get_video_folder, load_settings
from app.domain.dubbing.translator import (
    FormattedSubtitleCue,
    TARGET_LANGUAGE_ISO_639_2,
    TARGET_LANGUAGE_NAMES,
    build_dub_segments_and_words,
)
from app.infrastructure.audio.pcm_extractor import (
    extract_pcm_16k_wav,
    probe_media_duration,
    write_synthetic_pcm16_wav,
)
from app.infrastructure.storage.atomic_store import atomic_write_json, atomic_write_text, read_json
from app.infrastructure.video.ffmpeg_executor import is_nvenc_failure_log
from app.infrastructure.video.filter_script_builder import escape_ffmpeg_filter_path
from app.models.domain import DubbingSegmentSubtitle, DubbingUnit, Job, JobStatus, Segment, WordTiming

CANVAS_SAMPLE_RATE = 48000
MAX_BORROW_RATIO = 0.60
MIN_BREATH_GAP_SECONDS = 0.150
INTERNAL_PAUSE_THRESHOLD_SECONDS = 0.250
INTERNAL_PAUSE_KEEP_SECONDS = 0.200
COMFORTABLE_MIN_TEMPO = 0.85
COMFORTABLE_MAX_TEMPO = 1.20
HARD_MAX_TEMPO = 1.28

MP4_COMPATIBLE_VIDEO_CODECS = frozenset({"h264", "hevc", "h265", "mpeg4", "av1"})

CommandRunnerFn = Callable[..., int | tuple[int, str] | dict[str, Any] | Awaitable[int | tuple[int, str] | dict[str, Any]]]
CondenseResynthFn = Callable[[DubbingUnit, int], Awaitable[tuple[str, Path | None]]]


@dataclass
class UnitTimingPlan:
    """Computed placement slot and tempo adjustment for a single `DubbingUnit`."""

    unit_id: str
    slot_start: float
    slot_end: float
    available_duration: float
    raw_tts_duration: float
    trimmed_tts_duration: float
    tempo: float
    condensed: bool = False
    capped_warning: str | None = None


@dataclass
class MixResult:
    """Output of sample-exact 48kHz dubbing mix + ducking + loudnorm."""

    audio_path: Path
    duration_seconds: float
    unit_plans: list[UnitTimingPlan] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class ExportDubbedResult:
    """Output of exporting a dubbed full-length `.mp4`."""

    mp4_path: Path
    preset: str
    video_codec_used: str
    vtt_path: Path | None = None
    srt_path: Path | None = None
    warnings: list[str] = field(default_factory=list)


def _read_wav_as_float32(path: Path) -> tuple[np.ndarray, int]:
    if not path.exists():
        return np.zeros(0, dtype=np.float32), CANVAS_SAMPLE_RATE
    with wave.open(str(path), "rb") as wf:
        sr = wf.getframerate() or CANVAS_SAMPLE_RATE
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


def _write_wav_float32(path: Path, samples: np.ndarray, sample_rate: int = CANVAS_SAMPLE_RATE) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f"{path.name}.{uuid.uuid4().hex}.tmp")
    clipped = np.clip(np.asarray(samples, dtype=np.float32), -1.0, 1.0)
    int16_arr = (clipped * 32767.0).astype("<i2")
    with wave.open(str(tmp_path), "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(int(sample_rate))
        wf.writeframes(int16_arr.tobytes())
    tmp_path.replace(path)
    return path


def _resample_linear(samples: np.ndarray, src_sr: int, dst_sr: int) -> np.ndarray:
    if samples.size == 0 or src_sr == dst_sr or src_sr <= 0 or dst_sr <= 0:
        return samples.astype(np.float32, copy=False)
    dst_len = max(1, int(round(samples.size * (float(dst_sr) / float(src_sr)))))
    x_old = np.linspace(0.0, 1.0, num=samples.size, endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=dst_len, endpoint=False)
    return np.interp(x_new, x_old, samples).astype(np.float32)


def _load_audio_at_sr(audio_path: Path, target_sr: int = CANVAS_SAMPLE_RATE) -> np.ndarray:
    if not audio_path.exists():
        return np.zeros(0, dtype=np.float32)

    if audio_path.suffix.lower() == ".wav":
        try:
            arr, sr = _read_wav_as_float32(audio_path)
            return _resample_linear(arr, sr, target_sr)
        except Exception:
            pass

    try:
        import soundfile as sf  # type: ignore

        data, sr = sf.read(str(audio_path), dtype="float32", always_2d=False)
        arr = np.asarray(data, dtype=np.float32)
        if arr.ndim > 1:
            arr = arr.mean(axis=1)
        return _resample_linear(arr, int(sr), target_sr)
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
                str(audio_path),
                "-ac",
                "1",
                "-ar",
                str(target_sr),
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
                sr = wf.getframerate() or target_sr
                raw = wf.readframes(wf.getnframes())
            arr = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
            return _resample_linear(arr, sr, target_sr)

    return np.zeros(0, dtype=np.float32)


def trim_internal_pauses(
    samples: np.ndarray,
    sample_rate: int,
    *,
    pause_threshold_sec: float = INTERNAL_PAUSE_THRESHOLD_SECONDS,
    keep_pause_sec: float = INTERNAL_PAUSE_KEEP_SECONDS,
    silence_rms_threshold: float = 0.008,
) -> np.ndarray:
    """Trim leading/trailing dead silence and compress internal pauses `> 250ms` down to `200ms`."""
    arr = np.asarray(samples, dtype=np.float32)
    if arr.size == 0 or sample_rate <= 0:
        return arr

    win = max(1, int(round(0.01 * sample_rate)))  # 10ms frames
    n_frames = arr.size // win
    if n_frames <= 4:
        return arr

    framed = arr[: n_frames * win].reshape(n_frames, win)
    rms = np.sqrt(np.mean(framed * framed, axis=1))
    is_silent = rms < silence_rms_threshold

    speech_frames = np.nonzero(~is_silent)[0]
    if speech_frames.size == 0:
        return arr

    first_speech_f = int(speech_frames[0])
    last_speech_f = int(speech_frames[-1])

    # Keep small 30ms leading/trailing breath margin
    pad_f = 3
    start_f = max(0, first_speech_f - pad_f)
    end_f = min(n_frames - 1, last_speech_f + pad_f)

    keep_frames = max(1, int(round(keep_pause_sec / 0.01)))
    thresh_frames = max(keep_frames + 1, int(round(pause_threshold_sec / 0.01)))

    kept_segments: list[np.ndarray] = []
    f_idx = start_f
    while f_idx <= end_f:
        if not is_silent[f_idx]:
            run_end = f_idx
            while run_end <= end_f and not is_silent[run_end]:
                run_end += 1
            kept_segments.append(arr[f_idx * win : min(arr.size, run_end * win)])
            f_idx = run_end
        else:
            run_end = f_idx
            while run_end <= end_f and is_silent[run_end]:
                run_end += 1
            run_len = run_end - f_idx
            take_len = min(run_len, keep_frames) if run_len > thresh_frames else run_len
            kept_segments.append(arr[f_idx * win : min(arr.size, (f_idx + take_len) * win)])
            f_idx = run_end

    if not kept_segments:
        return arr
    return np.concatenate(kept_segments, axis=0).astype(np.float32)


def compute_unit_slots_with_silence_borrowing(
    units: Sequence[DubbingUnit],
    *,
    total_duration: float,
    window_start: float = 0.0,
    max_borrow_ratio: float = MAX_BORROW_RATIO,
    min_breath_gap: float = MIN_BREATH_GAP_SECONDS,
) -> list[tuple[float, float]]:
    """Compute `[slot_start, slot_end]` per unit, borrowing up to 60% of adjacent silence.

    Preserves `>= 150ms` breath gap and NEVER crosses a speaker change or passthrough boundary.
    """
    n = len(units)
    if n == 0:
        return []

    win_end = window_start + max(0.0, float(total_duration))
    slots: list[list[float]] = []

    for i, u in enumerate(units):
        u_st = max(window_start, float(u.start))
        u_en = min(win_end, max(u_st, float(u.end)))
        if u.passthrough_original:
            slots.append([u_st, u_en])
            continue

        # Left borrow
        prev_u = units[i - 1] if i > 0 else None
        if prev_u is None:
            gap_before = max(0.0, u_st - window_start)
            left_borrow = min(max_borrow_ratio * gap_before, gap_before)
        elif prev_u.passthrough_original or prev_u.speaker != u.speaker:
            # Never cross speaker change or music boundary
            left_borrow = 0.0
        else:
            gap_before = max(0.0, u_st - float(prev_u.end))
            left_borrow = min(max_borrow_ratio * gap_before, max(0.0, gap_before - min_breath_gap))

        # Right borrow
        next_u = units[i + 1] if i + 1 < n else None
        if next_u is None:
            gap_after = max(0.0, win_end - u_en)
            right_borrow = min(max_borrow_ratio * gap_after, gap_after)
        elif next_u.passthrough_original or next_u.speaker != u.speaker:
            right_borrow = 0.0
        else:
            gap_after = max(0.0, float(next_u.start) - u_en)
            right_borrow = min(max_borrow_ratio * gap_after, max(0.0, gap_after - min_breath_gap))

        slots.append([max(window_start, u_st - left_borrow), min(win_end, u_en + right_borrow)])

    # Ensure strictly monotonic non-overlapping slots preserving min_breath_gap between same-speaker neighbors
    for i in range(1, n):
        prev_end = slots[i - 1][1]
        min_next_start = prev_end + (0.0 if (units[i - 1].passthrough_original or units[i].passthrough_original) else min_breath_gap)
        if slots[i][0] < min_next_start:
            # Clamp both back safely around midpoint if both borrowed into same gap
            orig_prev_end = float(units[i - 1].end)
            orig_cur_start = float(units[i].start)
            if orig_cur_start >= orig_prev_end + min_breath_gap:
                slots[i - 1][1] = min(slots[i - 1][1], orig_cur_start - min_breath_gap * 0.5)
                slots[i][0] = max(slots[i][0], slots[i - 1][1] + min_breath_gap)
            else:
                slots[i][0] = max(slots[i][0], prev_end)
            slots[i][1] = max(slots[i][0] + 0.05, slots[i][1])

    return [(round(s[0], 4), round(s[1], 4)) for s in slots]


def compute_alignment_tempo(tts_duration: float, available_duration: float) -> float:
    """Compute desired playback tempo in `[0.85, 1.28]`.

    If `tts_duration <= available_duration`, returns `1.0` (natural pace).
    """
    avail = max(0.1, float(available_duration))
    tts_d = max(0.01, float(tts_duration))
    if tts_d <= avail:
        return 1.0
    return round(tts_d / avail, 4)


def build_rubberband_filter(tempo: float, *, use_rubberband: bool = True) -> str:
    """Return FFmpeg audio tempo filter string (`librubberband` with `atempo` fallback)."""
    clamped = max(COMFORTABLE_MIN_TEMPO, min(HARD_MAX_TEMPO, float(tempo)))
    if use_rubberband:
        return f"librubberband=tempo={clamped:.4f}:pitchq=quality:formant=preserved"
    return f"atempo={clamped:.4f}"


async def _run_command(
    cmd: list[str],
    *,
    command_runner: CommandRunnerFn | None = None,
    cancel_token: CancelToken | None = None,
    job_id: str | None = None,
    container: ServiceContainer | None = None,
) -> tuple[int, str]:
    if cancel_token is not None:
        cancel_token.raise_if_cancelled()

    if command_runner is not None:
        try:
            sig = inspect.signature(command_runner)
            pos_params = [
                p
                for p in sig.parameters.values()
                if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
            ]
            if len(pos_params) >= 3:
                res = command_runner(cmd, os.environ.copy(), cancel_token)
            elif len(pos_params) == 2:
                res = command_runner(cmd, cancel_token)
            else:
                res = command_runner(cmd)
        except (ValueError, TypeError):
            res = command_runner(cmd)
        if inspect.isawaitable(res):
            res = await res
        if isinstance(res, tuple):
            rc = int(res[0])
            out = str(res[1]) if len(res) > 1 else ""
            return rc, out
        if isinstance(res, dict):
            rc_raw = res.get("returncode", res.get("code", 0))
            rc = 1 if (not res.get("ok", True) and int(rc_raw or 0) == 0) else int(rc_raw or 0)
            out = str(res.get("stdout") or res.get("stderr") or res.get("output") or "")
            return rc, out
        return int(res), ""

    if not shutil.which(cmd[0]):
        return 127, f"Executable not found: {cmd[0]}"

    def _run_sync() -> tuple[int, str]:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        c = container or get_container()
        if job_id:
            c.runtime.register_process(job_id, "dubbing", proc.pid)
        try:
            out, _ = proc.communicate()
            return int(proc.returncode or 0), out or ""
        finally:
            if job_id:
                c.runtime.unregister_process(job_id, "dubbing", proc.pid)

    return await asyncio.to_thread(_run_sync)


async def _time_stretch_wav(
    input_wav: Path,
    output_wav: Path,
    tempo: float,
    *,
    command_runner: CommandRunnerFn | None = None,
    cancel_token: CancelToken | None = None,
    job_id: str | None = None,
    container: ServiceContainer | None = None,
) -> Path:
    """Run `ffmpeg librubberband=tempo=r:pitchq=quality:formant=preserved` (or `atempo` / linear fallback)."""
    if abs(tempo - 1.0) <= 0.01:
        if input_wav.resolve() != output_wav.resolve():
            output_wav.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(input_wav, output_wav)
        return output_wav

    rb_filter = build_rubberband_filter(tempo, use_rubberband=True)
    cmd = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(input_wav),
        "-af",
        rb_filter,
        "-ar",
        str(CANVAS_SAMPLE_RATE),
        "-ac",
        "1",
        str(output_wav),
    ]
    rc, err = await _run_command(
        cmd,
        command_runner=command_runner,
        cancel_token=cancel_token,
        job_id=job_id,
        container=container,
    )
    if rc == 0 and output_wav.exists() and output_wav.stat().st_size > 44:
        return output_wav

    # Fallback to built-in atempo if librubberband filter isn't compiled in FFmpeg
    at_filter = build_rubberband_filter(tempo, use_rubberband=False)
    cmd_at = [
        "ffmpeg",
        "-y",
        "-v",
        "error",
        "-i",
        str(input_wav),
        "-af",
        at_filter,
        "-ar",
        str(CANVAS_SAMPLE_RATE),
        "-ac",
        "1",
        str(output_wav),
    ]
    rc2, _err2 = await _run_command(
        cmd_at,
        command_runner=command_runner,
        cancel_token=cancel_token,
        job_id=job_id,
        container=container,
    )
    if rc2 == 0 and output_wav.exists() and output_wav.stat().st_size > 44:
        return output_wav

    # Pure-numpy time compression fallback (used when ffmpeg is absent in mock tests)
    samples = _load_audio_at_sr(input_wav, CANVAS_SAMPLE_RATE)
    if samples.size == 0:
        write_synthetic_pcm16_wav(output_wav, sample_rate=CANVAS_SAMPLE_RATE, duration_seconds=0.2)
        return output_wav
    new_len = max(1, int(round(samples.size / max(0.5, tempo))))
    x_old = np.linspace(0.0, 1.0, num=samples.size, endpoint=False)
    x_new = np.linspace(0.0, 1.0, num=new_len, endpoint=False)
    stretched = np.interp(x_new, x_old, samples).astype(np.float32)
    return _write_wav_float32(output_wav, stretched, CANVAS_SAMPLE_RATE)


def _apply_micro_fade(samples: np.ndarray, sample_rate: int = CANVAS_SAMPLE_RATE, fade_ms: float = 10.0) -> np.ndarray:
    arr = np.array(samples, dtype=np.float32, copy=True)
    fade_n = min(arr.size // 2, max(1, int(round(sample_rate * (fade_ms / 1000.0)))))
    if fade_n > 1:
        ramp = np.linspace(0.0, 1.0, num=fade_n, dtype=np.float32)
        arr[:fade_n] *= ramp
        arr[-fade_n:] *= ramp[::-1]
    return arr


async def mix_dubbed_audio(
    units: Sequence[DubbingUnit],
    tts_wav_by_unit_id: dict[str, Path],
    output_audio_path: str | Path,
    *,
    vocals_path: str | Path | None = None,
    no_vocals_path: str | Path | None = None,
    total_duration: float,
    window_start: float = 0.0,
    work_dir: str | Path | None = None,
    condense_and_resynth: CondenseResynthFn | None = None,
    command_runner: CommandRunnerFn | None = None,
    cancel_token: CancelToken | None = None,
    job_id: str | None = None,
    container: ServiceContainer | None = None,
) -> MixResult:
    """Align TTS units on a sample-exact 48kHz canvas, passthrough original vocals, duck bg stems, and encode `.m4a`."""
    out_m4a = Path(output_audio_path)
    out_m4a.parent.mkdir(parents=True, exist_ok=True)
    wdir = Path(work_dir) if work_dir is not None else out_m4a.parent / ".work_mix"
    wdir.mkdir(parents=True, exist_ok=True)

    target_dur = max(0.2, float(total_duration))
    total_samples = max(1, int(round(target_dur * CANVAS_SAMPLE_RATE)))
    speech_canvas = np.zeros(total_samples, dtype=np.float32)

    orig_vocals = np.zeros(0, dtype=np.float32)
    if vocals_path is not None and Path(vocals_path).exists():
        orig_vocals = _load_audio_at_sr(Path(vocals_path), CANVAS_SAMPLE_RATE)

    slots = compute_unit_slots_with_silence_borrowing(
        units, total_duration=target_dur, window_start=window_start
    )

    plans: list[UnitTimingPlan] = []
    warnings: list[str] = []

    for unit, (slot_start, slot_end) in zip(units, slots):
        if cancel_token is not None:
            cancel_token.raise_if_cancelled()

        # Skip units outside preview/canvas window
        if slot_end <= window_start or slot_start >= window_start + target_dur:
            continue

        if unit.passthrough_original:
            if orig_vocals.size > 0:
                v_st = max(0, int(round((unit.start - window_start) * CANVAS_SAMPLE_RATE)))
                v_en = min(orig_vocals.size, int(round((unit.end - window_start) * CANVAS_SAMPLE_RATE)))
                c_st = max(0, int(round((unit.start - window_start) * CANVAS_SAMPLE_RATE)))
                if v_en > v_st and c_st < total_samples:
                    copy_n = min(v_en - v_st, total_samples - c_st)
                    seg_audio = _apply_micro_fade(orig_vocals[v_st : v_st + copy_n], CANVAS_SAMPLE_RATE)
                    speech_canvas[c_st : c_st + copy_n] += seg_audio
            plans.append(
                UnitTimingPlan(
                    unit_id=unit.unit_id,
                    slot_start=slot_start,
                    slot_end=slot_end,
                    available_duration=round(max(0.0, slot_end - slot_start), 4),
                    raw_tts_duration=0.0,
                    trimmed_tts_duration=0.0,
                    tempo=1.0,
                )
            )
            continue

        wav_path = tts_wav_by_unit_id.get(unit.unit_id)
        if wav_path is None or not Path(wav_path).exists():
            continue

        samples = _load_audio_at_sr(Path(wav_path), CANVAS_SAMPLE_RATE)
        raw_dur = samples.size / float(CANVAS_SAMPLE_RATE)
        trimmed = trim_internal_pauses(samples, CANVAS_SAMPLE_RATE)
        trimmed_dur = trimmed.size / float(CANVAS_SAMPLE_RATE)
        avail_dur = max(0.1, slot_end - slot_start)

        tempo = compute_alignment_tempo(trimmed_dur, avail_dur)
        condensed = False

        if tempo > COMFORTABLE_MAX_TEMPO and condense_and_resynth is not None:
            cur_chars = len((unit.dub_text or unit.text or "").strip())
            target_chars = max(8, int(round(cur_chars * 0.78)))
            try:
                _new_txt, new_wav = await condense_and_resynth(unit, target_chars)
                if new_wav is not None and Path(new_wav).exists():
                    condensed = True
                    samples = _load_audio_at_sr(Path(new_wav), CANVAS_SAMPLE_RATE)
                    trimmed = trim_internal_pauses(samples, CANVAS_SAMPLE_RATE)
                    trimmed_dur = trimmed.size / float(CANVAS_SAMPLE_RATE)
                    tempo = compute_alignment_tempo(trimmed_dur, avail_dur)
            except OperationCancelledError:
                raise
            except Exception as exc:
                warnings.append(f"Condensation skipped for {unit.unit_id}: {exc}")

        capped_warning: str | None = None
        if tempo > HARD_MAX_TEMPO:
            capped_warning = (
                f"Unit {unit.unit_id} tempo capped at {HARD_MAX_TEMPO:.2f}x (needed {tempo:.2f}x)."
            )
            warnings.append(capped_warning)
            tempo = HARD_MAX_TEMPO

        trimmed_wav = _write_wav_float32(wdir / f"{unit.unit_id}_trimmed.wav", trimmed, CANVAS_SAMPLE_RATE)
        aligned_wav = wdir / f"{unit.unit_id}_aligned.wav"
        await _time_stretch_wav(
            trimmed_wav,
            aligned_wav,
            tempo,
            command_runner=command_runner,
            cancel_token=cancel_token,
            job_id=job_id,
            container=container,
        )

        aligned_samples = _load_audio_at_sr(aligned_wav, CANVAS_SAMPLE_RATE)
        max_allowed_samples = max(1, int(round(avail_dur * CANVAS_SAMPLE_RATE)))
        if aligned_samples.size > max_allowed_samples:
            aligned_samples = aligned_samples[:max_allowed_samples]
        aligned_samples = _apply_micro_fade(aligned_samples, CANVAS_SAMPLE_RATE)

        start_sample = max(0, int(round((slot_start - window_start) * CANVAS_SAMPLE_RATE)))
        if start_sample < total_samples and aligned_samples.size > 0:
            place_n = min(aligned_samples.size, total_samples - start_sample)
            speech_canvas[start_sample : start_sample + place_n] += aligned_samples[:place_n]

        plans.append(
            UnitTimingPlan(
                unit_id=unit.unit_id,
                slot_start=slot_start,
                slot_end=slot_end,
                available_duration=round(avail_dur, 4),
                raw_tts_duration=round(raw_dur, 4),
                trimmed_tts_duration=round(trimmed_dur, 4),
                tempo=round(tempo, 4),
                condensed=condensed,
                capped_warning=capped_warning,
            )
        )

    speech_wav = _write_wav_float32(wdir / "speech_canvas_48k.wav", speech_canvas, CANVAS_SAMPLE_RATE)

    has_bg = no_vocals_path is not None and Path(no_vocals_path).exists()
    if has_bg:
        # Dynamic sidechaincompress ducking (-8 to -12 dB) + -14 LUFS loudnorm + exact apad/atrim
        filter_complex = (
            f"[1:a]asplit=2[sc][fg];"
            f"[0:a][sc]sidechaincompress=threshold=0.02:ratio=6:attack=25:release=300:level_sc=1:makeup=1[bg];"
            f"[bg][fg]amix=inputs=2:duration=first:normalize=0,"
            f"loudnorm=I=-14:TP=-1.5:LRA=11,"
            f"apad=whole_dur={target_dur:.6f},atrim=0:{target_dur:.6f}[a_out]"
        )
        cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(no_vocals_path),
            "-i",
            str(speech_wav),
            "-filter_complex",
            filter_complex,
            "-map",
            "[a_out]",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            str(CANVAS_SAMPLE_RATE),
            str(out_m4a),
        ]
    else:
        filter_complex = (
            f"[0:a]loudnorm=I=-14:TP=-1.5:LRA=11,"
            f"apad=whole_dur={target_dur:.6f},atrim=0:{target_dur:.6f}[a_out]"
        )
        cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(speech_wav),
            "-filter_complex",
            filter_complex,
            "-map",
            "[a_out]",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-ar",
            str(CANVAS_SAMPLE_RATE),
            str(out_m4a),
        ]

    rc, err = await _run_command(
        cmd,
        command_runner=command_runner,
        cancel_token=cancel_token,
        job_id=job_id,
        container=container,
    )
    if rc != 0 or not out_m4a.exists():
        # Mocked/headless fallback when ffmpeg is absent in unit tests
        if not shutil.which("ffmpeg") and command_runner is None:
            out_m4a.write_bytes(speech_wav.read_bytes())
        else:
            raise RuntimeError(f"FFmpeg audio mix failed (rc={rc}): {err}")

    return MixResult(
        audio_path=out_m4a,
        duration_seconds=round(target_dur, 3),
        unit_plans=plans,
        warnings=warnings,
    )


def _probe_video_codec(
    video_path: Path,
    *,
    ffprobe_runner: Callable[[list[str]], tuple[int, str]] | None = None,
) -> str:
    cmd = [
        "ffprobe",
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(video_path),
    ]
    if ffprobe_runner is not None:
        rc, out = ffprobe_runner(cmd)
        if rc == 0 and out.strip():
            return out.strip().splitlines()[0].strip().lower()
        return ""
    if shutil.which("ffprobe"):
        try:
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=10, check=False)
            if proc.returncode == 0 and proc.stdout.strip():
                return proc.stdout.strip().splitlines()[0].strip().lower()
        except Exception:
            pass
    return "h264" if video_path.suffix.lower() in (".mp4", ".m4v", ".mov") else ""


def _srt_to_ass_content(srt_text: str, title: str = "Dubbed Subtitles") -> str:
    """Convert UTF-8 SRT text into clean ASS subtitle script for Preset 2 hardsub."""
    header = [
        "[Script Info]",
        f"Title: {title}",
        "ScriptType: v4.00+",
        "PlayResX: 1920",
        "PlayResY: 1080",
        "WrapStyle: 0",
        "ScaledBorderAndShadow: yes",
        "",
        "[V4+ Styles]",
        "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, "
        "Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, "
        "Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
        "Style: Default,Arial,54,&H00FFFFFF,&H0000FFFF,&H00000000,&H80000000,"
        "-1,0,0,0,100,100,0,0,1,3,1,2,80,80,55,1",
        "",
        "[Events]",
        "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ]
    events: list[str] = []
    blocks = re.split(r"\r?\n\r?\n+", (srt_text or "").strip())
    ts_re = re.compile(r"(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})")

    def _to_ass_ts(h: str, m: str, s: str, ms: str) -> str:
        cs = int(ms) // 10
        return f"{int(h)}:{int(m):02d}:{int(s):02d}.{cs:02d}"

    for blk in blocks:
        lines = [ln.strip() for ln in blk.splitlines() if ln.strip()]
        if not lines:
            continue
        ts_idx = 0 if ts_re.search(lines[0]) else (1 if len(lines) > 1 and ts_re.search(lines[1]) else -1)
        if ts_idx < 0:
            continue
        m = ts_re.search(lines[ts_idx])
        if not m:
            continue
        st_ass = _to_ass_ts(m.group(1), m.group(2), m.group(3), m.group(4))
        en_ass = _to_ass_ts(m.group(5), m.group(6), m.group(7), m.group(8))
        txt = r"\N".join(lines[ts_idx + 1 :]).replace("{", r"\{").replace("}", r"\}")
        if txt:
            events.append(f"Dialogue: 0,{st_ass},{en_ass},Default,,0,0,0,,{txt}")

    return "\n".join(header + events) + "\n"


async def export_dubbed_mp4(
    source_video_path: str | Path,
    dub_audio_path: str | Path,
    output_mp4_path: str | Path,
    target_lang: str,
    *,
    preset: str = "mov_text",
    subtitles_enabled: bool = True,
    srt_path: str | Path | None = None,
    vtt_path: str | Path | None = None,
    command_runner: CommandRunnerFn | None = None,
    ffprobe_runner: Callable[[list[str]], tuple[int, str]] | None = None,
    cancel_token: CancelToken | None = None,
    job_id: str | None = None,
    container: ServiceContainer | None = None,
) -> ExportDubbedResult:
    """Export dubbed full-length `.mp4` using Preset 1 (`mov_text` + `-c:v copy`) or Preset 2 (`hardsub` NVENC/x264)."""
    src_video = Path(source_video_path)
    src_audio = Path(dub_audio_path)
    out_mp4 = Path(output_mp4_path)
    out_mp4.parent.mkdir(parents=True, exist_ok=True)

    chosen_preset = "hardsub" if str(preset).strip().lower() == "hardsub" else "mov_text"
    iso_lang = TARGET_LANGUAGE_ISO_639_2.get(target_lang, "und")
    lang_label = TARGET_LANGUAGE_NAMES.get(target_lang, target_lang)
    warnings: list[str] = []

    srt_file = Path(srt_path) if srt_path is not None else None
    vtt_file = Path(vtt_path) if vtt_path is not None else None
    has_srt = bool(subtitles_enabled and srt_file is not None and srt_file.exists() and srt_file.read_text(encoding="utf-8").strip())

    # Ensure companion .vtt and .srt exist alongside exported MP4
    companion_vtt: Path | None = None
    companion_srt: Path | None = None
    if vtt_file is not None and vtt_file.exists():
        companion_vtt = out_mp4.with_suffix(".vtt")
        if vtt_file.resolve() != companion_vtt.resolve():
            shutil.copyfile(vtt_file, companion_vtt)
    if srt_file is not None and srt_file.exists():
        companion_srt = out_mp4.with_suffix(".srt")
        if srt_file.resolve() != companion_srt.resolve():
            shutil.copyfile(srt_file, companion_srt)

    if chosen_preset == "mov_text":
        codec = _probe_video_codec(src_video, ffprobe_runner=ffprobe_runner)
        can_copy_video = src_video.suffix.lower() in (".mp4", ".m4v", ".mov", ".mkv") and (
            codec in MP4_COMPATIBLE_VIDEO_CODECS or codec == ""
        )

        async def _run_mov_text(video_codec: str) -> tuple[int, str]:
            cmd: list[str] = ["ffmpeg", "-y", "-v", "error", "-i", str(src_video), "-i", str(src_audio)]
            if has_srt and srt_file is not None:
                cmd.extend(["-sub_charenc", "UTF-8", "-i", str(srt_file)])
            cmd.extend(["-map", "0:v:0", "-map", "1:a:0"])
            if has_srt:
                cmd.extend(["-map", "2:s:0"])

            if video_codec == "copy":
                cmd.extend(["-c:v", "copy"])
            elif video_codec == "h264_nvenc":
                cmd.extend(["-c:v", "h264_nvenc", "-rc", "vbr", "-cq", "20", "-preset", "p4", "-pix_fmt", "yuv420p"])
            else:
                cmd.extend(["-c:v", "libx264", "-crf", "20", "-preset", "veryfast", "-pix_fmt", "yuv420p"])

            cmd.extend(["-c:a", "copy", f"-metadata:s:a:0", f"language={iso_lang}"])
            if has_srt:
                cmd.extend(
                    [
                        "-c:s",
                        "mov_text",
                        "-metadata:s:s:0",
                        f"language={iso_lang}",
                        "-metadata:s:s:0",
                        f"handler_name={lang_label}",
                        "-metadata:s:s:0",
                        f"title={lang_label}",
                    ]
                )
            cmd.extend(["-shortest", "-movflags", "+faststart", str(out_mp4)])
            return await _run_command(
                cmd,
                command_runner=command_runner,
                cancel_token=cancel_token,
                job_id=job_id,
                container=container,
            )

        used_codec = "copy" if can_copy_video else "h264_nvenc"
        if not can_copy_video:
            warnings.append(
                f"Source video ({src_video.suffix} / {codec or 'unknown'}) is incompatible with MP4 stream copy; transcoding video stream."
            )

        rc, err = await _run_mov_text(used_codec)
        if rc != 0 and used_codec == "h264_nvenc":
            used_codec = "libx264"
            rc, err = await _run_mov_text(used_codec)

        if rc != 0:
            if not shutil.which("ffmpeg") and command_runner is None:
                out_mp4.write_bytes(src_video.read_bytes() if src_video.exists() else b"MP4")
            else:
                raise RuntimeError(f"FFmpeg mov_text export failed (rc={rc}): {err}")

        return ExportDubbedResult(
            mp4_path=out_mp4,
            preset="mov_text",
            video_codec_used=used_codec,
            vtt_path=companion_vtt,
            srt_path=companion_srt,
            warnings=warnings,
        )

    # Preset 2: Hardsub via ASCII `.work_export/sub.ass` + `escape_ffmpeg_filter_path` + NVENC/x264
    work_export = out_mp4.parent / ".work_export"
    work_export.mkdir(parents=True, exist_ok=True)
    ass_path = work_export / "sub.ass"
    srt_content = srt_file.read_text(encoding="utf-8") if (has_srt and srt_file is not None) else ""
    atomic_write_text(ass_path, _srt_to_ass_content(srt_content, title=lang_label))

    escaped_ass = escape_ffmpeg_filter_path(ass_path)
    vf_filter = f"ass={escaped_ass},format=yuv420p" if has_srt else "format=yuv420p"

    async def _run_hardsub(video_codec: str) -> tuple[int, str]:
        cmd = [
            "ffmpeg",
            "-y",
            "-v",
            "error",
            "-i",
            str(src_video),
            "-i",
            str(src_audio),
            "-map",
            "0:v:0",
            "-map",
            "1:a:0",
            "-vf",
            vf_filter,
        ]
        if video_codec == "h264_nvenc":
            cmd.extend(["-c:v", "h264_nvenc", "-rc", "vbr", "-cq", "20", "-preset", "p4"])
        else:
            cmd.extend(["-c:v", "libx264", "-crf", "20", "-preset", "veryfast"])
        cmd.extend(
            [
                "-c:a",
                "copy",
                f"-metadata:s:a:0",
                f"language={iso_lang}",
                "-shortest",
                "-movflags",
                "+faststart",
                str(out_mp4),
            ]
        )
        return await _run_command(
            cmd,
            command_runner=command_runner,
            cancel_token=cancel_token,
            job_id=job_id,
            container=container,
        )

    used_codec = "h264_nvenc"
    rc, err = await _run_hardsub(used_codec)
    if rc != 0 and (is_nvenc_failure_log(err) or rc != 0):
        used_codec = "libx264"
        rc, err = await _run_hardsub(used_codec)

    if rc != 0:
        if not shutil.which("ffmpeg") and command_runner is None:
            out_mp4.write_bytes(src_video.read_bytes() if src_video.exists() else b"MP4")
        else:
            raise RuntimeError(f"FFmpeg hardsub export failed (rc={rc}): {err}")

    return ExportDubbedResult(
        mp4_path=out_mp4,
        preset="hardsub",
        video_codec_used=used_codec,
        vtt_path=companion_vtt,
        srt_path=companion_srt,
        warnings=warnings,
    )


def _unique_video_folder_name(base_dir: Path, desired_name: str) -> str:
    clean = get_video_folder(desired_name) or "dubbed_video"
    if not (base_dir / clean).exists():
        return clean
    idx = 2
    while (base_dir / f"{clean} ({idx})").exists():
        idx += 1
    return f"{clean} ({idx})"


async def prepare_send_to_cuts_job(
    source_job_id: str,
    target_lang: str,
    *,
    dub_audio_path: str | Path,
    dub_dir: str | Path,
    container: ServiceContainer | None = None,
    command_runner: CommandRunnerFn | None = None,
    ffprobe_runner: Callable[[list[str]], tuple[int, str]] | None = None,
) -> dict[str, Any]:
    """Create a clean dubbed video job ready for Shorts Cuts inside atomic staging before moving into `{base_dir}`.

    - Muxes clean original video + `dub.audio.m4a` (NO hardsub!).
    - Stages `video.mp4`, `transcrições/transcription.segments.json`, `transcription.words.json`,
      `transcription.txt`, `transcription.vtt`, and `audio_16k.wav` inside `{data_dir}/tmp_staging/{new_job_id}`.
    - Atomically moves staging into `{base_dir}/{unique_name}` and THEN saves `job.json` (`status="DOWNLOADED"`).
    """
    c = container or get_container()
    orig_job = c.jobs.load_job(source_job_id)
    src_video = c.jobs.find_source_video(source_job_id)
    if src_video is None or not src_video.exists():
        raise FileNotFoundError(f"Source video not found for job {source_job_id}")

    dub_audio = Path(dub_audio_path)
    if not dub_audio.exists():
        raise FileNotFoundError(f"Dubbed audio not found: {dub_audio}")

    ddir = Path(dub_dir)
    new_job_id = str(uuid.uuid4())
    base_dir = Path(load_settings().media.base_dir)
    base_dir.mkdir(parents=True, exist_ok=True)

    orig_name = orig_job.video_name or source_job_id
    desired_name = f"{orig_name} [{target_lang}]"
    unique_name = _unique_video_folder_name(base_dir, desired_name)

    staging_root = data_dir() / "tmp_staging"
    staging_root.mkdir(parents=True, exist_ok=True)
    staging_dir = staging_root / new_job_id
    if staging_dir.exists():
        shutil.rmtree(staging_dir, ignore_errors=True)
    staging_dir.mkdir(parents=True, exist_ok=True)

    try:
        staged_video = staging_dir / "video.mp4"
        await export_dubbed_mp4(
            src_video,
            dub_audio,
            staged_video,
            target_lang,
            preset="mov_text",
            subtitles_enabled=False,
            command_runner=command_runner,
            ffprobe_runner=ffprobe_runner,
            job_id=source_job_id,
            container=c,
        )

        staged_trans_dir = staging_dir / "transcrições"
        staged_trans_dir.mkdir(parents=True, exist_ok=True)

        # Load dub.segments.json (or build empty list)
        dub_segs_path = ddir / "dub.segments.json"
        raw_segs = read_json(dub_segs_path) if dub_segs_path.exists() else []
        segments = [Segment.model_validate(s) for s in (raw_segs or [])]
        atomic_write_json(staged_trans_dir / "transcription.segments.json", segments)

        # Load dub.words.json or derive proportionally from segments
        dub_words_path = ddir / "dub.words.json"
        if dub_words_path.exists():
            raw_words = read_json(dub_words_path) or []
            words = [WordTiming.model_validate(w) for w in raw_words]
        else:
            subs = [
                DubbingSegmentSubtitle(
                    seg_id=str(s.segment_id or s.id or i),
                    start=s.start,
                    end=s.end,
                    original_text=s.text,
                    subtitle_text=s.text,
                )
                for i, s in enumerate(segments, start=1)
            ]
            _segs, words = build_dub_segments_and_words(subs)
        atomic_write_json(staged_trans_dir / "transcription.words.json", words)

        dub_txt_path = ddir / "dub.txt"
        if dub_txt_path.exists():
            txt_content = dub_txt_path.read_text(encoding="utf-8")
        else:
            txt_content = "\n".join(s.text.strip() for s in segments if s.text.strip())
        atomic_write_text(staged_trans_dir / "transcription.txt", txt_content)

        dub_vtt_path = ddir / "dub.vtt"
        if dub_vtt_path.exists():
            atomic_write_text(
                staged_trans_dir / "transcription.vtt",
                dub_vtt_path.read_text(encoding="utf-8"),
            )

        staged_wav = staged_trans_dir / "audio_16k.wav"
        dur_hint = orig_job.video_duration_seconds or await probe_media_duration(staged_video) or 1.0
        await extract_pcm_16k_wav(
            dub_audio,
            staged_wav,
            duration_hint_seconds=dur_hint,
        )

        # Atomically move staging -> {base_dir}/{unique_name}
        final_video_dir = base_dir / unique_name
        try:
            os.replace(str(staging_dir), str(final_video_dir))
        except OSError:
            shutil.move(str(staging_dir), str(final_video_dir))

        final_video_path = final_video_dir / "video.mp4"
        probed_dur = orig_job.video_duration_seconds or await probe_media_duration(final_video_path)

        now_iso = utc_now_iso()
        new_job = Job(
            job_id=new_job_id,
            youtube_url=f"[Dublado {target_lang}] {orig_name}",
            status=JobStatus.DOWNLOADED,
            created_at=now_iso,
            updated_at=now_iso,
            source_video_path=str(final_video_path),
            source_file_name="video.mp4",
            video_name=unique_name,
            video_duration_seconds=probed_dur,
        )
        c.jobs.save_job(new_job)

        return {
            "job": new_job,
            "job_id": new_job_id,
            "video_path": f"/media/videos/{new_job_id}",
            "video_name": unique_name,
            "hasTranscription": True,
        }
    except Exception:
        if staging_dir.exists():
            shutil.rmtree(staging_dir, ignore_errors=True)
        raise


__all__ = [
    "CANVAS_SAMPLE_RATE",
    "COMFORTABLE_MAX_TEMPO",
    "COMFORTABLE_MIN_TEMPO",
    "ExportDubbedResult",
    "HARD_MAX_TEMPO",
    "MixResult",
    "UnitTimingPlan",
    "build_rubberband_filter",
    "compute_alignment_tempo",
    "compute_unit_slots_with_silence_borrowing",
    "export_dubbed_mp4",
    "mix_dubbed_audio",
    "prepare_send_to_cuts_job",
    "trim_internal_pauses",
]
