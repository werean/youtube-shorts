"""Phase 3 Logical Tests: GPU `faster-whisper` adapter, `ActiveVRAMBudgetManager` fallback, `<500ms` cooperative cancel, anti-hallucination filter, 10ms RMS + zero-crossing snap, 5-min chunked speaker diarization, and format deletion (100% mocked, zero hardware)."""

from __future__ import annotations

import asyncio
import time
from pathlib import Path
from typing import Any, Iterator

import httpx
import numpy as np
import pytest

from app.application.runtime_service import ServiceContainer
from app.domain.transcription import (
    RawWhisperSegment,
    RawWhisperWord,
    is_hallucinated_segment,
    set_custom_whisper_model_factory,
)
from app.infrastructure.audio.acoustic_dsp import (
    assign_acoustic_speakers,
    compute_rms_energy_10ms,
    compute_rms_energy_from_wav,
    snap_cut_boundaries_acoustic,
)
from app.infrastructure.audio.pcm_extractor import write_synthetic_pcm16_wav
from app.models.domain import JobStatus, Segment


@pytest.fixture(autouse=True)
def reset_whisper_mocks():
    set_custom_whisper_model_factory(None)
    yield
    set_custom_whisper_model_factory(None)


def _create_downloaded_job_with_synthetic_audio(
    container: ServiceContainer,
    *,
    duration_sec: float = 12.0,
    samples: np.ndarray | None = None,
) -> str:
    job = container.jobs.create_job(
        "https://www.youtube.com/watch?v=phase3_test",
        status=JobStatus.DOWNLOADED,
        video_name="Entrevista_Renda_Fixa",
        video_duration_seconds=duration_sec,
    )
    video_path = container.jobs.video_dir_path(job.job_id) / "video.mp4"
    video_path.parent.mkdir(parents=True, exist_ok=True)
    video_path.write_bytes(b"synthetic_mp4_bytes")
    container.jobs.update_job(job.job_id, {"source_video_path": str(video_path)})
    container.jobs.set_cached_source_video(job.job_id, video_path)

    wav_path = container.jobs.audio_16k_path(job.job_id)
    write_synthetic_pcm16_wav(
        wav_path,
        samples=samples,
        sample_rate=16000,
        duration_seconds=duration_sec,
    )
    return job.job_id


def test_acoustic_dsp_rms_10ms_and_zero_crossing_snap(tmp_path: Path) -> None:
    sr = 16000
    duration_sec = 4.0
    total_samples = int(sr * duration_sec)
    t = np.arange(total_samples, dtype=np.float32) / float(sr)

    # Continuous 200 Hz sine wave with a quiet breathing valley at [0.80s, 0.90s] and [3.15s, 3.25s]
    envelope = np.ones_like(t) * 0.6
    envelope[(t >= 0.80) & (t <= 0.90)] = 0.005  # Start breathing valley around 0.85s
    envelope[(t >= 3.15) & (t <= 3.25)] = 0.002  # End breathing valley around 3.20s
    waveform = envelope * np.sin(2.0 * np.pi * 200.0 * t)

    wav_file = tmp_path / "speech_valley.wav"
    write_synthetic_pcm16_wav(wav_file, waveform, sample_rate=sr)

    rms_direct = compute_rms_energy_10ms(waveform, sample_rate=sr)
    assert rms_direct.shape[0] == 400  # 4.0s * 100 windows/sec

    rms_chunked, sr_out = compute_rms_energy_from_wav(wav_file, chunk_duration_sec=1.5)
    assert sr_out == sr
    assert rms_chunked.shape[0] == 400
    np.testing.assert_allclose(rms_direct, rms_chunked, atol=1e-3)

    # Candidate cut starts at 1.05s (search window [0.70s, 1.10s] -> valley at ~0.85s)
    # and ends at 2.95s (search window [2.90s, 3.40s] -> valley at ~3.20s)
    snapped_start, snapped_end = snap_cut_boundaries_acoustic(
        1.05,
        2.95,
        rms_10ms=rms_chunked,
        samples=waveform,
        sample_rate=sr,
    )
    assert 0.79 <= snapped_start <= 0.91
    assert 3.14 <= snapped_end <= 3.26

    # Verify zero-crossing alignment (amplitude near zero at snapped index)
    idx_start = int(round(snapped_start * sr))
    idx_end = int(round(snapped_end * sr))
    assert abs(float(waveform[idx_start])) < 0.01
    assert abs(float(waveform[idx_end])) < 0.01


def test_chunked_speaker_diarization_detects_speaker_shifts() -> None:
    sr = 16000
    # Build 9 seconds of synthetic 2-speaker conversation:
    # [0..3s]: Speaker A (low pitch 110Hz + low formants)
    # [3..6s]: Speaker B (high pitch 260Hz + high harmonics)
    # [6..9s]: Speaker A returns (low pitch 110Hz)
    t_3s = np.arange(sr * 3, dtype=np.float32) / float(sr)
    voice_a = (
        0.5 * np.sin(2.0 * np.pi * 110.0 * t_3s)
        + 0.25 * np.sin(2.0 * np.pi * 220.0 * t_3s)
        + 0.1 * np.sin(2.0 * np.pi * 440.0 * t_3s)
    )
    voice_b = (
        0.4 * np.sin(2.0 * np.pi * 260.0 * t_3s)
        + 0.35 * np.sin(2.0 * np.pi * 1820.0 * t_3s)
        + 0.25 * np.sin(2.0 * np.pi * 3120.0 * t_3s)
    )
    full_audio = np.concatenate([voice_a, voice_b, voice_a], axis=0)

    segments = [
        Segment(segment_id="s1", start=0.2, end=2.8, text="Qual é o maior erro ao investir hoje?"),
        Segment(segment_id="s2", start=3.3, end=5.8, text="O maior erro é ignorar a inflação real."),
        Segment(segment_id="s3", start=6.3, end=8.8, text="Perfeito, isso explica muita coisa."),
    ]

    diarized = assign_acoustic_speakers(
        segments,
        samples=full_audio,
        sample_rate=sr,
        chunk_duration_sec=4.0,  # Force multiple chunks across the 9s audio
    )
    assert len(diarized) == 3
    assert diarized[0].speaker == "SPEAKER_00"
    assert diarized[1].speaker == "SPEAKER_01"
    assert diarized[2].speaker == "SPEAKER_00"


def test_anti_hallucination_filter_rules() -> None:
    # 1. Valid speech segment -> kept
    valid_seg = RawWhisperSegment(
        start=0.5,
        end=4.2,
        text="Muita gente acha que investir em renda fixa é perder dinheiro.",
        no_speech_prob=0.05,
        avg_logprob=-0.22,
        compression_ratio=1.35,
    )
    assert is_hallucinated_segment(valid_seg) is False

    # 2. High no_speech_prob (>0.65) + low avg_logprob (<-1.0) -> discarded
    music_hallucination = RawWhisperSegment(
        start=4.5,
        end=8.0,
        text="Texto fantasma gerado sobre vinheta musical",
        no_speech_prob=0.78,
        avg_logprob=-1.35,
        compression_ratio=1.2,
    )
    assert is_hallucinated_segment(music_hallucination) is True

    # 3. High compression_ratio (>2.4) -> discarded
    loop_seg = RawWhisperSegment(
        start=8.0,
        end=14.0,
        text="sim sim sim sim sim sim sim sim sim sim",
        no_speech_prob=0.1,
        avg_logprob=-0.4,
        compression_ratio=2.85,
    )
    assert is_hallucinated_segment(loop_seg) is True

    # 4. Amara.org & isolated silence signature -> discarded
    amara_seg = RawWhisperSegment(
        start=15.0,
        end=18.0,
        text="Legendas pela comunidade Amara.org",
        no_speech_prob=0.15,
        avg_logprob=-0.3,
        compression_ratio=1.1,
    )
    assert is_hallucinated_segment(amara_seg) is True

    thanks_seg = RawWhisperSegment(
        start=18.0,
        end=20.0,
        text="Obrigado por assistir.",
        no_speech_prob=0.45,
        avg_logprob=-0.5,
        compression_ratio=1.0,
    )
    assert is_hallucinated_segment(thanks_seg) is True


@pytest.mark.asyncio
async def test_transcribe_vram_budget_fallback_and_artifact_generation(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    job_id = _create_downloaded_job_with_synthetic_audio(container, duration_sec=15.0)

    # Simulate low VRAM (<2.2 GB) even after unloading idle Ollama models -> transparent CPU int8 fallback
    container.scheduler.vram_manager._vram_probe = lambda: 1.4
    unloaded_calls: list[str] = []

    async def _fake_ollama_unloader() -> list[str]:
        unloaded_calls.append("qwen2.5:14b")
        return ["qwen2.5:14b"]

    container.scheduler.vram_manager._ollama_unloader = _fake_ollama_unloader
    container.scheduler.vram_manager._lms_unloader = lambda: False

    recorded_init_kwargs: list[dict[str, Any]] = []
    recorded_transcribe_kwargs: list[dict[str, Any]] = []

    class FakeWhisperModel:
        def __init__(self, model_name: str, **kwargs: Any) -> None:
            recorded_init_kwargs.append({"model_name": model_name, **kwargs})

        def transcribe(self, audio_path: str, **kwargs: Any) -> tuple[Iterator[Any], dict[str, Any]]:
            recorded_transcribe_kwargs.append({"audio_path": audio_path, **kwargs})
            segs = [
                RawWhisperSegment(
                    start=0.42,
                    end=4.18,
                    text="Muita gente acha que investir em renda fixa é perder dinheiro.",
                    no_speech_prob=0.02,
                    avg_logprob=-0.18,
                    compression_ratio=1.2,
                    words=[
                        RawWhisperWord(word="Muita", start=0.42, end=0.80, probability=0.98),
                        RawWhisperWord(word="gente", start=0.81, end=1.20, probability=0.99),
                    ],
                ),
                # Hallucinated segment that must be filtered out
                RawWhisperSegment(
                    start=4.50,
                    end=6.00,
                    text="Legendas pela comunidade Amara.org",
                    no_speech_prob=0.80,
                    avg_logprob=-1.20,
                    compression_ratio=1.1,
                ),
                RawWhisperSegment(
                    start=6.10,
                    end=11.50,
                    text="Mas deixa eu te mostrar a conta real descontando a inflação.",
                    no_speech_prob=0.04,
                    avg_logprob=-0.20,
                    compression_ratio=1.3,
                ),
            ]
            return iter(segs), {"duration": 15.0}

    set_custom_whisper_model_factory(FakeWhisperModel)

    resp = await async_client.post(f"/jobs/{job_id}/transcribe")
    assert resp.status_code == 200
    data = resp.json()

    # Check VRAM negotiation + fallback to CPU int8 + explicit cleanup in finally:
    assert unloaded_calls == ["qwen2.5:14b"]
    assert len(recorded_init_kwargs) == 1
    assert recorded_init_kwargs[0]["device"] == "cpu"
    assert recorded_init_kwargs[0]["compute_type"] == "int8"
    assert recorded_init_kwargs[0]["cpu_threads"] == 8
    assert container.scheduler.vram_manager.cleanup_count >= 1
    assert container.scheduler.gpu_mutex.locked is False

    # Check Silero VAD and word_timestamps flags passed to faster-whisper
    assert recorded_transcribe_kwargs[0]["vad_filter"] is True
    assert recorded_transcribe_kwargs[0]["word_timestamps"] is True
    assert recorded_transcribe_kwargs[0]["vad_parameters"]["min_silence_duration_ms"] == 400

    # Check anti-hallucination filtered out the Amara.org segment (2 valid segments remain)
    assert data["segments_count"] == 2
    assert len(data["segments"]) == 2
    assert data["segments"][0]["segment_id"] == "s1"
    assert data["segments"][1]["segment_id"] == "s2"
    assert "Amara.org" not in data["transcription"]
    assert data["available_formats"] == {"segments": True, "text": True, "vtt": True}
    assert data["status"] == "BUILDING_BLOCKS"

    # Check all 4 files persisted in {video_dir}/transcrições/
    assert container.jobs.transcription_segments_path(job_id).exists()
    assert container.jobs.transcription_words_path(job_id).exists()
    assert container.jobs.transcription_text_path(job_id).exists()
    assert container.jobs.transcription_vtt_path(job_id).exists()

    words = container.jobs.load_transcription_words(job_id)
    assert len(words) >= 3
    assert words[0].word == "Muita"
    assert words[0].segment_id == "s1"
    assert words[0].speaker == "SPEAKER_00"


@pytest.mark.asyncio
async def test_cooperative_cancellation_under_500ms(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    job_id = _create_downloaded_job_with_synthetic_audio(container, duration_sec=60.0)
    container.scheduler.vram_manager._vram_probe = lambda: 8.5

    generator_closed = False
    first_segment_emitted = asyncio.Event()
    loop = asyncio.get_running_loop()

    class SlowFakeWhisperModel:
        def __init__(self, model_name: str, **kwargs: Any) -> None:
            pass

        def transcribe(self, audio_path: str, **kwargs: Any) -> tuple[Iterator[Any], dict[str, Any]]:
            def _lazy_gen() -> Iterator[RawWhisperSegment]:
                nonlocal generator_closed
                try:
                    for idx in range(50):
                        if idx == 0:
                            loop.call_soon_threadsafe(first_segment_emitted.set)
                        time.sleep(0.03)
                        yield RawWhisperSegment(
                            start=float(idx),
                            end=float(idx + 1),
                            text=f"Segmento de teste número {idx + 1}",
                        )
                finally:
                    generator_closed = True

            return _lazy_gen(), {"duration": 60.0}

    set_custom_whisper_model_factory(SlowFakeWhisperModel)

    transcribe_task = asyncio.create_task(async_client.post(f"/jobs/{job_id}/transcribe"))
    await asyncio.wait_for(first_segment_emitted.wait(), timeout=2.0)

    t0 = time.perf_counter()
    cancel_resp = await async_client.post(f"/jobs/{job_id}/transcribe/cancel")
    assert cancel_resp.status_code == 200
    assert cancel_resp.json() == {"ok": True, "job_id": job_id}

    transcribe_resp = await asyncio.wait_for(transcribe_task, timeout=1.0)
    elapsed_ms = (time.perf_counter() - t0) * 1000.0

    assert elapsed_ms < 500.0
    assert transcribe_resp.status_code == 409
    assert generator_closed is True
    assert container.scheduler.gpu_mutex.locked is False
    assert container.jobs.load_job(job_id).status == "DOWNLOADED"

    # Calling cancel when not running returns 404
    not_running = await async_client.post(f"/jobs/{job_id}/transcribe/cancel")
    assert not_running.status_code == 404
    assert not_running.json()["detail"] == "Transcription not running"


@pytest.mark.asyncio
async def test_get_and_delete_transcription_formats_and_aliases(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
) -> None:
    job_id = _create_downloaded_job_with_synthetic_audio(container, duration_sec=10.0)
    container.scheduler.vram_manager._vram_probe = lambda: 6.0

    class QuickWhisperModel:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            pass

        def transcribe(self, *args: Any, **kwargs: Any) -> tuple[Iterator[Any], dict[str, Any]]:
            return (
                iter(
                    [
                        RawWhisperSegment(
                            start=0.0,
                            end=3.5,
                            text="Primeiro bloco de fala para teste de formatos.",
                        )
                    ]
                ),
                {"duration": 10.0},
            )

    set_custom_whisper_model_factory(QuickWhisperModel)
    await async_client.post(f"/jobs/{job_id}/transcribe")
    assert container.jobs.load_job(job_id).status == "BUILDING_BLOCKS"

    # GET /jobs/:id/transcription
    get_resp = await async_client.get(f"/jobs/{job_id}/transcription")
    assert get_resp.status_code == 200
    assert get_resp.json()["available_formats"] == {"segments": True, "text": True, "vtt": True}

    # Invalid format returns 400
    bad_fmt = await async_client.delete(f"/jobs/{job_id}/transcription/docx")
    assert bad_fmt.status_code == 400
    assert bad_fmt.json()["detail"] == "Invalid format"

    # Delete alias `txt` -> removes text only, keeps segments & vtt, status remains BUILDING_BLOCKS
    del_txt = await async_client.delete(f"/jobs/{job_id}/transcription/txt")
    assert del_txt.status_code == 200
    assert del_txt.json()["available_formats"] == {"segments": True, "text": False, "vtt": True}
    assert container.jobs.load_job(job_id).status == "BUILDING_BLOCKS"

    # Deleting `text` again when already deleted returns 404
    del_txt_again = await async_client.delete(f"/jobs/{job_id}/transcription/text")
    assert del_txt_again.status_code == 404

    # Delete alias `json` (or `segments`) -> removes segments & words and resets job.status = DOWNLOADED
    del_json = await async_client.delete(f"/jobs/{job_id}/transcription/json")
    assert del_json.status_code == 200
    assert del_json.json()["available_formats"] == {"segments": False, "text": False, "vtt": True}
    assert container.jobs.load_job(job_id).status == "DOWNLOADED"

    # Delete remaining via DELETE /jobs/:id/transcription
    del_all = await async_client.delete(f"/jobs/{job_id}/transcription")
    assert del_all.status_code == 200
    assert del_all.json()["available_formats"] == {"segments": False, "text": False, "vtt": False}

    # GET /jobs/:id/transcription now returns 404
    get_missing = await async_client.get(f"/jobs/{job_id}/transcription")
    assert get_missing.status_code == 404
    assert get_missing.json()["detail"] == "Transcription not found"
