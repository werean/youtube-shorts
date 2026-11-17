"""Standalone CLI worker executed inside `.venv-dubbing-base` for Demucs stem separation.

Outputs 16-bit FLAC stems (`vocals.flac` and `no_vocals.flac`) and emits JSON
progress lines to stdout (`{"event": "progress", "percent": ..., "message": ...}`).
"""

from __future__ import annotations

import argparse
import gc
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


def _emit(event: str, **payload: Any) -> None:
    line = json.dumps({"event": event, **payload}, ensure_ascii=False)
    print(line, flush=True)


def _emit_progress(percent: float, message: str) -> None:
    _emit("progress", percent=round(float(percent), 2), message=message)


def _prepare_input_audio(
    input_path: Path,
    work_dir: Path,
    start: float | None,
    end: float | None,
) -> Path:
    """Return path to WAV input, slicing `[start, end]` cleanly when requested."""
    if start is None and end is None:
        return input_path

    slice_path = work_dir / "_demucs_slice.wav"
    start_s = max(0.0, float(start or 0.0))
    duration_s = max(0.1, float(end) - start_s) if end is not None else None

    try:
        import soundfile as sf  # type: ignore

        info = sf.info(str(input_path))
        sr = int(info.samplerate)
        start_frame = max(0, int(round(start_s * sr)))
        stop_frame = (
            min(info.frames, int(round((start_s + duration_s) * sr)))
            if duration_s is not None
            else info.frames
        )
        frames_to_read = max(1, stop_frame - start_frame)
        data, read_sr = sf.read(
            str(input_path),
            start=start_frame,
            frames=frames_to_read,
            dtype="float32",
        )
        sf.write(str(slice_path), data, read_sr, subtype="PCM_16")
        return slice_path
    except Exception:
        cmd = ["ffmpeg", "-y", "-ss", f"{start_s:.3f}"]
        if duration_s is not None:
            cmd.extend(["-t", f"{duration_s:.3f}"])
        cmd.extend(["-i", str(input_path), "-vn", "-acodec", "pcm_s16le", str(slice_path)])
        res = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if res.returncode != 0 or not slice_path.exists():
            raise RuntimeError(f"Failed to slice input audio for Demucs: {res.stderr.strip()}")
        return slice_path


def _write_flac_16bit(src_path: Path, dst_path: Path) -> None:
    """Ensure stem file is saved as 16-bit FLAC at `dst_path`."""
    import soundfile as sf  # type: ignore

    data, sr = sf.read(str(src_path), dtype="float32")
    dst_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = dst_path.with_suffix(".tmp.flac")
    sf.write(str(tmp_path), data, int(sr), format="FLAC", subtype="PCM_16")
    os.replace(tmp_path, dst_path)


def _locate_stems(output_files: list[str], search_dir: Path) -> tuple[Path | None, Path | None]:
    """Identify vocals and instrumental/no_vocals stem paths from audio-separator output."""
    candidates: list[Path] = []
    for raw in output_files:
        p = Path(raw)
        if not p.is_absolute():
            p = search_dir / p.name
        if p.exists():
            candidates.append(p)
    if not candidates:
        candidates = sorted(
            p for p in search_dir.iterdir() if p.is_file() and p.suffix.lower() in {".flac", ".wav"}
        )

    vocals: Path | None = None
    no_vocals: Path | None = None
    for p in candidates:
        low = p.name.lower()
        if "no_vocals" in low or "instrumental" in low or "(other)" in low:
            no_vocals = p
        elif "vocals" in low or "(vocals)" in low:
            vocals = p

    if vocals is not None and no_vocals is None:
        others = [p for p in candidates if p != vocals]
        if others:
            no_vocals = others[0]
    return vocals, no_vocals


def _cleanup_gpu() -> None:
    gc.collect()
    try:
        import torch  # type: ignore

        if torch.cuda.is_available():
            torch.cuda.empty_cache()
    except Exception:
        pass


def run_separation(
    *,
    input_path: Path,
    output_dir: Path,
    model_dir: Path,
    primary_model: str = "htdemucs_ft",
    fallback_model: str = "htdemucs",
    start: float | None = None,
    end: float | None = None,
    device: str = "auto",
) -> dict[str, Any]:
    if not input_path.exists():
        raise FileNotFoundError(f"Input audio not found: {input_path}")

    output_dir.mkdir(parents=True, exist_ok=True)
    model_dir.mkdir(parents=True, exist_ok=True)

    vocals_out = output_dir / "vocals.flac"
    no_vocals_out = output_dir / "no_vocals.flac"

    with tempfile.TemporaryDirectory(prefix="demucs_work_", dir=str(output_dir)) as tmp_dir_str:
        work_dir = Path(tmp_dir_str)
        _emit_progress(5.0, "Preparando áudio para separação Demucs...")
        sep_input = _prepare_input_audio(input_path, work_dir, start, end)

        use_autocast = device != "cpu"
        try:
            import torch  # type: ignore

            if device == "auto":
                use_autocast = bool(torch.cuda.is_available())
        except Exception:
            use_autocast = False

        from audio_separator.separator import Separator  # type: ignore

        models_to_try = [primary_model]
        if fallback_model and fallback_model != primary_model:
            models_to_try.append(fallback_model)

        last_err: Exception | None = None
        used_model = primary_model
        raw_outputs: list[str] = []

        for idx, model_name in enumerate(models_to_try):
            model_filename = model_name if model_name.endswith((".yaml", ".th", ".ckpt", ".onnx")) else f"{model_name}.yaml"
            try:
                _emit_progress(
                    15.0 + idx * 10.0,
                    f"Carregando modelo Demucs ({model_name})...",
                )
                sep = Separator(
                    output_dir=str(work_dir),
                    model_file_dir=str(model_dir),
                    output_format="FLAC",
                    use_autocast=use_autocast,
                )
                sep.load_model(model_filename=model_filename)
                _emit_progress(35.0, f"Separando voz e instrumental ({model_name})...")
                raw_outputs = list(sep.separate(str(sep_input)) or [])
                used_model = model_name
                del sep
                break
            except Exception as exc:
                last_err = exc
                _cleanup_gpu()
                if idx + 1 < len(models_to_try):
                    _emit_progress(
                        25.0,
                        f"Modelo {model_name} falhou ({exc}); tentando fallback {models_to_try[idx + 1]}...",
                    )
                continue

        if not raw_outputs and last_err is not None:
            raise RuntimeError(f"Demucs separation failed: {last_err}") from last_err

        _emit_progress(80.0, "Convertendo stems para FLAC 16-bit...")
        vocals_src, no_vocals_src = _locate_stems(raw_outputs, work_dir)
        if vocals_src is None or no_vocals_src is None:
            raise RuntimeError(
                f"Demucs did not produce expected vocals/instrumental stems (got: {raw_outputs})"
            )

        _write_flac_16bit(vocals_src, vocals_out)
        _write_flac_16bit(no_vocals_src, no_vocals_out)

    _emit_progress(100.0, "Separação de stems concluída.")
    return {
        "ok": True,
        "model": used_model,
        "vocals_path": str(vocals_out),
        "no_vocals_path": str(no_vocals_out),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Standalone Demucs stem separation worker")
    parser.add_argument("--input", required=True, help="Path to source WAV/audio file")
    parser.add_argument("--output-dir", required=True, help="Directory for vocals.flac and no_vocals.flac")
    parser.add_argument("--model-dir", required=True, help="Cache directory for audio-separator models")
    parser.add_argument("--model", default="htdemucs_ft", help="Primary Demucs model name")
    parser.add_argument("--fallback-model", default="htdemucs", help="Fallback Demucs model name")
    parser.add_argument("--start", type=float, default=None, help="Optional slice start in seconds")
    parser.add_argument("--end", type=float, default=None, help="Optional slice end in seconds")
    parser.add_argument("--device", default="auto", choices=["auto", "cuda", "cpu"])
    args = parser.parse_args(argv)

    try:
        result = run_separation(
            input_path=Path(args.input),
            output_dir=Path(args.output_dir),
            model_dir=Path(args.model_dir),
            primary_model=args.model,
            fallback_model=args.fallback_model,
            start=args.start,
            end=args.end,
            device=args.device,
        )
        _emit("result", **result)
        return 0
    except Exception as exc:
        _emit("error", ok=False, error=str(exc))
        print(f"ERROR: {exc}", file=sys.stderr, flush=True)
        return 1
    finally:
        _cleanup_gpu()


if __name__ == "__main__":
    raise SystemExit(main())
