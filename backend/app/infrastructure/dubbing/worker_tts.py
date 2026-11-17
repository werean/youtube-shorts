"""Standalone CLI worker executed inside `.venv-qwen3` or `.venv-chatterbox` for TTS synthesis.

Supports:
- `engine="qwen3_tts"`: `Qwen3TTSModel` (`bfloat16`, `sdpa`), pre-loading speaker reference
  audio into memory `(wav_np, sr)` via `soundfile` to avoid the Windows `sox.exe` trap,
  with `x_vector_only_mode=True` fallback when `ref_text` is empty or flagged.
- `engine="chatterbox"`: `ChatterboxMultilingualTTS` with `language_id` (`pt`, `en`, `es`).

Emits JSON progress lines (`{"event": "progress", ...}`) and writes per-unit WAV files
plus a results manifest JSON reporting actual sample rates and measured durations.
"""

from __future__ import annotations

import argparse
import gc
import json
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


def _map_qwen_language(lang: str) -> str:
    low = (lang or "").strip().lower()
    if low.startswith("pt"):
        return "Portuguese"
    if low.startswith("es"):
        return "Spanish"
    if low.startswith("en"):
        return "English"
    return "Auto"


def _map_chatterbox_language(lang: str) -> str:
    low = (lang or "").strip().lower()
    if low.startswith("pt"):
        return "pt"
    if low.startswith("es"):
        return "es"
    if low.startswith("en"):
        return "en"
    return low.split("-")[0] or "pt"


def load_reference_audio_tuple(ref_wav_path: str | Path) -> tuple[Any, int]:
    """Load reference audio into an in-memory `(mono_float32_np, sr)` tuple via `soundfile`.

    Pre-loading via `soundfile` avoids passing file paths to `qwen_tts` / `pysox`,
    preventing `sox.exe` missing-binary crashes on Windows.
    """
    import numpy as np  # type: ignore
    import soundfile as sf  # type: ignore

    data, sr = sf.read(str(ref_wav_path), dtype="float32", always_2d=True)
    mono = data.mean(axis=1).astype(np.float32)
    return mono, int(sr)


def _measure_speech_duration(audio_np: Any, sr: int) -> tuple[float, float]:
    """Return `(total_duration_seconds, active_trimmed_duration_seconds)`."""
    import numpy as np  # type: ignore

    if sr <= 0 or len(audio_np) == 0:
        return 0.0, 0.0
    total_dur = float(len(audio_np)) / float(sr)
    peak = float(np.max(np.abs(audio_np)))
    if peak <= 1e-6:
        return round(total_dur, 4), 0.0
    thresh = peak * 0.0056  # ~ -45 dB relative to peak
    idx = np.where(np.abs(audio_np) > thresh)[0]
    if len(idx) == 0:
        return round(total_dur, 4), 0.0
    trimmed_samples = int(idx[-1] - idx[0] + 1)
    trimmed_dur = float(trimmed_samples) / float(sr)
    return round(total_dur, 4), round(trimmed_dur, 4)


def _to_mono_float32(raw_audio: Any) -> Any:
    import numpy as np  # type: ignore

    if hasattr(raw_audio, "detach"):
        raw_audio = raw_audio.detach().cpu().float().numpy()
    arr = np.asarray(raw_audio, dtype=np.float32)
    if arr.ndim > 1:
        # Collapse channel dimension whether shape is (C, N) or (N, C)
        if arr.shape[0] <= 8 and arr.shape[0] < arr.shape[-1]:
            arr = arr.mean(axis=0)
        else:
            arr = arr.mean(axis=-1)
    return np.clip(arr.reshape(-1), -1.0, 1.0).astype(np.float32)


def _cleanup_gpu() -> None:
    gc.collect()
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def synthesize_manifest(manifest_path: Path, results_path: Path) -> dict[str, Any]:
    if not manifest_path.exists():
        raise FileNotFoundError(f"TTS manifest not found: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    engine = str(manifest.get("engine") or "qwen3_tts").strip().lower()
    language = str(manifest.get("language") or "pt-BR").strip()
    units = list(manifest.get("units") or [])
    requested_device = str(manifest.get("device") or "auto").strip().lower()

    import soundfile as sf  # type: ignore
    import torch  # type: ignore

    if requested_device == "cpu" or not torch.cuda.is_available():
        device = "cpu"
    else:
        device = "cuda:0" if engine == "qwen3_tts" else "cuda"

    active_units = [
        u for u in units if not u.get("passthrough_original") and str(u.get("dub_text") or "").strip()
    ]
    total_units = max(1, len(active_units))

    model: Any = None
    ref_cache: dict[str, tuple[Any, int]] = {}
    results_units: list[dict[str, Any]] = []

    try:
        if engine == "qwen3_tts":
            _emit_progress(5.0, "Carregando Qwen3-TTS-12Hz-1.7B-Base...")
            from qwen_tts import Qwen3TTSModel  # type: ignore

            repo_id = str(manifest.get("model_id") or "Qwen/Qwen3-TTS-12Hz-1.7B-Base")
            dtype = torch.bfloat16 if device.startswith("cuda") else torch.float32
            model = Qwen3TTSModel.from_pretrained(
                repo_id,
                device_map=device,
                dtype=dtype,
                attn_implementation="sdpa",
            )
            qwen_lang = _map_qwen_language(language)

            done_count = 0
            for u in units:
                uid = str(u.get("unit_id") or "")
                out_wav = Path(str(u["output_wav_path"]))
                dub_text = str(u.get("dub_text") or "").strip()
                if u.get("passthrough_original") or not dub_text:
                    results_units.append(
                        {
                            "unit_id": uid,
                            "skipped": True,
                            "passthrough_original": bool(u.get("passthrough_original")),
                        }
                    )
                    continue

                ref_path = str(u.get("ref_wav_path") or "").strip()
                ref_text = str(u.get("ref_text") or "").strip()
                x_vec_only = bool(u.get("x_vector_only_mode")) or not bool(ref_text)

                ref_audio_tuple: tuple[Any, int] | None = None
                if ref_path and Path(ref_path).exists():
                    if ref_path not in ref_cache:
                        ref_cache[ref_path] = load_reference_audio_tuple(ref_path)
                    ref_audio_tuple = ref_cache[ref_path]

                gen_kwargs: dict[str, Any] = {
                    "text": dub_text,
                    "language": qwen_lang,
                    "x_vector_only_mode": x_vec_only,
                }
                if ref_audio_tuple is not None:
                    gen_kwargs["ref_audio"] = ref_audio_tuple
                if not x_vec_only and ref_text:
                    gen_kwargs["ref_text"] = ref_text

                wavs, out_sr = model.generate_voice_clone(**gen_kwargs)
                raw_wav = wavs[0] if isinstance(wavs, (list, tuple)) else wavs
                audio_np = _to_mono_float32(raw_wav)

                out_wav.parent.mkdir(parents=True, exist_ok=True)
                sf.write(str(out_wav), audio_np, int(out_sr), subtype="PCM_16")
                total_dur, speech_dur = _measure_speech_duration(audio_np, int(out_sr))

                done_count += 1
                pct = 15.0 + (done_count / total_units) * 80.0
                _emit_progress(pct, f"Sintetizando unidade {done_count}/{total_units} (Qwen3-TTS)...")
                results_units.append(
                    {
                        "unit_id": uid,
                        "skipped": False,
                        "output_wav_path": str(out_wav),
                        "sample_rate": int(out_sr),
                        "duration_seconds": total_dur,
                        "speech_duration_seconds": speech_dur,
                    }
                )

        elif engine == "chatterbox":
            _emit_progress(5.0, "Carregando Chatterbox Multilingual TTS...")
            from chatterbox.mtl_tts import ChatterboxMultilingualTTS  # type: ignore

            chatter_device = "cuda" if device.startswith("cuda") else "cpu"
            model = ChatterboxMultilingualTTS.from_pretrained(device=chatter_device)
            lang_id = _map_chatterbox_language(language)
            out_sr = int(getattr(model, "sr", 24000))

            done_count = 0
            for u in units:
                uid = str(u.get("unit_id") or "")
                out_wav = Path(str(u["output_wav_path"]))
                dub_text = str(u.get("dub_text") or "").strip()
                if u.get("passthrough_original") or not dub_text:
                    results_units.append(
                        {
                            "unit_id": uid,
                            "skipped": True,
                            "passthrough_original": bool(u.get("passthrough_original")),
                        }
                    )
                    continue

                ref_path = str(u.get("ref_wav_path") or "").strip()
                gen_kwargs: dict[str, Any] = {"language_id": lang_id}
                if ref_path and Path(ref_path).exists():
                    gen_kwargs["audio_prompt_path"] = ref_path

                wav_tensor = model.generate(dub_text, **gen_kwargs)
                audio_np = _to_mono_float32(wav_tensor)

                out_wav.parent.mkdir(parents=True, exist_ok=True)
                sf.write(str(out_wav), audio_np, out_sr, subtype="PCM_16")
                total_dur, speech_dur = _measure_speech_duration(audio_np, out_sr)

                done_count += 1
                pct = 15.0 + (done_count / total_units) * 80.0
                _emit_progress(pct, f"Sintetizando unidade {done_count}/{total_units} (Chatterbox)...")
                results_units.append(
                    {
                        "unit_id": uid,
                        "skipped": False,
                        "output_wav_path": str(out_wav),
                        "sample_rate": out_sr,
                        "duration_seconds": total_dur,
                        "speech_duration_seconds": speech_dur,
                    }
                )
        else:
            raise ValueError(f"Unsupported dubbing TTS engine: {engine}")

        payload = {
            "ok": True,
            "engine": engine,
            "language": language,
            "device": device,
            "units": results_units,
        }
        _atomic_write_json(results_path, payload)
        _emit_progress(100.0, "Síntese de voz concluída.")
        return payload
    finally:
        if model is not None:
            del model
        _cleanup_gpu()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Standalone TTS synthesis worker")
    parser.add_argument("--manifest", required=True, help="Path to input tts_manifest.json")
    parser.add_argument("--results", required=True, help="Path to output tts_results.json")
    args = parser.parse_args(argv)

    try:
        result = synthesize_manifest(Path(args.manifest), Path(args.results))
        _emit("result", **result)
        return 0
    except Exception as exc:
        _emit("error", ok=False, error=str(exc))
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
