"""Standalone CLI worker executed inside `.venv-dubbing-base` for CPU speaker diarization.

Uses `sherpa-onnx` offline speaker diarization on CPU over `vocals.flac` (or WAV),
gracefully falling back to single-speaker output if ONNX weights are absent or
when `voice_mode="single"` is requested. Writes `speakers.json` atomically.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path
from typing import Any


def _emit(event: str, **payload: Any) -> None:
    line = json.dumps({"event": event, **payload}, ensure_ascii=False)
    print(line, flush=True)


def _emit_progress(percent: float, message: str) -> None:
    _emit("progress", percent=round(float(percent), 2), message=message)


def _atomic_write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, path)


def _discover_onnx_models(model_dir: Path) -> tuple[Path | None, Path | None]:
    """Locate segmentation and speaker-embedding ONNX files inside `model_dir`."""
    if not model_dir.exists():
        return None, None

    seg_candidates = [
        model_dir / "segmentation.onnx",
        model_dir / "sherpa-onnx-pyannote-segmentation-3-0" / "model.onnx",
    ]
    emb_candidates = [
        model_dir / "speaker_embedding.onnx",
        model_dir / "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx",
    ]

    seg_path = next((p for p in seg_candidates if p.is_file() and p.stat().st_size > 0), None)
    emb_path = next((p for p in emb_candidates if p.is_file() and p.stat().st_size > 0), None)

    if seg_path is None or emb_path is None:
        all_onnx = sorted(
            p for p in model_dir.rglob("*.onnx") if p.is_file() and p.stat().st_size > 0
        )
        for p in all_onnx:
            low = str(p).lower()
            if seg_path is None and ("segment" in low or "pyannote" in low):
                seg_path = p
            elif emb_path is None and (
                "embed" in low or "3dspeaker" in low or "speakernet" in low or "ecapa" in low
            ):
                emb_path = p

    return seg_path, emb_path


def _load_mono_audio(input_path: Path, target_sr: int = 16000) -> tuple[Any, int, float]:
    import numpy as np  # type: ignore
    import soundfile as sf  # type: ignore

    audio, sr = sf.read(str(input_path), dtype="float32", always_2d=True)
    mono = audio.mean(axis=1).astype(np.float32)
    duration = float(len(mono)) / float(sr) if sr > 0 else 0.0

    if sr != target_sr and len(mono) > 0 and sr > 0:
        try:
            from scipy.signal import resample_poly  # type: ignore

            g = math.gcd(int(sr), int(target_sr))
            up = int(target_sr) // g
            down = int(sr) // g
            mono = resample_poly(mono, up, down).astype(np.float32)
            sr = target_sr
        except Exception:
            ratio = float(target_sr) / float(sr)
            new_len = max(1, int(round(len(mono) * ratio)))
            x_old = np.linspace(0.0, 1.0, num=len(mono), endpoint=False)
            x_new = np.linspace(0.0, 1.0, num=new_len, endpoint=False)
            mono = np.interp(x_new, x_old, mono).astype(np.float32)
            sr = target_sr

    return mono, int(sr), round(duration, 3)


def _fallback_rms_segments(samples: Any, sr: int, duration: float) -> list[dict[str, Any]]:
    """Build simple RMS speech spans assigned to SPEAKER_00 when diarizer weights are unavailable."""
    import numpy as np  # type: ignore

    if duration <= 0.0 or len(samples) == 0:
        return []

    frame_len = max(1, int(0.05 * sr))
    n_frames = len(samples) // frame_len
    if n_frames == 0:
        return [{"start": 0.0, "end": round(duration, 3), "speaker": "SPEAKER_00"}]

    trimmed = samples[: n_frames * frame_len].reshape(n_frames, frame_len)
    rms = np.sqrt(np.mean(trimmed * trimmed, axis=1))
    peak = float(np.max(rms)) if len(rms) > 0 else 0.0
    threshold = max(1e-4, peak * 0.05)

    active = rms > threshold
    segments: list[dict[str, Any]] = []
    in_seg = False
    seg_start = 0.0
    for idx, is_act in enumerate(active):
        t = idx * 0.05
        if is_act and not in_seg:
            in_seg = True
            seg_start = t
        elif not is_act and in_seg:
            if t - seg_start >= 0.25:
                segments.append(
                    {"start": round(seg_start, 3), "end": round(t, 3), "speaker": "SPEAKER_00"}
                )
            in_seg = False
    if in_seg:
        segments.append(
            {"start": round(seg_start, 3), "end": round(duration, 3), "speaker": "SPEAKER_00"}
        )

    if not segments:
        return [{"start": 0.0, "end": round(duration, 3), "speaker": "SPEAKER_00"}]

    # Merge tiny gaps <= 0.5s
    merged: list[dict[str, Any]] = [segments[0]]
    for seg in segments[1:]:
        if seg["start"] - merged[-1]["end"] <= 0.5:
            merged[-1]["end"] = seg["end"]
        else:
            merged.append(seg)
    return merged


def run_diarization(
    *,
    input_path: Path,
    output_path: Path,
    model_dir: Path,
    voice_mode: str = "auto",
    num_speakers: int = -1,
    threshold: float = 0.5,
) -> dict[str, Any]:
    if not input_path.exists():
        raise FileNotFoundError(f"Input audio not found: {input_path}")

    _emit_progress(10.0, "Carregando áudio para diarização de locutores...")
    samples, sr, duration = _load_mono_audio(input_path, target_sr=16000)

    if voice_mode == "single":
        payload = {
            "mode": "single",
            "duration": duration,
            "speakers": ["SPEAKER_00"],
            "segments": (
                [{"start": 0.0, "end": duration, "speaker": "SPEAKER_00"}] if duration > 0 else []
            ),
        }
        _atomic_write_json(output_path, payload)
        _emit_progress(100.0, "Modo voz única configurado (SPEAKER_00).")
        return {"ok": True, "output_path": str(output_path), **payload}

    seg_model, emb_model = _discover_onnx_models(model_dir)
    if seg_model is None or emb_model is None:
        warning = "Modelos ONNX de diarização ausentes; aplicando fallback SPEAKER_00."
        _emit_progress(60.0, warning)
        segs = _fallback_rms_segments(samples, sr, duration)
        payload = {
            "mode": "fallback_single",
            "warning": warning,
            "duration": duration,
            "speakers": ["SPEAKER_00"] if segs else [],
            "segments": segs,
        }
        _atomic_write_json(output_path, payload)
        _emit_progress(100.0, "Diarização fallback concluída.")
        return {"ok": True, "output_path": str(output_path), **payload}

    try:
        import sherpa_onnx  # type: ignore

        _emit_progress(30.0, "Inicializando sherpa-onnx diarization (CPU)...")
        config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
            segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
                pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(
                    model=str(seg_model)
                )
            ),
            embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(
                model=str(emb_model),
                num_threads=min(4, os.cpu_count() or 4),
                provider="cpu",
            ),
            clustering=sherpa_onnx.FastClusteringConfig(
                num_clusters=int(num_speakers),
                threshold=float(threshold),
            ),
            min_duration_on=0.3,
            min_duration_off=0.5,
        )
        sd = sherpa_onnx.OfflineSpeakerDiarization(config)
        if getattr(sd, "sample_rate", 16000) != sr:
            samples, sr, duration = _load_mono_audio(input_path, target_sr=int(sd.sample_rate))

        _emit_progress(55.0, "Detectando locutores no áudio...")
        raw_segments = sd.process(samples).sort_by_start_time()
        segments: list[dict[str, Any]] = []
        speakers_seen: list[str] = []
        for seg in raw_segments:
            spk_label = f"SPEAKER_{int(seg.speaker):02d}"
            if spk_label not in speakers_seen:
                speakers_seen.append(spk_label)
            segments.append(
                {
                    "start": round(float(seg.start), 3),
                    "end": round(float(seg.end), 3),
                    "speaker": spk_label,
                }
            )

        if not segments and duration > 0:
            segments = _fallback_rms_segments(samples, sr, duration)
            speakers_seen = ["SPEAKER_00"]

        payload = {
            "mode": "sherpa_onnx",
            "duration": duration,
            "speakers": speakers_seen or ["SPEAKER_00"],
            "segments": segments,
        }
        _atomic_write_json(output_path, payload)
        _emit_progress(100.0, f"Diarização concluída ({len(payload['speakers'])} locutor(es)).")
        return {"ok": True, "output_path": str(output_path), **payload}
    except Exception as exc:
        warning = f"sherpa-onnx falhou ({exc}); aplicando fallback SPEAKER_00."
        _emit_progress(75.0, warning)
        segs = _fallback_rms_segments(samples, sr, duration)
        payload = {
            "mode": "fallback_single",
            "warning": warning,
            "duration": duration,
            "speakers": ["SPEAKER_00"] if segs else [],
            "segments": segs,
        }
        _atomic_write_json(output_path, payload)
        _emit_progress(100.0, "Diarização fallback concluída.")
        return {"ok": True, "output_path": str(output_path), **payload}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Standalone sherpa-onnx speaker diarization worker")
    parser.add_argument("--input", required=True, help="Path to vocals.flac or 16kHz WAV")
    parser.add_argument("--output", required=True, help="Output path for speakers.json")
    parser.add_argument("--model-dir", required=True, help="Directory holding sherpa-onnx ONNX models")
    parser.add_argument("--voice-mode", default="auto", choices=["auto", "single"])
    parser.add_argument("--num-speakers", type=int, default=-1)
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args(argv)

    try:
        result = run_diarization(
            input_path=Path(args.input),
            output_path=Path(args.output),
            model_dir=Path(args.model_dir),
            voice_mode=args.voice_mode,
            num_speakers=args.num_speakers,
            threshold=args.threshold,
        )
        _emit("result", **result)
        return 0
    except Exception as exc:
        _emit("error", ok=False, error=str(exc))
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
