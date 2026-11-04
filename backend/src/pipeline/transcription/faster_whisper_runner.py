"""Transcribe with faster-whisper and write openai-whisper compatible JSON.

The process is local. It does not read API keys or call a hosted model.
"""

import argparse
import json
import os
from pathlib import Path
from typing import List, Optional

FASTER_WHISPER_REPOS = {
    "large-v3": "Systran/faster-whisper-large-v3",
    "large": "Systran/faster-whisper-large-v3",
    "turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
    "large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
}


def repo_id(model_name: str) -> str:
    if model_name in FASTER_WHISPER_REPOS:
        return FASTER_WHISPER_REPOS[model_name]
    if "/" in model_name:
        return model_name
    return f"Systran/faster-whisper-{model_name}"


def cache_roots() -> List[str]:
    roots: List[str] = []
    hub_cache = os.environ.get("HUGGINGFACE_HUB_CACHE")
    if hub_cache:
        roots.append(hub_cache)
    hf_home = os.environ.get("HF_HOME")
    if hf_home:
        roots.append(os.path.join(hf_home, "hub"))
    roots.append(os.path.join(os.path.expanduser("~"), ".cache", "huggingface", "hub"))
    return roots


def weights_cached(model_name: str) -> bool:
    """True when a snapshot of this model is already in the local Hugging Face cache."""
    if not model_name:
        return False
    if os.path.isdir(model_name) or os.path.isfile(model_name):
        return True
    folder = "models--" + repo_id(model_name).replace("/", "--")
    for root in cache_roots():
        snapshots = os.path.join(root, folder, "snapshots")
        try:
            if os.path.isdir(snapshots) and any(os.scandir(snapshots)):
                return True
        except OSError:
            continue
    return False


def parse_bool(value: Optional[str]) -> Optional[bool]:
    if value is None:
        return None
    return value.strip().lower() in {"1", "true", "yes"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("audio")
    parser.add_argument("--model", default="large-v3")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--compute_type", default="float16")
    parser.add_argument("--output_dir", required=True)
    parser.add_argument("--beam_size", type=int, default=5)
    parser.add_argument("--language", default=None)
    parser.add_argument("--task", default="transcribe")
    parser.add_argument("--initial_prompt", default=None)
    parser.add_argument("--temperature", type=float, default=0.0)
    parser.add_argument("--condition_on_previous_text", default=None)
    parser.add_argument("--word_timestamps", default=None)
    args = parser.parse_args()

    from faster_whisper import WhisperModel

    if not weights_cached(args.model):
        print(
            f"[faster-whisper] {args.model} is not cached; downloading weights on {args.device}",
            flush=True,
        )
    # local_files_only stays false so the first run fetches large-v3 (or the
    # configured model) into the Hugging Face cache. device is cuda unless the
    # caller already fell back to cpu.
    model = WhisperModel(
        args.model,
        device=args.device,
        compute_type=args.compute_type,
        local_files_only=False,
    )
    kwargs = {
        "beam_size": args.beam_size,
        "task": args.task or "transcribe",
        "temperature": args.temperature,
        "vad_filter": False,
    }
    if args.language:
        kwargs["language"] = args.language
    if args.initial_prompt:
        kwargs["initial_prompt"] = args.initial_prompt
    condition = parse_bool(args.condition_on_previous_text)
    if condition is not None:
        kwargs["condition_on_previous_text"] = condition
    word_timestamps = parse_bool(args.word_timestamps)
    if word_timestamps is not None:
        kwargs["word_timestamps"] = word_timestamps

    segments, _info = model.transcribe(args.audio, **kwargs)
    payload = {
        "segments": [
            {"start": segment.start, "end": segment.end, "text": segment.text}
            for segment in segments
        ]
    }
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{Path(args.audio).stem}.json"
    output_path.write_text(json.dumps(payload), encoding="utf-8")


if __name__ == "__main__":
    main()
