"""FFmpeg NVENC video render executor with automatic transparent fallback to CPU libx264.

Supports:
- Hybrid input seek (`-ss` before `-i`, `-t duration`).
- GPU NVENC (`h264_nvenc -rc vbr -cq 20 -preset p4`) with automatic fallback to `libx264 -crf 20 -preset veryfast`.
- `-filter_complex_script` integration.
- Process tracking with `c.runtime.register_process` and `c.runtime.register_partial_file`.
- Hardware scheduler slot (`c.scheduler.render_slot()`).
- Cooperative cancellation via `CancelToken` and cleanup of partial files.
"""

from __future__ import annotations

import asyncio
import os
import shutil
from pathlib import Path
from typing import Any, AsyncIterator, Awaitable, Callable, Sequence

from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)

SubprocessRunner = Callable[[list[str], Callable[[str], None] | None, CancelToken | None], Awaitable[int]]


def build_ffmpeg_nvenc_command(
    *,
    input_path: str | Path,
    output_path: str | Path,
    script_path: str | Path,
    start_time: float,
    duration: float,
    video_preset: str = "p4",
    video_cq: int = 20,
    audio_codec: str = "aac",
    audio_bitrate: str = "192k",
    extra_video_flags: Sequence[str] | None = None,
) -> list[str]:
    """Construct FFmpeg command with NVIDIA NVENC hardware acceleration."""
    cmd = [
        "ffmpeg",
        "-y",
        "-hwaccel",
        "cuda",
        "-ss",
        f"{float(start_time):.3f}",
        "-i",
        str(input_path),
        "-t",
        f"{float(duration):.3f}",
        "-filter_complex_script",
        str(script_path),
        "-map",
        "[v_out]",
        "-map",
        "[a_out]",
        "-c:v",
        "h264_nvenc",
        "-rc",
        "vbr",
        "-cq",
        str(video_cq),
        "-preset",
        str(video_preset or "p4"),
        "-c:a",
        str(audio_codec or "aac"),
        "-b:a",
        str(audio_bitrate or "192k"),
    ]
    if extra_video_flags:
        cmd.extend(extra_video_flags)
    cmd.extend(["-movflags", "+faststart", str(output_path)])
    return cmd


def build_ffmpeg_cpu_fallback_command(
    *,
    input_path: str | Path,
    output_path: str | Path,
    script_path: str | Path,
    start_time: float,
    duration: float,
    crf: int = 20,
    preset: str = "veryfast",
    audio_codec: str = "aac",
    audio_bitrate: str = "192k",
    extra_video_flags: Sequence[str] | None = None,
) -> list[str]:
    """Construct FFmpeg command with CPU libx264 fallback encoding."""
    cmd = [
        "ffmpeg",
        "-y",
        "-ss",
        f"{float(start_time):.3f}",
        "-i",
        str(input_path),
        "-t",
        f"{float(duration):.3f}",
        "-filter_complex_script",
        str(script_path),
        "-map",
        "[v_out]",
        "-map",
        "[a_out]",
        "-c:v",
        "libx264",
        "-crf",
        str(crf),
        "-preset",
        str(preset),
        "-c:a",
        str(audio_codec or "aac"),
        "-b:a",
        str(audio_bitrate or "192k"),
    ]
    if extra_video_flags:
        cmd.extend(extra_video_flags)
    cmd.extend(["-movflags", "+faststart", str(output_path)])
    return cmd


def is_nvenc_failure_log(log_line: str) -> bool:
    """Return True if an FFmpeg log line indicates NVENC/CUDA hardware failure."""
    lower = log_line.lower()
    patterns = (
        "unknown encoder 'h264_nvenc'",
        "cannot load nvcuda.dll",
        "driver does not support the required nvenc api version",
        "nvenc requires",
        "device creation failed",
        "cuda driver version is insufficient",
        "hardware accelerator failed",
        "failed to create nvenc",
        "no nvenc capable devices found",
        "initialization failed",
        "openencodess failed",
    )
    return any(p in lower for p in patterns)


class FFmpegNvencExecutor:
    """Orchestrates FFmpeg NVENC execution with automatic CPU fallback, cancellation, and scheduler coordination."""

    def __init__(
        self,
        *,
        container: ServiceContainer | None = None,
        subprocess_runner: SubprocessRunner | None = None,
    ) -> None:
        self.container = container or get_container()
        self._subprocess_runner = subprocess_runner

    async def execute_render_cut(
        self,
        *,
        job_id: str,
        input_path: Path,
        output_path: Path,
        script_path: Path,
        start_time: float,
        duration: float,
        cancel_token: CancelToken | None = None,
        on_log: Callable[[str], None] | None = None,
        tool_config: dict[str, Any] | None = None,
    ) -> bool:
        """Render a single cut using NVENC with transparent fallback to libx264."""
        token = cancel_token or self.container.runtime.get_cancel_token(job_id, "render")
        if token and token.is_set():
            raise OperationCancelledError(job_id, "render")

        output_path.parent.mkdir(parents=True, exist_ok=True)
        self.container.runtime.register_partial_file(job_id, output_path)

        f_cfg = (tool_config or {}).get("ffmpeg") or self.container.load_active_tool_configs().get("ffmpeg", {})
        preset = f_cfg.get("video_preset") or "p4"

        nvenc_cmd = build_ffmpeg_nvenc_command(
            input_path=input_path,
            output_path=output_path,
            script_path=script_path,
            start_time=start_time,
            duration=duration,
            video_preset=preset,
        )

        def _log(line: str) -> None:
            self.container.runtime.append_task_log(job_id, "render", line)
            if on_log:
                on_log(line)

        # Acquire scheduler render_slot (Semaphore = 2)
        async with self.container.scheduler.render_slot():
            if token and token.is_set():
                self.container.runtime.cleanup_partial_files(job_id)
                raise OperationCancelledError(job_id, "render")

            _log(f"[render] FFmpeg NVENC iniciando: {output_path.name}")
            fell_back_to_cpu = False
            nvenc_failed = False
            captured_logs: list[str] = []

            def _log_capture(line: str) -> None:
                captured_logs.append(line)
                _log(line)

            runner = self._subprocess_runner or self._default_run_subprocess
            retcode = await runner(nvenc_cmd, _log_capture, token)

            if token and token.is_set():
                self.container.runtime.cleanup_partial_files(job_id)
                raise OperationCancelledError(job_id, "render")

            if retcode != 0:
                # Check if it was an NVENC/CUDA hardware failure
                all_text = "\n".join(captured_logs)
                if is_nvenc_failure_log(all_text) or retcode != 0:
                    nvenc_failed = True
                    fell_back_to_cpu = True
                    _log(
                        f"[render] ⚠ NVENC falhou (código {retcode}). Aplicando fallback automático para libx264..."
                    )

            if nvenc_failed:
                # Remove partial output if any was written
                if output_path.exists():
                    output_path.unlink(missing_ok=True)

                fallback_cmd = build_ffmpeg_cpu_fallback_command(
                    input_path=input_path,
                    output_path=output_path,
                    script_path=script_path,
                    start_time=start_time,
                    duration=duration,
                )
                retcode = await runner(fallback_cmd, _log, token)
                if token and token.is_set():
                    self.container.runtime.cleanup_partial_files(job_id)
                    raise OperationCancelledError(job_id, "render")

                if retcode != 0:
                    self.container.runtime.cleanup_partial_files(job_id)
                    raise RuntimeError(f"FFmpeg CPU render failed with exit code {retcode}")

            self.container.runtime.unregister_partial_file(job_id, output_path)
            _log(
                f"[render] ✓ Concluído ({'libx264' if fell_back_to_cpu else 'h264_nvenc'}): {output_path.name}"
            )
            return True

    async def _default_run_subprocess(
        self,
        command: list[str],
        on_line: Callable[[str], None] | None,
        cancel_token: CancelToken | None,
    ) -> int:
        """Run FFmpeg child process asynchronously line-by-line."""
        if cancel_token and cancel_token.is_set():
            return -1

        proc = await asyncio.create_subprocess_exec(
            command[0],
            *command[1:],
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        pid = proc.pid
        job_id = cancel_token.job_id if cancel_token else "default"
        self.container.runtime.register_process(job_id, "render", pid)

        async def _read_stream(stream: asyncio.StreamReader | None) -> None:
            if not stream:
                return
            while not stream.at_eof():
                line_bytes = await stream.readline()
                if not line_bytes:
                    break
                line = line_bytes.decode("utf-8", errors="replace").strip()
                if line and on_line:
                    on_line(line)

        try:
            await asyncio.gather(
                _read_stream(proc.stdout),
                _read_stream(proc.stderr),
            )
            return await proc.wait()
        except asyncio.CancelledError:
            self.container.runtime.kill_process_tree(pid)
            raise
        finally:
            self.container.runtime.unregister_process(job_id, "render", pid)
