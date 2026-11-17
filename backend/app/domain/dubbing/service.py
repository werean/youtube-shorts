"""Domain coordinator for multi-language AI video dubbing, 20s preview, export presets, and Send-to-Cuts."""

from __future__ import annotations

import asyncio
import shutil
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable, Sequence

from app.application.job_lifecycle import utc_now_iso
from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.core.config import config as app_config
from app.core.paths import dubs_dir_path
from app.domain.dubbing.audio_mixer import (
    ExportDubbedResult,
    MixResult,
    export_dubbed_mp4,
    mix_dubbed_audio,
    prepare_send_to_cuts_job,
)
from app.domain.dubbing.manifest_store import (
    load_dubbing_manifest,
    load_or_create_dubbing_manifest,
    remove_dubbing_track,
    save_preview_manifest,
    set_dubbing_preview,
    sync_job_dubbing_fields,
    upsert_cut_dubbing_track,
    upsert_dubbing_track,
)
from app.domain.dubbing.translator import (
    DubbingTranslationResult,
    condense_dub_unit_text,
    format_subtitle_cues,
    generate_dub_srt,
    generate_dub_vtt,
    save_translation_artifacts,
    translate_dubbing_units,
)
from app.domain.dubbing.units_builder import (
    SpeakerReferenceResult,
    build_dubbing_units,
    detect_preview_window,
    load_dubbing_units,
    save_dubbing_units,
    select_clean_speaker_reference,
)
from app.domain.rendering.rendering_service import build_cut_filename
from app.domain.transcription.service import (
    FasterWhisperAdapter,
    RawWhisperSegment,
    TranscriptionDomainService,
    _synthesize_words_for_segment,
    is_hallucinated_segment,
)
from app.infrastructure.audio.acoustic_dsp import assign_acoustic_speakers
from app.infrastructure.audio.pcm_extractor import extract_pcm_16k_wav, probe_media_duration
from app.infrastructure.dubbing.env_manager import (
    check_dubbing_preflight,
    install_dubbing_dependencies,
    normalize_dubbing_engine,
)
from app.infrastructure.dubbing.subprocess_runner import (
    run_demucs_worker,
    run_diarize_worker,
    run_tts_worker,
)
from app.infrastructure.llm.unified_adapter import UnifiedLocalLLMAdapter
from app.infrastructure.storage.atomic_store import atomic_write_json, atomic_write_text, read_json
from app.models.domain import (
    DubbingCutTrack,
    DubbingManifest,
    DubbingPreview,
    DubbingSegmentSubtitle,
    DubbingTrack,
    DubbingUnit,
    Segment,
    WordTiming,
)


def _load_speakers_json(path: Path) -> dict[str, Any] | list[dict[str, Any]] | None:
    if not path.exists():
        return None
    try:
        raw = read_json(path)
        if isinstance(raw, (dict, list)):
            return raw
    except Exception:
        pass
    return None


def _extract_speaker_turns(speakers_payload: dict[str, Any] | list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not speakers_payload:
        return []
    if isinstance(speakers_payload, list):
        return [item for item in speakers_payload if isinstance(item, dict)]
    raw = speakers_payload.get("segments") or speakers_payload.get("turns") or []
    return [item for item in raw if isinstance(item, dict)]


def _assign_speakers_to_units(
    units: Sequence[DubbingUnit],
    turns: Sequence[dict[str, Any]],
    voice_mode: str,
) -> list[DubbingUnit]:
    """Update unit speaker labels from diarization turns without altering translated `dub_text`."""
    if str(voice_mode).lower() == "single" or not turns:
        return list(units)

    updated: list[DubbingUnit] = []
    for u in units:
        if u.passthrough_original:
            updated.append(u)
            continue
        overlap_by_spk: dict[str, float] = {}
        for t in turns:
            spk = str(t.get("speaker") or t.get("speaker_id") or "").strip()
            if not spk:
                continue
            try:
                tst = float(t.get("start", 0.0))
                ten = float(t.get("end", tst))
            except (TypeError, ValueError):
                continue
            ov = min(u.end, ten) - max(u.start, tst)
            if ov > 0.0:
                overlap_by_spk[spk] = overlap_by_spk.get(spk, 0.0) + ov
        spk_choice = max(overlap_by_spk.items(), key=lambda kv: kv[1])[0] if overlap_by_spk else (u.speaker or "SPEAKER_00")
        updated.append(u.model_copy(update={"speaker": spk_choice}))
    return updated


class DubbingService:
    """Domain orchestrator for local AI video dubbing."""

    def __init__(
        self,
        *,
        container: ServiceContainer | None = None,
        llm_adapter: UnifiedLocalLLMAdapter | None = None,
        whisper_adapter: FasterWhisperAdapter | None = None,
    ) -> None:
        self._container = container
        self.llm_adapter = llm_adapter
        self.whisper_adapter = whisper_adapter

    @property
    def c(self) -> ServiceContainer:
        return self._container or get_container()

    def _ffmpeg_runner(self) -> Any:
        c = self.c
        return getattr(c, "ffmpeg_command_runner", None) or getattr(c, "dubbing_command_runner", None)

    def _resolve_dubbing_options(
        self,
        *,
        engine: str | None = None,
        voice_mode: str | None = None,
        subtitles_enabled: bool | None = None,
        subtitle_preset: str | None = None,
    ) -> tuple[str, str, bool, str]:
        dub_cfg = self.c.load_settings().dubbing
        resolved_engine = normalize_dubbing_engine(engine or dub_cfg.engine)
        resolved_voice_mode = (voice_mode or dub_cfg.default_voice_mode or "auto").strip().lower()
        resolved_sub_enabled = (
            dub_cfg.default_subtitles_enabled if subtitles_enabled is None else bool(subtitles_enabled)
        )
        resolved_preset = (subtitle_preset or dub_cfg.default_subtitle_preset or "mov_text").strip().lower()
        return resolved_engine, resolved_voice_mode, resolved_sub_enabled, resolved_preset

    def _emit_dubbing_progress(
        self,
        job_id: str,
        *,
        lang: str,
        status: str,
        stage: str,
        percent: float,
        message: str,
        eta_seconds: int | float | None = None,
        error: str | None = None,
        error_phase: str | None = None,
        track: DubbingTrack | None = None,
        cut_track: DubbingCutTrack | None = None,
        preview: DubbingPreview | None = None,
        cut_id: str | None = None,
        cut_title: str | None = None,
        short_file: str | None = None,
    ) -> None:
        c = self.c
        c.runtime.publish_progress(
            job_id,
            status=status,
            task="dubbing",
            percent=percent,
            eta_seconds=eta_seconds,
            message=message,
        )
        payload: dict[str, Any] = {
            "job_id": job_id,
            "lang": lang,
            "status": status,
            "stage": stage,
            "percent": round(float(percent), 2),
            "message": message,
        }
        if cut_id is not None:
            payload["cut_id"] = cut_id
        if cut_title is not None:
            payload["cut_title"] = cut_title
        if short_file is not None:
            payload["short_file"] = short_file
        if error is not None:
            payload["error"] = error
        if error_phase is not None:
            payload["error_phase"] = error_phase
        if track is not None:
            payload["track"] = track.model_dump()
        if cut_track is not None:
            payload["cut_track"] = cut_track.model_dump()
        if preview is not None:
            payload["preview"] = preview.model_dump()
        c.runtime.publish_event(job_id, "dubbing_state", payload)

    def get_manifest(self, job_id: str) -> DubbingManifest:
        self.c.jobs.load_job(job_id)
        return load_or_create_dubbing_manifest(job_id)

    def check_preflight(self, engine: str | None = None) -> dict[str, Any]:
        resolved_engine = normalize_dubbing_engine(engine or self.c.load_settings().dubbing.engine)
        return check_dubbing_preflight(resolved_engine)

    async def install_dependencies(
        self,
        engine: str | None = None,
        *,
        job_id: str | None = None,
        cancel_token: CancelToken | None = None,
    ) -> dict[str, Any]:
        c = self.c
        resolved_engine = normalize_dubbing_engine(engine or c.load_settings().dubbing.engine)

        def _on_prog(pct: float, msg: str) -> None:
            if job_id:
                c.runtime.publish_progress(
                    job_id,
                    status="downloading",
                    task="dubbing",
                    percent=pct,
                    message=msg,
                )

        return await install_dubbing_dependencies(
            resolved_engine,
            cancel_token=cancel_token,
            on_progress=_on_prog,
            command_runner=getattr(c, "dubbing_command_runner", None),
            container=c,
        )

    def _build_tts_manifest_units(
        self,
        units: Sequence[DubbingUnit],
        refs_by_speaker: dict[str, SpeakerReferenceResult],
        tts_out_dir: Path,
    ) -> list[dict[str, Any]]:
        tts_out_dir.mkdir(parents=True, exist_ok=True)
        fallback_ref = refs_by_speaker.get("SPEAKER_00") or next(iter(refs_by_speaker.values()), None)
        payload_units: list[dict[str, Any]] = []
        for u in units:
            spk = u.speaker or "SPEAKER_00"
            ref_res = refs_by_speaker.get(spk) or fallback_ref
            ref_wav = str(ref_res.ref_path) if (ref_res and ref_res.ref_path) else ""
            ref_txt = ref_res.ref_text if ref_res else ""
            x_vec = bool(ref_res.x_vector_only) if ref_res else True
            payload_units.append(
                {
                    "unit_id": u.unit_id,
                    "speaker": spk,
                    "dub_text": (u.dub_text or u.text or "").strip(),
                    "passthrough_original": bool(u.passthrough_original),
                    "ref_wav_path": ref_wav,
                    "ref_text": ref_txt,
                    "x_vector_only_mode": x_vec,
                    "output_wav_path": str(tts_out_dir / f"{u.unit_id}.wav"),
                }
            )
        return payload_units

    async def _ensure_transcription_and_audio(
        self,
        job_id: str,
        *,
        cancel_token: CancelToken,
    ) -> tuple[Path, list[Segment], list[WordTiming], float]:
        c = self.c
        job = c.jobs.load_job(job_id)
        video_path = c.jobs.find_source_video(job_id)
        if video_path is None or not video_path.exists():
            raise FileNotFoundError(f"Source video not found for job {job_id}")

        wav_path = c.jobs.audio_16k_path(job_id)
        duration = job.video_duration_seconds
        if not duration or duration <= 0:
            duration = await probe_media_duration(video_path)
            if duration and duration > 0:
                c.jobs.update_job(job_id, {"video_duration_seconds": duration})

        if not wav_path.exists():
            async with c.scheduler.io_slot():
                await extract_pcm_16k_wav(
                    video_path,
                    wav_path,
                    duration_hint_seconds=duration or 1.0,
                )

        if not c.jobs.has_transcription(job_id):
            await TranscriptionDomainService(container=c).transcribe_job(
                job_id,
                emit_job_state=False,
                progress_task="dubbing",
                cancel_token=cancel_token,
            )

        segments = c.jobs.load_transcription_segments(job_id)
        words = c.jobs.load_transcription_words(job_id)

        if not duration or duration <= 0:
            duration = await probe_media_duration(wav_path)
        if (not duration or duration <= 0) and segments:
            duration = max(float(s.end) for s in segments)
        return wav_path, segments, words, float(duration or 1.0)

    def _collect_speaker_references(
        self,
        units: Sequence[DubbingUnit],
        vocals_path: Path,
        no_vocals_path: Path | None,
        diarized_turns: Sequence[dict[str, Any]],
        refs_dir: Path,
        *,
        words: Sequence[WordTiming],
        segments: Sequence[Segment],
        time_offset: float = 0.0,
    ) -> tuple[dict[str, SpeakerReferenceResult], list[str]]:
        speakers_needed = sorted(
            {
                u.speaker or "SPEAKER_00"
                for u in units
                if not u.passthrough_original
            }
        )
        if not speakers_needed:
            speakers_needed = ["SPEAKER_00"]

        refs: dict[str, SpeakerReferenceResult] = {}
        warnings: list[str] = []
        for spk in speakers_needed:
            res = select_clean_speaker_reference(
                vocals_path,
                no_vocals_path,
                diarized_turns,
                spk,
                output_dir=refs_dir,
                words=words,
                transcription_segments=segments,
                time_offset=time_offset,
            )
            refs[spk] = res
            warnings.extend(res.warnings)
        return refs, warnings

    async def _ensure_cut_transcription_and_audio(
        self,
        job_id: str,
        cut_video_path: Path,
        prep_dir: Path,
        *,
        duration_hint: float | None = None,
        cancel_token: CancelToken,
    ) -> tuple[Path, list[Segment], list[WordTiming], float]:
        """Extract 16kHz PCM WAV and transcribe an isolated rendered cut inside `{cut_dir}/.prep`."""
        c = self.c
        prep_dir.mkdir(parents=True, exist_ok=True)
        wav_path = prep_dir / "audio_16k.wav"
        segs_path = prep_dir / "transcription.segments.json"
        words_path = prep_dir / "transcription.words.json"

        duration = await probe_media_duration(cut_video_path)
        if not duration or duration <= 0:
            duration = duration_hint

        if not wav_path.exists():
            async with c.scheduler.io_slot():
                await extract_pcm_16k_wav(
                    cut_video_path,
                    wav_path,
                    duration_hint_seconds=duration or 1.0,
                )

        segments: list[Segment] = []
        words: list[WordTiming] = []
        detected_duration: float | None = None

        if segs_path.exists():
            raw_segs = read_json(segs_path)
            if isinstance(raw_segs, list):
                segments = [Segment.model_validate(item) for item in raw_segs]
            if words_path.exists():
                raw_words = read_json(words_path)
                if isinstance(raw_words, list):
                    words = [WordTiming.model_validate(item) for item in raw_words]
            if not words and segments:
                for seg in segments:
                    words.extend(
                        _synthesize_words_for_segment(
                            seg.segment_id or str(seg.id or ""),
                            seg.start,
                            seg.end,
                            seg.text,
                            seg.speaker,
                        )
                    )
        else:
            tool_cfgs = c.load_active_tool_configs()
            whisper_cfg = tool_cfgs.get("whisper", {})
            app_settings = c.load_settings()

            model_name = str(whisper_cfg.get("model") or app_config.WHISPER_MODEL_NAME)
            cfg_device = str(whisper_cfg.get("device") or app_settings.whisper.device or "cuda")
            requested_device = "cpu" if cfg_device == "cpu" else "cuda"

            no_speech_thresh = max(0.60, min(0.75, float(whisper_cfg.get("no_speech_threshold") or 0.65)))
            logprob_thresh = float(whisper_cfg.get("logprob_threshold") or -1.0)
            comp_ratio_thresh = float(whisper_cfg.get("compression_ratio_threshold") or 2.4)

            lmstudio = getattr(c, "lmstudio", None)
            if lmstudio is not None:
                try:
                    await lmstudio.ensure_idle_vram_released(job_id=job_id, task_log="dubbing")
                except Exception as exc:
                    c.runtime.log_warning(
                        job_id,
                        "dubbing",
                        f"LM Studio idle VRAM release skipped: {exc}",
                    )

            audio_input = wav_path if wav_path.exists() else cut_video_path
            adapter = self.whisper_adapter or FasterWhisperAdapter()

            async with c.scheduler.whisper_slot(requested_device=requested_device) as decision:
                raw_segments, detected_duration, _final_decision = await adapter.transcribe(
                    audio_input,
                    model_name=model_name,
                    decision=decision,
                    whisper_cfg=whisper_cfg,
                    cancel_token=cancel_token,
                    fallback_duration=duration,
                )

            cancel_token.raise_if_cancelled()

            filtered_raw: list[RawWhisperSegment] = [
                rseg
                for rseg in raw_segments
                if not is_hallucinated_segment(
                    rseg,
                    no_speech_threshold=no_speech_thresh,
                    logprob_threshold=logprob_thresh,
                    compression_ratio_threshold=comp_ratio_thresh,
                )
            ]

            preliminary_segments = [
                Segment(
                    segment_id=f"s{idx}",
                    start=rseg.start,
                    end=rseg.end,
                    text=rseg.text,
                    speaker=rseg.speaker,
                )
                for idx, rseg in enumerate(filtered_raw, start=1)
            ]
            segments = assign_acoustic_speakers(
                preliminary_segments,
                audio_path=wav_path if wav_path.exists() else None,
            )

            for seg, rseg in zip(segments, filtered_raw):
                if rseg.words:
                    for rw in rseg.words:
                        words.append(
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
                    words.extend(
                        _synthesize_words_for_segment(
                            seg.segment_id or "",
                            seg.start,
                            seg.end,
                            seg.text,
                            seg.speaker,
                        )
                    )

            atomic_write_json(segs_path, segments)
            atomic_write_json(words_path, words)

        if not duration or duration <= 0:
            duration = detected_duration or await probe_media_duration(wav_path)
        if (not duration or duration <= 0) and segments:
            duration = max(float(s.end) for s in segments)
        return wav_path, segments, words, float(duration or 1.0)

    async def _run_dubbing_pipeline(
        self,
        job_id: str,
        *,
        source_video_path: Path,
        work_root_dir: Path,
        target_lang: str,
        engine: str,
        voice_mode: str,
        subtitles_enabled: bool,
        subtitle_preset: str,
        prep_fn: Callable[[CancelToken], Awaitable[tuple[Path, list[Segment], list[WordTiming], float]]],
        has_cached_transcription: Callable[[], bool],
        cut_id: str | None = None,
        cut_title: str | None = None,
        short_file: str | None = None,
        export_mp4_name: str | None = None,
    ) -> DubbingManifest:
        """Shared 5-stage local dubbing pipeline for full videos and rendered cuts."""
        c = self.c
        c.runtime.clear_task_logs(job_id, "dubbing")
        cancel_token = c.runtime.create_cancel_token(job_id, "dubbing")

        work_root_dir.mkdir(parents=True, exist_ok=True)
        stems_dir = work_root_dir / "_stems"
        lang_dir = work_root_dir / target_lang
        lang_dir.mkdir(parents=True, exist_ok=True)
        work_dir = lang_dir / f".work_dub_{target_lang}"
        work_dir.mkdir(parents=True, exist_ok=True)
        c.runtime.register_partial_dir(job_id, work_dir)

        is_cut = cut_id is not None
        media_base = (
            f"/media/dubs/{job_id}/_cuts/{cut_id}/{target_lang}"
            if is_cut
            else f"/media/dubs/{job_id}/{target_lang}"
        )
        now_iso = utc_now_iso()

        track: DubbingTrack | None = None
        cut_track: DubbingCutTrack | None = None
        if is_cut:
            cut_track = DubbingCutTrack(
                cut_id=cut_id,
                short_file=short_file or source_video_path.name,
                lang=target_lang,
                engine=engine,
                voice_mode=voice_mode,
                status="preparing",
                subtitle_preset=subtitle_preset,
                subtitles_enabled=subtitles_enabled,
                created_at=now_iso,
                updated_at=now_iso,
            )
            manifest = upsert_cut_dubbing_track(job_id, cut_id, target_lang, cut_track)
        else:
            track = DubbingTrack(
                lang=target_lang,
                engine=engine,
                voice_mode=voice_mode,
                status="preparing",
                created_at=now_iso,
                updated_at=now_iso,
            )
            manifest = upsert_dubbing_track(job_id, target_lang, track, set_active=True)

        sync_job_dubbing_fields(job_id, manifest, container=c, dubbing_status="preparing")
        target_label = f"corte {cut_id}" if is_cut else "vídeo"
        self._emit_dubbing_progress(
            job_id,
            lang=target_lang,
            status="preparing",
            stage="preflight",
            percent=2.0,
            message=f"[dubbing] Iniciando dublagem do {target_label} ({target_lang}, {engine})...",
            track=track,
            cut_track=cut_track,
            cut_id=cut_id,
            cut_title=cut_title,
            short_file=short_file,
        )

        def _persist_track_state(status_val: str, *, error_msg: str | None = None) -> DubbingManifest:
            ts = utc_now_iso()
            if is_cut and cut_track is not None and cut_id is not None:
                cut_track.status = status_val
                cut_track.updated_at = ts
                if error_msg is not None:
                    cut_track.error = error_msg
                m = upsert_cut_dubbing_track(job_id, cut_id, target_lang, cut_track)
            elif track is not None:
                track.status = status_val
                track.updated_at = ts
                if error_msg is not None:
                    track.error = error_msg
                m = upsert_dubbing_track(job_id, target_lang, track, set_active=True)
            else:
                m = load_or_create_dubbing_manifest(job_id)
            sync_job_dubbing_fields(job_id, m, container=c, dubbing_status=status_val)
            return m

        prep_completed = False
        translation_cached = (
            (lang_dir / "dubbing.units.json").exists()
            and (lang_dir / "dub.segments.json").exists()
            and (lang_dir / "dub.vtt").exists()
            and (lang_dir / "dub.srt").exists()
            and has_cached_transcription()
        )

        try:
            # --- Stage 1: Parallel Download + Prep (Zero Deadlock) ---
            async def _run_download() -> dict[str, Any]:
                def _dl_prog(pct: float, msg: str) -> None:
                    self._emit_dubbing_progress(
                        job_id,
                        lang=target_lang,
                        status="downloading",
                        stage="download",
                        percent=min(35.0, max(2.0, pct * 0.35)),
                        message=msg,
                        cut_id=cut_id,
                        cut_title=cut_title,
                        short_file=short_file,
                    )

                return await install_dubbing_dependencies(
                    engine,
                    cancel_token=cancel_token,
                    on_progress=_dl_prog,
                    command_runner=getattr(c, "dubbing_command_runner", None),
                    container=c,
                )

            async def _run_prep() -> tuple[Path, list[Segment], list[WordTiming], float, list[DubbingUnit]]:
                nonlocal prep_completed
                wav_path, segments, words, total_dur = await prep_fn(cancel_token)
                cancel_token.raise_if_cancelled()

                if translation_cached:
                    cached_units = load_dubbing_units(lang_dir / "dubbing.units.json")
                    if cached_units:
                        prep_completed = True
                        self._emit_dubbing_progress(
                            job_id,
                            lang=target_lang,
                            status="preparing",
                            stage="prep",
                            percent=40.0,
                            message="[dubbing] Reaproveitando transcrição e tradução salvas.",
                            cut_id=cut_id,
                            cut_title=cut_title,
                            short_file=short_file,
                        )
                        return wav_path, segments, words, total_dur, cached_units

                speakers_payload = _load_speakers_json(stems_dir / "speakers.json")
                units = build_dubbing_units(
                    segments,
                    words=words,
                    speakers=speakers_payload,
                    voice_mode=voice_mode,
                )

                def _tr_prog(pct: float, msg: str) -> None:
                    self._emit_dubbing_progress(
                        job_id,
                        lang=target_lang,
                        status="translating",
                        stage="translate",
                        percent=15.0 + pct * 0.25,
                        message=msg,
                        cut_id=cut_id,
                        cut_title=cut_title,
                        short_file=short_file,
                    )

                tr_result = await translate_dubbing_units(
                    units,
                    segments,
                    target_lang,
                    job_id=job_id,
                    container=c,
                    llm_adapter=self.llm_adapter,
                    cancel_token=cancel_token,
                    on_progress=_tr_prog,
                )
                save_translation_artifacts(lang_dir, tr_result)
                prep_completed = True
                return wav_path, segments, words, total_dur, tr_result.units

            download_task = asyncio.create_task(_run_download())
            prep_task = asyncio.create_task(_run_prep())

            dl_res_or_exc, prep_res_or_exc = await asyncio.gather(
                download_task, prep_task, return_exceptions=True
            )

            if cancel_token.is_set():
                raise OperationCancelledError(job_id, "dubbing")
            if isinstance(dl_res_or_exc, OperationCancelledError) or isinstance(
                prep_res_or_exc, OperationCancelledError
            ):
                raise OperationCancelledError(job_id, "dubbing")

            if isinstance(dl_res_or_exc, BaseException):
                err_msg = str(dl_res_or_exc)
                error_phase = "download" if prep_completed else "preflight"
                _persist_track_state("error", error_msg=err_msg)
                self._emit_dubbing_progress(
                    job_id,
                    lang=target_lang,
                    status="error",
                    stage=error_phase,
                    percent=40.0 if prep_completed else 0.0,
                    message=f"[dubbing] Erro no download de modelos: {err_msg}",
                    error=err_msg,
                    error_phase=error_phase,
                    track=track,
                    cut_track=cut_track,
                    cut_id=cut_id,
                    cut_title=cut_title,
                    short_file=short_file,
                )
                raise RuntimeError(err_msg) from dl_res_or_exc

            if isinstance(prep_res_or_exc, BaseException):
                raise prep_res_or_exc

            wav_path, segments, words, total_dur, units = prep_res_or_exc
            cancel_token.raise_if_cancelled()

            # --- Stage 2: Demucs Stem Separation (cached in _stems/) ---
            vocals_path = stems_dir / "vocals.flac"
            no_vocals_path = stems_dir / "no_vocals.flac"
            if not (vocals_path.exists() and no_vocals_path.exists()):
                stems_dir.mkdir(parents=True, exist_ok=True)
                async with c.scheduler.gpu_slot("dubbing_demucs"):
                    demucs_res = await run_demucs_worker(
                        job_id=job_id,
                        input_path=wav_path,
                        output_dir=stems_dir,
                        cancel_token=cancel_token,
                        on_progress=lambda pct, msg: self._emit_dubbing_progress(
                            job_id,
                            lang=target_lang,
                            status="separating",
                            stage="demucs",
                            percent=40.0 + pct * 0.15,
                            message=msg,
                            cut_id=cut_id,
                            cut_title=cut_title,
                            short_file=short_file,
                        ),
                        container=c,
                    )
                    if demucs_res.result.get("vocals_path"):
                        vocals_path = Path(str(demucs_res.result["vocals_path"]))
                    if demucs_res.result.get("no_vocals_path"):
                        no_vocals_path = Path(str(demucs_res.result["no_vocals_path"]))

            cancel_token.raise_if_cancelled()

            # --- Stage 3: CPU Speaker Diarization (sherpa-onnx) ---
            speakers_json_path = stems_dir / "speakers.json"
            if voice_mode != "single" and not speakers_json_path.exists():
                await run_diarize_worker(
                    job_id=job_id,
                    input_path=vocals_path if vocals_path.exists() else wav_path,
                    output_path=speakers_json_path,
                    voice_mode=voice_mode,
                    cancel_token=cancel_token,
                    on_progress=lambda pct, msg: self._emit_dubbing_progress(
                        job_id,
                        lang=target_lang,
                        status="diarizing",
                        stage="diarize",
                        percent=55.0 + pct * 0.05,
                        message=msg,
                        cut_id=cut_id,
                        cut_title=cut_title,
                        short_file=short_file,
                    ),
                    container=c,
                )

            speakers_payload = _load_speakers_json(speakers_json_path)
            diarized_turns = _extract_speaker_turns(speakers_payload)
            if voice_mode != "single" and diarized_turns:
                units = _assign_speakers_to_units(units, diarized_turns, voice_mode)
                save_dubbing_units(lang_dir / "dubbing.units.json", units)

            # --- Stage 4: Clean Speaker Reference Extraction ---
            refs_by_speaker, ref_warnings = self._collect_speaker_references(
                units,
                vocals_path if vocals_path.exists() else wav_path,
                no_vocals_path if no_vocals_path.exists() else None,
                diarized_turns,
                work_dir / "refs",
                words=words,
                segments=segments,
            )

            # --- Stage 5: TTS Synthesis inside GPUMutex ---
            tts_wav_dir = work_dir / "tts"
            tts_manifest_path = work_dir / "tts_manifest.json"
            tts_results_path = work_dir / "tts_results.json"
            tts_manifest_units = self._build_tts_manifest_units(units, refs_by_speaker, tts_wav_dir)
            atomic_write_json(
                tts_manifest_path,
                {
                    "engine": engine,
                    "language": target_lang,
                    "device": "auto",
                    "units": tts_manifest_units,
                },
            )

            async with c.scheduler.gpu_slot("dubbing_tts"):
                await run_tts_worker(
                    job_id=job_id,
                    engine=engine,
                    manifest_path=tts_manifest_path,
                    results_path=tts_results_path,
                    cancel_token=cancel_token,
                    on_progress=lambda pct, msg: self._emit_dubbing_progress(
                        job_id,
                        lang=target_lang,
                        status="synthesizing",
                        stage="tts",
                        percent=60.0 + pct * 0.25,
                        message=msg,
                        cut_id=cut_id,
                        cut_title=cut_title,
                        short_file=short_file,
                    ),
                    container=c,
                )

            tts_wav_by_uid: dict[str, Path] = {}
            for item in tts_manifest_units:
                uid = str(item["unit_id"])
                p = Path(str(item["output_wav_path"]))
                if not item.get("passthrough_original") and p.exists():
                    tts_wav_by_uid[uid] = p

            # Condensation callback if any unit overflows 1.20x after pause trimming
            async def _condense_and_resynth(unit: DubbingUnit, target_chars: int) -> tuple[str, Path | None]:
                condensed_txt = await condense_dub_unit_text(
                    unit,
                    target_lang,
                    target_chars=target_chars,
                    job_id=job_id,
                    container=c,
                    llm_adapter=self.llm_adapter,
                    cancel_token=cancel_token,
                    acquire_gpu_slot=True,
                )
                if not condensed_txt:
                    return unit.dub_text or unit.text, None
                unit.dub_text = condensed_txt
                sub_manifest = work_dir / f"tts_condense_{unit.unit_id}.json"
                sub_results = work_dir / f"tts_condense_{unit.unit_id}_res.json"
                out_wav = tts_wav_dir / f"{unit.unit_id}_condensed.wav"
                spk = unit.speaker or "SPEAKER_00"
                ref_res = refs_by_speaker.get(spk) or next(iter(refs_by_speaker.values()), None)
                atomic_write_json(
                    sub_manifest,
                    {
                        "engine": engine,
                        "language": target_lang,
                        "device": "auto",
                        "units": [
                            {
                                "unit_id": unit.unit_id,
                                "speaker": spk,
                                "dub_text": condensed_txt,
                                "passthrough_original": False,
                                "ref_wav_path": str(ref_res.ref_path) if (ref_res and ref_res.ref_path) else "",
                                "ref_text": ref_res.ref_text if ref_res else "",
                                "x_vector_only_mode": bool(ref_res.x_vector_only) if ref_res else True,
                                "output_wav_path": str(out_wav),
                            }
                        ],
                    },
                )
                async with c.scheduler.gpu_slot("dubbing_tts"):
                    await run_tts_worker(
                        job_id=job_id,
                        engine=engine,
                        manifest_path=sub_manifest,
                        results_path=sub_results,
                        cancel_token=cancel_token,
                        container=c,
                    )
                return condensed_txt, (out_wav if out_wav.exists() else None)

            # --- Stage 6: Sample-Exact 48kHz Audio Alignment & Ducking Mix ---
            self._emit_dubbing_progress(
                job_id,
                lang=target_lang,
                status="mixing",
                stage="mix",
                percent=88.0,
                message="[dubbing] Mixando áudio dublado em 48kHz (-14 LUFS)...",
                cut_id=cut_id,
                cut_title=cut_title,
                short_file=short_file,
            )
            out_audio_m4a = lang_dir / "dub.audio.m4a"
            mix_res: MixResult = await mix_dubbed_audio(
                units,
                tts_wav_by_uid,
                out_audio_m4a,
                vocals_path=vocals_path if vocals_path.exists() else None,
                no_vocals_path=no_vocals_path if no_vocals_path.exists() else None,
                total_duration=total_dur,
                work_dir=work_dir / "mix",
                condense_and_resynth=_condense_and_resynth,
                command_runner=self._ffmpeg_runner(),
                cancel_token=cancel_token,
                job_id=job_id,
                container=c,
            )

            export_warnings: list[str] = []
            exported_mp4_path: str | None = None
            exported_mp4_url: str | None = None
            if export_mp4_name:
                self._emit_dubbing_progress(
                    job_id,
                    lang=target_lang,
                    status="mixing",
                    stage="export",
                    percent=95.0,
                    message=f"[dubbing] Gerando short dublado ({export_mp4_name})...",
                    cut_id=cut_id,
                    cut_title=cut_title,
                    short_file=short_file,
                )
                out_mp4 = lang_dir / export_mp4_name
                exp_res = await export_dubbed_mp4(
                    source_video_path,
                    out_audio_m4a,
                    out_mp4,
                    target_lang,
                    preset=subtitle_preset,
                    subtitles_enabled=subtitles_enabled,
                    srt_path=lang_dir / "dub.srt",
                    vtt_path=lang_dir / "dub.vtt",
                    command_runner=self._ffmpeg_runner(),
                    cancel_token=cancel_token,
                    job_id=job_id,
                    container=c,
                )
                export_warnings.extend(exp_res.warnings)
                exported_mp4_path = str(exp_res.mp4_path)
                exported_mp4_url = f"{media_base}/{exp_res.mp4_path.name}"

            all_warnings = list(dict.fromkeys([*ref_warnings, *mix_res.warnings, *export_warnings]))
            speakers_count = len({u.speaker for u in units if not u.passthrough_original and u.speaker})

            if is_cut and cut_id is not None:
                cut_track = DubbingCutTrack(
                    cut_id=cut_id,
                    short_file=short_file or source_video_path.name,
                    lang=target_lang,
                    engine=engine,
                    voice_mode=voice_mode,
                    status="ready",
                    audio_url=f"{media_base}/dub.audio.m4a",
                    audio_path=str(out_audio_m4a),
                    vtt_url=f"{media_base}/dub.vtt",
                    srt_url=f"{media_base}/dub.srt",
                    exported_mp4_url=exported_mp4_url,
                    exported_mp4_path=exported_mp4_path,
                    duration_seconds=mix_res.duration_seconds,
                    speakers_count=speakers_count or 1,
                    units_count=len(units),
                    warnings=all_warnings,
                    subtitle_preset=subtitle_preset,
                    subtitles_enabled=subtitles_enabled,
                    created_at=now_iso,
                    updated_at=utc_now_iso(),
                )
                manifest = upsert_cut_dubbing_track(job_id, cut_id, target_lang, cut_track)
            else:
                track = DubbingTrack(
                    lang=target_lang,
                    engine=engine,
                    voice_mode=voice_mode,
                    status="ready",
                    audio_url=f"{media_base}/dub.audio.m4a",
                    audio_path=str(out_audio_m4a),
                    vtt_url=f"{media_base}/dub.vtt",
                    srt_url=f"{media_base}/dub.srt",
                    duration_seconds=mix_res.duration_seconds,
                    speakers_count=speakers_count or 1,
                    units_count=len(units),
                    warnings=all_warnings,
                    subtitle_preset=subtitle_preset,
                    subtitles_enabled=subtitles_enabled,
                    created_at=now_iso,
                    updated_at=utc_now_iso(),
                )
                manifest = upsert_dubbing_track(job_id, target_lang, track, set_active=True)

            sync_job_dubbing_fields(job_id, manifest, container=c, dubbing_status="ready")
            self._emit_dubbing_progress(
                job_id,
                lang=target_lang,
                status="ready",
                stage="done",
                percent=100.0,
                message=f"[dubbing] Dublagem ({target_lang}) concluída!",
                eta_seconds=0,
                track=track,
                cut_track=cut_track,
                cut_id=cut_id,
                cut_title=cut_title,
                short_file=short_file,
            )
            return manifest

        except OperationCancelledError:
            _persist_track_state("cancelled")
            self._emit_dubbing_progress(
                job_id,
                lang=target_lang,
                status="cancelled",
                stage="cancelled",
                percent=0.0,
                message="[dubbing] Dublagem cancelada pelo usuário.",
                track=track,
                cut_track=cut_track,
                cut_id=cut_id,
                cut_title=cut_title,
                short_file=short_file,
            )
            raise
        except Exception as exc:
            if cancel_token.is_set():
                _persist_track_state("cancelled")
                self._emit_dubbing_progress(
                    job_id,
                    lang=target_lang,
                    status="cancelled",
                    stage="cancelled",
                    percent=0.0,
                    message="[dubbing] Dublagem cancelada pelo usuário.",
                    track=track,
                    cut_track=cut_track,
                    cut_id=cut_id,
                    cut_title=cut_title,
                    short_file=short_file,
                )
                raise OperationCancelledError(job_id, "dubbing") from exc

            # Preserve track error status if not already recorded during download phase
            cur_manifest = load_or_create_dubbing_manifest(job_id)
            if is_cut and cut_id is not None:
                cur_existing = ((cur_manifest.cut_dubs or {}).get(cut_id) or {}).get(target_lang)
            else:
                cur_existing = (cur_manifest.tracks or {}).get(target_lang)

            if cur_existing is None or cur_existing.status != "error":
                _persist_track_state("error", error_msg=str(exc))
                self._emit_dubbing_progress(
                    job_id,
                    lang=target_lang,
                    status="error",
                    stage="error",
                    percent=0.0,
                    message=f"[dubbing] Erro na dublagem: {exc}",
                    error=str(exc),
                    track=track,
                    cut_track=cut_track,
                    cut_id=cut_id,
                    cut_title=cut_title,
                    short_file=short_file,
                )
            raise
        finally:
            c.runtime.cleanup_partial_files(job_id)
            c.runtime.clear_cancel_token(job_id, "dubbing")

    async def dub_video(
        self,
        job_id: str,
        target_lang: str = "pt-BR",
        *,
        engine: str | None = None,
        voice_mode: str | None = None,
        subtitles_enabled: bool | None = None,
        subtitle_preset: str | None = None,
    ) -> DubbingManifest:
        """Run the full local dubbing pipeline for `(job_id, target_lang)`."""
        c = self.c
        if c.runtime.is_dubbing_active(job_id):
            raise RuntimeError(f"Dublagem já está em andamento para o vídeo {job_id}.")

        job = c.jobs.load_job(job_id)
        video_path = c.jobs.find_source_video(job_id)
        if video_path is None or not video_path.exists():
            raise FileNotFoundError(f"Source video not found for job {job_id}")

        resolved_engine, resolved_voice_mode, resolved_sub_enabled, resolved_preset = (
            self._resolve_dubbing_options(
                engine=engine,
                voice_mode=voice_mode,
                subtitles_enabled=subtitles_enabled,
                subtitle_preset=subtitle_preset,
            )
        )

        video_dir = c.video_dir(job_id, job.video_name)
        dubs_root = dubs_dir_path(video_dir, create=True)

        return await self._run_dubbing_pipeline(
            job_id,
            source_video_path=video_path,
            work_root_dir=dubs_root,
            target_lang=target_lang,
            engine=resolved_engine,
            voice_mode=resolved_voice_mode,
            subtitles_enabled=resolved_sub_enabled,
            subtitle_preset=resolved_preset,
            prep_fn=lambda tok: self._ensure_transcription_and_audio(job_id, cancel_token=tok),
            has_cached_transcription=lambda: c.jobs.has_transcription(job_id),
        )

    async def dub_rendered_cut(
        self,
        job_id: str,
        cut_id: str,
        target_lang: str = "pt-BR",
        *,
        engine: str | None = None,
        voice_mode: str | None = None,
        subtitles_enabled: bool | None = None,
        subtitle_preset: str | None = None,
    ) -> DubbingManifest:
        """Run isolated local dubbing for a specific rendered cut and export `short.{lang}.dub.mp4`."""
        c = self.c
        if c.runtime.is_dubbing_active(job_id):
            raise RuntimeError(f"Dublagem já está em andamento para o vídeo {job_id}.")

        job = c.jobs.load_job(job_id)
        cuts = c.jobs.load_cuts(job_id)
        cut = next((item for item in cuts if item.cut_id == cut_id or item.id == cut_id), None)
        if cut is None:
            raise FileNotFoundError(f"Cut {cut_id} not found for job {job_id}")

        short_file = build_cut_filename(cut.start, cut.end, cut.cut_id)
        shorts_dir = c.jobs.shorts_dir_path(job_id, create=False)
        short_path = shorts_dir / short_file
        if not short_path.exists() or not short_path.is_file():
            raise FileNotFoundError(
                f"Rendered short not found for cut {cut_id} ({short_file})"
            )

        resolved_engine, resolved_voice_mode, resolved_sub_enabled, resolved_preset = (
            self._resolve_dubbing_options(
                engine=engine,
                voice_mode=voice_mode,
                subtitles_enabled=subtitles_enabled,
                subtitle_preset=subtitle_preset,
            )
        )

        video_dir = c.video_dir(job_id, job.video_name)
        dubs_root = dubs_dir_path(video_dir, create=True)
        cut_root = dubs_root / "_cuts" / cut_id
        prep_dir = cut_root / ".prep"
        duration_hint = max(0.5, round(float(cut.end) - float(cut.start), 3))

        return await self._run_dubbing_pipeline(
            job_id,
            source_video_path=short_path,
            work_root_dir=cut_root,
            target_lang=target_lang,
            engine=resolved_engine,
            voice_mode=resolved_voice_mode,
            subtitles_enabled=resolved_sub_enabled,
            subtitle_preset=resolved_preset,
            prep_fn=lambda tok: self._ensure_cut_transcription_and_audio(
                job_id,
                short_path,
                prep_dir,
                duration_hint=duration_hint,
                cancel_token=tok,
            ),
            has_cached_transcription=lambda: (prep_dir / "transcription.segments.json").exists(),
            cut_id=cut_id,
            cut_title=cut.title,
            short_file=short_file,
            export_mp4_name=f"short.{target_lang}.dub.mp4",
        )

    async def preview_20s(
        self,
        job_id: str,
        target_lang: str = "pt-BR",
        *,
        requested_start: float | None = None,
        duration: float = 20.0,
        engine: str | None = None,
        voice_mode: str | None = None,
    ) -> DubbingPreview:
        """Generate an isolated 20s quick dubbing preview in `dubs/{lang}/_preview/`."""
        c = self.c
        if c.runtime.is_dubbing_active(job_id):
            raise RuntimeError(f"Dublagem já está em andamento para o vídeo {job_id}.")

        job = c.jobs.load_job(job_id)
        video_path = c.jobs.find_source_video(job_id)
        if video_path is None or not video_path.exists():
            raise FileNotFoundError(f"Source video not found for job {job_id}")

        app_settings = c.load_settings()
        dub_cfg = app_settings.dubbing
        resolved_engine = normalize_dubbing_engine(engine or dub_cfg.engine)
        resolved_voice_mode = (voice_mode or dub_cfg.default_voice_mode or "auto").strip().lower()

        c.runtime.clear_task_logs(job_id, "dubbing")
        cancel_token = c.runtime.create_cancel_token(job_id, "dubbing")

        video_dir = c.video_dir(job_id, job.video_name)
        dubs_root = dubs_dir_path(video_dir, create=True)
        lang_dir = dubs_root / target_lang
        preview_dir = lang_dir / "_preview"
        preview_dir.mkdir(parents=True, exist_ok=True)
        work_dir = preview_dir / ".work_preview"
        work_dir.mkdir(parents=True, exist_ok=True)
        c.runtime.register_partial_dir(job_id, work_dir)

        try:
            self._emit_dubbing_progress(
                job_id,
                lang=target_lang,
                status="previewing",
                stage="preview_prep",
                percent=5.0,
                message="[dubbing] Preparando prévia de 20s...",
            )

            dl_task = asyncio.create_task(
                install_dubbing_dependencies(
                    resolved_engine,
                    cancel_token=cancel_token,
                    command_runner=getattr(c, "dubbing_command_runner", None),
                    container=c,
                )
            )
            prep_task = asyncio.create_task(
                self._ensure_transcription_and_audio(job_id, cancel_token=cancel_token)
            )

            dl_res, prep_res = await asyncio.gather(dl_task, prep_task, return_exceptions=True)
            if cancel_token.is_set():
                raise OperationCancelledError(job_id, "dubbing")
            if isinstance(dl_res, BaseException):
                raise dl_res
            if isinstance(prep_res, BaseException):
                raise prep_res

            wav_path, segments, words, total_dur = prep_res
            p_start, p_end = detect_preview_window(
                segments,
                requested_start,
                duration=duration,
                video_duration=total_dur,
                audio_path=wav_path,
            )
            p_dur = max(1.0, p_end - p_start)

            # Filter segments overlapping preview window
            slice_segs = [
                s for s in segments if float(s.end) > p_start and float(s.start) < p_end
            ]
            if not slice_segs and segments:
                slice_segs = [segments[0]]

            # Reuse translated units from full dubbing if already present, else translate slice units
            cached_full_units = load_dubbing_units(lang_dir / "dubbing.units.json")
            cached_map = {u.unit_id: u for u in cached_full_units if u.dub_text}
            if cached_map:
                preview_units = [
                    u for u in cached_full_units if u.end > p_start and u.start < p_end
                ]
                raw_dub_segs = read_json(lang_dir / "dub.segments.json") if (lang_dir / "dub.segments.json").exists() else []
                seg_subs = [
                    DubbingSegmentSubtitle(
                        seg_id=str(s.get("segment_id") or s.get("id") or i),
                        start=float(s.get("start", 0.0)),
                        end=float(s.get("end", 0.0)),
                        original_text=str(s.get("text", "")),
                        subtitle_text=str(s.get("text", "")),
                    )
                    for i, s in enumerate(raw_dub_segs or [], start=1)
                ]
                cues = format_subtitle_cues(seg_subs)
            else:
                preview_units = build_dubbing_units(
                    slice_segs,
                    words=words,
                    voice_mode=resolved_voice_mode,
                )
                tr_res = await translate_dubbing_units(
                    preview_units,
                    slice_segs,
                    target_lang,
                    job_id=job_id,
                    container=c,
                    llm_adapter=self.llm_adapter,
                    cancel_token=cancel_token,
                )
                preview_units = tr_res.units
                cues = tr_res.cues

            # Slice-only Demucs: [max(0, start - 2s), end + 5s]
            demucs_start = max(0.0, p_start - 2.0)
            demucs_end = min(total_dur, p_end + 5.0)
            preview_stems_dir = preview_dir / "_stems"
            preview_stems_dir.mkdir(parents=True, exist_ok=True)

            async with c.scheduler.gpu_slot("dubbing_demucs"):
                demucs_res = await run_demucs_worker(
                    job_id=job_id,
                    input_path=wav_path,
                    output_dir=preview_stems_dir,
                    start=demucs_start,
                    end=demucs_end,
                    cancel_token=cancel_token,
                    container=c,
                )
            p_vocals = Path(str(demucs_res.result.get("vocals_path") or (preview_stems_dir / "vocals.flac")))
            p_no_vocals = Path(str(demucs_res.result.get("no_vocals_path") or (preview_stems_dir / "no_vocals.flac")))

            diarized_turns: list[dict[str, Any]] = []
            if resolved_voice_mode != "single":
                p_spk_json = preview_stems_dir / "speakers.json"
                await run_diarize_worker(
                    job_id=job_id,
                    input_path=p_vocals if p_vocals.exists() else wav_path,
                    output_path=p_spk_json,
                    voice_mode=resolved_voice_mode,
                    cancel_token=cancel_token,
                    container=c,
                )
                raw_turns = _extract_speaker_turns(_load_speakers_json(p_spk_json))
                # Shift slice-relative diarization timestamps back to absolute video time
                diarized_turns = [
                    {
                        **t,
                        "start": float(t.get("start", 0.0)) + demucs_start,
                        "end": float(t.get("end", 0.0)) + demucs_start,
                    }
                    for t in raw_turns
                ]
                preview_units = _assign_speakers_to_units(preview_units, diarized_turns, resolved_voice_mode)

            refs_by_speaker, preview_warnings = self._collect_speaker_references(
                preview_units,
                p_vocals if p_vocals.exists() else wav_path,
                p_no_vocals if p_no_vocals.exists() else None,
                diarized_turns,
                work_dir / "refs",
                words=words,
                segments=segments,
                time_offset=demucs_start if p_vocals.exists() else 0.0,
            )

            # Probe +45s ahead if any speaker had < 2.5s clean speech in the preview slice
            if any(r.needs_probe_ahead for r in refs_by_speaker.values()) and total_dur > demucs_end + 3.0:
                ahead_start = demucs_end
                ahead_end = min(total_dur, ahead_start + 45.0)
                ahead_stems = work_dir / "_stems_ahead"
                async with c.scheduler.gpu_slot("dubbing_demucs"):
                    ahead_res = await run_demucs_worker(
                        job_id=job_id,
                        input_path=wav_path,
                        output_dir=ahead_stems,
                        start=ahead_start,
                        end=ahead_end,
                        cancel_token=cancel_token,
                        container=c,
                    )
                a_voc = Path(str(ahead_res.result.get("vocals_path") or (ahead_stems / "vocals.flac")))
                a_novoc = Path(str(ahead_res.result.get("no_vocals_path") or (ahead_stems / "no_vocals.flac")))
                for spk, cur_ref in list(refs_by_speaker.items()):
                    if not cur_ref.needs_probe_ahead:
                        continue
                    retry_ref = select_clean_speaker_reference(
                        a_voc if a_voc.exists() else wav_path,
                        a_novoc if a_novoc.exists() else None,
                        diarized_turns,
                        spk,
                        output_dir=work_dir / "refs_ahead",
                        words=words,
                        transcription_segments=segments,
                        time_offset=ahead_start if a_voc.exists() else 0.0,
                    )
                    if retry_ref.ref_path is not None and not retry_ref.needs_probe_ahead:
                        refs_by_speaker[spk] = retry_ref

            tts_wav_dir = work_dir / "tts"
            tts_manifest_path = work_dir / "tts_preview_manifest.json"
            tts_results_path = work_dir / "tts_preview_results.json"
            tts_manifest_units = self._build_tts_manifest_units(preview_units, refs_by_speaker, tts_wav_dir)
            atomic_write_json(
                tts_manifest_path,
                {
                    "engine": resolved_engine,
                    "language": target_lang,
                    "device": "auto",
                    "units": tts_manifest_units,
                },
            )
            async with c.scheduler.gpu_slot("dubbing_tts"):
                await run_tts_worker(
                    job_id=job_id,
                    engine=resolved_engine,
                    manifest_path=tts_manifest_path,
                    results_path=tts_results_path,
                    cancel_token=cancel_token,
                    container=c,
                )

            tts_wav_by_uid = {
                str(item["unit_id"]): Path(str(item["output_wav_path"]))
                for item in tts_manifest_units
                if not item.get("passthrough_original") and Path(str(item["output_wav_path"])).exists()
            }

            preview_audio = preview_dir / "preview.audio.m4a"
            await mix_dubbed_audio(
                preview_units,
                tts_wav_by_uid,
                preview_audio,
                vocals_path=p_vocals if p_vocals.exists() else None,
                no_vocals_path=p_no_vocals if p_no_vocals.exists() else None,
                total_duration=p_dur,
                window_start=p_start,
                work_dir=work_dir / "mix",
                command_runner=self._ffmpeg_runner(),
                cancel_token=cancel_token,
                job_id=job_id,
                container=c,
            )

            # preview.vtt keeps absolute video timestamps [p_start, p_end]
            preview_vtt_path = preview_dir / "preview.vtt"
            preview_vtt_content = generate_dub_vtt(cues, window_start=p_start, window_end=p_end)
            atomic_write_text(preview_vtt_path, preview_vtt_content)

            audio_url = f"/media/dubs/{job_id}/{target_lang}/_preview/preview.audio.m4a"
            vtt_url = f"/media/dubs/{job_id}/{target_lang}/_preview/preview.vtt"
            preview_obj = DubbingPreview(
                lang=target_lang,
                engine=resolved_engine,
                voice_mode=resolved_voice_mode,
                status="ready",
                preview_start=p_start,
                preview_end=p_end,
                duration=round(p_dur, 3),
                audio_url=audio_url,
                vtt_url=vtt_url,
                audio_path=str(preview_audio),
                vtt_path=str(preview_vtt_path),
                warnings=preview_warnings,
                updated_at=utc_now_iso(),
            )
            save_preview_manifest(preview_dir, preview_obj.model_dump())
            set_dubbing_preview(job_id, preview_obj)

            self._emit_dubbing_progress(
                job_id,
                lang=target_lang,
                status="preview_ready",
                stage="preview_done",
                percent=100.0,
                message=f"[dubbing] Prévia 20s ({p_start:.1f}s–{p_end:.1f}s) pronta!",
                preview=preview_obj,
            )
            return preview_obj
        finally:
            c.runtime.cleanup_partial_files(job_id)
            c.runtime.clear_cancel_token(job_id, "dubbing")

    def cancel_dubbing(self, job_id: str) -> bool:
        """Request cooperative cancellation of active dubbing for `job_id`."""
        c = self.c
        cancelled = c.runtime.request_cancel(job_id, task="dubbing")
        if not cancelled:
            return False

        manifest = load_dubbing_manifest(job_id)
        if manifest is not None:
            handled = False
            for cut_id, lang_map in (manifest.cut_dubs or {}).items():
                for lang, cut_tr in (lang_map or {}).items():
                    if cut_tr.status not in ("ready", "error", "cancelled"):
                        cut_tr.status = "cancelled"
                        cut_tr.updated_at = utc_now_iso()
                        manifest = upsert_cut_dubbing_track(job_id, cut_id, lang, cut_tr)
                        sync_job_dubbing_fields(job_id, manifest, container=c, dubbing_status="cancelled")
                        self._emit_dubbing_progress(
                            job_id,
                            lang=lang,
                            status="cancelled",
                            stage="cancelled",
                            percent=0.0,
                            message="[dubbing] Cancelamento solicitado.",
                            cut_track=cut_tr,
                            cut_id=cut_id,
                            short_file=cut_tr.short_file,
                        )
                        handled = True

            if not handled and manifest.active_lang:
                lang = manifest.active_lang
                tr = (manifest.tracks or {}).get(lang)
                if tr is not None and tr.status not in ("ready", "error"):
                    tr.status = "cancelled"
                    tr.updated_at = utc_now_iso()
                    manifest = upsert_dubbing_track(job_id, lang, tr, set_active=True)
                    sync_job_dubbing_fields(job_id, manifest, container=c, dubbing_status="cancelled")
                self._emit_dubbing_progress(
                    job_id,
                    lang=lang,
                    status="cancelled",
                    stage="cancelled",
                    percent=0.0,
                    message="[dubbing] Cancelamento solicitado.",
                    track=tr,
                )
        return True

    async def export_dub(
        self,
        job_id: str,
        target_lang: str,
        *,
        preset: str | None = None,
        subtitles_enabled: bool | None = None,
    ) -> ExportDubbedResult:
        """Export dubbed `.mp4` using Preset 1 (`mov_text`) or Preset 2 (`hardsub`)."""
        c = self.c
        job = c.jobs.load_job(job_id)
        src_video = c.jobs.find_source_video(job_id)
        if src_video is None or not src_video.exists():
            raise FileNotFoundError(f"Source video not found for job {job_id}")

        app_settings = c.load_settings()
        resolved_preset = (preset or app_settings.dubbing.default_subtitle_preset or "mov_text").strip().lower()
        resolved_subs = (
            app_settings.dubbing.default_subtitles_enabled
            if subtitles_enabled is None
            else bool(subtitles_enabled)
        )

        video_dir = c.video_dir(job_id, job.video_name)
        lang_dir = dubs_dir_path(video_dir, create=False) / target_lang
        dub_audio = lang_dir / "dub.audio.m4a"
        if not dub_audio.exists():
            raise FileNotFoundError(f"Dubbed audio not found for {job_id} ({target_lang})")

        suffix_tag = "hardsub" if resolved_preset == "hardsub" else "dub"
        out_mp4 = lang_dir / f"video.{target_lang}.{suffix_tag}.mp4"
        res = await export_dubbed_mp4(
            src_video,
            dub_audio,
            out_mp4,
            target_lang,
            preset=resolved_preset,
            subtitles_enabled=resolved_subs,
            srt_path=lang_dir / "dub.srt",
            vtt_path=lang_dir / "dub.vtt",
            command_runner=self._ffmpeg_runner(),
            job_id=job_id,
            container=c,
        )

        manifest = load_dubbing_manifest(job_id)
        if manifest is not None and target_lang in (manifest.tracks or {}):
            tr = manifest.tracks[target_lang]
            tr.exported_mp4_url = f"/media/dubs/{job_id}/{target_lang}/{out_mp4.name}"
            tr.exported_mp4_path = str(out_mp4)
            tr.subtitle_preset = res.preset
            tr.updated_at = utc_now_iso()
            upsert_dubbing_track(job_id, target_lang, tr, set_active=False)

        return res

    async def send_to_cuts(self, job_id: str, target_lang: str) -> dict[str, Any]:
        """Create a new clean dubbed video job ready for Shorts Cuts generation."""
        c = self.c
        job = c.jobs.load_job(job_id)
        video_dir = c.video_dir(job_id, job.video_name)
        lang_dir = dubs_dir_path(video_dir, create=False) / target_lang
        dub_audio = lang_dir / "dub.audio.m4a"
        return await prepare_send_to_cuts_job(
            job_id,
            target_lang,
            dub_audio_path=dub_audio,
            dub_dir=lang_dir,
            container=c,
            command_runner=self._ffmpeg_runner(),
        )

    def delete_dub(self, job_id: str, target_lang: str) -> DubbingManifest:
        """Delete dubbed outputs for `(job_id, target_lang)` and update manifest + job metadata."""
        c = self.c
        if c.runtime.is_dubbing_active(job_id):
            raise RuntimeError("Não é possível remover a dublagem enquanto ela está em execução.")

        job = c.jobs.load_job(job_id)
        video_dir = c.video_dir(job_id, job.video_name)
        dubs_root = dubs_dir_path(video_dir, create=False)
        lang_dir = dubs_root / target_lang
        if lang_dir.exists():
            shutil.rmtree(lang_dir, ignore_errors=True)

        manifest = remove_dubbing_track(job_id, target_lang)
        # Clean up _stems if no language tracks remain
        if dubs_root.exists() and not (manifest.tracks or {}):
            stems_dir = dubs_root / "_stems"
            if stems_dir.exists():
                shutil.rmtree(stems_dir, ignore_errors=True)

        sync_job_dubbing_fields(job_id, manifest, container=c)
        return manifest


_default_dubbing_service: DubbingService | None = None


def get_dubbing_service(
    container: ServiceContainer | None = None,
    llm_adapter: UnifiedLocalLLMAdapter | None = None,
) -> DubbingService:
    global _default_dubbing_service
    if container is not None or llm_adapter is not None:
        return DubbingService(container=container, llm_adapter=llm_adapter)
    if _default_dubbing_service is None:
        _default_dubbing_service = DubbingService()
    return _default_dubbing_service


__all__ = [
    "DubbingService",
    "get_dubbing_service",
]
