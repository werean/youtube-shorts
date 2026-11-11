"""Vision infrastructure package (MediaPipe/OpenCV face tracking, active speaker, HSV scene cut detection)."""

from __future__ import annotations

from app.infrastructure.vision.face_tracker import (
    DEFAULT_ACTIVE_SPEAKER_WINDOW_SECONDS,
    DEFAULT_HSV_SCENE_CUT_THRESHOLD,
    DEFAULT_SAMPLE_FPS,
    DEFAULT_SPEAKER_DWELL_SECONDS,
    MIN_VALID_FACE_AREA_RATIO,
    ActiveSpeakerTracker,
    FaceBoundingBox,
    FrameObservation,
    MediaPipeVisionAdapter,
    ShotSegment,
    compute_hsv_histogram_from_bgr,
    compute_speaker_activity_scores,
    detect_scene_cuts_hsv,
    filter_false_faces,
    filter_static_false_faces_in_shot,
    hsv_histogram_distance,
    is_valid_face_box,
    segment_observations_into_shots,
)

__all__ = [
    "DEFAULT_ACTIVE_SPEAKER_WINDOW_SECONDS",
    "DEFAULT_HSV_SCENE_CUT_THRESHOLD",
    "DEFAULT_SAMPLE_FPS",
    "DEFAULT_SPEAKER_DWELL_SECONDS",
    "MIN_VALID_FACE_AREA_RATIO",
    "ActiveSpeakerTracker",
    "FaceBoundingBox",
    "FrameObservation",
    "MediaPipeVisionAdapter",
    "ShotSegment",
    "compute_hsv_histogram_from_bgr",
    "compute_speaker_activity_scores",
    "detect_scene_cuts_hsv",
    "filter_false_faces",
    "filter_static_false_faces_in_shot",
    "hsv_histogram_distance",
    "is_valid_face_box",
    "segment_observations_into_shots",
]
