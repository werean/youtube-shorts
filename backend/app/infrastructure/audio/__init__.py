"""Audio extraction and acoustic DSP utilities (16kHz mono PCM, 10ms RMS energy, zero-crossing snap, and 5-min chunked speaker diarization)."""

from app.infrastructure.audio.acoustic_dsp import (
    AcousticSpeakerDiarizer,
    assign_acoustic_speakers,
    compute_rms_energy_10ms,
    compute_rms_energy_from_wav,
    detect_speaker_shifts_chunked,
    find_rms_valley_time,
    snap_cut_boundaries_acoustic,
    snap_to_zero_crossing,
)
from app.infrastructure.audio.pcm_extractor import (
    PcmAudioExtractor,
    extract_pcm_16k_wav,
    probe_media_duration,
    read_wav_chunk_float32,
    write_synthetic_pcm16_wav,
)

__all__ = [
    "AcousticSpeakerDiarizer",
    "PcmAudioExtractor",
    "assign_acoustic_speakers",
    "compute_rms_energy_10ms",
    "compute_rms_energy_from_wav",
    "detect_speaker_shifts_chunked",
    "extract_pcm_16k_wav",
    "find_rms_valley_time",
    "probe_media_duration",
    "read_wav_chunk_float32",
    "snap_cut_boundaries_acoustic",
    "snap_to_zero_crossing",
    "write_synthetic_pcm16_wav",
]
