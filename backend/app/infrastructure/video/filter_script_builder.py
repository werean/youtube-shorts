"""FFmpeg `-filter_complex_script` file builder.

Writes `filter_script.txt` per cut to avoid CLI command length limits and Windows shell escaping issues.
Supports:
- Dynamic 9:16 crop trajectory `x(t)` via piecewise-linear `sendcmd`/`crop` expressions.
- Split-screen 50%/50% vertical stack (`1080x960` top + `1080x960` bottom) for 2 active speakers.
- Background `blur` (`1080x1920` blurred background + centered 16:9 foreground) or `zoom` (centered 4:5 on blur) fallback.
- Optional word-by-word dynamic subtitle burn-in (`subtitles=` / `ass=`).
- Time-warping interval concatenation when `trim_internal_silence` is enabled.
- Audio broadcast mastering (`loudnorm=-14 LUFS`, micro-fades 30ms in / 50ms out).
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

from app.domain.rendering.ass_generator import TimelineMapper
from app.domain.rendering.virtual_cameraman import (
    CameraKeyframe,
    CameraLayoutMode,
    VirtualCameramanPlan,
)


def escape_ffmpeg_filter_path(file_path: str | Path) -> str:
    """Escape file path for FFmpeg filter arguments (subtitles='...').

    Converts backslashes to forward slashes, escapes colons (`C:` -> `C\:`), and escapes single quotes.
    """
    clean = str(file_path).replace("\\", "/")
    # Escape colons (especially Windows drive letters C:)
    clean = clean.replace(":", r"\:")
    clean = clean.replace("'", r"\'")
    return f"'{clean}'"


def build_piecewise_linear_crop_expression(
    keyframes: Sequence[CameraKeyframe],
    *,
    default_x: float = 0.0,
) -> str:
    """Build an FFmpeg arithmetic expression `x(t)` interpolating linearly across `keyframes`.

    For $N$ keyframes $[(t_0, x_0), \dots, (t_{N-1}, x_{N-1})]$:
    Uses nested `if(lt(t, t_1), lerp_0, if(lt(t, t_2), lerp_1, ...))` clamping to $x_0$ for $t \le t_0$
    and to $x_{N-1}$ for $t \ge t_{N-1}$.
    """
    kfs = [k for k in keyframes if k.mode == "crop_track"]
    if not kfs:
        return f"{default_x:.2f}"
    if len(kfs) == 1:
        return f"{kfs[0].x:.2f}"

    # Build from right to left
    last_x = kfs[-1].x
    expr = f"{last_x:.2f}"

    for i in range(len(kfs) - 2, -1, -1):
        k0 = kfs[i]
        k1 = kfs[i + 1]
        dt = float(k1.time) - float(k0.time)
        if dt <= 1e-4:
            seg_expr = f"{k1.x:.2f}"
        else:
            dx = float(k1.x) - float(k0.x)
            seg_expr = f"({k0.x:.2f}+({dx:.2f})*(t-{k0.time:.3f})/{dt:.3f})"
        expr = f"if(lt(t,{k1.time:.3f}),{seg_expr},{expr})"

    # Clamp for t < t_0
    first_k = kfs[0]
    expr = f"if(lt(t,{first_k.time:.3f}),{first_k.x:.2f},{expr})"
    return expr


@dataclass
class FilterScriptOptions:
    """Configuration options for building a cut's filtergraph script."""

    target_width: int = 1080
    target_height: int = 1920
    normalize_audio: bool = True
    burn_subtitles: bool = True
    ass_path: Path | None = None
    audio_fade_in_seconds: float = 0.03
    audio_fade_out_seconds: float = 0.05
    target_lufs: float = -14.0
    has_audio: bool = True


def build_filter_complex_script_content(
    plan: VirtualCameramanPlan,
    duration: float,
    *,
    timeline_mapper: TimelineMapper | None = None,
    options: FilterScriptOptions | None = None,
) -> str:
    """Generate the full FFmpeg `-filter_complex_script` string."""
    opts = options or FilterScriptOptions()
    tw, th = opts.target_width, opts.target_height
    dur = max(0.1, float(duration))

    # Determine audio/video input stems (handling trim_internal_silence intervals if present)
    lines: list[str] = []
    v_in = "0:v"
    a_in = "0:a"

    if timeline_mapper is not None and timeline_mapper.trim_enabled and len(timeline_mapper.intervals) >= 1:
        v_segs: list[str] = []
        a_segs: list[str] = []
        for idx, iv in enumerate(timeline_mapper.intervals):
            lines.append(
                f"[0:v]trim=start={iv.rel_start:.3f}:end={iv.rel_end:.3f},setpts=PTS-STARTPTS[vt{idx}];"
            )
            v_segs.append(f"[vt{idx}]")
            if opts.has_audio:
                lines.append(
                    f"[0:a]atrim=start={iv.rel_start:.3f}:end={iv.rel_end:.3f},asetpts=PTS-STARTPTS[at{idx}];"
                )
                a_segs.append(f"[at{idx}]")

        concat_n = len(timeline_mapper.intervals)
        lines.append(f"{''.join(v_segs)}concat=n={concat_n}:v=1:a=0[v_trimmed];")
        v_in = "v_trimmed"
        if opts.has_audio:
            lines.append(f"{''.join(a_segs)}concat=n={concat_n}:v=0:a=1[a_trimmed];")
            a_in = "a_trimmed"
        dur = timeline_mapper.compacted_duration

    # Video processing by layout mode
    layout_mode: CameraLayoutMode = plan.primary_mode

    if layout_mode == "split_screen":
        # 50% Top (speaker 1) + 50% Bottom (speaker 2), stacked vertically
        # Match virtual_cameraman.py (`min(source_width, 960)`) so crop width never overflows 16:9 width
        split_crop_w = min(plan.source_width, 960)
        if split_crop_w % 2 != 0:
            split_crop_w -= 1
        half_h = th // 2  # 960
        max_split_x = float(max(0, plan.source_width - split_crop_w))

        # Left / right crop offsets clamped to [0, source_width - split_crop_w]
        left_kfs = [k for k in plan.keyframes if k.mode == "split_screen"]
        left_x = min(max(0.0, left_kfs[0].x if left_kfs else 0.0), max_split_x)
        raw_right_x = (
            left_kfs[0].secondary_x
            if (left_kfs and left_kfs[0].secondary_x is not None)
            else max_split_x
        )
        right_x = min(max(0.0, float(raw_right_x)), max_split_x)

        lines.append(
            f"[{v_in}]crop={split_crop_w}:{plan.source_height}:{left_x:.1f}:0,"
            f"scale={tw}:{half_h},setsar=1[top];"
        )
        lines.append(
            f"[{v_in}]crop={split_crop_w}:{plan.source_height}:{right_x:.1f}:0,"
            f"scale={tw}:{half_h},setsar=1[bottom];"
        )
        lines.append(f"[top][bottom]vstack=inputs=2[v_base];")

    elif layout_mode in ("blur", "zoom"):
        # Blurred background (1080x1920) + centered foreground
        lines.append(
            f"[{v_in}]scale={tw}:{th}:force_original_aspect_ratio=increase,"
            f"crop={tw}:{th},boxblur=20:2,setsar=1[bg];"
        )
        if layout_mode == "zoom":
            # 4:5 centered zoom over blur
            lines.append(
                f"[{v_in}]scale={tw}:-2:force_original_aspect_ratio=decrease,setsar=1[fg];"
            )
        else:
            # 16:9 centered over blur
            lines.append(
                f"[{v_in}]scale={tw}:-2:force_original_aspect_ratio=decrease,setsar=1[fg];"
            )
        lines.append(f"[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v_base];")

    else:
        # "crop_track": dynamic piecewise-linear 9:16 crop trajectory x(t)
        crop_expr = build_piecewise_linear_crop_expression(
            plan.keyframes,
            default_x=float(max(0, plan.source_width - plan.crop_width)) * 0.5,
        )
        lines.append(
            f"[{v_in}]crop={plan.crop_width}:{plan.crop_height}:'{crop_expr}':0,"
            f"scale={tw}:{th},setsar=1[v_base];"
        )

    # Subtitle burn-in
    v_current = "v_base"
    if opts.burn_subtitles and opts.ass_path and opts.ass_path.exists():
        escaped_ass = escape_ffmpeg_filter_path(opts.ass_path)
        lines.append(f"[{v_current}]subtitles={escaped_ass}[v_sub];")
        v_current = "v_sub"

    lines.append(f"[{v_current}]format=yuv420p[v_out];")

    # Audio mastering: fades + loudnorm (or silent stream fallback when input has no audio)
    if not opts.has_audio:
        lines.append(f"anullsrc=channel_layout=stereo:sample_rate=44100:d={dur:.3f}[a_out]")
    else:
        a_filters: list[str] = []
        if opts.audio_fade_in_seconds > 0:
            a_filters.append(f"afade=t=in:st=0:d={opts.audio_fade_in_seconds:.3f}")
        if opts.audio_fade_out_seconds > 0:
            fade_out_start = max(0.0, dur - opts.audio_fade_out_seconds)
            a_filters.append(f"afade=t=out:st={fade_out_start:.3f}:d={opts.audio_fade_out_seconds:.3f}")
        if opts.normalize_audio:
            a_filters.append(f"loudnorm=I={opts.target_lufs:.1f}:TP=-1.5:LRA=11")

        if a_filters:
            lines.append(f"[{a_in}]{','.join(a_filters)}[a_out]")
        else:
            lines.append(f"[{a_in}]anull[a_out]")

    return "\n".join(lines) + "\n"


def write_filter_complex_script_file(
    script_path: str | Path,
    plan: VirtualCameramanPlan,
    duration: float,
    *,
    timeline_mapper: TimelineMapper | None = None,
    options: FilterScriptOptions | None = None,
) -> Path:
    """Generate and write the filter script to `filter_script.txt` (UTF-8)."""
    target = Path(script_path)
    target.parent.mkdir(parents=True, exist_ok=True)
    content = build_filter_complex_script_content(
        plan,
        duration,
        timeline_mapper=timeline_mapper,
        options=options,
    )
    target.write_text(content, encoding="utf-8")
    return target
