"""Domain rendering service: orchestrates 9:16 Virtual Cameraman, ASS subtitles, filter script, and FFmpeg NVENC execution.

Exposes the clean public callable interface for Wave 2 router and Wave 3 orchestrator.
"""

from __future__ import annotations

import asyncio
import shutil
import subprocess
from pathlib import Path
from typing import Any, Callable, Sequence

from app.application.job_lifecycle import JobNotFoundError
from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.domain.rendering.ass_generator import (
    TimelineMapper,
    build_timeline_mapper,
    write_ass_subtitle_file,
)
from app.domain.rendering.virtual_cameraman import (
    VerticalPresetMode,
    VirtualCameramanPlan,
    build_virtual_cameraman_plan,
)
from app.infrastructure.video.ffmpeg_executor import (
    FFmpegNvencExecutor,
    SubprocessRunner,
)
from app.infrastructure.video.filter_script_builder import (
    FilterScriptOptions,
    write_filter_complex_script_file,
)
from app.infrastructure.vision.face_tracker import (
    FrameObservation,
    MediaPipeVisionAdapter,
)
from app.models.domain import Cut, Job, JobStatus, Segment, WordTiming


def _probe_video_has_audio(video_path: Path) -> bool:
    """Detect whether a real video file contains at least one audio stream via ffprobe."""
    try:
        if not video_path.exists() or video_path.stat().st_size <= 4096:
            return True
    except OSError:
        return True

    ffprobe_bin = shutil.which("ffprobe")
    if not ffprobe_bin:
        return True

    try:
        proc = subprocess.run(
            [
                ffprobe_bin,
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=index",
                "-of",
                "csv=p=0",
                str(video_path),
            ],
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        if proc.returncode == 0:
            return bool(proc.stdout.strip())
    except Exception:
        pass
    return True


def format_timestamp_for_filename(seconds: float) -> str:
    """Format seconds into MM_SS for cut filenames."""
    clamped = max(0.0, float(seconds))
    mins = int(clamped) // 60
    secs = int(clamped) % 60
    return f"{mins:02d}_{secs:02d}"


def build_cut_filename(start: float, end: float, cut_id: str | None = None) -> str:
    """Build canonical filename for a rendered short: `MM_SS-MM_SS.mp4`."""
    s_fmt = format_timestamp_for_filename(start)
    e_fmt = format_timestamp_for_filename(end)
    return f"{s_fmt}-{e_fmt}.mp4"


def list_render_output_urls(job_id: str, container: ServiceContainer | None = None) -> list[str]:
    """List relative streaming URLs for all rendered `.mp4` shorts of `job_id`."""
    c = container or get_container()
    shorts_dir = c.jobs.shorts_dir_path(job_id, create=False)
    if not shorts_dir.exists():
        return []

    files = sorted(
        [f for f in shorts_dir.iterdir() if f.is_file() and f.name.lower().endswith(".mp4")],
        key=lambda p: p.name,
    )
    return [f"/media/shorts/{job_id}/{f.name}" for f in files]


def delete_rendered_file(
    job_id: str,
    file_name: str,
    container: ServiceContainer | None = None,
) -> tuple[bool, str]:
    """Delete a rendered short from disk. Returns `(success, safe_file_name)`."""
    c = container or get_container()
    safe_name = Path(file_name).name
    shorts_dir = c.jobs.shorts_dir_path(job_id, create=False)
    target = shorts_dir / safe_name
    if not target.exists() or not target.is_file():
        return False, safe_name

    target.unlink(missing_ok=True)
    return True, safe_name


def cancel_rendering_job(job_id: str, container: ServiceContainer | None = None) -> bool:
    """Trigger cooperative cancellation of active rendering for `job_id` and restore status to DOWNLOADED."""
    c = container or get_container()
    cancelled = c.runtime.request_cancel(job_id, "render")
    if not cancelled:
        return False

    try:
        c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)
    except Exception:
        pass
    c.runtime.append_task_log(job_id, "render", "[rendering] Cancelled")
    c.runtime.publish_progress(
        job_id,
        status=JobStatus.DOWNLOADED.value,
        task="render",
        percent=0.0,
        message="Renderização cancelada",
    )
    c.runtime.publish_state_change(job_id, JobStatus.DOWNLOADED, "Renderização cancelada pelo usuário")
    return True


class RenderingService:
    """Domain rendering coordinator."""

    def __init__(
        self,
        *,
        container: ServiceContainer | None = None,
        vision_adapter: MediaPipeVisionAdapter | None = None,
        ffmpeg_executor: FFmpegNvencExecutor | None = None,
        subprocess_runner: SubprocessRunner | None = None,
    ) -> None:
        self.container = container or get_container()
        self.vision_adapter = vision_adapter or MediaPipeVisionAdapter()
        self.ffmpeg_executor = ffmpeg_executor or FFmpegNvencExecutor(
            container=self.container,
            subprocess_runner=subprocess_runner,
        )

    async def render_job(
        self,
        job_id: str,
        *,
        cut_ids: Sequence[str] | None = None,
        synthetic_observations_provider: Callable[[float, float], list[FrameObservation]] | None = None,
    ) -> list[str]:
        """Execute full 9:16 vertical rendering pipeline for approved or non-rejected cuts of `job_id`."""
        c = self.container

        # 1. Check for conflicting active render jobs
        conflict_id = c.runtime.conflicting_active_rendering_job_id(job_id)
        if conflict_id:
            msg = f"Renderização já em andamento para outro vídeo ({conflict_id}). Cancele a anterior."
            c.runtime.append_task_log(job_id, "render", f"[rendering] ✗ {msg}")
            raise RuntimeError(msg)

        # 2. Reset task logs and set status to RENDERING
        c.runtime.clear_task_logs(job_id, "render")
        c.runtime.append_task_log(job_id, "render", "[rendering] Starting render")
        c.jobs.update_job_status(job_id, JobStatus.RENDERING)
        c.runtime.publish_state_change(job_id, JobStatus.RENDERING, "Iniciando renderização vertical dos cortes")

        cancel_token = c.runtime.create_cancel_token(job_id, "render")

        try:
            # 3. Locate source video
            video_path = c.jobs.find_source_video(job_id)
            if not video_path or not video_path.exists():
                err_msg = "Source video not found for job"
                c.runtime.append_task_log(job_id, "render", f"[rendering] ✗ Error: {err_msg}")
                c.jobs.update_job_status(job_id, JobStatus.ERROR)
                raise FileNotFoundError(err_msg)

            c.runtime.append_task_log(job_id, "render", f"[rendering] Source: {video_path}")

            # 4. Load cuts
            all_cuts = c.jobs.load_cuts(job_id)
            if not all_cuts:
                err_msg = "No cuts found to render"
                c.runtime.append_task_log(job_id, "render", f"[rendering] ✗ Error: {err_msg}")
                c.jobs.update_job_status(job_id, JobStatus.ERROR)
                raise ValueError(err_msg)

            # Filter cuts
            if cut_ids is not None:
                selected_cuts = [cut for cut in all_cuts if cut.cut_id in cut_ids]
            else:
                approved = [cut for cut in all_cuts if getattr(cut, "status", "") == "approved"]
                if approved:
                    selected_cuts = approved
                else:
                    selected_cuts = [cut for cut in all_cuts if getattr(cut, "status", "") != "rejected"]

            if not selected_cuts:
                err_msg = "No cuts found to render"
                c.runtime.append_task_log(job_id, "render", f"[rendering] ✗ Error: {err_msg}")
                c.jobs.update_job_status(job_id, JobStatus.ERROR)
                raise ValueError(err_msg)

            # 5. Load tool configs
            tool_cfg = c.load_active_tool_configs()
            ffmpeg_cfg = tool_cfg.get("ffmpeg", {})
            vertical_mode: VerticalPresetMode = ffmpeg_cfg.get("vertical_mode", "auto_reframe")
            burn_subtitles = bool(ffmpeg_cfg.get("burn_subtitles", not ffmpeg_cfg.get("disable_subtitle", False)))
            trim_silence = bool(ffmpeg_cfg.get("trim_internal_silence", False))
            subtitle_style = ffmpeg_cfg.get("subtitle_style", "word_highlight")
            normalize_audio = bool(ffmpeg_cfg.get("normalize_audio", True))

            # 6. Load transcription words and segments
            words = c.jobs.load_transcription_words(job_id)
            segments = c.jobs.load_transcription_segments(job_id)
            has_audio = _probe_video_has_audio(video_path)
            if not has_audio:
                c.runtime.log_warning(
                    job_id,
                    "render",
                    f"Source media {video_path.name} has no audio stream; synthesizing silent stereo track.",
                )

            shorts_dir = c.jobs.shorts_dir_path(job_id, create=True)
            output_urls: list[str] = []
            total_cuts = len(selected_cuts)

            for idx, cut in enumerate(selected_cuts):
                if cancel_token.is_set():
                    raise OperationCancelledError(job_id, "render")

                cut_start = float(cut.start)
                cut_end = float(cut.end)
                dur = max(0.1, cut_end - cut_start)
                filename = build_cut_filename(cut_start, cut_end, cut.cut_id)
                output_path = shorts_dir / filename
                work_dir = shorts_dir / f".work_{cut.cut_id}"
                work_dir.mkdir(parents=True, exist_ok=True)
                ass_path = work_dir / f"{cut.cut_id}.ass"
                script_path = work_dir / f"filter_script_{cut.cut_id}.txt"

                c.runtime.append_task_log(
                    job_id,
                    "render",
                    f"[rendering] Cut {cut.cut_id} {cut_start:.2f}-{cut_end:.2f}",
                )
                percent = float(idx) / float(total_cuts) * 100.0
                c.runtime.publish_progress(
                    job_id,
                    status=JobStatus.RENDERING,
                    task="render",
                    percent=percent,
                    message=f"Renderizando corte {idx + 1}/{total_cuts} ({filename})",
                )

                # A. Build timeline mapper
                timeline_mapper = build_timeline_mapper(
                    cut_start=cut_start,
                    cut_end=cut_end,
                    words=words,
                    segments=segments,
                    trim_internal_silence=trim_silence,
                )

                # B. Extract or synthesize frame observations
                if synthetic_observations_provider is not None:
                    observations = synthetic_observations_provider(cut_start, cut_end)
                else:
                    observations = self.vision_adapter.analyze_video_cut(
                        video_path,
                        cut_start,
                        cut_end,
                        cancel_check=cancel_token.raise_if_cancelled,
                    )

                # C. Non-Causal Virtual Cameraman 9:16 planning
                cameraman_plan = build_virtual_cameraman_plan(
                    observations,
                    vertical_mode=vertical_mode,
                    time_remapper=timeline_mapper.remap_relative if timeline_mapper.trim_enabled else None,
                )

                # D. Generate ASS subtitles
                if burn_subtitles:
                    write_ass_subtitle_file(
                        ass_path,
                        words,
                        cut_start=cut_start,
                        cut_end=cut_end,
                        segments=segments,
                        subtitle_style=subtitle_style,
                        timeline_mapper=timeline_mapper,
                        trim_internal_silence=trim_silence,
                    )
                    c.runtime.register_partial_file(job_id, ass_path)

                # E. Write filter complex script
                opts = FilterScriptOptions(
                    target_width=1080,
                    target_height=1920,
                    normalize_audio=normalize_audio,
                    burn_subtitles=burn_subtitles,
                    ass_path=ass_path if burn_subtitles else None,
                    has_audio=has_audio,
                )
                write_filter_complex_script_file(
                    script_path,
                    cameraman_plan,
                    dur,
                    timeline_mapper=timeline_mapper,
                    options=opts,
                )
                c.runtime.register_partial_file(job_id, script_path)

                # F. Execute FFmpeg NVENC (with transparent fallback to libx264)
                await self.ffmpeg_executor.execute_render_cut(
                    job_id=job_id,
                    input_path=video_path,
                    output_path=output_path,
                    script_path=script_path,
                    start_time=cut_start,
                    duration=dur,
                    cancel_token=cancel_token,
                    tool_config=tool_cfg,
                )

                # Clean up temporary work files for this cut
                try:
                    c.runtime.unregister_partial_file(job_id, ass_path)
                    c.runtime.unregister_partial_file(job_id, script_path)
                    if ass_path.exists():
                        ass_path.unlink(missing_ok=True)
                    if script_path.exists():
                        script_path.unlink(missing_ok=True)
                    if work_dir.exists():
                        work_dir.rmdir()
                except OSError:
                    pass

                output_url = f"/media/shorts/{job_id}/{filename}"
                output_urls.append(output_url)

            # 7. Check if cancelled during loop
            if cancel_token.is_set():
                c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)
                c.runtime.append_task_log(job_id, "render", "[rendering] Cancel acknowledged")
                return output_urls

            # 8. Complete successfully
            c.jobs.update_job(
                job_id,
                {"status": JobStatus.DONE, "rendered_files": [Path(u).name for u in output_urls]},
            )
            c.runtime.append_task_log(job_id, "render", "[rendering] ✓ Render complete")
            c.runtime.publish_progress(
                job_id,
                status=JobStatus.DONE,
                task="render",
                percent=100.0,
                message="Renderização concluída com sucesso",
            )
            c.runtime.publish_state_change(job_id, JobStatus.DONE, "Todos os cortes verticais foram gerados")
            return output_urls

        except OperationCancelledError:
            c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)
            c.runtime.append_task_log(job_id, "render", "[rendering] Cancel acknowledged")
            c.runtime.publish_state_change(job_id, JobStatus.DOWNLOADED, "Renderização cancelada")
            return []
        except Exception as exc:
            if cancel_token.is_set():
                c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)
                c.runtime.append_task_log(job_id, "render", "[rendering] Cancel acknowledged")
                return []
            c.runtime.log_exception(
                job_id,
                "render",
                exc,
                message=f"[rendering] ✗ Error: {exc}",
            )
            try:
                c.jobs.update_job_status(job_id, JobStatus.ERROR)
            except Exception:
                pass
            c.runtime.publish_state_change(job_id, JobStatus.ERROR, f"Erro na renderização: {exc}")
            raise
        finally:
            c.runtime.clear_cancel_token(job_id, "render")


# Public singleton helper
_rendering_service: RenderingService | None = None


def get_rendering_service(
    *,
    container: ServiceContainer | None = None,
    vision_adapter: MediaPipeVisionAdapter | None = None,
    ffmpeg_executor: FFmpegNvencExecutor | None = None,
    subprocess_runner: SubprocessRunner | None = None,
) -> RenderingService:
    global _rendering_service
    if container or vision_adapter or ffmpeg_executor or subprocess_runner:
        return RenderingService(
            container=container,
            vision_adapter=vision_adapter,
            ffmpeg_executor=ffmpeg_executor,
            subprocess_runner=subprocess_runner,
        )
    if _rendering_service is None:
        _rendering_service = RenderingService()
    return _rendering_service
