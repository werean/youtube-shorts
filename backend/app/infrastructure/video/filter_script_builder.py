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
    coalesce_layout_spans,
)


def escape_ffmpeg_filter_path(file_path: str | Path) -> str:
    r"""Escape file path for FFmpeg filter arguments (subtitles='...').

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
    mode_filter: CameraLayoutMode | None = "crop_track",
    use_secondary_x: bool = False,
) -> str:
    r"""Build an FFmpeg arithmetic expression `x(t)` interpolating linearly across `keyframes`.

    For $N$ keyframes $[(t_0, x_0), \dots, (t_{N-1}, x_{N-1})]$:
    Uses nested `if(lt(t, t_1), lerp_0, if(lt(t, t_2), lerp_1, ...))` clamping to $x_0$ for $t \le t_0$
    and to $x_{N-1}$ for $t \ge t_{N-1}$.
    Across `shot_id` boundaries (or mode discontinuities), step-holds `k0.x` until `t >= k1.time`
    to eliminate cross-cut whip-pan sliding.
    """
    filtered: list[tuple[int, CameraKeyframe]] = [
        (idx, k)
        for idx, k in enumerate(keyframes)
        if mode_filter is None or k.mode == mode_filter
    ]
    if not filtered:
        return f"{default_x:.2f}"

    def _val(kf: CameraKeyframe) -> float:
        if use_secondary_x:
            return float(kf.secondary_x if kf.secondary_x is not None else default_x)
        return float(kf.x)

    if len(filtered) == 1:
        return f"{_val(filtered[0][1]):.2f}"

    # Build from right to left
    last_x = _val(filtered[-1][1])
    expr = f"{last_x:.2f}"

    for i in range(len(filtered) - 2, -1, -1):
        orig_i0, k0 = filtered[i]
        orig_i1, k1 = filtered[i + 1]
        x0 = _val(k0)
        x1 = _val(k1)
        dt = float(k1.time) - float(k0.time)
        same_shot = int(k0.shot_id) == int(k1.shot_id)
        contiguous_in_mode = (orig_i1 == orig_i0 + 1) or all(
            keyframes[mid].mode == k0.mode for mid in range(orig_i0 + 1, orig_i1)
        )
        if not same_shot or not contiguous_in_mode:
            # Step-hold k0.x across scene cuts or intervening mode switches (no whip-pan)
            seg_expr = f"{x0:.2f}"
        elif dt <= 1e-4:
            seg_expr = f"{x1:.2f}"
        else:
            dx = x1 - x0
            seg_expr = f"({x0:.2f}+({dx:.2f})*(t-{float(k0.time):.3f})/{dt:.3f})"
        expr = f"if(lt(t,{float(k1.time):.3f}),{seg_expr},{expr})"

    # Clamp for t < t_0
    first_k = filtered[0][1]
    expr = f"if(lt(t,{float(first_k.time):.3f}),{_val(first_k):.2f},{expr})"
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


def _emit_mode_stream_lines(
    layout_mode: CameraLayoutMode,
    src_pad: str,
    out_pad: str,
    plan: VirtualCameramanPlan,
    tw: int,
    th: int,
    *,
    suffix: str = "",
) -> list[str]:
    """Emit FFmpeg filter lines converting `[src_pad]` into `[out_pad]` (`tw x th`, SAR 1:1) for `layout_mode`."""
    lines: list[str] = []

    if layout_mode == "split_screen":
        # 50% Top (speaker 1) + 50% Bottom (speaker 2), stacked vertically
        # Match virtual_cameraman.py (`min(source_width, 960)`) so crop width never overflows 16:9 width
        split_crop_w = min(plan.source_width, 960)
        if split_crop_w % 2 != 0:
            split_crop_w -= 1
        half_h = th // 2  # 960
        max_split_x = float(max(0, plan.source_width - split_crop_w))

        clamped_kfs: list[CameraKeyframe] = []
        for k in plan.keyframes:
            if k.mode == "split_screen":
                lx = min(max(0.0, float(k.x)), max_split_x)
                rx = min(
                    max(0.0, float(k.secondary_x if k.secondary_x is not None else max_split_x)),
                    max_split_x,
                )
                clamped_kfs.append(
                    CameraKeyframe(
                        time=k.time,
                        x=lx,
                        y=k.y,
                        crop_w=k.crop_w,
                        crop_h=k.crop_h,
                        mode=k.mode,
                        shot_id=k.shot_id,
                        secondary_x=rx,
                    )
                )
            else:
                clamped_kfs.append(k)

        split_only = [k for k in clamped_kfs if k.mode == "split_screen"]
        if len(split_only) <= 1:
            left_val = split_only[0].x if split_only else 0.0
            right_val = (
                split_only[0].secondary_x
                if (split_only and split_only[0].secondary_x is not None)
                else max_split_x
            )
            left_arg = f"{left_val:.1f}"
            right_arg = f"{right_val:.1f}"
        else:
            left_expr = build_piecewise_linear_crop_expression(
                clamped_kfs,
                default_x=0.0,
                mode_filter="split_screen",
                use_secondary_x=False,
            )
            right_expr = build_piecewise_linear_crop_expression(
                clamped_kfs,
                default_x=max_split_x,
                mode_filter="split_screen",
                use_secondary_x=True,
            )
            left_arg = f"'{left_expr}'" if ("(" in left_expr or "," in left_expr) else f"{float(left_expr):.1f}"
            right_arg = f"'{right_expr}'" if ("(" in right_expr or "," in right_expr) else f"{float(right_expr):.1f}"

        if src_pad != "0:v":
            p_top = f"{src_pad}_top"
            p_bot = f"{src_pad}_bot"
            lines.append(f"[{src_pad}]split=2[{p_top}][{p_bot}];")
        else:
            p_top = src_pad
            p_bot = src_pad

        top_pad = f"top{suffix}"
        bot_pad = f"bottom{suffix}"
        lines.append(
            f"[{p_top}]crop={split_crop_w}:{plan.source_height}:{left_arg}:0,"
            f"scale={tw}:{half_h},setsar=1[{top_pad}];"
        )
        lines.append(
            f"[{p_bot}]crop={split_crop_w}:{plan.source_height}:{right_arg}:0,"
            f"scale={tw}:{half_h},setsar=1[{bot_pad}];"
        )
        if suffix:
            lines.append(f"[{top_pad}][{bot_pad}]vstack=inputs=2,setsar=1[{out_pad}];")
        else:
            lines.append(f"[{top_pad}][{bot_pad}]vstack=inputs=2[{out_pad}];")

    elif layout_mode in ("blur", "zoom"):
        # Downscale background by 4x before heavy boxblur to avoid blurring 2M+ pixels/frame on CPU
        blur_w = max(64, (tw // 4) & ~1)
        blur_h = max(64, (th // 4) & ~1)
        if src_pad != "0:v":
            p_bg = f"{src_pad}_bg"
            p_fg = f"{src_pad}_fg"
            lines.append(f"[{src_pad}]split=2[{p_bg}][{p_fg}];")
        else:
            p_bg = src_pad
            p_fg = src_pad

        bg_pad = f"bg{suffix}"
        fg_pad = f"fg{suffix}"
        lines.append(
            f"[{p_bg}]scale={blur_w}:{blur_h}:force_original_aspect_ratio=increase,"
            f"crop={blur_w}:{blur_h},boxblur=5:2,"
            f"scale={tw}:{th}:flags=bilinear,setsar=1[{bg_pad}];"
        )
        if layout_mode == "zoom":
            # Genuine 4:5 portrait-cropped zoom (1080x1350 for 1080w) centered on blurred background
            zoom_h = max(2, int(round(tw * 5.0 / 4.0)) & ~1)
            lines.append(
                f"[{p_fg}]scale={tw}:{zoom_h}:force_original_aspect_ratio=increase,"
                f"crop={tw}:{zoom_h},setsar=1[{fg_pad}];"
            )
        else:
            # 16:9 centered over blurred background
            lines.append(
                f"[{p_fg}]scale={tw}:-2:force_original_aspect_ratio=decrease,setsar=1[{fg_pad}];"
            )
        lines.append(f"[{bg_pad}][{fg_pad}]overlay=(W-w)/2:(H-h)/2,setsar=1[{out_pad}];")

    else:
        # "crop_track": dynamic piecewise-linear 9:16 crop trajectory x(t)
        crop_expr = build_piecewise_linear_crop_expression(
            plan.keyframes,
            default_x=float(max(0, plan.source_width - plan.crop_width)) * 0.5,
            mode_filter="crop_track",
        )
        lines.append(
            f"[{src_pad}]crop={plan.crop_width}:{plan.crop_height}:'{crop_expr}':0,"
            f"scale={tw}:{th},setsar=1[{out_pad}];"
        )

    return lines


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

    # Video processing: single-mode direct pipeline or multi-mode coalesced overlay compositing
    spans = coalesce_layout_spans(plan, dur)
    active_modes: list[CameraLayoutMode] = list(dict.fromkeys(mode for _, _, mode, _ in spans))

    if len(active_modes) <= 1:
        layout_mode: CameraLayoutMode = active_modes[0] if active_modes else plan.primary_mode
        lines.extend(_emit_mode_stream_lines(layout_mode, v_in, "v_base", plan, tw, th, suffix=""))
    else:
        base_mode: CameraLayoutMode = (
            plan.primary_mode if plan.primary_mode in active_modes else active_modes[0]
        )
        overlay_modes: list[CameraLayoutMode] = [m for m in active_modes if m != base_mode]

        split_pads = [f"vin_{i}" for i in range(len(active_modes))]
        lines.append(f"[{v_in}]split={len(active_modes)}{''.join(f'[{p}]' for p in split_pads)};")

        mode_to_pad: dict[CameraLayoutMode, str] = {}
        for idx, mode in enumerate(active_modes):
            mode_pad = "v_mode_base" if mode == base_mode else f"v_mode_{mode}"
            mode_to_pad[mode] = mode_pad
            lines.extend(
                _emit_mode_stream_lines(
                    mode,
                    split_pads[idx],
                    mode_pad,
                    plan,
                    tw,
                    th,
                    suffix=f"_{mode}",
                )
            )

        cur_pad = mode_to_pad[base_mode]
        for idx, omode in enumerate(overlay_modes):
            enable_terms = [
                f"between(t,{s:.3f},{e:.3f})"
                for s, e, m, _ in spans
                if m == omode
            ]
            enable_expr = "+".join(enable_terms)
            next_pad = "v_base" if idx == len(overlay_modes) - 1 else f"v_comp_{idx}"
            lines.append(
                f"[{cur_pad}][{mode_to_pad[omode]}]overlay=0:0:enable='{enable_expr}':"
                f"eof_action=pass:shortest=0[{next_pad}];"
            )
            cur_pad = next_pad

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
