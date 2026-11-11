"""Video infrastructure package (filter complex script builder and FFmpeg NVENC executor)."""

from __future__ import annotations

from app.infrastructure.video.ffmpeg_executor import (
    FFmpegNvencExecutor,
    SubprocessRunner,
    build_ffmpeg_cpu_fallback_command,
    build_ffmpeg_nvenc_command,
    is_nvenc_failure_log,
)
from app.infrastructure.video.filter_script_builder import (
    FilterScriptOptions,
    build_filter_complex_script_content,
    build_piecewise_linear_crop_expression,
    escape_ffmpeg_filter_path,
    write_filter_complex_script_file,
)

__all__ = [
    "FFmpegNvencExecutor",
    "FilterScriptOptions",
    "SubprocessRunner",
    "build_ffmpeg_cpu_fallback_command",
    "build_ffmpeg_nvenc_command",
    "build_filter_complex_script_content",
    "build_piecewise_linear_crop_expression",
    "escape_ffmpeg_filter_path",
    "is_nvenc_failure_log",
    "write_filter_complex_script_file",
]
