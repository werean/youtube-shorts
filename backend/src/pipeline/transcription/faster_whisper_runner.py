"""Transcribe with faster-whisper and write openai-whisper compatible JSON.

The process is local. It does not read API keys or call a hosted model.
"""

import argparse
import json
from pathlib import Path
from typing import Optional


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

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
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
