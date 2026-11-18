"""Optional diarization modes (acoustic/model/off): pure assignment + service wiring (100% mocked)."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any, Iterator

import pytest

from app.application.runtime_service import OperationCancelledError, ServiceContainer
from app.domain.transcription import (
    RawWhisperSegment,
    RawWhisperWord,
    set_custom_whisper_model_factory,
)
from app.domain.transcription.service import FasterWhisperAdapter, TranscriptionDomainService
from app.infrastructure.audio.acoustic_dsp import assign_acoustic_speakers
from app.infrastructure.audio.diarization import (
    DiarizationTurn,
    DiarizationUnavailableError,
    assign_speakers_from_turns,
    load_default_backend,
    resolve_diarization_mode,
)
from app.infrastructure.audio.pcm_extractor import write_synthetic_pcm16_wav
from app.models.domain import JobStatus, Segment, WordTiming


@pytest.fixture(autouse=True)
def _reset_whisper():
    set_custom_whisper_model_factory(None)
    yield
    set_custom_whisper_model_factory(None)


def T(s: float, e: float, spk: str) -> DiarizationTurn:
    return DiarizationTurn(start=s, end=e, speaker=spk)


def W(word: str, s: float, e: float, seg: str) -> WordTiming:
    return WordTiming(word=word, start=s, end=e, segment_id=seg)


# ---------------------------------------------------------------- pure function


def _sample() -> tuple[list[Segment], list[WordTiming]]:
    segs = [
        Segment(segment_id="s1", start=0.0, end=2.0, text="a b"),
        Segment(segment_id="s2", start=2.0, end=4.0, text="c d"),
    ]
    words = [W("a", 0.0, 1.0, "s1"), W("b", 1.0, 2.0, "s1"), W("c", 2.0, 3.0, "s2"), W("d", 3.0, 4.0, "s2")]
    return segs, words


def test_labels_normalised_in_order_of_first_appearance_and_deterministic() -> None:
    segs, words = _sample()
    turns = [T(2.0, 4.0, "zeta"), T(0.0, 2.0, "alpha")]
    s1, w1 = assign_speakers_from_turns(segs, words, turns)
    s2, w2 = assign_speakers_from_turns(segs, words, list(reversed(turns)))
    assert [s.speaker for s in s1] == ["SPEAKER_00", "SPEAKER_01"]
    assert [w.speaker for w in w1] == ["SPEAKER_00", "SPEAKER_00", "SPEAKER_01", "SPEAKER_01"]
    assert [s.model_dump() for s in s1] == [s.model_dump() for s in s2]
    assert [w.model_dump() for w in w1] == [w.model_dump() for w in w2]
    # inputs untouched
    assert all(s.speaker is None for s in segs) and all(w.speaker is None for w in words)


def test_largest_overlap_and_tie_goes_to_earliest_turn() -> None:
    segs = [Segment(segment_id="s1", start=0.0, end=2.0, text="x")]
    words = [W("x", 0.0, 2.0, "s1")]
    _, w = assign_speakers_from_turns(segs, words, [T(0.0, 0.8, "A"), T(0.8, 2.0, "B")])
    assert w[0].speaker == "SPEAKER_00"  # B wins by overlap, and is first to appear
    s, w = assign_speakers_from_turns(segs, words, [T(1.0, 2.0, "B"), T(0.0, 1.0, "A")])
    assert w[0].speaker == "SPEAKER_00"  # exact tie -> earliest turn (A); only one label exists
    assert s[0].speaker == "SPEAKER_00"


def test_words_outside_any_turn_and_empty_turns_give_none() -> None:
    segs, words = _sample()
    s, w = assign_speakers_from_turns(segs, words, [T(0.0, 2.0, "A")])
    assert [x.speaker for x in w] == ["SPEAKER_00", "SPEAKER_00", None, None]
    assert s[1].speaker is None
    s, w = assign_speakers_from_turns(segs, words, [])
    assert all(x.speaker is None for x in s) and all(x.speaker is None for x in w)


def test_single_speaker_yields_exactly_one_label() -> None:
    segs, words = _sample()
    s, w = assign_speakers_from_turns(segs, words, [T(0.0, 1.5, "X"), T(1.5, 4.0, "X")])
    assert {x.speaker for x in s} | {x.speaker for x in w} == {"SPEAKER_00"}


def test_segment_majority_and_segment_without_words_uses_overlap() -> None:
    segs = [
        Segment(segment_id="s1", start=0.0, end=3.0, text="a b c"),
        Segment(segment_id="s2", start=3.0, end=5.0, text="no words"),
    ]
    words = [W("a", 0.0, 1.0, "s1"), W("b", 1.0, 2.0, "s1"), W("c", 2.0, 3.0, "s1")]
    turns = [T(0.0, 1.0, "A"), T(1.0, 3.0, "B"), T(3.0, 5.0, "A")]
    s, w = assign_speakers_from_turns(segs, words, turns)
    assert [x.speaker for x in w] == ["SPEAKER_00", "SPEAKER_01", "SPEAKER_01"]
    assert s[0].speaker == "SPEAKER_01"  # 2 of 3 words
    assert s[1].speaker == "SPEAKER_00"  # by overlap with turn A


def test_resolve_mode() -> None:
    assert resolve_diarization_mode(None) == ("acoustic", True)
    assert resolve_diarization_mode("Model") == ("model", True)
    assert resolve_diarization_mode("off") == ("off", True)
    assert resolve_diarization_mode("pyannote") == ("acoustic", False)


def test_module_imports_without_pyannote() -> None:
    code = (
        "import sys; sys.modules['pyannote']=None; sys.modules['pyannote.audio']=None;"
        "import app.infrastructure.audio.diarization as d, app.domain.transcription.service;"
        "assert 'pyannote.audio' not in [k for k,v in sys.modules.items() if v is not None];"
        "\ntry:\n d.load_default_backend()\nexcept d.DiarizationUnavailableError: print('ok')"
    )
    out = subprocess.run(
        [sys.executable, "-c", code], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True
    )
    assert out.returncode == 0, out.stderr
    assert out.stdout.strip() == "ok"


def test_load_default_backend_raises_clear_error_when_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "pyannote.audio", None)
    with pytest.raises(DiarizationUnavailableError):
        load_default_backend()


# ---------------------------------------------------------------- service wiring


class _FakeWhisperModel:
    def __init__(self, model_name: str, **kwargs: Any) -> None:
        pass

    def transcribe(self, audio_path: str, **kwargs: Any) -> tuple[Iterator[Any], dict[str, Any]]:
        def seg(s: float, e: float, text: str) -> RawWhisperSegment:
            ws = text.split()
            step = (e - s) / len(ws)
            return RawWhisperSegment(
                start=s,
                end=e,
                text=text,
                no_speech_prob=0.01,
                avg_logprob=-0.1,
                compression_ratio=1.2,
                words=[
                    RawWhisperWord(word=w, start=s + i * step, end=s + (i + 1) * step, probability=0.9)
                    for i, w in enumerate(ws)
                ],
            )

        return iter([seg(0.0, 4.0, "primeira fala aqui hoje"), seg(4.0, 8.0, "segunda fala outra pessoa")]), {
            "duration": 8.0
        }


class FakeBackend:
    def __init__(self, turns: list[DiarizationTurn] | None = None, error: Exception | None = None) -> None:
        self.turns = turns or []
        self.error = error
        self.calls = 0
        self.unloaded = 0
        self.slot_held_during_call: bool | None = None
        self.container: ServiceContainer | None = None
        self.on_diarize: Any = None

    def diarize(self, audio_path: Path) -> list[DiarizationTurn]:
        self.calls += 1
        if self.container is not None:
            self.slot_held_during_call = self.container.scheduler.gpu_mutex.locked
        if self.on_diarize:
            self.on_diarize()
        if self.error:
            raise self.error
        return self.turns

    def unload(self) -> None:
        self.unloaded += 1


def _job(container: ServiceContainer) -> str:
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=diar",
        status=JobStatus.DOWNLOADED,
        video_name="Diar",
        video_duration_seconds=8.0,
    )
    vp = container.jobs.video_dir_path(job.job_id) / "video.mp4"
    vp.parent.mkdir(parents=True, exist_ok=True)
    vp.write_bytes(b"x")
    container.jobs.update_job(job.job_id, {"source_video_path": str(vp)})
    container.jobs.set_cached_source_video(job.job_id, vp)
    write_synthetic_pcm16_wav(container.jobs.audio_16k_path(job.job_id), sample_rate=16000, duration_seconds=8.0)
    container.scheduler.vram_manager._vram_probe = lambda: 11.0
    return job.job_id


async def _run(container: ServiceContainer, mode: str | None, backend: FakeBackend | None = None) -> tuple[str, Any]:
    if mode is not None:
        container.update_tool_configs({"whisper": {"diarization": mode}})
    job_id = _job(container)
    if backend is not None:
        backend.container = container
    svc = TranscriptionDomainService(
        container=container,
        whisper_adapter=FasterWhisperAdapter(model_factory=_FakeWhisperModel),
        diarization_backend=backend,
    )
    resp = await svc.transcribe_job(job_id)
    return job_id, resp


def _words(container: ServiceContainer, job_id: str) -> list[WordTiming]:
    return container.jobs.load_transcription_words(job_id)


def _log(container: ServiceContainer, job_id: str) -> str:
    return "\n".join(str(x) for x in container.runtime.get_task_logs(job_id, "transcription"))


TURNS = [T(0.0, 4.0, "p"), T(4.0, 8.0, "q")]


@pytest.mark.asyncio
async def test_default_absent_key_identical_to_acoustic_path(container: ServiceContainer) -> None:
    jid, resp = await _run(container, None)
    seg_bytes = container.jobs.transcription_segments_path(jid).read_bytes()
    word_bytes = container.jobs.transcription_words_path(jid).read_bytes()
    assert "diarization" not in _log(container, jid).lower().replace("diarization.", "")

    # Same bytes as the pre-change computation: acoustic heuristic on the preliminary segments.
    prelim = [Segment(segment_id=s.segment_id, start=s.start, end=s.end, text=s.text) for s in resp.segments]
    expected = assign_acoustic_speakers(prelim, audio_path=container.jobs.audio_16k_path(jid))
    assert [s.speaker for s in resp.segments] == [s.speaker for s in expected]
    assert all(w.speaker == next(s.speaker for s in expected if s.segment_id == w.segment_id) for w in _words(container, jid))

    # Explicit "acoustic" is byte-identical to the absent key.
    jid2, _ = await _run(container, "acoustic")
    assert container.jobs.transcription_segments_path(jid2).read_bytes() == seg_bytes
    assert container.jobs.transcription_words_path(jid2).read_bytes() == word_bytes


@pytest.mark.asyncio
async def test_off_gives_none_everywhere(container: ServiceContainer) -> None:
    backend = FakeBackend(TURNS)
    jid, resp = await _run(container, "off", backend)
    assert all(s.speaker is None for s in resp.segments)
    assert all(w.speaker is None for w in _words(container, jid))
    assert backend.calls == 0
    assert container.scheduler.gpu_mutex.locked is False


@pytest.mark.asyncio
async def test_model_mode_assigns_from_turns_under_gpu_slot(container: ServiceContainer) -> None:
    backend = FakeBackend(TURNS)
    jid, resp = await _run(container, "model", backend)
    assert [s.speaker for s in resp.segments] == ["SPEAKER_00", "SPEAKER_01"]
    words = _words(container, jid)
    assert {w.speaker for w in words[:4]} == {"SPEAKER_00"} and {w.speaker for w in words[4:]} == {"SPEAKER_01"}
    persisted = container.jobs.load_transcription_segments(jid)
    assert [s.speaker for s in persisted] == ["SPEAKER_00", "SPEAKER_01"]
    assert backend.slot_held_during_call is True
    assert backend.unloaded == 1
    assert container.scheduler.gpu_mutex.locked is False


@pytest.mark.asyncio
async def test_model_failure_degrades_to_none_with_warning(container: ServiceContainer) -> None:
    backend = FakeBackend(error=RuntimeError("boom"))
    jid, resp = await _run(container, "model", backend)
    assert all(s.speaker is None for s in resp.segments)  # never the acoustic heuristic
    assert all(w.speaker is None for w in _words(container, jid))
    assert "Model diarization skipped" in _log(container, jid)
    assert backend.unloaded == 1
    assert container.scheduler.gpu_mutex.locked is False


@pytest.mark.asyncio
async def test_model_unavailable_library_degrades(container: ServiceContainer, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(sys.modules, "pyannote.audio", None)
    jid, resp = await _run(container, "model", None)
    assert all(s.speaker is None for s in resp.segments)
    assert "Model diarization skipped" in _log(container, jid)
    assert container.scheduler.gpu_mutex.locked is False


@pytest.mark.asyncio
async def test_vram_not_released_skips_stage(container: ServiceContainer) -> None:
    backend = FakeBackend(TURNS)
    container.update_tool_configs({"whisper": {"diarization": "model"}})
    job_id = _job(container)
    container.scheduler.vram_manager._vram_probe = lambda: 11.0
    svc = TranscriptionDomainService(
        container=container,
        whisper_adapter=FasterWhisperAdapter(model_factory=_FakeWhisperModel),
        diarization_backend=backend,
    )
    calls = {"n": 0}

    def probe() -> float:
        calls["n"] += 1
        return 11.0 if calls["n"] == 1 else 0.5  # whisper slot ok, diarization check low

    container.scheduler.vram_manager._vram_probe = probe
    resp = await svc.transcribe_job(job_id)
    assert backend.calls == 0
    assert all(s.speaker is None for s in resp.segments)
    assert "VRAM not released" in _log(container, job_id)
    assert container.scheduler.gpu_mutex.locked is False


@pytest.mark.asyncio
async def test_vram_that_a_still_loaded_whisper_would_leave_skips_stage(container: ServiceContainer) -> None:
    backend = FakeBackend(TURNS)
    container.update_tool_configs({"whisper": {"diarization": "model"}})
    job_id = _job(container)
    # 9 GB free passes the old Whisper-sized bar (2.2 GB) but is what a card with Whisper still loaded shows.
    container.scheduler.vram_manager._vram_probe = lambda: 9.0
    svc = TranscriptionDomainService(
        container=container,
        whisper_adapter=FasterWhisperAdapter(model_factory=_FakeWhisperModel),
        diarization_backend=backend,
    )
    resp = await svc.transcribe_job(job_id)
    assert backend.calls == 0
    assert all(s.speaker is None for s in resp.segments)
    assert "VRAM not released" in _log(container, job_id)


@pytest.mark.asyncio
async def test_cancel_between_whisper_and_diarization(container: ServiceContainer) -> None:
    backend = FakeBackend(TURNS)
    container.update_tool_configs({"whisper": {"diarization": "model"}})
    job_id = _job(container)

    class CancellingAdapter(FasterWhisperAdapter):
        async def transcribe(self, *a: Any, **kw: Any):
            out = await super().transcribe(*a, **kw)
            container.runtime.request_cancel(job_id, task="transcription")
            return out

    svc = TranscriptionDomainService(
        container=container,
        whisper_adapter=CancellingAdapter(model_factory=_FakeWhisperModel),
        diarization_backend=backend,
    )
    with pytest.raises(OperationCancelledError):
        await svc.transcribe_job(job_id)
    assert backend.calls == 0
    assert container.jobs.load_job(job_id).status == JobStatus.DOWNLOADED
    assert container.scheduler.gpu_mutex.locked is False


@pytest.mark.asyncio
async def test_cancel_during_diarization_releases_slot_and_unloads(container: ServiceContainer) -> None:
    backend = FakeBackend(TURNS)
    container.update_tool_configs({"whisper": {"diarization": "model"}})
    job_id = _job(container)
    backend.on_diarize = lambda: container.runtime.request_cancel(job_id, task="transcription")
    backend.container = container
    svc = TranscriptionDomainService(
        container=container,
        whisper_adapter=FasterWhisperAdapter(model_factory=_FakeWhisperModel),
        diarization_backend=backend,
    )
    with pytest.raises(OperationCancelledError):
        await svc.transcribe_job(job_id)
    assert backend.unloaded == 1
    assert container.scheduler.gpu_mutex.locked is False


def test_whisper_diarization_key_survives_tool_config_normalisation() -> None:
    from app.core import tool_configs

    assert tool_configs.normalize_whisper_config({"diarization": "off"})["diarization"] == "off"
    assert "diarization" not in tool_configs.normalize_whisper_config({})
