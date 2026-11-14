"""Non-Causal Virtual Cameraman 9:16 state machine (`0`, `1`, `2`, `3+` faces).

Implements:
- False-face filtering (`area < 1.5%` of frame area + static background artifacts).
- `1` face: track center with 15% Deadband (tripod lock inside central 15% of crop window).
- `2` faces: track active speaker (with 2.5s dwell hysteresis) or Split-Screen Vertical (`1080x960` top/bottom)
  when both speak/alternate rapidly or when `vertical_mode == "split_podcast"`.
- `3+` faces: dominant speaker tracking or automatic fallback to `zoom`/`blur` group layout.
- `0` faces: Hold-Last-Position for gaps `< 2.0s`; automatic fallback to `blur`/`zoom` layout for gaps `>= 2.0s`
  (slides, screen-share, B-roll).
- Savitzky-Golay smoothing (`window_length=15, polyorder=3`) strictly isolated per HSV `ShotSegment`.
- Ramer-Douglas-Peucker (`epsilon = 2.0px`) trajectory simplification into piecewise-linear keyframes.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Literal, Sequence

import numpy as np
from scipy.signal import savgol_filter

from app.infrastructure.vision.face_tracker import (
    DEFAULT_HSV_SCENE_CUT_THRESHOLD,
    DEFAULT_SAMPLE_FPS,
     DEFAULT_SPEAKER_DWELL_SECONDS,
    MIN_VALID_FACE_AREA_RATIO,
    ActiveSpeakerTracker,
    FaceBoundingBox,
    FrameObservation,
    ShotSegment,
    compute_speaker_activity_scores,
    filter_static_false_faces_in_shot,
    segment_observations_into_shots,
)

CameraLayoutMode = Literal["crop_track", "split_screen", "blur", "zoom"]
VerticalPresetMode = Literal["auto_reframe", "split_podcast", "crop", "zoom", "blur"]

DEFAULT_DEADBAND_RATIO: float = 0.15
DEFAULT_HOLD_MAX_GAP_SECONDS: float = 2.0
DEFAULT_SAVGOL_WINDOW_LENGTH: int = 15
DEFAULT_SAVGOL_POLYORDER: int = 3
DEFAULT_RDP_EPSILON_PX: float = 2.0
DEFAULT_SPLIT_MIN_SEPARATION_RATIO: float = 0.25


@dataclass
class FrameCameraSample:
    """Per-frame resolved camera state before Ramer-Douglas-Peucker keyframe simplification."""

    frame_index: int
    timestamp: float
    shot_id: int
    mode: CameraLayoutMode
    crop_x: float
    crop_y: float = 0.0
    crop_w: int = 608
    crop_h: int = 1080
    secondary_crop_x: float | None = None
    active_face_id: str | None = None
    face_count: int = 0


@dataclass
class CameraKeyframe:
    """Simplified linear camera trajectory keyframe produced by Ramer-Douglas-Peucker."""

    time: float
    x: float
    y: float = 0.0
    crop_w: int = 608
    crop_h: int = 1080
    mode: CameraLayoutMode = "crop_track"
    shot_id: int = 0
    secondary_x: float | None = None


@dataclass
class ShotCameraPlan:
    """Per-shot camera plan isolating smoothing and layout mode transitions within a single HSV shot."""

    shot_id: int
    start_time: float
    end_time: float
    dominant_mode: CameraLayoutMode
    samples: list[FrameCameraSample] = field(default_factory=list)
    keyframes: list[CameraKeyframe] = field(default_factory=list)


@dataclass
class VirtualCameramanPlan:
    """Complete 9:16 Virtual Cameraman trajectory and layout plan for a video cut."""

    source_width: int
    source_height: int
    target_width: int
    target_height: int
    crop_width: int
    crop_height: int
    vertical_mode: VerticalPresetMode
    primary_mode: CameraLayoutMode
    shots: list[ShotCameraPlan] = field(default_factory=list)
    samples: list[FrameCameraSample] = field(default_factory=list)
    keyframes: list[CameraKeyframe] = field(default_factory=list)

    def coalesce_layout_spans(
        self,
        duration: float,
    ) -> list[tuple[float, float, CameraLayoutMode, list[int]]]:
        """Return contiguous coalesced layout intervals `[(start_t, end_t, mode, shot_ids)]` across `[0.0, duration]`."""
        return coalesce_layout_spans(self, duration)


def _group_mode_runs(items: Sequence[tuple[float, CameraLayoutMode, int]]) -> list[list[tuple[float, CameraLayoutMode, int]]]:
    """Group `(time, mode, shot_id)` tuples into contiguous runs sharing the same `mode`."""
    runs: list[list[tuple[float, CameraLayoutMode, int]]] = []
    for item in items:
        if not runs or runs[-1][0][1] != item[1]:
            runs.append([item])
        else:
            runs[-1].append(item)
    return runs


def coalesce_layout_spans(
    plan: VirtualCameramanPlan,
    duration: float,
) -> list[tuple[float, float, CameraLayoutMode, list[int]]]:
    """Build contiguous coalesced layout spans `[(start_t, end_t, mode, shot_ids)]` across `[0.0, duration]`.

    - When `plan.shots` is empty (or all shots/keyframes share a single mode), returns 1 interval
      `[(0.0, dur, plan.primary_mode, ...)]`.
    - Supports mode transitions both across distinct `ShotCameraPlan` shots and within a single shot
      (via `shot.keyframes` / `shot.samples`).
    """
    dur = max(0.1, float(duration))
    raw_spans: list[tuple[float, float, CameraLayoutMode, list[int]]] = []

    if plan.shots:
        for shot in plan.shots:
            if shot.keyframes:
                pts = [(float(k.time), k.mode, int(shot.shot_id)) for k in shot.keyframes]
            elif shot.samples:
                pts = [(float(s.timestamp), s.mode, int(shot.shot_id)) for s in shot.samples]
            else:
                pts = []

            if pts:
                runs = _group_mode_runs(pts)
                if len(runs) == 1:
                    raw_spans.append(
                        (float(shot.start_time), float(shot.end_time), runs[0][0][1], [int(shot.shot_id)])
                    )
                else:
                    for idx, run in enumerate(runs):
                        r_start = float(shot.start_time) if idx == 0 else float(run[0][0])
                        r_end = float(shot.end_time) if idx == len(runs) - 1 else float(runs[idx + 1][0][0])
                        raw_spans.append((r_start, r_end, run[0][1], [int(shot.shot_id)]))
            else:
                raw_spans.append(
                    (float(shot.start_time), float(shot.end_time), shot.dominant_mode, [int(shot.shot_id)])
                )
    elif plan.keyframes:
        sorted_kfs = sorted(plan.keyframes, key=lambda k: float(k.time))
        pts = [(float(k.time), k.mode, int(k.shot_id)) for k in sorted_kfs]
        runs = _group_mode_runs(pts)
        if len(runs) <= 1:
            shot_ids = list(dict.fromkeys(int(k.shot_id) for k in sorted_kfs))
            return [(0.0, dur, plan.primary_mode, shot_ids)]
        for idx, run in enumerate(runs):
            r_start = 0.0 if idx == 0 else float(run[0][0])
            r_end = dur if idx == len(runs) - 1 else float(runs[idx + 1][0][0])
            sids = list(dict.fromkeys(item[2] for item in run))
            raw_spans.append((r_start, r_end, run[0][1], sids))
    else:
        return [(0.0, dur, plan.primary_mode, [])]

    if not raw_spans:
        return [(0.0, dur, plan.primary_mode, [])]

    # Normalize & tile [0.0, dur] cleanly without gaps or overlaps
    normalized: list[list[object]] = []
    for s_t, e_t, mode, sids in raw_spans:
        cs = max(0.0, min(dur, float(s_t)))
        ce = max(0.0, min(dur, float(e_t)))
        if ce > cs + 1e-6:
            normalized.append([cs, ce, mode, list(dict.fromkeys(sids))])

    if not normalized:
        all_sids = list(dict.fromkeys(sid for _, _, _, sids in raw_spans for sid in sids))
        return [(0.0, dur, plan.primary_mode, all_sids)]

    normalized[0][0] = 0.0
    for i in range(len(normalized) - 1):
        cur_end = float(normalized[i][1])
        next_start = float(normalized[i + 1][0])
        if next_start > cur_end:
            normalized[i][1] = next_start
        elif next_start < cur_end:
            normalized[i + 1][0] = cur_end
    normalized[-1][1] = dur

    coalesced: list[tuple[float, float, CameraLayoutMode, list[int]]] = []
    for cs_obj, ce_obj, mode_obj, sids_obj in normalized:
        cs = float(cs_obj)
        ce = float(ce_obj)
        if ce <= cs + 1e-6:
            continue
        mode: CameraLayoutMode = mode_obj  # type: ignore[assignment]
        sids: list[int] = sids_obj  # type: ignore[assignment]
        if coalesced and coalesced[-1][2] == mode:
            prev_s, _, prev_m, prev_sids = coalesced[-1]
            merged_sids = list(dict.fromkeys([*prev_sids, *sids]))
            coalesced[-1] = (prev_s, ce, prev_m, merged_sids)
        else:
            coalesced.append((cs, ce, mode, sids))

    if not coalesced:
        return [(0.0, dur, plan.primary_mode, [])]
    if len(coalesced) == 1:
        _, _, only_mode, only_sids = coalesced[0]
        # Preserve plan.primary_mode when single-mode
        resolved_mode = only_mode if plan.shots else plan.primary_mode
        return [(0.0, dur, resolved_mode, only_sids)]
    return coalesced


def compute_9_16_crop_dimensions(source_width: int = 1920, source_height: int = 1080) -> tuple[int, int]:
    """Compute even-integer 9:16 crop window `(crop_w, crop_h)` inside `source_width x source_height`."""
    crop_h = max(2, int(source_height) - (int(source_height) % 2))
    raw_w = int(round(crop_h * 9.0 / 16.0))
    if raw_w % 2 != 0:
        raw_w += 1
    crop_w = min(int(source_width), max(2, raw_w))
    return crop_w, crop_h


def center_x_to_crop_x(center_x: float, crop_width: int, source_width: int) -> float:
    """Convert desired horizontal center `center_x` to clamped top-left `crop_x` in `[0, source_width - crop_width]`."""
    max_x = float(max(0, int(source_width) - int(crop_width)))
    raw_x = float(center_x) - float(crop_width) * 0.5
    return float(np.clip(raw_x, 0.0, max_x))


def apply_deadband_15pct(
    raw_center_xs: Sequence[float],
    *,
    crop_width: int = 608,
    deadband_ratio: float = DEFAULT_DEADBAND_RATIO,
) -> list[float]:
    """Apply 15% Deadband (tripod lock) to a sequence of target center-X positions within a single shot.

    While the target face remains inside the central `deadband_ratio` (15%) of the current crop window
    (`|target_cx - locked_cx| <= deadband_ratio * crop_width`), the camera position stays 100% locked.
    When the target moves outside the deadband, the camera follows smoothly.
    """
    if not raw_center_xs:
        return []

    threshold_px = float(crop_width) * float(deadband_ratio)
    locked_cx = float(raw_center_xs[0])
    stabilized: list[float] = [locked_cx]

    for cx in raw_center_xs[1:]:
        target_cx = float(cx)
        delta = target_cx - locked_cx
        if abs(delta) <= threshold_px:
            stabilized.append(locked_cx)
        else:
            # Move camera to re-center on target (or track boundary excursion)
            locked_cx = target_cx
            stabilized.append(locked_cx)

    return stabilized


def apply_savgol_isolated_per_shot(
    values: Sequence[float],
    *,
    window_length: int = DEFAULT_SAVGOL_WINDOW_LENGTH,
    polyorder: int = DEFAULT_SAVGOL_POLYORDER,
    min_value: float = 0.0,
    max_value: float = 1312.0,
) -> list[float]:
    """Apply non-causal Savitzky-Golay filter strictly isolated to a single shot's trajectory array."""
    n = len(values)
    if n == 0:
        return []

    arr = np.asarray(values, dtype=np.float64)
    if n < 5 or float(np.max(arr) - np.min(arr)) < 1e-4:
        return [float(np.clip(v, min_value, max_value)) for v in arr]

    # Determine largest odd window_length <= min(n, window_length)
    eff_window = min(int(window_length), n)
    if eff_window % 2 == 0:
        eff_window -= 1
    if eff_window < 5:
        return [float(np.clip(v, min_value, max_value)) for v in arr]

    eff_poly = min(int(polyorder), eff_window - 2)
    smoothed = savgol_filter(arr, window_length=eff_window, polyorder=eff_poly, mode="interp")
    clipped = np.clip(smoothed, min_value, max_value)
    return [float(v) for v in clipped]


def ramer_douglas_peucker(
    points: Sequence[tuple[float, float]],
    *,
    epsilon: float = DEFAULT_RDP_EPSILON_PX,
) -> list[tuple[float, float]]:
    """Simplify a 2D trajectory `[(t_0, x_0), ..., (t_n, x_n)]` using Ramer-Douglas-Peucker (`epsilon = 2.0px`).

    Uses vertical deviation `|x_i - lerp(x_start, x_end, (t_i - t_start) / (t_end - t_start))|`
    so `epsilon` is measured directly in pixels (`px`).
    """
    pts = list(points)
    if len(pts) <= 2:
        return pts

    t_start, x_start = float(pts[0][0]), float(pts[0][1])
    t_end, x_end = float(pts[-1][0]), float(pts[-1][1])
    dt = t_end - t_start

    max_dist = -1.0
    split_idx = 0
    for idx in range(1, len(pts) - 1):
        ti, xi = float(pts[idx][0]), float(pts[idx][1])
        if dt <= 1e-9:
            interp_x = (x_start + x_end) * 0.5
        else:
            alpha = (ti - t_start) / dt
            interp_x = x_start + alpha * (x_end - x_start)
        dist = abs(xi - interp_x)
        if dist > max_dist:
            max_dist = dist
            split_idx = idx

    if max_dist > float(epsilon):
        left = ramer_douglas_peucker(pts[: split_idx + 1], epsilon=epsilon)
        right = ramer_douglas_peucker(pts[split_idx:], epsilon=epsilon)
        return left[:-1] + right

    return [pts[0], pts[-1]]


def _is_dual_active_conversation(
    face_left: FaceBoundingBox,
    face_right: FaceBoundingBox,
    window_observations: Sequence[FrameObservation],
    *,
    min_separation_ratio: float = DEFAULT_SPLIT_MIN_SEPARATION_RATIO,
) -> bool:
    """Return True if 2 faces are horizontally separated and both speak/alternate rapidly in the window."""
    frame_w = float(max(1, face_left.frame_width))
    sep_ratio = abs(face_right.center_x - face_left.center_x) / frame_w
    if sep_ratio < min_separation_ratio:
        return False

    # Check if both faces show active mouth openness in the recent window
    left_mouths: list[float] = []
    right_mouths: list[float] = []
    for obs in window_observations:
        if len(obs.faces) >= 2:
            s_faces = sorted(obs.faces, key=lambda f: f.center_x)
            left_mouths.append(float(s_faces[0].mouth_openness))
            right_mouths.append(float(s_faces[-1].mouth_openness))

    if not left_mouths or not right_mouths:
        return (face_left.mouth_openness >= 0.25) and (face_right.mouth_openness >= 0.25)

    left_active = max(left_mouths) >= 0.25 or float(np.mean(left_mouths)) >= 0.18
    right_active = max(right_mouths) >= 0.25 or float(np.mean(right_mouths)) >= 0.18
    return bool(left_active and right_active)


def _resolve_three_plus_faces(
    current_obs: FrameObservation,
    shot_obs_up_to_now: Sequence[FrameObservation],
    speaker_tracker: ActiveSpeakerTracker,
    *,
    fallback_mode: CameraLayoutMode = "blur",
) -> tuple[CameraLayoutMode, FaceBoundingBox | None]:
    """For 3+ faces, track a single clearly dominant active speaker or fall back to group framing (`blur`/`zoom`)."""
    faces = current_obs.faces
    scores = compute_speaker_activity_scores(shot_obs_up_to_now[-8:], faces)
    sorted_scores = sorted(scores.values(), reverse=True)
    max_mouth = max((f.mouth_openness for f in faces), default=0.0)

    # Single dominant speaker only if top score is substantially above second-best AND has real mouth activity
    if (
        len(sorted_scores) >= 2
        and max_mouth >= 0.30
        and sorted_scores[0] >= max(0.35, sorted_scores[1] * 1.8)
    ):
        chosen, _ = speaker_tracker.select_speaker(current_obs, shot_obs_up_to_now)
        return "crop_track", chosen

    return fallback_mode, None


def _plan_single_shot(
    shot: ShotSegment,
    *,
    source_width: int,
    source_height: int,
    crop_width: int,
    crop_height: int,
    vertical_mode: VerticalPresetMode,
    deadband_ratio: float,
    hold_max_gap_seconds: float,
    zero_face_fallback_mode: CameraLayoutMode,
    multi_face_fallback_mode: CameraLayoutMode,
    savgol_window: int,
    savgol_polyorder: int,
    rdp_epsilon: float,
    sample_fps: float,
) -> ShotCameraPlan:
    """Execute the Non-Causal Virtual Cameraman state machine strictly inside one HSV `ShotSegment`."""
    cleaned_obs = filter_static_false_faces_in_shot(
        shot.observations,
        min_area_ratio=MIN_VALID_FACE_AREA_RATIO,
    )
    n_frames = len(cleaned_obs)
    default_center_x = float(source_width) * 0.5
    default_crop_x = center_x_to_crop_x(default_center_x, crop_width, source_width)
    max_crop_x = float(max(0, source_width - crop_width))
    frame_dt = 1.0 / max(1.0, sample_fps)

    if n_frames == 0:
        return ShotCameraPlan(
            shot_id=shot.shot_id,
            start_time=shot.start_time,
            end_time=shot.end_time,
            dominant_mode=zero_face_fallback_mode,
        )

    # Explicit static preset overrides
    if vertical_mode in ("blur", "zoom", "crop"):
        fixed_mode: CameraLayoutMode = (
            "blur" if vertical_mode == "blur" else ("zoom" if vertical_mode == "zoom" else "crop_track")
        )
        samples = [
            FrameCameraSample(
                frame_index=o.frame_index,
                timestamp=o.timestamp,
                shot_id=shot.shot_id,
                mode=fixed_mode,
                crop_x=default_crop_x,
                crop_w=crop_width,
                crop_h=crop_height,
                face_count=len(o.faces),
            )
            for o in cleaned_obs
        ]
        keyframes = [
            CameraKeyframe(
                time=cleaned_obs[0].timestamp,
                x=default_crop_x,
                crop_w=crop_width,
                crop_h=crop_height,
                mode=fixed_mode,
                shot_id=shot.shot_id,
            ),
            CameraKeyframe(
                time=cleaned_obs[-1].timestamp,
                x=default_crop_x,
                crop_w=crop_width,
                crop_h=crop_height,
                mode=fixed_mode,
                shot_id=shot.shot_id,
            ),
        ]
        return ShotCameraPlan(
            shot_id=shot.shot_id,
            start_time=shot.start_time,
            end_time=shot.end_time,
            dominant_mode=fixed_mode,
            samples=samples,
            keyframes=keyframes if len(cleaned_obs) > 1 else keyframes[:1],
        )

    # Check if the entire shot is a prolonged 0-face shot (< 15% frames with faces and duration >= 2.0s)
    frames_with_faces = sum(1 for o in cleaned_obs if len(o.faces) > 0)
    face_presence_ratio = float(frames_with_faces) / float(n_frames)
    shot_span_seconds = max(
        shot.duration,
        (float(cleaned_obs[-1].timestamp) - float(cleaned_obs[0].timestamp)) + frame_dt,
    )
    if (frames_with_faces == 0 or face_presence_ratio < 0.15) and shot_span_seconds >= hold_max_gap_seconds:
        samples = [
            FrameCameraSample(
                frame_index=o.frame_index,
                timestamp=o.timestamp,
                shot_id=shot.shot_id,
                mode=zero_face_fallback_mode,
                crop_x=default_crop_x,
                crop_w=crop_width,
                crop_h=crop_height,
                face_count=len(o.faces),
            )
            for o in cleaned_obs
        ]
        keyframes = [
            CameraKeyframe(
                time=cleaned_obs[0].timestamp,
                x=default_crop_x,
                crop_w=crop_width,
                crop_h=crop_height,
                mode=zero_face_fallback_mode,
                shot_id=shot.shot_id,
            )
        ]
        if len(cleaned_obs) > 1:
            keyframes.append(
                CameraKeyframe(
                    time=cleaned_obs[-1].timestamp,
                    x=default_crop_x,
                    crop_w=crop_width,
                    crop_h=crop_height,
                    mode=zero_face_fallback_mode,
                    shot_id=shot.shot_id,
                )
            )
        return ShotCameraPlan(
            shot_id=shot.shot_id,
            start_time=shot.start_time,
            end_time=shot.end_time,
            dominant_mode=zero_face_fallback_mode,
            samples=samples,
            keyframes=keyframes,
        )

    # Precompute contiguous 0-face gap durations so we know whether each 0-face gap is < 2.0s (Hold) or >= 2.0s (Fallback)
    zero_face_gap_durations: dict[int, float] = {}
    idx = 0
    while idx < n_frames:
        if len(cleaned_obs[idx].faces) == 0:
            gap_start = idx
            while idx < n_frames and len(cleaned_obs[idx].faces) == 0:
                idx += 1
            gap_end = idx - 1
            gap_dur = (float(cleaned_obs[gap_end].timestamp) - float(cleaned_obs[gap_start].timestamp)) + frame_dt
            for g_i in range(gap_start, gap_end + 1):
                zero_face_gap_durations[g_i] = gap_dur
        else:
            idx += 1

    # Find initial valid face center_x in this shot for leading <2s Hold-Last-Position
    first_valid_cx = default_center_x
    for o in cleaned_obs:
        if o.faces:
            first_valid_cx = o.faces[0].center_x
            break

    speaker_tracker = ActiveSpeakerTracker(min_dwell_seconds=DEFAULT_SPEAKER_DWELL_SECONDS)
    last_valid_cx = first_valid_cx
    last_active_face_id: str | None = None

    raw_modes: list[CameraLayoutMode] = []
    raw_center_xs: list[float] = []
    raw_secondary_xs: list[float | None] = []
    raw_face_ids: list[str | None] = []

    for i, obs in enumerate(cleaned_obs):
        faces = obs.faces
        num_faces = len(faces)
        history_slice = cleaned_obs[max(0, i - 8) : i + 1]

        if num_faces == 0:
            gap_dur = zero_face_gap_durations.get(i, 0.0)
            if gap_dur >= hold_max_gap_seconds - 1e-6:
                raw_modes.append(zero_face_fallback_mode)
                raw_center_xs.append(last_valid_cx)
                raw_secondary_xs.append(None)
                raw_face_ids.append(None)
            else:
                # Hold-Last-Position (< 2.0s gap)
                raw_modes.append("crop_track")
                raw_center_xs.append(last_valid_cx)
                raw_secondary_xs.append(None)
                raw_face_ids.append(last_active_face_id)
            continue

        if num_faces == 1:
            face = faces[0]
            speaker_tracker.select_speaker(obs, cleaned_obs[: i + 1])
            last_valid_cx = face.center_x
            last_active_face_id = face.face_id
            raw_modes.append("crop_track")
            raw_center_xs.append(last_valid_cx)
            raw_secondary_xs.append(None)
            raw_face_ids.append(face.face_id)
            continue

        if num_faces == 2:
            left_f, right_f = sorted(faces, key=lambda f: f.center_x)
            sep_ratio = abs(right_f.center_x - left_f.center_x) / float(max(1, source_width))
            use_split = (
                vertical_mode == "split_podcast" and sep_ratio >= 0.20
            ) or _is_dual_active_conversation(left_f, right_f, history_slice)
            if use_split:
                raw_modes.append("split_screen")
                raw_center_xs.append(left_f.center_x)
                raw_secondary_xs.append(right_f.center_x)
                raw_face_ids.append(f"{left_f.face_id}+{right_f.face_id}")
            else:
                chosen, _ = speaker_tracker.select_speaker(obs, cleaned_obs[: i + 1])
                last_valid_cx = chosen.center_x
                last_active_face_id = chosen.face_id
                raw_modes.append("crop_track")
                raw_center_xs.append(last_valid_cx)
                raw_secondary_xs.append(None)
                raw_face_ids.append(chosen.face_id)
            continue

        # 3+ faces
        mode_3p, chosen_3p = _resolve_three_plus_faces(
            obs,
            cleaned_obs[: i + 1],
            speaker_tracker,
            fallback_mode=multi_face_fallback_mode,
        )
        if mode_3p == "crop_track" and chosen_3p is not None:
            last_valid_cx = chosen_3p.center_x
            last_active_face_id = chosen_3p.face_id
            raw_modes.append("crop_track")
            raw_center_xs.append(last_valid_cx)
            raw_secondary_xs.append(None)
            raw_face_ids.append(chosen_3p.face_id)
        else:
            raw_modes.append(mode_3p)
            raw_center_xs.append(default_center_x)
            raw_secondary_xs.append(None)
            raw_face_ids.append(None)

    # Apply 15% Deadband + Savitzky-Golay strictly isolated within this shot (and per contiguous mode span)
    final_crop_xs: list[float] = [default_crop_x] * n_frames
    final_sec_crop_xs: list[float | None] = [None] * n_frames

    span_start = 0
    while span_start < n_frames:
        span_mode = raw_modes[span_start]
        span_end = span_start
        while span_end + 1 < n_frames and raw_modes[span_end + 1] == span_mode:
            span_end += 1

        indices = list(range(span_start, span_end + 1))
        if span_mode == "crop_track":
            span_cxs = [raw_center_xs[k] for k in indices]
            deadbanded_cxs = apply_deadband_15pct(
                span_cxs,
                crop_width=crop_width,
                deadband_ratio=deadband_ratio,
            )
            span_crop_xs = [
                center_x_to_crop_x(cx, crop_width, source_width)
                for cx in deadbanded_cxs
            ]
            smoothed_crop_xs = apply_savgol_isolated_per_shot(
                span_crop_xs,
                window_length=savgol_window,
                polyorder=savgol_polyorder,
                min_value=0.0,
                max_value=max_crop_x,
            )
            for k, val in zip(indices, smoothed_crop_xs):
                final_crop_xs[k] = val
        elif span_mode == "split_screen":
            split_crop_w = min(source_width, 960)
            max_split_x = float(max(0, source_width - split_crop_w))
            left_xs = [
                center_x_to_crop_x(raw_center_xs[k], split_crop_w, source_width)
                for k in indices
            ]
            right_xs = [
                center_x_to_crop_x(
                    raw_secondary_xs[k] if raw_secondary_xs[k] is not None else float(source_width) * 0.75,
                    split_crop_w,
                    source_width,
                )
                for k in indices
            ]
            sm_left = apply_savgol_isolated_per_shot(
                left_xs,
                window_length=savgol_window,
                polyorder=savgol_polyorder,
                min_value=0.0,
                max_value=max_split_x,
            )
            sm_right = apply_savgol_isolated_per_shot(
                right_xs,
                window_length=savgol_window,
                polyorder=savgol_polyorder,
                min_value=0.0,
                max_value=max_split_x,
            )
            for k, lx, rx in zip(indices, sm_left, sm_right):
                final_crop_xs[k] = lx
                final_sec_crop_xs[k] = rx
        else:
            for k in indices:
                final_crop_xs[k] = default_crop_x

        span_start = span_end + 1

    samples: list[FrameCameraSample] = []
    for k, obs in enumerate(cleaned_obs):
        samples.append(
            FrameCameraSample(
                frame_index=obs.frame_index,
                timestamp=float(obs.timestamp),
                shot_id=shot.shot_id,
                mode=raw_modes[k],
                crop_x=float(final_crop_xs[k]),
                crop_y=0.0,
                crop_w=crop_width,
                crop_h=crop_height,
                secondary_crop_x=final_sec_crop_xs[k],
                active_face_id=raw_face_ids[k],
                face_count=len(obs.faces),
            )
        )

    # Simplify each contiguous mode span in this shot with Ramer-Douglas-Peucker (`epsilon = 2.0px`)
    keyframes: list[CameraKeyframe] = []
    span_start = 0
    while span_start < len(samples):
        span_mode = samples[span_start].mode
        span_end = span_start
        while span_end + 1 < len(samples) and samples[span_end + 1].mode == span_mode:
            span_end += 1

        span_samples = samples[span_start : span_end + 1]
        if span_mode == "split_screen":
            pts_primary = [(float(s.timestamp), float(s.crop_x)) for s in span_samples]
            pts_secondary = [
                (
                    float(s.timestamp),
                    float(s.secondary_crop_x) if s.secondary_crop_x is not None else float(s.crop_x),
                )
                for s in span_samples
            ]
            simp_primary = ramer_douglas_peucker(pts_primary, epsilon=rdp_epsilon)
            simp_secondary = ramer_douglas_peucker(pts_secondary, epsilon=rdp_epsilon)
            kept_times = sorted(
                {float(t) for t, _ in simp_primary} | {float(t) for t, _ in simp_secondary}
            )
            sample_by_time = {float(s.timestamp): s for s in span_samples}
            for t_val in kept_times:
                smp = sample_by_time[t_val]
                keyframes.append(
                    CameraKeyframe(
                        time=float(t_val),
                        x=float(smp.crop_x),
                        y=0.0,
                        crop_w=crop_width,
                        crop_h=crop_height,
                        mode=span_mode,
                        shot_id=shot.shot_id,
                        secondary_x=smp.secondary_crop_x,
                    )
                )
        else:
            pts = [(s.timestamp, s.crop_x) for s in span_samples]
            simplified = ramer_douglas_peucker(pts, epsilon=rdp_epsilon)
            sec_lookup = {s.timestamp: s.secondary_crop_x for s in span_samples}
            for t_val, x_val in simplified:
                keyframes.append(
                    CameraKeyframe(
                        time=float(t_val),
                        x=float(x_val),
                        y=0.0,
                        crop_w=crop_width,
                        crop_h=crop_height,
                        mode=span_mode,
                        shot_id=shot.shot_id,
                        secondary_x=sec_lookup.get(t_val),
                    )
                )
        span_start = span_end + 1

    # Dominant mode in shot by frame count
    mode_counts: dict[CameraLayoutMode, int] = {}
    for s in samples:
        mode_counts[s.mode] = mode_counts.get(s.mode, 0) + 1
    dominant_mode = max(mode_counts.items(), key=lambda kv: kv[1])[0]

    return ShotCameraPlan(
        shot_id=shot.shot_id,
        start_time=shot.start_time,
        end_time=shot.end_time,
        dominant_mode=dominant_mode,
        samples=samples,
        keyframes=keyframes,
    )


def build_virtual_cameraman_plan(
    observations: Sequence[FrameObservation],
    *,
    source_width: int = 1920,
    source_height: int = 1080,
    target_width: int = 1080,
    target_height: int = 1920,
    vertical_mode: VerticalPresetMode = "auto_reframe",
    deadband_ratio: float = DEFAULT_DEADBAND_RATIO,
    hold_max_gap_seconds: float = DEFAULT_HOLD_MAX_GAP_SECONDS,
    zero_face_fallback_mode: CameraLayoutMode = "blur",
    multi_face_fallback_mode: CameraLayoutMode = "blur",
    hsv_cut_threshold: float = DEFAULT_HSV_SCENE_CUT_THRESHOLD,
    savgol_window: int = DEFAULT_SAVGOL_WINDOW_LENGTH,
    savgol_polyorder: int = DEFAULT_SAVGOL_POLYORDER,
    rdp_epsilon: float = DEFAULT_RDP_EPSILON_PX,
    sample_fps: float = DEFAULT_SAMPLE_FPS,
    time_remapper: Callable[[float], float] | None = None,
) -> VirtualCameramanPlan:
    """Build the complete Non-Causal Virtual Cameraman 9:16 trajectory plan across all HSV shots."""
    if observations:
        source_width = int(observations[0].frame_width or source_width)
        source_height = int(observations[0].frame_height or source_height)

    crop_w, crop_h = compute_9_16_crop_dimensions(source_width, source_height)

    if not observations:
        fallback: CameraLayoutMode = (
            "blur"
            if vertical_mode in ("auto_reframe", "blur")
            else ("zoom" if vertical_mode == "zoom" else ("split_screen" if vertical_mode == "split_podcast" else "crop_track"))
        )
        default_x = center_x_to_crop_x(source_width * 0.5, crop_w, source_width)
        kf = CameraKeyframe(time=0.0, x=default_x, crop_w=crop_w, crop_h=crop_h, mode=fallback, shot_id=0)
        return VirtualCameramanPlan(
            source_width=source_width,
            source_height=source_height,
            target_width=target_width,
            target_height=target_height,
            crop_width=crop_w,
            crop_height=crop_h,
            vertical_mode=vertical_mode,
            primary_mode=fallback,
            shots=[],
            samples=[],
            keyframes=[kf],
        )

    shots = segment_observations_into_shots(
        observations,
        hsv_threshold=hsv_cut_threshold,
        sample_fps=sample_fps,
    )

    shot_plans: list[ShotCameraPlan] = []
    all_samples: list[FrameCameraSample] = []
    all_keyframes: list[CameraKeyframe] = []

    for shot in shots:
        splan = _plan_single_shot(
            shot,
            source_width=source_width,
            source_height=source_height,
            crop_width=crop_w,
            crop_height=crop_h,
            vertical_mode=vertical_mode,
            deadband_ratio=deadband_ratio,
            hold_max_gap_seconds=hold_max_gap_seconds,
            zero_face_fallback_mode=zero_face_fallback_mode,
            multi_face_fallback_mode=multi_face_fallback_mode,
            savgol_window=savgol_window,
            savgol_polyorder=savgol_polyorder,
            rdp_epsilon=rdp_epsilon,
            sample_fps=sample_fps,
        )
        if time_remapper is not None:
            splan.start_time = float(time_remapper(splan.start_time))
            splan.end_time = float(time_remapper(splan.end_time))
            for smp in splan.samples:
                smp.timestamp = float(time_remapper(smp.timestamp))
            for kf in splan.keyframes:
                kf.time = float(time_remapper(kf.time))

        shot_plans.append(splan)
        all_samples.extend(splan.samples)
        all_keyframes.extend(splan.keyframes)

    mode_counts: dict[CameraLayoutMode, int] = {}
    for s in all_samples:
        mode_counts[s.mode] = mode_counts.get(s.mode, 0) + 1
    primary_mode: CameraLayoutMode = (
        max(mode_counts.items(), key=lambda kv: kv[1])[0] if mode_counts else zero_face_fallback_mode
    )

    return VirtualCameramanPlan(
        source_width=source_width,
        source_height=source_height,
        target_width=target_width,
        target_height=target_height,
        crop_width=crop_w,
        crop_height=crop_h,
        vertical_mode=vertical_mode,
        primary_mode=primary_mode,
        shots=shot_plans,
        samples=all_samples,
        keyframes=all_keyframes,
    )
