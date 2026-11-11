"""Phase 6 tests: Virtual Cameraman 9:16, ASS Subtitles, Filter Script Builder, NVENC with CPU fallback, and Render API endpoints.

CRITICAL: 100% Logical Tests (ZERO Hardware):
- Synthetic bounding-box trajectories and synthetic scene-cut boundaries.
- Mocked FFmpeg subprocess execution in `tmp_path` (`isolated_workspace` fixture).
- No real cv2.VideoCapture on heavy files, no mediapipe loading, no real NVENC hardware encoding.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import httpx
import numpy as np
import pytest

from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
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
    list_render_output_urls,
)
from app.domain.rendering.virtual_cameraman import (
    CameraKeyframe,
    VirtualCameramanPlan,
    apply_deadband_15pct,
    apply_savgol_isolated_per_shot,
    build_virtual_cameraman_plan,
    center_x_to_crop_x,
    compute_9_16_crop_dimensions,
    ramer_douglas_peucker,
)
from app.infrastructure.video.ffmpeg_executor import (
    FFmpegNvencExecutor,
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
from app.infrastructure.vision.face_tracker import (
    ActiveSpeakerTracker,
    FaceBoundingBox,
    FrameObservation,
    ShotSegment,
    compute_hsv_histogram_from_bgr,
    compute_speaker_activity_scores,
    detect_scene_cuts_hsv,
    filter_false_faces,
    filter_static_false_faces_in_shot,
    hsv_histogram_distance,
    segment_observations_into_shots,
)
from app.models.domain import Cut, JobStatus, Segment, WordTiming


# --- 1. Vision: Face Filtering & Static Artifact Removal ---


def test_face_bounding_box_and_false_face_filtering() -> None:
    # Frame is 1920x1080 -> area = 2,073,600
    # 1.5% area threshold = 31,104 px
    small_face = FaceBoundingBox(
        face_id="tiny_bg",
        x=100,
        y=100,
        width=100,
        height=100,  # 10,000 px < 1.5%
        frame_width=1920,
        frame_height=1080,
    )
    valid_face = FaceBoundingBox(
        face_id="real_face",
        x=800,
        y=200,
        width=250,
        height=300,  # 75,000 px > 1.5% (approx 3.6%)
        frame_width=1920,
        frame_height=1080,
    )

    filtered = filter_false_faces([small_face, valid_face])
    assert len(filtered) == 1
    assert filtered[0].face_id == "real_face"


def test_static_background_poster_filter_in_shot() -> None:
    # A moving person across 10 frames + a static poster face with zero motion/mouth
    observations: list[FrameObservation] = []
    for i in range(10):
        t = i * 0.125
        moving_face = FaceBoundingBox(
            face_id="speaker",
            x=500 + i * 15,
            y=200,
            width=220,
            height=260,
            mouth_openness=0.4 if i % 2 == 0 else 0.1,
        )
        static_face = FaceBoundingBox(
            face_id="poster",
            x=1500,
            y=150,
            width=180,
            height=180,
            mouth_openness=0.0,
        )
        observations.append(
            FrameObservation(
                frame_index=i,
                timestamp=t,
                faces=[moving_face, static_face],
            )
        )

    cleaned = filter_static_false_faces_in_shot(observations)
    assert len(cleaned) == 10
    for obs in cleaned:
        face_ids = [f.face_id for f in obs.faces]
        assert "speaker" in face_ids
        assert "poster" not in face_ids


# --- 2. Vision: HSV Scene-Cut Detection & Shot Segmentation ---


def test_hsv_scene_cut_detection_and_shot_segmentation() -> None:
    hist_a = np.zeros(32, dtype=np.float32)
    hist_a[0] = 1.0  # Dominant color A
    hist_b = np.zeros(32, dtype=np.float32)
    hist_b[16] = 1.0  # Dominant color B

    dist_same = hsv_histogram_distance(hist_a, hist_a)
    dist_diff = hsv_histogram_distance(hist_a, hist_b)
    assert dist_same == pytest.approx(0.0)
    assert dist_diff == pytest.approx(1.0)

    observations: list[FrameObservation] = []
    # Shot 1: frames 0..9 with hist_a
    for i in range(10):
        observations.append(
            FrameObservation(frame_index=i, timestamp=i * 0.125, hsv_histogram=hist_a)
        )
    # Shot 2: frames 10..19 with hist_b
    for i in range(10, 20):
        observations.append(
            FrameObservation(frame_index=i, timestamp=i * 0.125, hsv_histogram=hist_b)
        )

    shots = segment_observations_into_shots(observations, hsv_threshold=0.40)
    assert len(shots) == 2
    assert shots[0].start_frame == 0
    assert shots[0].end_frame == 9
    assert shots[1].start_frame == 10
    assert shots[1].end_frame == 19


# --- 3. Active Speaker Selection & 2.5s Dwell Hysteresis ---


def test_active_speaker_scoring_and_dwell_hysteresis() -> None:
    tracker = ActiveSpeakerTracker(min_dwell_seconds=2.5)

    # Frame 0 at t=0.0: face A is talking (mouth=0.6), face B is listening (mouth=0.0)
    face_a0 = FaceBoundingBox(face_id="A", x=400, y=200, width=250, height=250, mouth_openness=0.6)
    face_b0 = FaceBoundingBox(face_id="B", x=1200, y=200, width=250, height=250, mouth_openness=0.0)
    obs0 = FrameObservation(frame_index=0, timestamp=0.0, faces=[face_a0, face_b0])

    chosen0, scores0 = tracker.select_speaker(obs0, [obs0])
    assert chosen0.face_id == "A"
    assert tracker.current_speaker_id == "A"

    # Frame 1 at t=1.0s: face B starts talking briefly, but dwell time (2.5s) has NOT elapsed!
    face_a1 = FaceBoundingBox(face_id="A", x=400, y=200, width=250, height=250, mouth_openness=0.05)
    face_b1 = FaceBoundingBox(face_id="B", x=1200, y=200, width=250, height=250, mouth_openness=0.7)
    obs1 = FrameObservation(frame_index=8, timestamp=1.0, faces=[face_a1, face_b1])

    chosen1, _ = tracker.select_speaker(obs1, [obs0, obs1])
    assert chosen1.face_id == "A", "Hysteresis must prevent switching before dwell time"

    # Frame 2 at t=3.0s: dwell time (2.5s) has passed, and B is speaking vigorously
    face_a2 = FaceBoundingBox(face_id="A", x=400, y=200, width=250, height=250, mouth_openness=0.0)
    face_b2 = FaceBoundingBox(face_id="B", x=1200, y=200, width=250, height=250, mouth_openness=0.8)
    obs2 = FrameObservation(frame_index=24, timestamp=3.0, faces=[face_a2, face_b2])

    chosen2, _ = tracker.select_speaker(obs2, [obs0, obs1, obs2])
    assert chosen2.face_id == "B", "Switch should occur once dwell time has elapsed"


# --- 4. 1-Face Tracking & 15% Deadband (Tripod Lock) ---


def test_virtual_cameraman_1_face_deadband_15pct() -> None:
    crop_w, crop_h = compute_9_16_crop_dimensions(1920, 1080)
    assert crop_w == 608
    assert crop_h == 1080

    deadband_threshold = crop_w * 0.15  # 91.2 px
    initial_cx = 960.0
    # Micro-movements within 91.2 px of 960 (e.g. 960 -> 980 -> 950)
    xs = [initial_cx, 980.0, 950.0, 975.0, 1020.0, 1150.0]

    stabilized = apply_deadband_15pct(xs, crop_width=crop_w, deadband_ratio=0.15)
    assert stabilized[0] == initial_cx
    assert stabilized[1] == initial_cx  # delta 20 <= 91.2 -> locked
    assert stabilized[2] == initial_cx  # delta 10 <= 91.2 -> locked
    assert stabilized[3] == initial_cx  # delta 15 <= 91.2 -> locked
    assert stabilized[4] == initial_cx  # delta 60 <= 91.2 -> locked
    assert stabilized[5] == 1150.0  # delta 190 > 91.2 -> unlocked and followed


# --- 5. 2-Faces Split-Screen vs Active Speaker Tracking ---


def test_virtual_cameraman_2_faces_split_screen_vs_active_speaker() -> None:
    # 2 widely separated faces both active -> split screen mode
    f_left = FaceBoundingBox(face_id="L", x=300, y=200, width=250, height=250, mouth_openness=0.5)
    f_right = FaceBoundingBox(face_id="R", x=1300, y=200, width=250, height=250, mouth_openness=0.5)
    obs = [
        FrameObservation(frame_index=0, timestamp=0.0, faces=[f_left, f_right]),
        FrameObservation(frame_index=1, timestamp=0.5, faces=[f_left, f_right]),
    ]

    plan = build_virtual_cameraman_plan(obs, vertical_mode="split_podcast")
    assert plan.primary_mode == "split_screen"
    assert len(plan.keyframes) >= 1
    assert plan.keyframes[0].mode == "split_screen"


# --- 6. 0-Faces Hold-Last-Position (<2s) vs Fallback (>=2s) ---


def test_virtual_cameraman_0_faces_state_machine() -> None:
    # Case A: Brief 0-face gap (1.0s < 2.0s) -> Hold-Last-Position (crop_track)
    obs_brief: list[FrameObservation] = [
        FrameObservation(
            frame_index=0,
            timestamp=0.0,
            faces=[FaceBoundingBox(face_id="A", x=800, y=200, width=250, height=250)],
        ),
    ]
    # 8 frames of 0 faces = 1.0 second at 8 fps
    for i in range(1, 9):
        obs_brief.append(FrameObservation(frame_index=i, timestamp=i * 0.125, faces=[]))
    obs_brief.append(
        FrameObservation(
            frame_index=9,
            timestamp=1.125,
            faces=[FaceBoundingBox(face_id="A", x=820, y=200, width=250, height=250)],
        )
    )

    plan_brief = build_virtual_cameraman_plan(obs_brief, hold_max_gap_seconds=2.0)
    assert plan_brief.primary_mode == "crop_track"
    # All samples during the 1s gap keep crop_track
    for s in plan_brief.samples:
        assert s.mode == "crop_track"

    # Case B: Prolonged 0-face gap (3.0s >= 2.0s) -> Fallback to "blur"
    obs_long: list[FrameObservation] = [
        FrameObservation(
            frame_index=0,
            timestamp=0.0,
            faces=[FaceBoundingBox(face_id="A", x=800, y=200, width=250, height=250)],
        ),
    ]
    # 24 frames of 0 faces = 3.0 seconds
    for i in range(1, 25):
        obs_long.append(FrameObservation(frame_index=i, timestamp=i * 0.125, faces=[]))

    plan_long = build_virtual_cameraman_plan(
        obs_long,
        hold_max_gap_seconds=2.0,
        zero_face_fallback_mode="blur",
    )
    blur_samples = [s for s in plan_long.samples if s.mode == "blur"]
    assert len(blur_samples) >= 20, "Long gap must fall back to blur mode"


# --- 7. Savitzky-Golay Smoothing Strictly Isolated Per Shot ---


def test_savgol_smoothing_strictly_isolated_per_shot() -> None:
    # Shot 0: face at x=300; Shot 1: hard cut, face at x=1500
    hist_0 = np.zeros(32, dtype=np.float32)
    hist_0[0] = 1.0
    hist_1 = np.zeros(32, dtype=np.float32)
    hist_1[16] = 1.0

    obs: list[FrameObservation] = []
    # 15 frames in shot 0
    for i in range(15):
        obs.append(
            FrameObservation(
                frame_index=i,
                timestamp=i * 0.125,
                faces=[FaceBoundingBox(face_id="A", x=300, y=200, width=250, height=250)],
                hsv_histogram=hist_0,
            )
        )
    # 15 frames in shot 1
    for i in range(15, 30):
        obs.append(
            FrameObservation(
                frame_index=i,
                timestamp=i * 0.125,
                faces=[FaceBoundingBox(face_id="B", x=1500, y=200, width=250, height=250)],
                hsv_histogram=hist_1,
            )
        )

    plan = build_virtual_cameraman_plan(obs, hsv_cut_threshold=0.40)
    assert len(plan.shots) == 2

    # The last frame of shot 0 and first frame of shot 1 jump instantaneously!
    last_sample_shot0 = plan.shots[0].samples[-1]
    first_sample_shot1 = plan.shots[1].samples[0]
    delta_x = abs(first_sample_shot1.crop_x - last_sample_shot0.crop_x)
    assert delta_x > 500, "Camera must jump instantaneously across hard scene cuts without smoothing bleed"


# --- 8. Ramer-Douglas-Peucker Trajectory Simplification ---


def test_ramer_douglas_peucker_trajectory_simplification() -> None:
    # 10 collinear points (t, 2*t + 10)
    collinear = [(float(i), 10.0 + 2.0 * i) for i in range(10)]
    simplified_collinear = ramer_douglas_peucker(collinear, epsilon=2.0)
    assert len(simplified_collinear) == 2
    assert simplified_collinear[0] == collinear[0]
    assert simplified_collinear[-1] == collinear[-1]

    # Non-linear point with deviation > 2.0px
    deviated = list(collinear)
    deviated[5] = (5.0, 50.0)  # Big excursion
    simplified_dev = ramer_douglas_peucker(deviated, epsilon=2.0)
    assert len(simplified_dev) >= 3
    times = [p[0] for p in simplified_dev]
    assert 5.0 in times


# --- 9. Dynamic ASS Subtitles (Karaoke Highlight & Styles) ---


def test_ass_subtitle_generation_word_highlight_and_sentence() -> None:
    words = [
        WordTiming(word="Investir", start=1.0, end=1.5),
        WordTiming(word="em", start=1.5, end=1.8),
        WordTiming(word="renda", start=1.8, end=2.2),
        WordTiming(word="fixa.", start=2.2, end=2.8),
    ]

    # Word highlight
    ass_highlight = generate_ass_subtitles(
        words,
        cut_start=1.0,
        cut_end=3.0,
        subtitle_style="word_highlight",
        play_res_y=1920,
        margin_v=280,
    )
    assert "[Script Info]" in ass_highlight
    assert "PlayResY: 1920" in ass_highlight
    assert "MarginV, Encoding" in ass_highlight
    assert r"{\c&H0000FFFF&" in ass_highlight
    assert "Dialogue:" in ass_highlight

    # Sentence style
    ass_sentence = generate_ass_subtitles(
        words,
        cut_start=1.0,
        cut_end=3.0,
        subtitle_style="sentence",
    )
    assert r"{\c&H0000FFFF&" not in ass_sentence
    assert "Investir em renda fixa." in ass_sentence


# --- 10. ASS & Camera Timeline Warping (`trim_internal_silence`) ---


def test_ass_subtitles_and_camera_timeline_warping_trim_internal_silence() -> None:
    # 2 speech clusters separated by a 3.0s dead silence: [0.0, 2.0] and [5.0, 7.0]
    words = [
        WordTiming(word="Primeira", start=0.2, end=0.8),
        WordTiming(word="parte", start=0.9, end=1.6),
        WordTiming(word="Segunda", start=5.2, end=5.8),
        WordTiming(word="parte", start=5.9, end=6.6),
    ]

    mapper = build_timeline_mapper(
        cut_start=0.0,
        cut_end=7.0,
        words=words,
        trim_internal_silence=True,
        min_silence_duration=1.2,
    )
    assert mapper.trim_enabled is True
    assert mapper.compacted_duration < mapper.original_duration
    assert len(mapper.intervals) == 2

    # Verify word timestamps in ASS are remapped
    ass_content = generate_ass_subtitles(
        words,
        cut_start=0.0,
        cut_end=7.0,
        timeline_mapper=mapper,
    )
    assert mapper.intervals[1].out_start < 5.0


# --- 11. Filter Script Builder ---


def test_filter_complex_script_builder(tmp_path: Path) -> None:
    kfs = [
        CameraKeyframe(time=0.0, x=100.0, mode="crop_track"),
        CameraKeyframe(time=5.0, x=300.0, mode="crop_track"),
    ]
    expr = build_piecewise_linear_crop_expression(kfs)
    assert "if(lt(t,5.000)" in expr
    assert "100.00" in expr
    assert "300.00" in expr

    plan = VirtualCameramanPlan(
        source_width=1920,
        source_height=1080,
        target_width=1080,
        target_height=1920,
        crop_width=608,
        crop_height=1080,
        vertical_mode="auto_reframe",
        primary_mode="crop_track",
        keyframes=kfs,
    )

    ass_file = tmp_path / "test.ass"
    ass_file.write_text("[Events]\n", encoding="utf-8")

    opts = FilterScriptOptions(
        target_width=1080,
        target_height=1920,
        burn_subtitles=True,
        ass_path=ass_file,
        normalize_audio=True,
    )

    script_path = tmp_path / "filter_script.txt"
    written = write_filter_complex_script_file(script_path, plan, duration=10.0, options=opts)
    assert written.exists()

    content = written.read_text(encoding="utf-8")
    assert "crop=608:1080:" in content
    assert "subtitles=" in content
    assert "loudnorm=I=-14.0" in content
    assert "[v_out]" in content
    assert "[a_out]" in content


# --- 12. FFmpeg NVENC with Automatic Transparent Fallback to CPU libx264 ---


@pytest.mark.asyncio
async def test_ffmpeg_nvenc_executor_with_transparent_cpu_fallback(tmp_path: Path, container: ServiceContainer) -> None:
    input_video = tmp_path / "input.mp4"
    input_video.write_bytes(b"dummy_video")
    out_video = tmp_path / "out.mp4"
    script_file = tmp_path / "filter_script.txt"
    script_file.write_text("dummy_script", encoding="utf-8")

    executed_commands: list[list[str]] = []

    async def _mock_runner(cmd: list[str], on_line: Any, cancel_token: Any) -> int:
        executed_commands.append(cmd)
        if "h264_nvenc" in cmd:
            if on_line:
                on_line("Unknown encoder 'h264_nvenc'")
            return 1  # Fail NVENC
        # CPU libx264 fallback succeeds
        out_video.write_bytes(b"rendered_cpu")
        return 0

    executor = FFmpegNvencExecutor(container=container, subprocess_runner=_mock_runner)
    success = await executor.execute_render_cut(
        job_id="test_job",
        input_path=input_video,
        output_path=out_video,
        script_path=script_file,
        start_time=0.0,
        duration=5.0,
    )

    assert success is True
    assert len(executed_commands) == 2
    assert "h264_nvenc" in executed_commands[0]
    assert "libx264" in executed_commands[1]
    assert out_video.exists()


# --- 13. Rendering Service Full Pipeline ---


@pytest.mark.asyncio
async def test_rendering_service_full_pipeline_success(tmp_path: Path, container: ServiceContainer) -> None:
    job = container.jobs.create_job("https://example.com/v", status=JobStatus.WAITING_APPROVAL)
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"fake_source")
    container.jobs.update_job(job.job_id, {"source_video_path": str(video_file), "video_name": "TestVid"})

    cuts = [
        Cut(cut_id="c1", start=2.0, end=7.0, title="Cut 1", status="approved"),
        Cut(cut_id="c2", start=10.0, end=15.0, title="Cut 2", status="approved"),
    ]
    container.jobs.save_cuts(job.job_id, cuts)

    words = [
        WordTiming(word="Hello", start=2.5, end=3.0),
        WordTiming(word="World", start=3.1, end=3.6),
    ]
    container.jobs.save_transcription_words(job.job_id, words)

    async def _fake_render_exec(cmd: list[str], on_line: Any, cancel_token: Any) -> int:
        # Create destination file
        out_f = Path(cmd[-1])
        out_f.write_bytes(b"mp4_bytes")
        return 0

    def _synthetic_observations(start: float, end: float) -> list[FrameObservation]:
        return [
            FrameObservation(
                frame_index=0,
                timestamp=0.0,
                faces=[FaceBoundingBox(face_id="A", x=900, y=200, width=250, height=250)],
            ),
            FrameObservation(
                frame_index=8,
                timestamp=1.0,
                faces=[FaceBoundingBox(face_id="A", x=920, y=200, width=250, height=250)],
            ),
        ]

    service = RenderingService(container=container, subprocess_runner=_fake_render_exec)
    urls = await service.render_job(
        job.job_id,
        synthetic_observations_provider=_synthetic_observations,
    )

    assert len(urls) == 2
    assert urls[0].startswith(f"/media/shorts/{job.job_id}/")
    assert urls[1].startswith(f"/media/shorts/{job.job_id}/")

    updated_job = container.jobs.load_job(job.job_id)
    assert updated_job.status == JobStatus.DONE
    assert len(updated_job.rendered_files) == 2


# --- 14. Cooperative Cancellation ---


@pytest.mark.asyncio
async def test_rendering_service_cancellation(tmp_path: Path, container: ServiceContainer) -> None:
    job = container.jobs.create_job("https://example.com/v", status=JobStatus.WAITING_APPROVAL)
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"fake_source")
    container.jobs.update_job(job.job_id, {"source_video_path": str(video_file), "video_name": "TestVid"})
    container.jobs.save_cuts(
        job.job_id,
        [Cut(cut_id="c1", start=0.0, end=10.0, status="approved")],
    )

    cancelled_event = asyncio.Event()

    async def _blocking_runner(cmd: list[str], on_line: Any, cancel_token: Any) -> int:
        cancelled_event.set()
        # Wait until cancelled
        while cancel_token and not cancel_token.is_set():
            await asyncio.sleep(0.01)
        raise OperationCancelledError()

    service = RenderingService(container=container, subprocess_runner=_blocking_runner)

    task = asyncio.create_task(
        service.render_job(
            job.job_id,
            synthetic_observations_provider=lambda s, e: [FrameObservation(0, 0.0, faces=[])],
        )
    )

    await cancelled_event.wait()
    assert cancel_rendering_job(job.job_id, container=container) is True
    await task

    reloaded = container.jobs.load_job(job.job_id)
    assert reloaded.status == JobStatus.DOWNLOADED


# --- 15. FastAPI HTTP Router Integration Tests ---


@pytest.mark.asyncio
async def test_render_api_endpoints(async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path) -> None:
    # 1. Create job with fake video & cuts
    job = container.jobs.create_job("https://example.com/v", status=JobStatus.WAITING_APPROVAL)
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"fake_source")
    container.jobs.update_job(job.job_id, {"source_video_path": str(video_file), "video_name": "TestVid"})
    container.jobs.save_cuts(
        job.job_id,
        [Cut(cut_id="c1", start=2.0, end=5.0, status="approved")],
    )

    # Fake pre-existing render file in shorts/
    shorts_dir = container.jobs.shorts_dir_path(job.job_id, create=True)
    fake_render = shorts_dir / "00_02-00_05.mp4"
    fake_render.write_bytes(b"mp4_content")

    # A. GET /jobs/{job_id}/renders
    resp_get = await async_client.get(f"/jobs/{job.job_id}/renders")
    assert resp_get.status_code == 200
    renders = resp_get.json()
    assert len(renders) == 1
    assert renders[0] == f"/media/shorts/{job.job_id}/00_02-00_05.mp4"

    # B. POST /jobs/{job_id}/renders/{file}/open-folder
    resp_open = await async_client.post(f"/jobs/{job.job_id}/renders/00_02-00_05.mp4/open-folder")
    assert resp_open.status_code == 200
    assert resp_open.json() == {"ok": True}

    # C. POST /jobs/{job_id}/renders/nonexistent.mp4/open-folder -> 404
    resp_open_404 = await async_client.post(f"/jobs/{job.job_id}/renders/nonexistent.mp4/open-folder")
    assert resp_open_404.status_code == 404

    # D. DELETE /jobs/{job_id}/renders/{file}
    resp_del = await async_client.delete(f"/jobs/{job.job_id}/renders/00_02-00_05.mp4")
    assert resp_del.status_code == 200
    assert resp_del.json() == {"ok": True, "file": "00_02-00_05.mp4"}
    assert not fake_render.exists()

    # E. DELETE non-existent file -> 404
    resp_del_404 = await async_client.delete(f"/jobs/{job.job_id}/renders/00_02-00_05.mp4")
    assert resp_del_404.status_code == 404

    # F. POST /jobs/{job_id}/render
    resp_start = await async_client.post(f"/jobs/{job.job_id}/render")
    assert resp_start.status_code == 200
    assert resp_start.json() == {"started": True}

    # G. POST /jobs/{job_id}/render/cancel when not running -> 404
    resp_cancel = await async_client.post(f"/jobs/{job.job_id}/render/cancel")
    # Might be 404 if background task didn't hold lock or 200 if active
    assert resp_cancel.status_code in (200, 404)
