"""Computer vision adapters: MediaPipe/OpenCV face tracking, false-face filter, active speaker heuristic, and HSV scene-cut detection.

NOTE: `cv2` and `mediapipe` are lazy-imported ONLY inside functions that process actual video frames,
never at module top-level, keeping logical unit tests 100% hardware-free and fast.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Sequence

import numpy as np

MIN_VALID_FACE_AREA_RATIO: float = 0.015  # 1.5% of total frame area
DEFAULT_HSV_SCENE_CUT_THRESHOLD: float = 0.40
DEFAULT_ACTIVE_SPEAKER_WINDOW_SECONDS: float = 1.0
DEFAULT_SPEAKER_DWELL_SECONDS: float = 2.5
DEFAULT_SAMPLE_FPS: float = 8.0


@dataclass
class FaceBoundingBox:
    """Detected face bounding box in pixel coordinates with mouth/lip motion energy metadata."""

    face_id: str
    x: float
    y: float
    width: float
    height: float
    frame_width: int = 1920
    frame_height: int = 1080
    confidence: float = 1.0
    mouth_openness: float = 0.0
    mouth_motion_energy: float | None = None
    is_static_artifact: bool = False

    @property
    def center_x(self) -> float:
        return float(self.x) + float(self.width) * 0.5

    @property
    def center_y(self) -> float:
        return float(self.y) + float(self.height) * 0.5

    @property
    def area(self) -> float:
        return max(0.0, float(self.width)) * max(0.0, float(self.height))

    @property
    def frame_area(self) -> float:
        return float(max(1, self.frame_width) * max(1, self.frame_height))

    @property
    def area_ratio(self) -> float:
        return self.area / self.frame_area

    @property
    def norm_center_x(self) -> float:
        return self.center_x / float(max(1, self.frame_width))


@dataclass
class FrameObservation:
    """Sampled video frame observation at timestamp `timestamp` (in seconds relative to cut start)."""

    frame_index: int
    timestamp: float
    faces: list[FaceBoundingBox] = field(default_factory=list)
    audio_rms: float = 0.0
    hsv_histogram: Sequence[float] | np.ndarray | None = None
    is_scene_cut: bool = False
    frame_width: int = 1920
    frame_height: int = 1080


@dataclass
class ShotSegment:
    """Continuous camera shot bounded by hard scene cuts (HSV histogram discontinuities)."""

    shot_id: int
    start_frame: int
    end_frame: int
    start_time: float
    end_time: float
    observations: list[FrameObservation] = field(default_factory=list)

    @property
    def duration(self) -> float:
        return max(0.0, float(self.end_time) - float(self.start_time))


def is_valid_face_box(
    face: FaceBoundingBox,
    *,
    min_area_ratio: float = MIN_VALID_FACE_AREA_RATIO,
    min_confidence: float = 0.45,
) -> bool:
    """Return True if the face bounding box passes the >= 1.5% frame area and confidence filters."""
    if face.is_static_artifact:
        return False
    if face.width <= 0 or face.height <= 0:
        return False
    if face.confidence < min_confidence:
        return False
    return face.area_ratio >= min_area_ratio


def filter_false_faces(
    faces: Sequence[FaceBoundingBox],
    *,
    min_area_ratio: float = MIN_VALID_FACE_AREA_RATIO,
    min_confidence: float = 0.45,
) -> list[FaceBoundingBox]:
    """Filter out false background faces (< 1.5% of frame area or low confidence)."""
    valid = [
        f
        for f in faces
        if is_valid_face_box(f, min_area_ratio=min_area_ratio, min_confidence=min_confidence)
    ]
    valid.sort(key=lambda b: b.center_x)
    return valid


def filter_static_false_faces_in_shot(
    observations: Sequence[FrameObservation],
    *,
    min_area_ratio: float = MIN_VALID_FACE_AREA_RATIO,
    min_confidence: float = 0.45,
    min_frames_for_static_check: int = 8,
) -> list[FrameObservation]:
    """Filter per-frame false faces (< 1.5% area) and static background posters across a shot.

    A face track is treated as a static background artifact if:
    - It is explicitly marked `is_static_artifact=True`, OR
    - Another moving face exists in the shot and this track has zero spatial variance
      (`std(center_x) < 1e-4` and `std(center_y) < 1e-4`) and zero mouth activity (`max(mouth) < 1e-4`)
      across >= `min_frames_for_static_check` frames while having smaller area (< 4% of frame).
    """
    per_track: dict[str, list[FaceBoundingBox]] = {}
    filtered_per_frame: list[list[FaceBoundingBox]] = []

    for obs in observations:
        valid = filter_false_faces(
            obs.faces,
            min_area_ratio=min_area_ratio,
            min_confidence=min_confidence,
        )
        filtered_per_frame.append(valid)
        for f in valid:
            per_track.setdefault(f.face_id, []).append(f)

    static_artifact_ids: set[str] = set()
    if len(per_track) > 1 and len(observations) >= min_frames_for_static_check:
        moving_tracks: set[str] = set()
        for fid, boxes in per_track.items():
            if len(boxes) < 2:
                continue
            cx_std = float(np.std([b.center_x for b in boxes]))
            cy_std = float(np.std([b.center_y for b in boxes]))
            mouth_max = max((b.mouth_openness for b in boxes), default=0.0)
            if cx_std > 0.25 or cy_std > 0.25 or mouth_max > 0.05:
                moving_tracks.add(fid)

        if moving_tracks:
            for fid, boxes in per_track.items():
                if fid in moving_tracks or len(boxes) < min_frames_for_static_check:
                    continue
                cx_std = float(np.std([b.center_x for b in boxes]))
                cy_std = float(np.std([b.center_y for b in boxes]))
                mouth_max = max((b.mouth_openness for b in boxes), default=0.0)
                mean_area = float(np.mean([b.area_ratio for b in boxes]))
                if cx_std < 1e-4 and cy_std < 1e-4 and mouth_max < 1e-4 and mean_area < 0.04:
                    static_artifact_ids.add(fid)

    cleaned: list[FrameObservation] = []
    for obs, valid_faces in zip(observations, filtered_per_frame):
        kept = [f for f in valid_faces if f.face_id not in static_artifact_ids]
        cleaned.append(
            FrameObservation(
                frame_index=obs.frame_index,
                timestamp=obs.timestamp,
                faces=kept,
                audio_rms=obs.audio_rms,
                hsv_histogram=obs.hsv_histogram,
                is_scene_cut=obs.is_scene_cut,
                frame_width=obs.frame_width,
                frame_height=obs.frame_height,
            )
        )
    return cleaned


def compute_hsv_histogram_from_bgr(
    bgr_frame: np.ndarray,
    *,
    h_bins: int = 16,
    s_bins: int = 8,
    v_bins: int = 8,
) -> np.ndarray:
    """Compute normalized HSV histogram from a BGR image (lazy-imports cv2 if available, numpy fallback)."""
    arr = np.asarray(bgr_frame)
    if arr.ndim != 3 or arr.shape[2] < 3:
        hist, _ = np.histogram(arr.ravel(), bins=h_bins, range=(0, 256), density=False)
        total = float(hist.sum()) or 1.0
        return hist.astype(np.float32) / total

    try:
        import cv2  # Lazy import inside function only

        hsv = cv2.cvtColor(arr, cv2.COLOR_BGR2HSV)
        hist_h = cv2.calcHist([hsv], [0], None, [h_bins], [0, 180]).ravel()
        hist_s = cv2.calcHist([hsv], [1], None, [s_bins], [0, 256]).ravel()
        hist_v = cv2.calcHist([hsv], [2], None, [v_bins], [0, 256]).ravel()
        combined = np.concatenate([hist_h, hist_s, hist_v]).astype(np.float32)
    except Exception:
        # Pure-numpy channel histogram fallback
        ch0, _ = np.histogram(arr[:, :, 0], bins=h_bins, range=(0, 256))
        ch1, _ = np.histogram(arr[:, :, 1], bins=s_bins, range=(0, 256))
        ch2, _ = np.histogram(arr[:, :, 2], bins=v_bins, range=(0, 256))
        combined = np.concatenate([ch0, ch1, ch2]).astype(np.float32)

    norm = float(np.sum(np.abs(combined)))
    if norm > 0:
        combined = combined / norm
    return combined


def hsv_histogram_distance(
    hist_a: Sequence[float] | np.ndarray | None,
    hist_b: Sequence[float] | np.ndarray | None,
) -> float:
    """Compute normalized L1 distance in [0.0, 1.0] between two normalized HSV histograms."""
    if hist_a is None or hist_b is None:
        return 0.0
    a = np.asarray(hist_a, dtype=np.float64).ravel()
    b = np.asarray(hist_b, dtype=np.float64).ravel()
    if a.size == 0 or b.size == 0 or a.size != b.size:
        return 0.0
    sum_a = float(np.sum(np.abs(a)))
    sum_b = float(np.sum(np.abs(b)))
    if sum_a <= 0 or sum_b <= 0:
        return 0.0
    a_norm = a / sum_a
    b_norm = b / sum_b
    return float(np.clip(0.5 * np.sum(np.abs(a_norm - b_norm)), 0.0, 1.0))


def detect_scene_cuts_hsv(
    observations: Sequence[FrameObservation],
    *,
    threshold: float = DEFAULT_HSV_SCENE_CUT_THRESHOLD,
) -> list[int]:
    """Return frame indices where a hard scene cut occurs (always starts with 0 if non-empty)."""
    if not observations:
        return []

    cut_starts: list[int] = [0]
    for idx in range(1, len(observations)):
        prev_obs = observations[idx - 1]
        curr_obs = observations[idx]
        if curr_obs.is_scene_cut:
            cut_starts.append(idx)
            continue
        dist = hsv_histogram_distance(prev_obs.hsv_histogram, curr_obs.hsv_histogram)
        if dist >= threshold:
            cut_starts.append(idx)
    return cut_starts


def segment_observations_into_shots(
    observations: Sequence[FrameObservation],
    *,
    hsv_threshold: float = DEFAULT_HSV_SCENE_CUT_THRESHOLD,
    sample_fps: float = DEFAULT_SAMPLE_FPS,
) -> list[ShotSegment]:
    """Partition frame observations into isolated `ShotSegment`s at HSV scene cuts."""
    if not observations:
        return []

    obs_list = list(observations)
    cut_indices = detect_scene_cuts_hsv(obs_list, threshold=hsv_threshold)
    frame_dt = 1.0 / max(1.0, sample_fps)

    shots: list[ShotSegment] = []
    for shot_id, start_idx in enumerate(cut_indices):
        end_idx = (cut_indices[shot_id + 1] - 1) if (shot_id + 1 < len(cut_indices)) else (len(obs_list) - 1)
        slice_obs = obs_list[start_idx : end_idx + 1]
        if not slice_obs:
            continue
        start_time = float(slice_obs[0].timestamp)
        if shot_id + 1 < len(cut_indices):
            end_time = float(obs_list[cut_indices[shot_id + 1]].timestamp)
        else:
            end_time = float(slice_obs[-1].timestamp) + frame_dt
        shots.append(
            ShotSegment(
                shot_id=shot_id,
                start_frame=slice_obs[0].frame_index,
                end_frame=slice_obs[-1].frame_index,
                start_time=start_time,
                end_time=max(start_time, end_time),
                observations=slice_obs,
            )
        )
    return shots


def compute_speaker_activity_scores(
    window_observations: Sequence[FrameObservation],
    current_faces: Sequence[FaceBoundingBox],
) -> dict[str, float]:
    """Score each face in `current_faces` using Lip/Mouth Motion Energy, audio RMS correlation, and area."""
    if not current_faces:
        return {}

    scores: dict[str, float] = {}
    audio_series = np.asarray([max(0.0, float(o.audio_rms)) for o in window_observations], dtype=np.float64)
    has_audio_signal = bool(audio_series.size > 0 and float(np.max(audio_series)) > 0.01)

    for face in current_faces:
        fid = face.face_id
        mouth_values: list[float] = []
        aligned_audio: list[float] = []
        explicit_energies: list[float] = []

        for obs in window_observations:
            for cand in obs.faces:
                if cand.face_id == fid:
                    mouth_values.append(max(0.0, float(cand.mouth_openness)))
                    aligned_audio.append(max(0.0, float(obs.audio_rms)))
                    if cand.mouth_motion_energy is not None:
                        explicit_energies.append(max(0.0, float(cand.mouth_motion_energy)))
                    break

        if explicit_energies:
            motion_energy = float(np.mean(explicit_energies))
        elif len(mouth_values) >= 2:
            arr = np.asarray(mouth_values, dtype=np.float64)
            mad_diff = float(np.mean(np.abs(np.diff(arr))))
            std_val = float(np.std(arr))
            mean_val = float(np.mean(arr))
            motion_energy = 1.8 * mad_diff + 1.2 * std_val + 0.6 * mean_val
        elif len(mouth_values) == 1:
            motion_energy = float(mouth_values[0]) * 0.8
        else:
            motion_energy = float(face.mouth_openness) * 0.8

        audio_corr_bonus = 0.0
        if has_audio_signal and len(mouth_values) >= 2:
            m_arr = np.asarray(mouth_values, dtype=np.float64)
            a_arr = np.asarray(aligned_audio, dtype=np.float64)
            if float(np.std(m_arr)) > 1e-5 and float(np.std(a_arr)) > 1e-5:
                corr = float(np.corrcoef(m_arr, a_arr)[0, 1])
                if not math.isnan(corr) and corr > 0:
                    audio_corr_bonus = 0.25 * corr
            elif float(np.mean(m_arr)) > 0.1 and float(np.mean(a_arr)) > 0.05:
                audio_corr_bonus = 0.15

        area_bonus = 0.15 * min(1.0, face.area_ratio / 0.15)
        scores[fid] = float(motion_energy + audio_corr_bonus + area_bonus)

    return scores


class ActiveSpeakerTracker:
    """Stateful active-speaker selector with trailing 1.0s lip-motion window and 2.5s dwell hysteresis."""

    def __init__(
        self,
        *,
        window_seconds: float = DEFAULT_ACTIVE_SPEAKER_WINDOW_SECONDS,
        min_dwell_seconds: float = DEFAULT_SPEAKER_DWELL_SECONDS,
        switch_margin_ratio: float = 1.15,
    ) -> None:
        self.window_seconds = window_seconds
        self.min_dwell_seconds = min_dwell_seconds
        self.switch_margin_ratio = switch_margin_ratio
        self.current_speaker_id: str | None = None
        self.last_switch_timestamp: float | None = None

    def reset(self) -> None:
        self.current_speaker_id = None
        self.last_switch_timestamp = None

    def select_speaker(
        self,
        current_obs: FrameObservation,
        shot_observations_up_to_now: Sequence[FrameObservation],
    ) -> tuple[FaceBoundingBox, dict[str, float]]:
        """Return the active speaker `FaceBoundingBox` and the activity score map for `current_obs.faces`."""
        faces = current_obs.faces
        if not faces:
            raise ValueError("Cannot select active speaker when no valid faces are present")
        if len(faces) == 1:
            only = faces[0]
            if self.current_speaker_id != only.face_id:
                self.current_speaker_id = only.face_id
                self.last_switch_timestamp = current_obs.timestamp
            return only, {only.face_id: 1.0}

        t_now = float(current_obs.timestamp)
        t_min = t_now - self.window_seconds
        window_obs = [o for o in shot_observations_up_to_now if t_min - 1e-6 <= float(o.timestamp) <= t_now + 1e-6]
        if not window_obs:
            window_obs = [current_obs]

        scores = compute_speaker_activity_scores(window_obs, faces)
        best_face = max(faces, key=lambda f: (scores.get(f.face_id, 0.0), f.area_ratio))
        best_score = scores.get(best_face.face_id, 0.0)

        by_id = {f.face_id: f for f in faces}
        if self.current_speaker_id is None or self.current_speaker_id not in by_id:
            self.current_speaker_id = best_face.face_id
            self.last_switch_timestamp = t_now
            return best_face, scores

        if best_face.face_id == self.current_speaker_id:
            return by_id[self.current_speaker_id], scores

        elapsed_since_switch = (
            (t_now - self.last_switch_timestamp) if self.last_switch_timestamp is not None else float("inf")
        )
        current_score = scores.get(self.current_speaker_id, 0.0)

        # Enforce dwell time hysteresis (2.5s) before switching camera to another speaker
        if elapsed_since_switch >= self.min_dwell_seconds and best_score > max(current_score * self.switch_margin_ratio, 0.08):
            self.current_speaker_id = best_face.face_id
            self.last_switch_timestamp = t_now
            return best_face, scores

        return by_id[self.current_speaker_id], scores


DetectorCallable = Callable[[Any, float, int, int], list[FaceBoundingBox]]
ObservationsProviderCallable = Callable[[Path, float, float, float], list[FrameObservation]]


class MediaPipeVisionAdapter:
    """Face tracking & scene-cut adapter using MediaPipe with automatic fallback to OpenCV Haar/YuNet.

    Supports an injectable `detector` or `observations_provider` for 100% logical tests without GPU/video files.
    """

    def __init__(
        self,
        *,
        sample_fps: float = DEFAULT_SAMPLE_FPS,
        min_face_area_ratio: float = MIN_VALID_FACE_AREA_RATIO,
        hsv_cut_threshold: float = DEFAULT_HSV_SCENE_CUT_THRESHOLD,
        detector: DetectorCallable | None = None,
        observations_provider: ObservationsProviderCallable | None = None,
    ) -> None:
        self.sample_fps = sample_fps
        self.min_face_area_ratio = min_face_area_ratio
        self.hsv_cut_threshold = hsv_cut_threshold
        self._detector = detector
        self._observations_provider = observations_provider
        self._backend_name: str | None = None

    @property
    def backend_name(self) -> str:
        if self._detector is not None:
            return "injected"
        if self._backend_name is not None:
            return self._backend_name
        return "lazy_uninitialized"

    def _build_default_detector(self) -> DetectorCallable:
        """Lazy-load MediaPipe FaceDetection/FaceMesh or fall back to OpenCV Haar Cascade."""
        if self._detector is not None:
            return self._detector

        # 1. Try MediaPipe first
        try:
            import mediapipe as mp  # Lazy import inside method only

            mp_face = getattr(mp.solutions, "face_detection", None)
            if mp_face is not None:
                detector_mp = mp_face.FaceDetection(model_selection=1, min_detection_confidence=0.5)
                self._backend_name = "mediapipe"

                def _detect_mp(bgr_frame: Any, timestamp: float, width: int, height: int) -> list[FaceBoundingBox]:
                    import cv2  # Lazy import

                    rgb = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2RGB)
                    results = detector_mp.process(rgb)
                    boxes: list[FaceBoundingBox] = []
                    if not results or not getattr(results, "detections", None):
                        return boxes
                    for idx, det in enumerate(results.detections):
                        rel_box = det.location_data.relative_bounding_box
                        x = max(0.0, float(rel_box.xmin) * width)
                        y = max(0.0, float(rel_box.ymin) * height)
                        w = max(0.0, float(rel_box.width) * width)
                        h = max(0.0, float(rel_box.height) * height)
                        score = float(det.score[0]) if getattr(det, "score", None) else 0.8
                        mouth_energy = _estimate_lower_face_motion(bgr_frame, int(x), int(y), int(w), int(h))
                        boxes.append(
                            FaceBoundingBox(
                                face_id=f"face_{idx}",
                                x=x,
                                y=y,
                                width=w,
                                height=h,
                                frame_width=width,
                                frame_height=height,
                                confidence=score,
                                mouth_openness=mouth_energy,
                            )
                        )
                    return boxes

                self._detector = _detect_mp
                return _detect_mp
        except Exception:
            pass

        # 2. Automatic graceful fallback to OpenCV Haar Cascade
        try:
            import cv2  # Lazy import inside method only

            cascade_path = str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
            cascade = cv2.CascadeClassifier(cascade_path)
            self._backend_name = "opencv_haar"

            def _detect_cv(bgr_frame: Any, timestamp: float, width: int, height: int) -> list[FaceBoundingBox]:
                gray = cv2.cvtColor(bgr_frame, cv2.COLOR_BGR2GRAY)
                rects = cascade.detectMultiScale(
                    gray,
                    scaleFactor=1.15,
                    minNeighbors=5,
                    minSize=(int(width * 0.08), int(height * 0.08)),
                )
                boxes: list[FaceBoundingBox] = []
                if rects is None or len(rects) == 0:
                    return boxes
                sorted_rects = sorted(rects, key=lambda r: float(r[0]))
                for idx, (rx, ry, rw, rh) in enumerate(sorted_rects):
                    mouth_energy = _estimate_lower_face_motion(bgr_frame, int(rx), int(ry), int(rw), int(rh))
                    boxes.append(
                        FaceBoundingBox(
                            face_id=f"face_{idx}",
                            x=float(rx),
                            y=float(ry),
                            width=float(rw),
                            height=float(rh),
                            frame_width=width,
                            frame_height=height,
                            confidence=0.85,
                            mouth_openness=mouth_energy,
                        )
                    )
                return boxes

            self._detector = _detect_cv
            return _detect_cv
        except Exception:
            self._backend_name = "noop_fallback"

            def _detect_noop(bgr_frame: Any, timestamp: float, width: int, height: int) -> list[FaceBoundingBox]:
                return []

            self._detector = _detect_noop
            return _detect_noop

    def analyze_video_cut(
        self,
        video_path: str | Path,
        start_time: float,
        end_time: float,
        *,
        audio_rms_series: Sequence[float] | None = None,
        cancel_check: Callable[[], None] | None = None,
    ) -> list[FrameObservation]:
        """Sample frames at `sample_fps` over `[start_time, end_time]` and extract faces + HSV histograms."""
        vpath = Path(video_path)
        if self._observations_provider is not None:
            return self._observations_provider(vpath, float(start_time), float(end_time), float(self.sample_fps))

        if not vpath.exists():
            return []

        try:
            import cv2  # Lazy import inside method only
        except Exception:
            return []

        cap = cv2.VideoCapture(str(vpath))
        if not cap.isOpened():
            cap.release()
            return []

        try:
            video_fps = float(cap.get(cv2.CAP_PROP_FPS) or 30.0)
            if video_fps <= 0 or math.isnan(video_fps):
                video_fps = 30.0
            width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH) or 1920)
            height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 1080)
            step_frames = max(1, int(round(video_fps / max(1.0, self.sample_fps))))

            cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, float(start_time) * 1000.0))
            detector = self._build_default_detector()
            observations: list[FrameObservation] = []
            duration = max(0.0, float(end_time) - float(start_time))
            max_samples = max(1, int(math.ceil(duration * self.sample_fps)) + 2)

            frame_counter = 0
            sample_idx = 0
            while sample_idx < max_samples:
                if cancel_check is not None:
                    cancel_check()
                ok, frame = cap.read()
                if not ok or frame is None:
                    break
                if frame_counter % step_frames == 0:
                    rel_t = float(sample_idx) / max(1.0, self.sample_fps)
                    if rel_t > duration + 0.05:
                        break
                    hist = compute_hsv_histogram_from_bgr(frame)
                    raw_faces = detector(frame, rel_t, width, height)
                    valid_faces = filter_false_faces(raw_faces, min_area_ratio=self.min_face_area_ratio)
                    rms_val = 0.0
                    if audio_rms_series is not None and len(audio_rms_series) > 0:
                        rms_idx = min(len(audio_rms_series) - 1, max(0, int(round(rel_t * 100.0))))
                        rms_val = float(audio_rms_series[rms_idx])
                    observations.append(
                        FrameObservation(
                            frame_index=sample_idx,
                            timestamp=rel_t,
                            faces=valid_faces,
                            audio_rms=rms_val,
                            hsv_histogram=hist,
                            frame_width=width,
                            frame_height=height,
                        )
                    )
                    sample_idx += 1
                frame_counter += 1

            return _assign_consistent_face_track_ids(observations)
        finally:
            cap.release()


def _estimate_lower_face_motion(bgr_frame: np.ndarray, x: int, y: int, w: int, h: int) -> float:
    """Estimate normalized contrast/gradient energy in the lower-third (mouth/jaw) region of a face box."""
    if w <= 4 or h <= 4:
        return 0.0
    fh, fw = bgr_frame.shape[:2]
    y0 = max(0, min(fh - 1, y + int(h * 0.60)))
    y1 = max(y0 + 1, min(fh, y + h))
    x0 = max(0, min(fw - 1, x + int(w * 0.20)))
    x1 = max(x0 + 1, min(fw, x + int(w * 0.80)))
    roi = bgr_frame[y0:y1, x0:x1]
    if roi.size == 0:
        return 0.0
    diff_v = np.abs(np.diff(roi.astype(np.float32), axis=0))
    if diff_v.size == 0:
        return 0.0
    return float(np.clip(np.mean(diff_v) / 32.0, 0.0, 1.0))


def _assign_consistent_face_track_ids(observations: list[FrameObservation]) -> list[FrameObservation]:
    """Match detected faces across consecutive frames by horizontal proximity so track IDs persist within shots."""
    prev_tracks: list[tuple[str, float, float]] = []
    next_id = 0
    for obs in observations:
        if obs.is_scene_cut:
            prev_tracks = []
        used_ids: set[str] = set()
        new_tracks: list[tuple[str, float, float]] = []
        max_dist = float(obs.frame_width) * 0.18
        for face in obs.faces:
            best_id: str | None = None
            best_d = max_dist
            for tid, px, py in prev_tracks:
                if tid in used_ids:
                    continue
                d = math.hypot(face.center_x - px, face.center_y - py)
                if d < best_d:
                    best_d = d
                    best_id = tid
            if best_id is None:
                best_id = f"track_{next_id}"
                next_id += 1
            face.face_id = best_id
            used_ids.add(best_id)
            new_tracks.append((best_id, face.center_x, face.center_y))
        prev_tracks = new_tracks
    return observations
