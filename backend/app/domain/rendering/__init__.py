"""Rendering domain package (Virtual Cameraman 9:16, ASS Subtitles, and Rendering Service)."""

from __future__ import annotations

from app.domain.rendering.ass_generator import (
    TimelineMapper,
    build_timeline_mapper,
    format_ass_timestamp,
    generate_ass_subtitles,
    write_ass_subtitle_file,
)
from app.domain.rendering.rendering_service import (
    RenderingService,
    build_cut_filename,
    cancel_rendering_job,
    delete_rendered_file,
    format_timestamp_for_filename,
    get_rendering_service,
    list_render_output_urls,
)
from app.domain.rendering.virtual_cameraman import (
    CameraKeyframe,
    CameraLayoutMode,
    FrameCameraSample,
    ShotCameraPlan,
    VerticalPresetMode,
    VirtualCameramanPlan,
    apply_deadband_15pct,
    apply_savgol_isolated_per_shot,
    build_virtual_cameraman_plan,
    compute_9_16_crop_dimensions,
    ramer_douglas_peucker,
)

__all__ = [
    "CameraKeyframe",
    "CameraLayoutMode",
    "FrameCameraSample",
    "RenderingService",
    "ShotCameraPlan",
    "TimelineMapper",
    "VerticalPresetMode",
    "VirtualCameramanPlan",
    "apply_deadband_15pct",
    "apply_savgol_isolated_per_shot",
    "build_cut_filename",
    "build_timeline_mapper",
    "build_virtual_cameraman_plan",
    "cancel_rendering_job",
    "compute_9_16_crop_dimensions",
    "delete_rendered_file",
    "format_ass_timestamp",
    "format_timestamp_for_filename",
    "generate_ass_subtitles",
    "get_rendering_service",
    "list_render_output_urls",
    "ramer_douglas_peucker",
    "write_ass_subtitle_file",
]
