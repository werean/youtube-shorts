"""Stage 2 Domain Service: GPU `faster-whisper` (`large-v3-turbo` `int8_float16`) + `Silero VAD`, VRAM budget coexistence, cooperative `<500ms` cancellation, anti-hallucination filter, chunked acoustic speaker diarization, and atomic persistence."""

from __future__ import annotations

import asyncio
import gc
import inspect
import math
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Iterable

from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.application.scheduler import WhisperAllocationDecision
from app.core.config import config
from app.infrastructure.audio.acoustic_dsp import assign_acoustic_speakers
from app.infrastructure.audio.pcm_extractor import extract_pcm_16k_wav, probe_media_duration
from app.models.domain import Job, JobStatus, Segment, WordTiming
from app.models.schemas import (
    AvailableTranscriptionFormats,
    GetTranscriptionResponse,
    TranscribeJobResponse,
)

# --- Classic Whisper Silence Hallucination Signatures (PT / EN) ---

_UNCONDITIONAL_HALLUCINATION_SUBSTRINGS: tuple[str, ...] = (
    "legendas pela comunidade amara.org",
    "amara.org",
    "subtitles by the amara.org community",
    "transcrição e legendas por",
    "legendado por",
    "www.mooji.org",
    "sottotitoli creati dalla comunità",
    "untertitel der amara.org-community",
)

_ISOLATED_SILENCE_HALLUCINATION_PHRASES: frozenset[str] = frozenset(
    {
        "obrigado por assistir",
        "obrigado por assistir.",
        "obrigado por assistir!",
        "muito obrigado por assistir",
        "muito obrigado por assistir.",
        "inscreva-se no canal",
        "inscreva-se no canal.",
        "deixe seu like e inscreva-se",
        "thank you for watching",
        "thank you for watching.",
        "thank you for watching!",
        "thanks for watching",
        "thanks for watching.",
        "please subscribe",
        "[música]",
        "[music]",
        "[aplausos]",
        "♪",
        "...",
    }
)

_WORD_SPLIT_RE = re.compile(r"\S+")
_PUNCT_STRIP_RE = re.compile(r"[^\w\sÀ-ÿ]", re.UNICODE)


@dataclass
class RawWhisperWord:
    word: str
    start: float
    end: float
    probability: float = 1.0


@dataclass
class RawWhisperSegment:
    start: float
    end: float
    text: str
    no_speech_prob: float = 0.0
    avg_logprob: float = -0.2
    compression_ratio: float = 1.0
    words: list[RawWhisperWord] = field(default_factory=list)
    speaker: str | None = None


WhisperModelFactoryFn = Callable[..., Any]
_custom_whisper_model_factory: WhisperModelFactoryFn | None = None


def set_custom_whisper_model_factory(factory: WhisperModelFactoryFn | None) -> None:
    """Register a custom/mock WhisperModel factory for logical tests."""
    global _custom_whisper_model_factory
    _custom_whisper_model_factory = factory


def _has_repetitive_loop(text: str) -> bool:
    """Detect repetitive n-gram loops characteristic of Whisper decoding stalls."""
    cleaned = _PUNCT_STRIP_RE.sub(" ", text.lower()).strip()
    tokens = cleaned.split()
    if len(tokens) < 6:
        return False
    unique_ratio = len(set(tokens)) / float(len(tokens))
    if len(tokens) >= 8 and unique_ratio < 0.25:
        return True
    # Check consecutive identical bigrams/trigrams
    bigram_counts: dict[tuple[str, str], int] = {}
    for i in range(len(tokens) - 1):
        bg = (tokens[i], tokens[i + 1])
        bigram_counts[bg] = bigram_counts.get(bg, 0) + 1
        if bigram_counts[bg] >= 4 and (bigram_counts[bg] * 2) / float(len(tokens)) >= 0.6:
            return True
    return False


def is_hallucinated_segment(
    seg: RawWhisperSegment | dict[str, Any] | Any,
    *,
    no_speech_threshold: float = 0.65,
    logprob_threshold: float = -1.0,
    compression_ratio_threshold: float = 2.4,
) -> bool:
    """Return True if a raw Whisper segment is an acoustic/silence hallucination.

    Follows ARCHITECTURE.md §3 Estágio 2 item 2:
    - `no_speech_prob > 0.65` combined with `avg_logprob < -1.0` (or `no_speech_prob > 0.88`)
    - `compression_ratio > 2.4` (or repetitive token loop)
    - Classic silence hallucination signatures ("Legendas pela comunidade Amara.org", isolated "Obrigado por assistir", etc.)
    """
    if isinstance(seg, dict):
        text = str(seg.get("text") or "").strip()
        no_speech_prob = float(seg.get("no_speech_prob") or 0.0)
        avg_logprob = float(seg.get("avg_logprob") if seg.get("avg_logprob") is not None else -0.2)
        compression_ratio = float(
            seg.get("compression_ratio") if seg.get("compression_ratio") is not None else 1.0
        )
    else:
        text = str(getattr(seg, "text", "") or "").strip()
        no_speech_prob = float(getattr(seg, "no_speech_prob", 0.0) or 0.0)
        avg_logprob = float(
            getattr(seg, "avg_logprob", -0.2)
            if getattr(seg, "avg_logprob", None) is not None
            else -0.2
        )
        compression_ratio = float(
            getattr(seg, "compression_ratio", 1.0)
            if getattr(seg, "compression_ratio", None) is not None
            else 1.0
        )

    if not text:
        return True

    norm_lower = " ".join(text.lower().split())

    for sig in _UNCONDITIONAL_HALLUCINATION_SUBSTRINGS:
        if sig in norm_lower:
            return True

    if norm_lower in _ISOLATED_SILENCE_HALLUCINATION_PHRASES:
        return True

    stripped_punct = _PUNCT_STRIP_RE.sub("", norm_lower).strip()
    if not stripped_punct:
        return True
    if stripped_punct in _ISOLATED_SILENCE_HALLUCINATION_PHRASES and no_speech_prob >= 0.25:
        return True

    if no_speech_prob > no_speech_threshold and avg_logprob < logprob_threshold:
        return True

    if no_speech_prob > 0.88:
        return True

    if compression_ratio > compression_ratio_threshold:
        return True

    if _has_repetitive_loop(text):
        return True

    return False


def _normalize_raw_segment(item: Any) -> RawWhisperSegment:
    if isinstance(item, RawWhisperSegment):
        return item
    if isinstance(item, dict):
        start = float(item.get("start") or 0.0)
        end = float(item.get("end") or max(start + 0.1, 0.1))
        text = str(item.get("text") or "").strip()
        no_speech = float(item.get("no_speech_prob") or 0.0)
        avg_lp = float(item.get("avg_logprob") if item.get("avg_logprob") is not None else -0.2)
        comp_ratio = float(
            item.get("compression_ratio") if item.get("compression_ratio") is not None else 1.0
        )
        speaker = item.get("speaker")
        raw_words = item.get("words") or []
    else:
        start = float(getattr(item, "start", 0.0) or 0.0)
        end = float(getattr(item, "end", max(start + 0.1, 0.1)) or max(start + 0.1, 0.1))
        text = str(getattr(item, "text", "") or "").strip()
        no_speech = float(getattr(item, "no_speech_prob", 0.0) or 0.0)
        avg_lp = float(
            getattr(item, "avg_logprob", -0.2)
            if getattr(item, "avg_logprob", None) is not None
            else -0.2
        )
        comp_ratio = float(
            getattr(item, "compression_ratio", 1.0)
            if getattr(item, "compression_ratio", None) is not None
            else 1.0
        )
        speaker = getattr(item, "speaker", None)
        raw_words = getattr(item, "words", None) or []

    words: list[RawWhisperWord] = []
    for w in raw_words:
        if isinstance(w, dict):
            w_text = str(w.get("word") or "").strip()
            w_start = float(w.get("start") if w.get("start") is not None else start)
            w_end = float(w.get("end") if w.get("end") is not None else end)
            w_prob = float(w.get("probability") if w.get("probability") is not None else 1.0)
        else:
            w_text = str(getattr(w, "word", "") or "").strip()
            w_start = float(
                getattr(w, "start", start) if getattr(w, "start", None) is not None else start
            )
            w_end = float(getattr(w, "end", end) if getattr(w, "end", None) is not None else end)
            w_prob = float(
                getattr(w, "probability", 1.0)
                if getattr(w, "probability", None) is not None
                else 1.0
            )
        if w_text:
            words.append(
                RawWhisperWord(
                    word=w_text,
                    start=round(w_start, 3),
                    end=round(max(w_start, w_end), 3),
                    probability=round(w_prob, 4),
                )
            )

    return RawWhisperSegment(
        start=round(start, 3),
        end=round(max(start, end), 3),
        text=text,
        no_speech_prob=no_speech,
        avg_logprob=avg_lp,
        compression_ratio=comp_ratio,
        words=words,
        speaker=str(speaker) if speaker else None,
    )


def _synthesize_words_for_segment(
    segment_id: str,
    start: float,
    end: float,
    text: str,
    speaker: str | None,
) -> list[WordTiming]:
    """Synthesize proportional word-level timestamps when a mock/fallback omits `words`."""
    tokens = _WORD_SPLIT_RE.findall(text or "")
    if not tokens:
        return []
    total_dur = max(0.05, float(end) - float(start))
    char_weights = [max(1, len(tok)) for tok in tokens]
    total_weight = float(sum(char_weights))
    cursor = float(start)
    result: list[WordTiming] = []
    for tok, weight in zip(tokens, char_weights):
        w_dur = total_dur * (weight / total_weight)
        w_start = round(cursor, 3)
        cursor += w_dur
        w_end = round(min(float(end), max(w_start + 0.01, cursor)), 3)
        result.append(
            WordTiming(
                word=tok,
                start=w_start,
                end=w_end,
                probability=1.0,
                speaker=speaker,
                segment_id=segment_id,
            )
        )
    if result:
        result[-1].end = round(float(end), 3)
    return result


def format_vtt_timestamp(seconds: float) -> str:
    total_ms = max(0, int(math.floor(float(seconds) * 1000.0 + 0.5)))
    ms = total_ms % 1000
    total_sec = total_ms // 1000
    s = total_sec % 60
    total_min = total_sec // 60
    m = total_min % 60
    h = total_min // 60
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def build_plain_text(segments: Iterable[Segment]) -> str:
    return " ".join(s.text.strip() for s in segments if s.text and s.text.strip()).strip()


def build_vtt_content(segments: Iterable[Segment]) -> str:
    cues: list[str] = []
    for idx, seg in enumerate(segments, start=1):
        start_ts = format_vtt_timestamp(seg.start)
        end_ts = format_vtt_timestamp(seg.end)
        cues.append(f"{idx}\n{start_ts} --> {end_ts}\n{seg.text.strip()}\n")
    body = "\n".join(cues).rstrip()
    return f"WEBVTT\n\n{body}\n" if body else "WEBVTT\n\n"


class FasterWhisperAdapter:
    """Adapter for `faster-whisper` (`large-v3-turbo` `int8_float16` + `Silero VAD`) with VRAM fallback and `<500ms` cancel."""

    def __init__(self, *, model_factory: WhisperModelFactoryFn | None = None) -> None:
        self.model_factory = model_factory

    def _get_model_factory(self) -> WhisperModelFactoryFn:
        if self.model_factory is not None:
            return self.model_factory
        if _custom_whisper_model_factory is not None:
            return _custom_whisper_model_factory
        # Register Windows/Linux CUDA DLL directories before lazy faster_whisper/ctranslate2 import.
        from app.infrastructure.cuda_env import ensure_cuda_dll_directories

        ensure_cuda_dll_directories()
        # Lazy import per architecture rules (never import faster_whisper at module top-level)
        from faster_whisper import WhisperModel

        return WhisperModel

    @staticmethod
    def _cleanup_model_resources(whisper_model: Any, segments_gen: Any) -> None:
        if segments_gen is not None and hasattr(segments_gen, "close"):
            try:
                segments_gen.close()
            except Exception:
                pass
        if whisper_model is not None:
            del whisper_model
        gc.collect()
        torch_mod = sys.modules.get("torch")
        if torch_mod is not None:
            try:
                if torch_mod.cuda.is_available():
                    torch_mod.cuda.empty_cache()
            except Exception:
                pass

    @staticmethod
    def _build_transcribe_kwargs(whisper_cfg: dict[str, Any]) -> dict[str, Any]:
        transcribe_kwargs: dict[str, Any] = {
            "beam_size": int(whisper_cfg.get("beam_size") or 5),
            "best_of": int(whisper_cfg.get("best_of") or 5),
            "task": str(whisper_cfg.get("task") or "transcribe"),
            "condition_on_previous_text": bool(
                whisper_cfg.get("condition_on_previous_text", True)
            ),
            "word_timestamps": True,
            "vad_filter": True,
            "vad_parameters": {
                "min_silence_duration_ms": 400,
                "speech_pad_ms": 200,
            },
        }
        if whisper_cfg.get("language"):
            transcribe_kwargs["language"] = str(whisper_cfg["language"])
        if whisper_cfg.get("initial_prompt"):
            transcribe_kwargs["initial_prompt"] = str(whisper_cfg["initial_prompt"])
        temp_val = whisper_cfg.get("temperature")
        if temp_val is not None:
            if isinstance(temp_val, (list, tuple)):
                transcribe_kwargs["temperature"] = [float(t) for t in temp_val]
            else:
                transcribe_kwargs["temperature"] = float(temp_val)
        return transcribe_kwargs

    def _run_attempt(
        self,
        factory: WhisperModelFactoryFn,
        audio_input_path: str,
        *,
        model_name: str,
        attempt_decision: WhisperAllocationDecision,
        transcribe_kwargs: dict[str, Any],
        cancel_token: CancelToken | None = None,
        on_segment_progress: Callable[[float, float | None, str], None] | None = None,
        fallback_duration: float | None = None,
    ) -> tuple[list[RawWhisperSegment], float | None]:
        whisper_model: Any = None
        segments_gen: Any = None
        try:
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()

            model_kwargs: dict[str, Any] = {
                "device": attempt_decision.device,
                "compute_type": attempt_decision.compute_type,
            }
            if attempt_decision.device == "cpu" and attempt_decision.cpu_threads > 0:
                model_kwargs["cpu_threads"] = attempt_decision.cpu_threads

            whisper_model = factory(model_name, **model_kwargs)

            if cancel_token is not None:
                cancel_token.raise_if_cancelled()

            segments_gen, info = whisper_model.transcribe(audio_input_path, **transcribe_kwargs)
            detected_duration: float | None = getattr(info, "duration", None)
            if detected_duration is None and isinstance(info, dict):
                detected_duration = info.get("duration")
            total_dur = float(detected_duration or fallback_duration or 0.0) or None

            collected: list[RawWhisperSegment] = []
            for raw_seg in segments_gen:
                if cancel_token is not None and cancel_token.is_set():
                    if hasattr(segments_gen, "close"):
                        try:
                            segments_gen.close()
                        except Exception:
                            pass
                    cancel_token.raise_if_cancelled()

                norm_seg = _normalize_raw_segment(raw_seg)
                collected.append(norm_seg)

                if on_segment_progress is not None:
                    on_segment_progress(norm_seg.end, total_dur, norm_seg.text)

            if cancel_token is not None:
                cancel_token.raise_if_cancelled()

            return collected, total_dur
        finally:
            self._cleanup_model_resources(whisper_model, segments_gen)

    def _transcribe_sync(
        self,
        audio_input_path: str,
        *,
        model_name: str,
        decision: WhisperAllocationDecision,
        whisper_cfg: dict[str, Any],
        cancel_token: CancelToken | None = None,
        on_segment_progress: Callable[[float, float | None, str], None] | None = None,
        fallback_duration: float | None = None,
        on_fallback: Callable[[str], None] | None = None,
    ) -> tuple[list[RawWhisperSegment], float | None, WhisperAllocationDecision]:
        """Run `WhisperModel` creation, lazy segment iteration, transparent CUDA->CPU fallback, and VRAM cleanup."""
        from app.infrastructure.cuda_env import is_cuda_or_dll_error

        factory = self._get_model_factory()
        transcribe_kwargs = self._build_transcribe_kwargs(whisper_cfg)
        active_decision = decision

        try:
            collected, total_dur = self._run_attempt(
                factory,
                audio_input_path,
                model_name=model_name,
                attempt_decision=active_decision,
                transcribe_kwargs=transcribe_kwargs,
                cancel_token=cancel_token,
                on_segment_progress=on_segment_progress,
                fallback_duration=fallback_duration,
            )
            return collected, total_dur, active_decision
        except OperationCancelledError:
            raise
        except Exception as exc:
            if active_decision.device != "cuda" or (
                cancel_token is not None and cancel_token.is_set()
            ):
                raise
            # Any load-time error on CUDA OR runtime CUDA/cuBLAS/cuDNN DLL error triggers CPU int8 fallback
            reason = (
                f"CUDA transcription failed ({exc}); falling back to CPU ({config.WHISPER_COMPUTE_TYPE_CPU})"
                if is_cuda_or_dll_error(exc)
                else f"Whisper CUDA execution failed ({exc}); retrying on CPU ({config.WHISPER_COMPUTE_TYPE_CPU})"
            )
            active_decision = WhisperAllocationDecision(
                device="cpu",
                compute_type=config.WHISPER_COMPUTE_TYPE_CPU,
                cpu_threads=config.WHISPER_CPU_THREADS,
                free_vram_gb=active_decision.free_vram_gb,
                unloaded_models=list(active_decision.unloaded_models),
                lms_unloaded=active_decision.lms_unloaded,
                fell_back_to_cpu=True,
                fallback_reason=reason,
            )
            if on_fallback is not None:
                on_fallback(reason)

            collected, total_dur = self._run_attempt(
                factory,
                audio_input_path,
                model_name=model_name,
                attempt_decision=active_decision,
                transcribe_kwargs=transcribe_kwargs,
                cancel_token=cancel_token,
                on_segment_progress=on_segment_progress,
                fallback_duration=fallback_duration,
            )
            return collected, total_dur, active_decision

    async def transcribe(
        self,
        audio_input_path: str | Path,
        *,
        model_name: str,
        decision: WhisperAllocationDecision,
        whisper_cfg: dict[str, Any],
        cancel_token: CancelToken | None = None,
        on_segment_progress: Callable[[float, float | None, str], None] | None = None,
        fallback_duration: float | None = None,
        on_fallback: Callable[[str], None] | None = None,
    ) -> tuple[list[RawWhisperSegment], float | None, WhisperAllocationDecision]:
        return await asyncio.to_thread(
            self._transcribe_sync,
            str(audio_input_path),
            model_name=model_name,
            decision=decision,
            whisper_cfg=whisper_cfg,
            cancel_token=cancel_token,
            on_segment_progress=on_segment_progress,
            fallback_duration=fallback_duration,
            on_fallback=on_fallback,
        )


class TranscriptionDomainService:
    """Domain service orchestrating GPU transcription, VRAM budget coexistence, anti-hallucination, and speaker diarization."""

    def __init__(
        self,
        *,
        container: ServiceContainer | None = None,
        whisper_adapter: FasterWhisperAdapter | None = None,
    ) -> None:
        self._container = container
        self.whisper_adapter = whisper_adapter or FasterWhisperAdapter()

    @property
    def c(self) -> ServiceContainer:
        return self._container or get_container()

    def _resolve_requested_formats(self) -> tuple[bool, bool]:
        """Return `(write_text, write_vtt)` from active tool configs and settings."""
        tool_cfgs = self.c.load_active_tool_configs()
        whisper_cfg = tool_cfgs.get("whisper", {})
        raw_formats = whisper_cfg.get("output_format")
        if not isinstance(raw_formats, list) or not raw_formats:
            raw_formats = self.c.load_settings().whisper.formats
        normalized = {str(f).strip().lower() for f in (raw_formats or [])}
        use_all = "all" in normalized
        write_text = use_all or "txt" in normalized or "text" in normalized
        write_vtt = use_all or "vtt" in normalized
        return write_text, write_vtt

    async def transcribe_job(self, job_id: str) -> TranscribeJobResponse:
        """Execute Stage 2 GPU transcription for `job_id` inside `c.scheduler.whisper_slot()`."""
        c = self.c
        job = c.jobs.load_job(job_id)

        c.runtime.clear_task_logs(job_id, "transcription")

        cancel_token = c.runtime.create_cancel_token(job_id, "transcription")
        start_wall = time.monotonic()

        try:
            c.jobs.update_job_status(job_id, JobStatus.TRANSCRIBING)
            c.runtime.publish_state_change(
                job_id, JobStatus.TRANSCRIBING.value, "[transcription] Starting transcription"
            )
            c.runtime.append_task_log(
                job_id, "transcription", "[transcription] Starting transcription"
            )

            video_path = c.jobs.find_source_video(job_id)
            if video_path is None or not video_path.exists():
                raise RuntimeError("Source video not found for job")

            c.runtime.append_task_log(
                job_id, "transcription", f"[transcription] Using file: {video_path}"
            )

            # Ensure 16kHz mono PCM WAV exists and is not a truncated fallback artifact
            wav_path = c.jobs.audio_16k_path(job_id)
            if not job.video_duration_seconds and video_path.exists():
                probed_dur = await probe_media_duration(video_path)
                if probed_dur and probed_dur > 0:
                    job = c.jobs.update_job(job_id, {"video_duration_seconds": probed_dur})

            if wav_path.exists() and video_path.stat().st_size > 4096:
                expected_dur = job.video_duration_seconds or await probe_media_duration(video_path)
                wav_dur = await probe_media_duration(wav_path)
                if expected_dur and expected_dur > 20.0 and (
                    wav_dur is None or wav_dur < expected_dur * 0.5
                ):
                    c.runtime.log_warning(
                        job_id,
                        "transcription",
                        f"Existing audio_16k.wav looks truncated/stale ({wav_dur}s vs video {expected_dur:.1f}s); re-extracting full audio.",
                    )
                    wav_path.unlink(missing_ok=True)

            if not wav_path.exists():
                async with c.scheduler.io_slot():
                    await extract_pcm_16k_wav(
                        video_path,
                        wav_path,
                        duration_hint_seconds=job.video_duration_seconds or 1.0,
                    )

            audio_input = wav_path if wav_path.exists() else video_path

            tool_cfgs = c.load_active_tool_configs()
            whisper_cfg = tool_cfgs.get("whisper", {})
            app_settings = c.load_settings()

            model_name = str(whisper_cfg.get("model") or config.WHISPER_MODEL_NAME)
            cfg_device = str(whisper_cfg.get("device") or app_settings.whisper.device or "cuda")
            requested_device = "cpu" if cfg_device == "cpu" else "cuda"

            no_speech_thresh = float(whisper_cfg.get("no_speech_threshold") or 0.65)
            # Enforce at least 0.65 per ARCHITECTURE.md §3 Estágio 2
            no_speech_thresh = max(0.60, min(0.75, no_speech_thresh))
            logprob_thresh = float(whisper_cfg.get("logprob_threshold") or -1.0)
            comp_ratio_thresh = float(whisper_cfg.get("compression_ratio_threshold") or 2.4)

            def _on_segment_progress(seg_end: float, total_dur: float | None, _text: str) -> None:
                denom = total_dur or job.video_duration_seconds or 0.0
                if denom and denom > 0:
                    pct = min(98.0, max(1.0, (seg_end / denom) * 100.0))
                    elapsed = max(0.01, time.monotonic() - start_wall)
                    rate = seg_end / elapsed if seg_end > 0 else 1.0
                    remaining_audio = max(0.0, denom - seg_end)
                    eta = int(round(remaining_audio / max(rate, 0.1)))
                    msg = f"[transcription] Progresso: {pct:.0f}% ({seg_end:.1f}s / {denom:.1f}s)"
                else:
                    pct = 50.0
                    eta = None
                    msg = f"[transcription] Decodificado até {seg_end:.1f}s"

                c.runtime.publish_progress(
                    job_id,
                    status=JobStatus.TRANSCRIBING.value,
                    task="transcription",
                    percent=pct,
                    eta_seconds=eta,
                    message=msg,
                )

            def _on_runtime_fallback(reason: str) -> None:
                c.runtime.log_warning(job_id, "transcription", reason)

            async with c.scheduler.whisper_slot(requested_device=requested_device) as decision:
                if decision.unloaded_models:
                    c.runtime.append_task_log(
                        job_id,
                        "transcription",
                        f"[transcription] Unloaded idle Ollama models: {', '.join(decision.unloaded_models)}",
                    )
                if decision.fell_back_to_cpu:
                    fallback_msg = decision.fallback_reason or (
                        f"Free VRAM ({decision.free_vram_gb:.2f}GB < {config.MIN_FREE_VRAM_GB_FOR_WHISPER}GB); "
                        f"falling back to CPU ({decision.compute_type})"
                    )
                    c.runtime.log_warning(job_id, "transcription", fallback_msg)
                c.runtime.append_task_log(
                    job_id,
                    "transcription",
                    f"[transcription] Carregando faster-whisper ({model_name}, {decision.device}, {decision.compute_type})...",
                )

                raw_segments, detected_duration, final_decision = await self.whisper_adapter.transcribe(
                    audio_input,
                    model_name=model_name,
                    decision=decision,
                    whisper_cfg=whisper_cfg,
                    cancel_token=cancel_token,
                    on_segment_progress=_on_segment_progress,
                    fallback_duration=job.video_duration_seconds,
                    on_fallback=_on_runtime_fallback,
                )

            cancel_token.raise_if_cancelled()

            c.runtime.append_task_log(
                job_id,
                "transcription",
                f"[transcription] Silero VAD ativo: {len(raw_segments)} segmentos brutos detectados ({final_decision.device})",
            )

            # 2. Anti-hallucination post-filter
            filtered_raw: list[RawWhisperSegment] = []
            discarded_count = 0
            for rseg in raw_segments:
                if is_hallucinated_segment(
                    rseg,
                    no_speech_threshold=no_speech_thresh,
                    logprob_threshold=logprob_thresh,
                    compression_ratio_threshold=comp_ratio_thresh,
                ):
                    discarded_count += 1
                    continue
                filtered_raw.append(rseg)

            if discarded_count > 0:
                c.runtime.append_task_log(
                    job_id,
                    "transcription",
                    f"[transcription] Anti-hallucination filter discarded {discarded_count} segment(s)",
                )

            # 3. Build canonical Segment list and run 5-min chunked acoustic speaker diarization
            preliminary_segments: list[Segment] = []
            for idx, rseg in enumerate(filtered_raw, start=1):
                preliminary_segments.append(
                    Segment(
                        segment_id=f"s{idx}",
                        start=rseg.start,
                        end=rseg.end,
                        text=rseg.text,
                        speaker=rseg.speaker,
                    )
                )

            diarized_segments = assign_acoustic_speakers(
                preliminary_segments,
                audio_path=wav_path if wav_path.exists() else None,
            )

            # 4. Build word-level timing list (`transcription.words.json`) aligned with diarized speakers
            all_words: list[WordTiming] = []
            for seg, rseg in zip(diarized_segments, filtered_raw):
                if rseg.words:
                    for rw in rseg.words:
                        all_words.append(
                            WordTiming(
                                word=rw.word,
                                start=rw.start,
                                end=rw.end,
                                probability=rw.probability,
                                speaker=seg.speaker,
                                segment_id=seg.segment_id,
                            )
                        )
                else:
                    all_words.extend(
                        _synthesize_words_for_segment(
                            seg.segment_id,
                            seg.start,
                            seg.end,
                            seg.text,
                            seg.speaker,
                        )
                    )

            # 5. Persist all transcription artifacts atomically in {video_dir}/transcrições/
            c.jobs.save_transcription_segments(job_id, diarized_segments)
            c.jobs.save_transcription_words(job_id, all_words)

            plain_text = build_plain_text(diarized_segments)
            write_text, write_vtt = self._resolve_requested_formats()
            if write_text:
                c.jobs.save_transcription_text(job_id, plain_text)
            if write_vtt:
                vtt_text = build_vtt_content(diarized_segments)
                c.jobs.save_transcription_vtt(job_id, vtt_text)

            # 6. Update job status -> BUILDING_BLOCKS and ensure video_duration_seconds is populated
            resolved_duration = job.video_duration_seconds
            if not resolved_duration or resolved_duration <= 0:
                if detected_duration and detected_duration > 0:
                    resolved_duration = round(float(detected_duration), 3)
                else:
                    probed = await probe_media_duration(video_path)
                    if probed and probed > 0:
                        resolved_duration = round(float(probed), 3)
                    elif diarized_segments:
                        resolved_duration = round(float(diarized_segments[-1].end), 3)

            def _upd_job(j: Job) -> None:
                j.status = JobStatus.BUILDING_BLOCKS
                if resolved_duration and resolved_duration > 0:
                    j.video_duration_seconds = float(resolved_duration)

            updated_job = c.jobs.update_job(job_id, _upd_job)
            available_formats = c.jobs.get_available_transcription_formats(job_id)

            c.runtime.publish_progress(
                job_id,
                status=JobStatus.BUILDING_BLOCKS.value,
                task="transcription",
                percent=100.0,
                eta_seconds=0,
                message="[transcription] Transcription saved",
            )
            c.runtime.publish_state_change(
                job_id, JobStatus.BUILDING_BLOCKS.value, "[transcription] Transcription completed"
            )

            status_str = updated_job.status.value if hasattr(updated_job.status, "value") else str(updated_job.status)
            return TranscribeJobResponse(
                transcription=plain_text,
                segments=diarized_segments,
                available_formats=available_formats,
                job_id=job_id,
                status=status_str,
                segments_count=len(diarized_segments),
            )
        except OperationCancelledError:
            c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)
            c.runtime.append_task_log(job_id, "transcription", "[transcription] Cancelled")
            c.runtime.publish_state_change(
                job_id, JobStatus.DOWNLOADED.value, "[transcription] Cancelled"
            )
            raise
        except Exception as exc:
            if cancel_token.is_set():
                c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)
                c.runtime.append_task_log(job_id, "transcription", "[transcription] Cancelled")
                c.runtime.publish_state_change(
                    job_id, JobStatus.DOWNLOADED.value, "[transcription] Cancelled"
                )
                raise OperationCancelledError(job_id, "transcription") from exc

            c.runtime.log_exception(
                job_id,
                "transcription",
                exc,
                message="[transcription] ERROR executing Whisper",
            )
            c.jobs.update_job_status(job_id, JobStatus.ERROR)
            c.runtime.publish_state_change(
                job_id, JobStatus.ERROR.value, f"[transcription] {exc}"
            )
            raise
        finally:
            c.runtime.clear_cancel_token(job_id, "transcription")

    def cancel_transcription(self, job_id: str) -> bool:
        """Trigger cooperative cancellation for `job_id` and reset status to `DOWNLOADED`."""
        c = self.c
        c.runtime.append_task_log(job_id, "transcription", "[transcription] Cancel requested")
        cancelled = c.runtime.request_cancel(job_id, task="transcription")
        if not cancelled:
            return False
        try:
            c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)
        except Exception:
            pass
        c.runtime.append_task_log(job_id, "transcription", "[transcription] Cancelled")
        c.runtime.publish_progress(
            job_id,
            status=JobStatus.DOWNLOADED.value,
            task="transcription",
            percent=0.0,
            message="Transcrição cancelada",
        )
        c.runtime.publish_state_change(
            job_id, JobStatus.DOWNLOADED.value, "[transcription] Cancelled"
        )
        return True

    def get_transcription(self, job_id: str) -> GetTranscriptionResponse | None:
        """Read existing transcription artifacts from `{video_dir}/transcrições/` (with fallback to `data/jobs/<id>/`)."""
        c = self.c
        formats = c.jobs.get_available_transcription_formats(job_id)
        if not formats.segments and not formats.text and not formats.vtt:
            return None

        segments: list[Segment] = []
        transcription_text = ""

        if formats.segments:
            segments = c.jobs.load_transcription_segments(job_id)
            transcription_text = build_plain_text(segments)
        elif formats.text:
            transcription_text = (c.jobs.load_transcription_text(job_id) or "").strip()

        return GetTranscriptionResponse(
            transcription=transcription_text,
            segments=segments,
            available_formats=formats,
        )


_default_transcription_service: TranscriptionDomainService | None = None


def get_transcription_service(
    container: ServiceContainer | None = None,
    whisper_adapter: FasterWhisperAdapter | None = None,
) -> TranscriptionDomainService:
    global _default_transcription_service
    if container or whisper_adapter:
        return TranscriptionDomainService(container=container, whisper_adapter=whisper_adapter)
    if _default_transcription_service is None:
        _default_transcription_service = TranscriptionDomainService()
    return _default_transcription_service


async def transcribe_job(
    job_id: str,
    *,
    container: ServiceContainer | None = None,
    **kwargs: Any,
) -> TranscribeJobResponse:
    """Convenience entrypoint for Wave 3 orchestrator (`await transcribe_job(job_id)`)."""
    return await get_transcription_service(container=container).transcribe_job(job_id, **kwargs)
