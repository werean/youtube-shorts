"""Optional model-based speaker diarization (whisper config key ``diarization``).

Modes (``tool_configs.whisper.diarization``):
  - ``"acoustic"`` (default, key absent): the existing ``assign_acoustic_speakers`` heuristic.
  - ``"model"``: a local diarization model through a ``DiarizationBackend``.
  - ``"off"``: every segment and word gets ``speaker = None``.

The acoustic heuristic is never used as a fallback for ``"model"`` or ``"off"``: an invented
speaker is worse than none (phase-5.md, part B).

This module imports without any third-party model library. The only library-specific code
lives in ``load_default_backend`` and is imported lazily.
"""

from __future__ import annotations

import gc
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence

from app.models.domain import Segment, WordTiming

# Free VRAM (GB) required before the model diarization loads, proving the previous model (Whisper, ~1.8 GB) was
# released: on the 12 GB reference card a still-loaded Whisper leaves roughly 8-10 GB free, so the bar sits above that.
# Initial value, tune on the owner's PC. Without a readable GPU probe (CPU-only machine: 0.0) the stage is skipped
# with a job-log warning, never run on CPU, and the speakers stay empty.
DIARIZATION_MIN_FREE_VRAM_GB = 10.5

DIARIZATION_MODE_ACOUSTIC = "acoustic"
DIARIZATION_MODE_MODEL = "model"
DIARIZATION_MODE_OFF = "off"
DIARIZATION_MODES: tuple[str, ...] = (
    DIARIZATION_MODE_ACOUSTIC,
    DIARIZATION_MODE_MODEL,
    DIARIZATION_MODE_OFF,
)

# Model id expected by load_default_backend (pyannote community pipeline). Never run in this project.
DEFAULT_PYANNOTE_MODEL_ID = "pyannote/speaker-diarization-community-1"


class DiarizationUnavailableError(RuntimeError):
    """The diarization library or model is not installed / not loadable."""


@dataclass(frozen=True)
class DiarizationTurn:
    start: float
    end: float
    speaker: str


class DiarizationBackend(Protocol):
    def diarize(self, audio_path: Path) -> list[DiarizationTurn]: ...


def resolve_diarization_mode(value: object) -> tuple[str, bool]:
    """Return ``(mode, valid)``. Absent/None -> acoustic and valid; unknown -> acoustic, invalid."""
    if value is None:
        return DIARIZATION_MODE_ACOUSTIC, True
    if isinstance(value, str) and value.strip().lower() in DIARIZATION_MODES:
        return value.strip().lower(), True
    return DIARIZATION_MODE_ACOUSTIC, False


def _overlap(a_start: float, a_end: float, b_start: float, b_end: float) -> float:
    return min(a_end, b_end) - max(a_start, b_start)


def _speaker_by_overlap(start: float, end: float, turns: Sequence[DiarizationTurn]) -> str | None:
    """Speaker of the turn with the largest positive overlap; ties go to the earliest turn."""
    best_label: str | None = None
    best_overlap = 0.0
    best_key: tuple[float, float] | None = None
    for turn in turns:
        ov = _overlap(start, end, turn.start, turn.end)
        if ov <= 0.0:
            continue
        key = (turn.start, turn.end)
        if ov > best_overlap + 1e-9 or (abs(ov - best_overlap) <= 1e-9 and best_key is not None and key < best_key):
            best_label, best_overlap, best_key = turn.speaker, ov, key
    return best_label


def assign_speakers_from_turns(
    segments: Sequence[Segment],
    words: Sequence[WordTiming],
    turns: Sequence[DiarizationTurn],
) -> tuple[list[Segment], list[WordTiming]]:
    """Pure, deterministic speaker assignment from diarization turns.

    Each word gets the speaker of the turn with the largest overlap (None without overlap).
    Each segment gets the majority speaker of its words (ties: the label whose word comes
    first), or the largest-overlap turn when it has no labelled words. Labels are normalised
    to SPEAKER_00, SPEAKER_01... in order of first appearance in time. Inputs are not mutated.
    """
    new_words = [w.model_copy() for w in words]
    new_segments = [s.model_copy() for s in segments]
    raw_word: list[str | None] = [_speaker_by_overlap(w.start, w.end, turns) for w in new_words]

    words_by_segment: dict[str, list[int]] = {}
    for idx, w in enumerate(new_words):
        if w.segment_id is not None:
            words_by_segment.setdefault(w.segment_id, []).append(idx)

    raw_segment: list[str | None] = []
    for seg in new_segments:
        idxs = sorted(words_by_segment.get(seg.segment_id or "", []), key=lambda i: (new_words[i].start, i))
        counts: dict[str, int] = {}
        order: list[str] = []
        for i in idxs:
            label = raw_word[i]
            if label is None:
                continue
            if label not in counts:
                counts[label] = 0
                order.append(label)
            counts[label] += 1
        if counts:
            top = max(counts.values())
            raw_segment.append(next(lbl for lbl in order if counts[lbl] == top))
        else:
            raw_segment.append(_speaker_by_overlap(seg.start, seg.end, turns))

    appearances: list[tuple[float, int, str]] = []
    seq = 0
    for w, label in zip(new_words, raw_word):
        if label is not None:
            appearances.append((w.start, seq, label))
        seq += 1
    for s, label in zip(new_segments, raw_segment):
        if label is not None:
            appearances.append((s.start, seq, label))
        seq += 1
    mapping: dict[str, str] = {}
    for _, _, label in sorted(appearances):
        if label not in mapping:
            mapping[label] = f"SPEAKER_{len(mapping):02d}"

    for w, label in zip(new_words, raw_word):
        w.speaker = mapping[label] if label is not None else None
    for s, label in zip(new_segments, raw_segment):
        s.speaker = mapping[label] if label is not None else None
    return new_segments, new_words


def clear_speakers(
    segments: Sequence[Segment], words: Sequence[WordTiming]
) -> tuple[list[Segment], list[WordTiming]]:
    """``"off"`` mode: every segment and word gets speaker None."""
    out_s = [s.model_copy(update={"speaker": None}) for s in segments]
    out_w = [w.model_copy(update={"speaker": None}) for w in words]
    return out_s, out_w


class _PyannoteBackend:
    def __init__(self, pipeline: object) -> None:
        self._pipeline: object | None = pipeline

    def diarize(self, audio_path: Path) -> list[DiarizationTurn]:
        if self._pipeline is None:
            raise DiarizationUnavailableError("diarization pipeline already unloaded")
        output = self._pipeline(str(audio_path))  # type: ignore[operator]
        annotation = getattr(output, "speaker_diarization", output)
        return [
            DiarizationTurn(start=float(turn.start), end=float(turn.end), speaker=str(label))
            for turn, _track, label in annotation.itertracks(yield_label=True)
        ]

    def unload(self) -> None:
        self._pipeline = None
        gc.collect()
        torch = sys.modules.get("torch")
        if torch is not None:
            try:
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
            except Exception:
                pass


def load_default_backend(*, model_id: str = DEFAULT_PYANNOTE_MODEL_ID) -> DiarizationBackend:
    """Load the pyannote community pipeline lazily.

    WARNING: this code was written blind and has NEVER been run in this project. It expects
    ``pyannote.audio>=4`` and the model id ``pyannote/speaker-diarization-community-1`` (which
    may require accepting its terms and a Hugging Face login). Raises
    ``DiarizationUnavailableError`` when the library or the model is unavailable.
    """
    try:
        from pyannote.audio import Pipeline  # noqa: WPS433 (lazy, optional dependency)
    except Exception as exc:
        raise DiarizationUnavailableError(f"pyannote.audio is not installed: {exc}") from exc
    try:
        pipeline = Pipeline.from_pretrained(model_id)
        if pipeline is None:
            raise DiarizationUnavailableError(f"model {model_id} could not be loaded")
        import torch  # noqa: WPS433

        if torch.cuda.is_available():
            pipeline.to(torch.device("cuda"))
    except DiarizationUnavailableError:
        raise
    except Exception as exc:
        raise DiarizationUnavailableError(f"diarization model {model_id} unavailable: {exc}") from exc
    return _PyannoteBackend(pipeline)
