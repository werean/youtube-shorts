"""Stage 1 Domain Service: Native `yt_dlp` ingestion, `ffprobe` media duration, chapter anchors, local upload, and 16kHz PCM audio extraction."""

from __future__ import annotations

import asyncio
import inspect
import shutil
import uuid
from pathlib import Path
from typing import Any, Awaitable, Callable

from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.core.settings import get_video_dir, get_video_file_path
from app.infrastructure.audio.pcm_extractor import (
    extract_pcm_16k_wav,
    probe_media_duration,
)
from app.models.domain import ChapterAnchor, Job, JobStatus, SourceVideoInfo

PRIMARY_FORMAT_BY_RESOLUTION: dict[str, str] = {
    "1080p": "bv*[height<=1080]+ba/b[height<=1080]",
    "1440p": "bv*[height<=1440]+ba/b[height<=1440]",
    "4k": "bv*[height<=2160]+ba/b[height<=2160]",
}
FALLBACK_FORMAT_SELECTOR = "bestvideo+bestaudio/best"

YtDlpFactoryFn = Callable[[dict[str, Any]], Any]
_custom_ytdlp_factory: YtDlpFactoryFn | None = None


def set_custom_ytdlp_factory(factory: YtDlpFactoryFn | None) -> None:
    """Register a custom/mock YoutubeDL class or factory for logical tests."""
    global _custom_ytdlp_factory
    _custom_ytdlp_factory = factory


def normalize_chapters(raw_chapters: Any) -> list[ChapterAnchor]:
    """Normalize raw `yt_dlp` chapter dictionaries into `ChapterAnchor` models."""
    if not isinstance(raw_chapters, list):
        return []
    anchors: list[ChapterAnchor] = []
    for idx, item in enumerate(raw_chapters):
        if not isinstance(item, dict):
            continue
        start_raw = item.get("start_time")
        end_raw = item.get("end_time")
        if start_raw is None or end_raw is None:
            continue
        try:
            start_f = round(float(start_raw), 3)
            end_f = round(float(end_raw), 3)
        except (TypeError, ValueError):
            continue
        if end_f <= start_f:
            continue
        title = str(item.get("title") or f"Chapter {idx + 1}").strip()
        anchors.append(ChapterAnchor(title=title, start_time=start_f, end_time=end_f))
    return anchors


def build_source_video_info(
    info_dict: dict[str, Any],
    *,
    duration_override: float | None = None,
) -> dict[str, Any]:
    """Build canonical `source.info.json` payload preserving chapters and core metadata."""
    chapters = normalize_chapters(info_dict.get("chapters"))
    raw_duration = duration_override if duration_override is not None else info_dict.get("duration")
    duration_val: float | None = None
    if raw_duration is not None:
        try:
            d = float(raw_duration)
            if d > 0:
                duration_val = round(d, 3)
        except (TypeError, ValueError):
            duration_val = None

    # Keep a clean JSON-serializable snapshot of info_dict without internal hooks/streams
    serializable_raw: dict[str, Any] = {}
    for k, v in info_dict.items():
        if k.startswith("_") or k in ("formats", "thumbnails", "automatic_captions", "subtitles", "requested_formats"):
            continue
        if isinstance(v, (str, int, float, bool, list, dict)) or v is None:
            serializable_raw[k] = v

    model = SourceVideoInfo(
        id=str(info_dict.get("id")) if info_dict.get("id") is not None else None,
        title=str(info_dict.get("title")).strip() if info_dict.get("title") else None,
        duration=duration_val,
        webpage_url=str(info_dict.get("webpage_url") or info_dict.get("original_url") or "") or None,
        chapters=chapters,
        raw_info=serializable_raw,
    )
    payload = model.model_dump()
    # Keep top-level compatibility fields expected by legacy readers
    for key in ("uploader", "channel", "upload_date", "view_count", "description", "ext"):
        if key in serializable_raw and key not in payload:
            payload[key] = serializable_raw[key]
    return payload


class YtDlpNativeAdapter:
    """Native Python `yt_dlp` adapter with format fallback and real-time progress hooks."""

    def __init__(self, *, ytdlp_factory: YtDlpFactoryFn | None = None) -> None:
        self.ytdlp_factory = ytdlp_factory

    def _get_factory(self) -> YtDlpFactoryFn:
        if self.ytdlp_factory is not None:
            return self.ytdlp_factory
        if _custom_ytdlp_factory is not None:
            return _custom_ytdlp_factory
        # Lazy import per architecture rules (never import yt_dlp at module top-level)
        import yt_dlp

        return yt_dlp.YoutubeDL

    def _run_extract_info_sync(
        self,
        url: str,
        ydl_opts: dict[str, Any],
    ) -> dict[str, Any]:
        factory = self._get_factory()
        ydl_ctx = factory(ydl_opts)
        if hasattr(ydl_ctx, "__enter__"):
            with ydl_ctx as ydl:
                info = ydl.extract_info(url, download=True)
        else:
            info = ydl_ctx.extract_info(url, download=True)
        if not isinstance(info, dict):
            raise RuntimeError("yt-dlp did not return a valid info dictionary")
        return info

    async def download_video(
        self,
        url: str,
        output_template: str | Path,
        *,
        resolution: str = "1080p",
        on_progress: Callable[[dict[str, Any]], None] | None = None,
        cancel_token: CancelToken | None = None,
    ) -> dict[str, Any]:
        """Download video with primary format selector and automatic fallback to `bestvideo+bestaudio/best`."""
        primary_format = PRIMARY_FORMAT_BY_RESOLUTION.get(
            resolution, PRIMARY_FORMAT_BY_RESOLUTION["1080p"]
        )

        def _hook(d: dict[str, Any]) -> None:
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()
            if on_progress is not None:
                on_progress(d)

        base_opts: dict[str, Any] = {
            "format": primary_format,
            "outtmpl": str(output_template),
            "merge_output_format": "mp4",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            "progress_hooks": [_hook],
        }

        try:
            return await asyncio.to_thread(self._run_extract_info_sync, url, base_opts)
        except OperationCancelledError:
            raise
        except Exception as primary_exc:
            if cancel_token is not None and cancel_token.is_set():
                raise OperationCancelledError(cancel_token.job_id, cancel_token.task) from primary_exc
            fallback_opts = {
                **base_opts,
                "format": FALLBACK_FORMAT_SELECTOR,
            }
            try:
                return await asyncio.to_thread(self._run_extract_info_sync, url, fallback_opts)
            except OperationCancelledError:
                raise
            except Exception as fallback_exc:
                raise RuntimeError(f"{primary_exc} (fallback error: {fallback_exc})") from fallback_exc


class IngestDomainService:
    """Domain service orchestrating YouTube ingestion, local uploads, media probing, and 16kHz audio extraction."""

    def __init__(
        self,
        *,
        container: ServiceContainer | None = None,
        ytdlp_adapter: YtDlpNativeAdapter | None = None,
        media_prober: Callable[[str | Path], float | None | Awaitable[float | None]] | None = None,
        pcm_extractor: Callable[..., Path | Awaitable[Path]] | None = None,
    ) -> None:
        self._container = container
        self.ytdlp_adapter = ytdlp_adapter or YtDlpNativeAdapter()
        self._media_prober = media_prober
        self._pcm_extractor = pcm_extractor

    @property
    def c(self) -> ServiceContainer:
        return self._container or get_container()

    async def _probe_duration(self, video_path: Path) -> float | None:
        if self._media_prober is not None:
            res = self._media_prober(video_path)
            if inspect.isawaitable(res):
                res = await res
            return round(float(res), 3) if res is not None else None
        return await probe_media_duration(video_path)

    async def _extract_audio_16k(
        self,
        video_path: Path,
        output_wav_path: Path,
        *,
        duration_hint: float | None = None,
    ) -> Path:
        if self._pcm_extractor is not None:
            res = self._pcm_extractor(video_path, output_wav_path, duration_hint_seconds=duration_hint)
            if inspect.isawaitable(res):
                res = await res
            return Path(res)
        return await extract_pcm_16k_wav(
            video_path,
            output_wav_path,
            duration_hint_seconds=duration_hint,
        )

    def _find_downloaded_video_file(self, directory: Path) -> Path | None:
        if not directory.exists():
            return None
        for entry in sorted(directory.iterdir(), key=lambda p: p.name):
            if entry.is_file() and entry.name.startswith("video.") and not entry.name.endswith(".part"):
                return entry
        for entry in sorted(directory.iterdir(), key=lambda p: p.name):
            if entry.is_file() and entry.suffix.lower() in (".mp4", ".mkv", ".webm", ".mov"):
                return entry
        return None

    async def ingest_job(self, job_id: str) -> dict[str, Any]:
        """Execute Stage 1 ingestion for `job_id` inside `c.scheduler.io_slot()`."""
        c = self.c
        job = c.jobs.load_job(job_id)

        c.runtime.clear_task_logs(job_id, "ingest")
        c.runtime.clear_task_logs(job_id, "transcription")
        c.runtime.clear_task_logs(job_id, "render")

        cancel_token = c.runtime.create_cancel_token(job_id, "ingest")

        try:
            async with c.scheduler.io_slot():
                info_path = c.jobs.source_info_path(job_id)

                # Fast path: existing source video & metadata already on disk
                if (
                    job.source_video_path
                    and Path(job.source_video_path).exists()
                    and info_path.exists()
                ):
                    existing_video = Path(job.source_video_path)
                    c.runtime.append_task_log(
                        job_id, "ingest", "[ingest] Video already exists. Skipping download."
                    )
                    existing_info = c.jobs.load_source_info(job_id) or {}
                    title = existing_info.get("title")
                    duration = job.video_duration_seconds
                    if not duration or duration <= 0:
                        probed = await self._probe_duration(existing_video)
                        info_dur = existing_info.get("duration")
                        duration = float(probed or info_dur or 0.0)

                    def _upd_existing(j: Job) -> None:
                        j.status = JobStatus.DOWNLOADED
                        if title and not j.video_name:
                            j.video_name = str(title)
                        if not j.video_name:
                            j.video_name = j.job_id
                        if duration and duration > 0:
                            j.video_duration_seconds = round(float(duration), 3)

                    updated = c.jobs.update_job(job_id, _upd_existing)
                    wav_path = c.jobs.audio_16k_path(job_id)
                    if not wav_path.exists():
                        await self._extract_audio_16k(
                            existing_video, wav_path, duration_hint=updated.video_duration_seconds
                        )
                    c.jobs.set_cached_source_video(job_id, existing_video)
                    c.runtime.publish_progress(
                        job_id,
                        status=JobStatus.DOWNLOADED.value,
                        task="ingest",
                        percent=100.0,
                        eta_seconds=0,
                        message="[ingest] Video ready for playback",
                    )
                    c.runtime.publish_state_change(
                        job_id, JobStatus.DOWNLOADED.value, "[ingest] Video ready for playback"
                    )
                    return {
                        "video_path": f"/media/videos/{job_id}",
                        "metadata_path": str(info_path),
                        "full_path": str(existing_video),
                        "job_id": job_id,
                        "status": JobStatus.DOWNLOADED.value,
                    }

                c.jobs.update_job_status(job_id, JobStatus.DOWNLOADING)
                c.runtime.publish_state_change(
                    job_id, JobStatus.DOWNLOADING.value, "[ingest] Starting ingestion"
                )
                c.runtime.append_task_logs(
                    job_id,
                    "ingest",
                    [
                        "[ingest] Starting ingestion",
                        f"[ingest] URL: {job.youtube_url}",
                    ],
                )

                temp_video_dir = get_video_dir(job_id, job.video_name or job_id)
                temp_video_dir.mkdir(parents=True, exist_ok=True)
                output_template = temp_video_dir / "video.%(ext)s"

                c.runtime.append_task_logs(
                    job_id,
                    "ingest",
                    [
                        f"[ingest] Output: {output_template}",
                        f"[ingest] Info: {info_path}",
                    ],
                )

                app_settings = c.load_settings()
                resolution = app_settings.media.download_resolution

                def _on_ytdlp_progress(d: dict[str, Any]) -> None:
                    status = d.get("status")
                    if status == "downloading":
                        downloaded = float(d.get("downloaded_bytes") or 0.0)
                        total = float(
                            d.get("total_bytes") or d.get("total_bytes_estimate") or 0.0
                        )
                        pct = (downloaded / total * 90.0) if total > 0 else 45.0
                        eta = d.get("eta")
                        eta_int = int(eta) if isinstance(eta, (int, float)) and eta >= 0 else None
                        c.runtime.publish_progress(
                            job_id,
                            status=JobStatus.DOWNLOADING.value,
                            task="ingest",
                            percent=min(90.0, max(1.0, pct)),
                            eta_seconds=eta_int,
                            message=f"[ingest] Downloading: {pct:.1f}%",
                        )
                    elif status == "finished":
                        c.runtime.publish_progress(
                            job_id,
                            status=JobStatus.DOWNLOADING.value,
                            task="ingest",
                            percent=92.0,
                            eta_seconds=1,
                            message="[ingest] Download completed",
                        )

                info_dict = await self.ytdlp_adapter.download_video(
                    job.youtube_url,
                    output_template,
                    resolution=resolution,
                    on_progress=_on_ytdlp_progress,
                    cancel_token=cancel_token,
                )

                cancel_token.raise_if_cancelled()

                downloaded_file = self._find_downloaded_video_file(temp_video_dir)
                if downloaded_file is None:
                    raise RuntimeError("Downloaded video file not found on disk")

                c.runtime.append_task_log(
                    job_id, "ingest", f"[ingest] File: {downloaded_file.name}"
                )

                # Resolve duration via ffprobe and/or yt_dlp info_dict
                probed_duration = await self._probe_duration(downloaded_file)
                info_duration = info_dict.get("duration")
                resolved_duration: float = 0.0
                if probed_duration is not None and probed_duration > 0:
                    resolved_duration = float(probed_duration)
                elif info_duration is not None:
                    try:
                        resolved_duration = float(info_duration)
                    except (TypeError, ValueError):
                        resolved_duration = 0.0

                # Persist source.info.json (including chapters)
                source_info = build_source_video_info(
                    info_dict,
                    duration_override=resolved_duration if resolved_duration > 0 else None,
                )
                c.jobs.save_source_info(job_id, source_info)

                # Determine final video_name and move folder if needed
                raw_title = str(info_dict.get("title") or "").strip()
                target_video_name = job.video_name or raw_title or job_id
                final_video_dir = get_video_dir(job_id, target_video_name)

                final_video_path = downloaded_file
                if final_video_dir.resolve() != temp_video_dir.resolve():
                    final_video_dir.parent.mkdir(parents=True, exist_ok=True)
                    if final_video_dir.exists():
                        # Move files into existing target directory
                        for item in temp_video_dir.iterdir():
                            dest_item = final_video_dir / item.name
                            if dest_item.exists():
                                if dest_item.is_dir():
                                    shutil.rmtree(dest_item, ignore_errors=True)
                                else:
                                    dest_item.unlink(missing_ok=True)
                            shutil.move(str(item), str(dest_item))
                        shutil.rmtree(temp_video_dir, ignore_errors=True)
                    else:
                        shutil.move(str(temp_video_dir), str(final_video_dir))
                    final_video_path = final_video_dir / downloaded_file.name

                # Update job metadata first so audio_16k_path resolves to final_video_dir
                def _finalize_job(j: Job) -> None:
                    j.status = JobStatus.DOWNLOADED
                    j.video_name = target_video_name
                    j.source_video_path = str(final_video_path)
                    j.video_duration_seconds = round(float(resolved_duration), 3)

                updated_job = c.jobs.update_job(job_id, _finalize_job)
                c.jobs.set_cached_source_video(job_id, final_video_path)

                # Extract 16kHz mono PCM WAV in {video_dir}/transcrições/audio_16k.wav
                wav_target = c.jobs.audio_16k_path(job_id)
                await self._extract_audio_16k(
                    final_video_path,
                    wav_target,
                    duration_hint=updated_job.video_duration_seconds,
                )

                c.runtime.publish_progress(
                    job_id,
                    status=JobStatus.DOWNLOADED.value,
                    task="ingest",
                    percent=100.0,
                    eta_seconds=0,
                    message="[ingest] Video ready for playback",
                )
                c.runtime.publish_state_change(
                    job_id, JobStatus.DOWNLOADED.value, "[ingest] Video ready for playback"
                )

                return {
                    "video_path": f"/media/videos/{job_id}",
                    "metadata_path": str(info_path),
                    "full_path": str(final_video_path),
                    "job_id": job_id,
                    "status": JobStatus.DOWNLOADED.value,
                }
        except Exception as exc:
            c.runtime.log_exception(
                job_id,
                "ingest",
                exc,
                message="[ingest] CRITICAL ERROR",
            )
            c.jobs.update_job_status(job_id, JobStatus.ERROR)
            c.runtime.publish_state_change(job_id, JobStatus.ERROR.value, f"[ingest] {exc}")
            msg = str(exc)
            if not msg.startswith("Ingestion failed:"):
                msg = f"Ingestion failed: {msg}"
            raise RuntimeError(msg) from exc
        finally:
            c.runtime.clear_cancel_token(job_id, "ingest")

    async def upload_local_video(
        self,
        *,
        filename: str,
        content: bytes | Any,
    ) -> dict[str, Any]:
        """Save an uploaded local video file, probe duration via `ffprobe`, extract 16kHz WAV, and create a `DOWNLOADED` Job."""
        c = self.c
        clean_filename = Path(filename or "video.mp4").name
        video_name = Path(clean_filename).stem or "uploaded_video"
        ext = Path(clean_filename).suffix or ".mp4"
        job_id = uuid.uuid4().hex

        video_path = get_video_file_path(job_id, video_name, ext)
        video_path.parent.mkdir(parents=True, exist_ok=True)

        if isinstance(content, (bytes, bytearray, memoryview)):
            video_path.write_bytes(bytes(content))
        elif hasattr(content, "read"):
            try:
                sig = inspect.signature(content.read)
                accepts_size = len(sig.parameters) > 0
            except (TypeError, ValueError):
                accepts_size = False

            if accepts_size:
                with video_path.open("wb") as out_fh:
                    while True:
                        chunk = content.read(1024 * 1024)
                        if inspect.isawaitable(chunk):
                            chunk = await chunk
                        if not chunk:
                            break
                        out_fh.write(bytes(chunk))
            else:
                data = content.read()
                if inspect.isawaitable(data):
                    data = await data
                video_path.write_bytes(bytes(data))
        else:
            raise ValueError("Unsupported upload content stream")

        job_created = False
        try:
            async with c.scheduler.io_slot():
                probed_duration = await self._probe_duration(video_path)
                duration_sec = round(float(probed_duration), 3) if probed_duration and probed_duration > 0 else 0.0

                job = c.jobs.create_job(
                    f"[Local Upload] {clean_filename}",
                    status=JobStatus.DOWNLOADED,
                    job_id=job_id,
                    source_video_path=str(video_path),
                    source_file_name=clean_filename,
                    video_name=video_name,
                    video_duration_seconds=duration_sec,
                )
                job_created = True
                c.jobs.set_cached_source_video(job_id, video_path)

                # Save source.info.json for local upload consistency
                c.jobs.save_source_info(
                    job_id,
                    {
                        "id": job_id,
                        "title": video_name,
                        "duration": duration_sec,
                        "webpage_url": job.youtube_url,
                        "chapters": [],
                    },
                )

                # Extract 16kHz PCM WAV in {video_dir}/transcrições/audio_16k.wav
                wav_target = c.jobs.audio_16k_path(job_id)
                await self._extract_audio_16k(
                    video_path,
                    wav_target,
                    duration_hint=duration_sec if duration_sec > 0 else 1.0,
                )
        except Exception as exc:
            if job_created:
                c.runtime.log_exception(
                    job_id,
                    "ingest",
                    exc,
                    message=f"[ingest] Local upload post-processing failed for {clean_filename}",
                )
                c.jobs.update_job_status(job_id, JobStatus.ERROR)
                c.runtime.publish_state_change(
                    job_id, JobStatus.ERROR.value, f"[ingest] Local upload failed: {exc}"
                )
            raise

        c.runtime.publish_state_change(
            job_id, JobStatus.DOWNLOADED.value, f"[ingest] Local upload saved: {clean_filename}"
        )

        return {
            "job": job,
            "video_path": f"/media/videos/{job_id}",
        }


_default_ingest_service: IngestDomainService | None = None


def get_ingest_service(
    container: ServiceContainer | None = None,
    ytdlp_adapter: YtDlpNativeAdapter | None = None,
    pcm_extractor: PcmExtractor | None = None,
) -> IngestDomainService:
    global _default_ingest_service
    if container or ytdlp_adapter or pcm_extractor:
        return IngestDomainService(
            container=container,
            ytdlp_adapter=ytdlp_adapter,
            pcm_extractor=pcm_extractor,
        )
    if _default_ingest_service is None:
        _default_ingest_service = IngestDomainService()
    return _default_ingest_service


async def ingest_video(
    job_or_id: Job | str,
    *,
    container: ServiceContainer | None = None,
    **kwargs: Any,
) -> dict[str, Any]:
    """Convenience entrypoint for Wave 3 orchestrator (`await ingest_video(job_id)`)."""
    job_id = job_or_id.job_id if isinstance(job_or_id, Job) else str(job_or_id)
    return await get_ingest_service(container=container).ingest_job(job_id, **kwargs)
