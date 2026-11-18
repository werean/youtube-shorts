"""Profiles & publishing, phase 1: watermark (local profile, image validation, routes, FFmpeg graph).

100% mocked: images are generated in memory, FFmpeg is a fake subprocess runner, every path lives in `tmp_path`
(`isolated_workspace` autouse fixture). No real FFmpeg, GPU, network or model.
"""

from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path
from typing import Any
from unittest.mock import patch

import cv2
import httpx
import numpy as np
import pytest

from app.application.runtime_service import ServiceContainer
from app.core import paths
from app.domain.profiles import profile_store as ps
from app.domain.profiles import watermark as wm
from app.domain.rendering.ass_generator import build_timeline_mapper
from app.domain.rendering.rendering_service import RenderingService
from app.domain.rendering.virtual_cameraman import CameraKeyframe, VirtualCameramanPlan
from app.infrastructure.video import ffmpeg_executor as ffe
from app.infrastructure.video.filter_script_builder import (
    FilterScriptOptions,
    WatermarkOverlay,
    build_filter_complex_script_content,
    escape_ffmpeg_filter_path,
)
from app.infrastructure.vision.face_tracker import FaceBoundingBox, FrameObservation
from app.main import create_app
from app.models.domain import Cut, JobStatus, WordTiming

# ---------------------------------------------------------------------------
# Helpers: images, fixtures for the filter graph
# ---------------------------------------------------------------------------


def _png_bytes(w: int = 64, h: int = 48, *, alpha: bool = True, color: tuple[int, int, int] = (10, 200, 30)) -> bytes:
    img = np.zeros((h, w, 4 if alpha else 3), dtype=np.uint8)
    img[:, :, 0], img[:, :, 1], img[:, :, 2] = color
    if alpha:
        img[:, :, 3] = 128
    ok, enc = cv2.imencode(".png", img)
    assert ok
    return enc.tobytes()


def _jpeg_bytes(w: int = 64, h: int = 48) -> bytes:
    img = np.full((h, w, 3), 90, dtype=np.uint8)
    ok, enc = cv2.imencode(".jpg", img)
    assert ok
    return enc.tobytes()


def _webp_bytes(w: int = 64, h: int = 48) -> bytes:
    img = np.full((h, w, 3), 140, dtype=np.uint8)
    ok, enc = cv2.imencode(".webp", img)
    assert ok
    return enc.tobytes()


def _chunk(ctype: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", len(payload)) + ctype + payload + struct.pack(">I", zlib.crc32(ctype + payload) & 0xFFFFFFFF)


def _apng_bytes() -> bytes:
    png = _png_bytes()
    # insert an `acTL` chunk right after IHDR (8 signature + 25 IHDR bytes)
    return png[:33] + _chunk(b"acTL", struct.pack(">II", 2, 0)) + png[33:]


def _animated_webp_bytes() -> bytes:
    vp8x = bytes([0x02, 0, 0, 0]) + (63).to_bytes(3, "little") + (47).to_bytes(3, "little")
    chunk = b"VP8X" + struct.pack("<I", len(vp8x)) + vp8x
    body = b"WEBP" + chunk + b"ANIM" + struct.pack("<I", 6) + b"\x00" * 6
    return b"RIFF" + struct.pack("<I", len(body)) + body


def _plan(mode: str, keyframes: list[CameraKeyframe] | None = None) -> VirtualCameramanPlan:
    kfs = keyframes or [
        CameraKeyframe(time=0.0, x=100.0, mode=mode, shot_id=0),  # type: ignore[arg-type]
        CameraKeyframe(time=5.0, x=300.0, mode=mode, shot_id=0),  # type: ignore[arg-type]
    ]
    return VirtualCameramanPlan(
        source_width=1920,
        source_height=1080,
        target_width=1080,
        target_height=1920,
        crop_width=608,
        crop_height=1080,
        vertical_mode="auto_reframe",
        primary_mode=mode,  # type: ignore[arg-type]
        keyframes=kfs,
    )


def _multi_mode_plan() -> VirtualCameramanPlan:
    return _plan(
        "crop_track",
        [
            CameraKeyframe(time=0.0, x=100.0, mode="crop_track", shot_id=0),
            CameraKeyframe(time=2.0, x=200.0, mode="crop_track", shot_id=0),
            CameraKeyframe(time=2.5, x=0.0, mode="blur", shot_id=1),
            CameraKeyframe(time=5.0, x=0.0, mode="blur", shot_id=1),
        ],
    )


_WORDS = [
    WordTiming(word="Primeira", start=0.2, end=0.8),
    WordTiming(word="parte", start=0.9, end=1.6),
    WordTiming(word="Segunda", start=5.2, end=5.8),
    WordTiming(word="parte", start=5.9, end=6.6),
]


def _script_cases(ass_path: Path) -> dict[str, str]:
    """Scripts built with the watermark feature OFF (default options), one per layout/option combination."""
    out: dict[str, str] = {}
    for mode in ("crop_track", "split_screen", "blur", "zoom"):
        plan = _plan(mode)
        out[f"{mode}|subs|audio"] = build_filter_complex_script_content(
            plan, 5.0, options=FilterScriptOptions(burn_subtitles=True, ass_path=ass_path)
        )
        out[f"{mode}|nosubs|noaudio"] = build_filter_complex_script_content(
            plan, 5.0, options=FilterScriptOptions(burn_subtitles=False, has_audio=False)
        )
    out["multi|subs|audio"] = build_filter_complex_script_content(
        _multi_mode_plan(), 5.0, options=FilterScriptOptions(burn_subtitles=True, ass_path=ass_path)
    )
    mapper = build_timeline_mapper(
        cut_start=0.0, cut_end=7.0, words=_WORDS, trim_internal_silence=True, min_silence_duration=1.2
    )
    out["trim|subs|audio"] = build_filter_complex_script_content(
        _plan("crop_track"),
        7.0,
        timeline_mapper=mapper,
        options=FilterScriptOptions(burn_subtitles=True, ass_path=ass_path),
    )
    out["default-options"] = build_filter_complex_script_content(_plan("crop_track"), 5.0)
    return out


def _command_cases() -> dict[str, list[str]]:
    kwargs: dict[str, Any] = dict(
        input_path="C:/videos/in.mp4",
        output_path="C:/videos/out.mp4",
        script_path="C:/videos/script.txt",
        start_time=12.5,
        duration=34.25,
    )
    return {
        "nvenc": ffe.build_ffmpeg_nvenc_command(**kwargs),
        "nvenc-preset": ffe.build_ffmpeg_nvenc_command(**kwargs, video_preset="p5", video_cq=23),
        "cpu": ffe.build_ffmpeg_cpu_fallback_command(**kwargs),
        "cpu-extra": ffe.build_ffmpeg_cpu_fallback_command(**kwargs, crf=18, preset="slow", extra_video_flags=["-r", "30"]),
    }


@pytest.fixture(autouse=True)
def _stable_filter_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    """Never probe a real ffmpeg binary for the script-file flag name."""
    monkeypatch.setattr(ffe, "resolve_filter_complex_script_flag", lambda: "-filter_complex_script")


# Captured by running the pre-feature builders (git HEAD) over the same fixtures; ASS path replaced by <ASS>.
GOLDEN_SCRIPTS: dict[str, str] = {'blur|nosubs|noaudio': '[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=5:2,scale=1080:1920:flags=bilinear,setsar=1[bg];\n'
                        '[0:v]scale=1080:-2:force_original_aspect_ratio=decrease,setsar=1[fg];\n'
                        '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v_base];\n'
                        '[v_base]format=yuv420p[v_out];\n'
                        'anullsrc=channel_layout=stereo:sample_rate=44100:d=5.000[a_out]\n',
 'blur|subs|audio': '[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=5:2,scale=1080:1920:flags=bilinear,setsar=1[bg];\n'
                    '[0:v]scale=1080:-2:force_original_aspect_ratio=decrease,setsar=1[fg];\n'
                    '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v_base];\n'
                    '[v_base]subtitles=<ASS>[v_sub];\n'
                    '[v_sub]format=yuv420p[v_out];\n'
                    '[0:a]afade=t=in:st=0:d=0.030,afade=t=out:st=4.950:d=0.050,loudnorm=I=-14.0:TP=-1.5:LRA=11[a_out]\n',
 'crop_track|nosubs|noaudio': "[0:v]crop=608:1080:'if(lt(t,0.000),100.00,if(lt(t,5.000),(100.00+(200.00)*(t-0.000)/5.000),300.00))':0,scale=1080:1920,setsar=1[v_base];\n"
                              '[v_base]format=yuv420p[v_out];\n'
                              'anullsrc=channel_layout=stereo:sample_rate=44100:d=5.000[a_out]\n',
 'crop_track|subs|audio': "[0:v]crop=608:1080:'if(lt(t,0.000),100.00,if(lt(t,5.000),(100.00+(200.00)*(t-0.000)/5.000),300.00))':0,scale=1080:1920,setsar=1[v_base];\n"
                          '[v_base]subtitles=<ASS>[v_sub];\n'
                          '[v_sub]format=yuv420p[v_out];\n'
                          '[0:a]afade=t=in:st=0:d=0.030,afade=t=out:st=4.950:d=0.050,loudnorm=I=-14.0:TP=-1.5:LRA=11[a_out]\n',
 'default-options': "[0:v]crop=608:1080:'if(lt(t,0.000),100.00,if(lt(t,5.000),(100.00+(200.00)*(t-0.000)/5.000),300.00))':0,scale=1080:1920,setsar=1[v_base];\n"
                    '[v_base]format=yuv420p[v_out];\n'
                    '[0:a]afade=t=in:st=0:d=0.030,afade=t=out:st=4.950:d=0.050,loudnorm=I=-14.0:TP=-1.5:LRA=11[a_out]\n',
 'multi|subs|audio': '[0:v]split=2[vin_0][vin_1];\n'
                     "[vin_0]crop=608:1080:'if(lt(t,0.000),100.00,if(lt(t,2.000),(100.00+(100.00)*(t-0.000)/2.000),200.00))':0,scale=1080:1920,setsar=1[v_mode_base];\n"
                     '[vin_1]split=2[vin_1_bg][vin_1_fg];\n'
                     '[vin_1_bg]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=5:2,scale=1080:1920:flags=bilinear,setsar=1[bg_blur];\n'
                     '[vin_1_fg]scale=1080:-2:force_original_aspect_ratio=decrease,setsar=1[fg_blur];\n'
                     '[bg_blur][fg_blur]overlay=(W-w)/2:(H-h)/2,setsar=1[v_mode_blur];\n'
                     "[v_mode_base][v_mode_blur]overlay=0:0:enable='between(t,2.500,5.000)':eof_action=pass:shortest=0[v_base];\n"
                     '[v_base]subtitles=<ASS>[v_sub];\n'
                     '[v_sub]format=yuv420p[v_out];\n'
                     '[0:a]afade=t=in:st=0:d=0.030,afade=t=out:st=4.950:d=0.050,loudnorm=I=-14.0:TP=-1.5:LRA=11[a_out]\n',
 'split_screen|nosubs|noaudio': "[0:v]crop=960:1080:'if(lt(t,0.000),100.00,if(lt(t,5.000),(100.00+(200.00)*(t-0.000)/5.000),300.00))':0,scale=1080:960,setsar=1[top];\n"
                                "[0:v]crop=960:1080:'if(lt(t,0.000),960.00,if(lt(t,5.000),(960.00+(0.00)*(t-0.000)/5.000),960.00))':0,scale=1080:960,setsar=1[bottom];\n"
                                '[top][bottom]vstack=inputs=2[v_base];\n'
                                '[v_base]format=yuv420p[v_out];\n'
                                'anullsrc=channel_layout=stereo:sample_rate=44100:d=5.000[a_out]\n',
 'split_screen|subs|audio': "[0:v]crop=960:1080:'if(lt(t,0.000),100.00,if(lt(t,5.000),(100.00+(200.00)*(t-0.000)/5.000),300.00))':0,scale=1080:960,setsar=1[top];\n"
                            "[0:v]crop=960:1080:'if(lt(t,0.000),960.00,if(lt(t,5.000),(960.00+(0.00)*(t-0.000)/5.000),960.00))':0,scale=1080:960,setsar=1[bottom];\n"
                            '[top][bottom]vstack=inputs=2[v_base];\n'
                            '[v_base]subtitles=<ASS>[v_sub];\n'
                            '[v_sub]format=yuv420p[v_out];\n'
                            '[0:a]afade=t=in:st=0:d=0.030,afade=t=out:st=4.950:d=0.050,loudnorm=I=-14.0:TP=-1.5:LRA=11[a_out]\n',
 'trim|subs|audio': '[0:v]trim=start=0.000:end=1.750,setpts=PTS-STARTPTS[vt0];\n'
                    '[0:a]atrim=start=0.000:end=1.750,asetpts=PTS-STARTPTS[at0];\n'
                    '[0:v]trim=start=5.050:end=7.000,setpts=PTS-STARTPTS[vt1];\n'
                    '[0:a]atrim=start=5.050:end=7.000,asetpts=PTS-STARTPTS[at1];\n'
                    '[vt0][vt1]concat=n=2:v=1:a=0[v_trimmed];\n'
                    '[at0][at1]concat=n=2:v=0:a=1[a_trimmed];\n'
                    "[v_trimmed]crop=608:1080:'if(lt(t,0.000),100.00,if(lt(t,5.000),(100.00+(200.00)*(t-0.000)/5.000),300.00))':0,scale=1080:1920,setsar=1[v_base];\n"
                    '[v_base]subtitles=<ASS>[v_sub];\n'
                    '[v_sub]format=yuv420p[v_out];\n'
                    '[a_trimmed]afade=t=in:st=0:d=0.030,afade=t=out:st=3.650:d=0.050,loudnorm=I=-14.0:TP=-1.5:LRA=11[a_out]\n',
 'zoom|nosubs|noaudio': '[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=5:2,scale=1080:1920:flags=bilinear,setsar=1[bg];\n'
                        '[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1[fg];\n'
                        '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v_base];\n'
                        '[v_base]format=yuv420p[v_out];\n'
                        'anullsrc=channel_layout=stereo:sample_rate=44100:d=5.000[a_out]\n',
 'zoom|subs|audio': '[0:v]scale=270:480:force_original_aspect_ratio=increase,crop=270:480,boxblur=5:2,scale=1080:1920:flags=bilinear,setsar=1[bg];\n'
                    '[0:v]scale=1080:1350:force_original_aspect_ratio=increase,crop=1080:1350,setsar=1[fg];\n'
                    '[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[v_base];\n'
                    '[v_base]subtitles=<ASS>[v_sub];\n'
                    '[v_sub]format=yuv420p[v_out];\n'
                    '[0:a]afade=t=in:st=0:d=0.030,afade=t=out:st=4.950:d=0.050,loudnorm=I=-14.0:TP=-1.5:LRA=11[a_out]\n'}

GOLDEN_COMMANDS: dict[str, list[str]] = {'cpu': ['ffmpeg',
         '-y',
         '-ss',
         '12.500',
         '-i',
         'C:/videos/in.mp4',
         '-t',
         '34.250',
         '-filter_complex_script',
         'C:/videos/script.txt',
         '-map',
         '[v_out]',
         '-map',
         '[a_out]',
         '-c:v',
         'libx264',
         '-crf',
         '20',
         '-preset',
         'veryfast',
         '-c:a',
         'aac',
         '-b:a',
         '192k',
         '-movflags',
         '+faststart',
         'C:/videos/out.mp4'],
 'cpu-extra': ['ffmpeg',
               '-y',
               '-ss',
               '12.500',
               '-i',
               'C:/videos/in.mp4',
               '-t',
               '34.250',
               '-filter_complex_script',
               'C:/videos/script.txt',
               '-map',
               '[v_out]',
               '-map',
               '[a_out]',
               '-c:v',
               'libx264',
               '-crf',
               '18',
               '-preset',
               'slow',
               '-c:a',
               'aac',
               '-b:a',
               '192k',
               '-r',
               '30',
               '-movflags',
               '+faststart',
               'C:/videos/out.mp4'],
 'nvenc': ['ffmpeg',
           '-y',
           '-hwaccel',
           'cuda',
           '-ss',
           '12.500',
           '-i',
           'C:/videos/in.mp4',
           '-t',
           '34.250',
           '-filter_complex_script',
           'C:/videos/script.txt',
           '-map',
           '[v_out]',
           '-map',
           '[a_out]',
           '-c:v',
           'h264_nvenc',
           '-rc',
           'vbr',
           '-cq',
           '20',
           '-preset',
           'p4',
           '-c:a',
           'aac',
           '-b:a',
           '192k',
           '-movflags',
           '+faststart',
           'C:/videos/out.mp4'],
 'nvenc-preset': ['ffmpeg',
                  '-y',
                  '-hwaccel',
                  'cuda',
                  '-ss',
                  '12.500',
                  '-i',
                  'C:/videos/in.mp4',
                  '-t',
                  '34.250',
                  '-filter_complex_script',
                  'C:/videos/script.txt',
                  '-map',
                  '[v_out]',
                  '-map',
                  '[a_out]',
                  '-c:v',
                  'h264_nvenc',
                  '-rc',
                  'vbr',
                  '-cq',
                  '23',
                  '-preset',
                  'p5',
                  '-c:a',
                  'aac',
                  '-b:a',
                  '192k',
                  '-movflags',
                  '+faststart',
                  'C:/videos/out.mp4']}

# ---------------------------------------------------------------------------
# 1. Feature off: byte-identical to the pre-feature output (golden captured from `git HEAD` builders)
# ---------------------------------------------------------------------------


def test_scripts_without_watermark_are_identical_to_pre_feature_output(tmp_path: Path) -> None:
    ass = tmp_path / "sub title.ass"
    ass.write_text("[Events]\n", encoding="utf-8")
    placeholder = escape_ffmpeg_filter_path(ass)
    cases = _script_cases(ass)
    assert set(cases) == set(GOLDEN_SCRIPTS)
    for name, content in cases.items():
        assert content.replace(placeholder, "<ASS>") == GOLDEN_SCRIPTS[name], name
        assert "overlay=x=" not in content and "[1:v]" not in content and "v_wm" not in content


def test_commands_without_watermark_are_identical_to_pre_feature_output() -> None:
    cases = _command_cases()
    assert set(cases) == set(GOLDEN_COMMANDS)
    for name, cmd in cases.items():
        assert cmd == GOLDEN_COMMANDS[name], name
        assert cmd.count("-i") == 1


# ---------------------------------------------------------------------------
# 2. With watermark: command and script
# ---------------------------------------------------------------------------


def _example_overlay() -> WatermarkOverlay:
    return wm.build_overlay("top-right", 18, 0.7)


def test_nvenc_and_cpu_commands_carry_watermark_as_second_input_before_t() -> None:
    wm_path = Path("C:/Users/João D'Arc/Meu Vídeo/data/profile/marca-dagua/watermark.png")
    base = dict(
        input_path="C:/v/in.mp4",
        output_path="C:/v/out.mp4",
        script_path="C:/v/s.txt",
        start_time=1.0,
        duration=2.0,
    )
    for builder in (ffe.build_ffmpeg_nvenc_command, ffe.build_ffmpeg_cpu_fallback_command):
        cmd = builder(**base, watermark_path=wm_path)
        i_positions = [i for i, a in enumerate(cmd) if a == "-i"]
        assert len(i_positions) == 2
        assert cmd[i_positions[0] + 1] == "C:/v/in.mp4"
        assert i_positions[1] == i_positions[0] + 2  # right after the video input
        assert cmd[i_positions[1] + 1] == str(wm_path)  # one single argv element: spaces/apostrophe/accents intact
        assert cmd[i_positions[1] + 2] == "-t"
        assert "-pattern_type" not in cmd
        plain = builder(**base)
        # removing the two watermark arguments gives exactly the command without watermark
        assert cmd[: i_positions[1]] + cmd[i_positions[1] + 2 :] == plain


def test_watermark_path_with_percent_disables_image2_sequence_pattern() -> None:
    cmd = ffe.build_ffmpeg_cpu_fallback_command(
        input_path="in.mp4",
        output_path="o.mp4",
        script_path="s.txt",
        start_time=0,
        duration=1,
        watermark_path=Path("/data/100%d/watermark.png"),
    )
    idx = cmd.index("-pattern_type")
    assert cmd[idx : idx + 4] == ["-pattern_type", "none", "-i", str(Path("/data/100%d/watermark.png"))]


def test_example_filter_graph_fragment_top_right_18_percent_opacity_07_with_subtitles(tmp_path: Path) -> None:
    ass = tmp_path / "cut.ass"
    ass.write_text("[Events]\n", encoding="utf-8")
    script = build_filter_complex_script_content(
        _plan("crop_track"),
        5.0,
        options=FilterScriptOptions(burn_subtitles=True, ass_path=ass, watermark=_example_overlay()),
    )
    lines = script.splitlines()
    sub_idx = next(i for i, ln in enumerate(lines) if ln.startswith("[v_base]subtitles="))
    assert lines[sub_idx + 1 : sub_idx + 4] == [
        "[1:v]format=rgba,scale=w=194:h=480:force_original_aspect_ratio=decrease,colorchannelmixer=aa=0.70[wm];",
        "[v_sub][wm]overlay=x=W-w-44:y=44:eof_action=repeat[v_wm];",
        "[v_wm]format=yuv420p[v_out];",
    ]
    # audio chain untouched and still last
    assert lines[-1].startswith("[0:a]afade=")


def test_watermark_lines_follow_base_when_subtitles_are_off() -> None:
    script = build_filter_complex_script_content(
        _plan("crop_track"),
        5.0,
        options=FilterScriptOptions(burn_subtitles=False, watermark=_example_overlay()),
    )
    lines = script.splitlines()
    idx = next(i for i, ln in enumerate(lines) if ln.startswith("[1:v]"))
    assert lines[idx + 1] == "[v_base][wm]overlay=x=W-w-44:y=44:eof_action=repeat[v_wm];"
    assert lines[idx + 2] == "[v_wm]format=yuv420p[v_out];"
    assert "subtitles=" not in script


def test_watermark_with_multi_mode_and_trim_silence_graph(tmp_path: Path) -> None:
    ass = tmp_path / "cut.ass"
    ass.write_text("[Events]\n", encoding="utf-8")
    mapper = build_timeline_mapper(
        cut_start=0.0, cut_end=7.0, words=_WORDS, trim_internal_silence=True, min_silence_duration=1.2
    )
    script = build_filter_complex_script_content(
        _multi_mode_plan(),
        7.0,
        timeline_mapper=mapper,
        options=FilterScriptOptions(burn_subtitles=True, ass_path=ass, watermark=_example_overlay()),
    )
    assert script.count("[1:v]") == 1
    assert "[v_sub][wm]overlay=x=W-w-44:y=44:eof_action=repeat[v_wm];" in script
    assert script.index("subtitles=") < script.index("[1:v]") < script.index("[v_wm]format=yuv420p[v_out];")
    # the watermark never reads input 0 and nothing else reads input 1
    assert "[1:a]" not in script and script.count("[0:v]") >= 1


# ---------------------------------------------------------------------------
# 3. Geometry
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("position", "x", "y"),
    [
        ("top-left", "44", "44"),
        ("top-center", "(W-w)/2", "44"),
        ("top-right", "W-w-44", "44"),
        ("middle-left", "44", "(H-h)/2"),
        ("center", "(W-w)/2", "(H-h)/2"),
        ("middle-right", "W-w-44", "(H-h)/2"),
        ("bottom-left", "44", "H-h-44"),
        ("bottom-center", "(W-w)/2", "H-h-44"),
        ("bottom-right", "W-w-44", "H-h-44"),
    ],
)
def test_overlay_position_grid(position: str, x: str, y: str) -> None:
    overlay = wm.build_overlay(position, 18, 0.7)
    assert (overlay.x, overlay.y) == (x, y)
    script = build_filter_complex_script_content(
        _plan("crop_track"), 5.0, options=FilterScriptOptions(burn_subtitles=False, watermark=overlay)
    )
    assert f"overlay=x={x}:y={y}:eof_action=repeat" in script


@pytest.mark.parametrize(("size", "expected"), [(5, 54), (18, 194), (33, 356), (50, 540)])
def test_overlay_box_width_is_even_and_box_height_capped(size: int, expected: int) -> None:
    overlay = wm.build_overlay("top-right", size, 0.7)
    assert overlay.box_width == expected
    assert overlay.box_width % 2 == 0
    assert overlay.box_height == 480


@pytest.mark.parametrize("size", list(range(5, 51)))
def test_overlay_box_width_always_even(size: int) -> None:
    assert wm.build_overlay("center", size, 0.5).box_width % 2 == 0


def test_opacity_is_written_with_two_decimals() -> None:
    for value, text in ((0.7, "0.70"), (0.333, "0.33"), (1.0, "1.00"), (0.05, "0.05")):
        script = build_filter_complex_script_content(
            _plan("crop_track"),
            5.0,
            options=FilterScriptOptions(burn_subtitles=False, watermark=wm.build_overlay("top-left", 18, value)),
        )
        assert f"colorchannelmixer=aa={text}[wm];" in script


# ---------------------------------------------------------------------------
# 4. Image validation and storage
# ---------------------------------------------------------------------------


def _decode_stored() -> np.ndarray:
    data = ps.watermark_image_path().read_bytes()
    img = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
    assert img is not None
    return img


@pytest.mark.parametrize("maker", [_png_bytes, _jpeg_bytes, _webp_bytes])
def test_png_jpeg_webp_are_accepted_and_stored_as_png(maker: Any) -> None:
    profile = wm.store_watermark_image(maker())
    stored = ps.watermark_image_path()
    assert stored == paths.local_profile_dir() / "marca-dagua" / "watermark.png"
    assert stored.read_bytes()[:8] == b"\x89PNG\r\n\x1a\n"
    img = _decode_stored()
    assert img.shape == (48, 64, 4)  # always BGRA, so overlay never meets a missing alpha channel
    block = ps.get_watermark_block(profile)
    assert block["image"]["width"] == 64 and block["image"]["height"] == 48
    assert block["file"] == "marca-dagua/watermark.png"


def test_alpha_is_preserved_and_opaque_images_get_an_opaque_alpha_channel() -> None:
    wm.store_watermark_image(_png_bytes(alpha=True))
    assert int(_decode_stored()[0, 0, 3]) == 128
    wm.store_watermark_image(_jpeg_bytes())
    assert set(np.unique(_decode_stored()[:, :, 3]).tolist()) == {255}


def test_grayscale_and_16_bit_png_are_normalized() -> None:
    gray = np.full((32, 32), 100, dtype=np.uint8)
    ok, enc = cv2.imencode(".png", gray)
    assert ok
    wm.store_watermark_image(enc.tobytes())
    assert _decode_stored().shape == (32, 32, 4)
    deep = np.full((32, 32, 3), 25700, dtype=np.uint16)
    ok, enc = cv2.imencode(".png", deep)
    assert ok
    wm.store_watermark_image(enc.tobytes())
    img = _decode_stored()
    assert img.dtype == np.uint8 and int(img[0, 0, 0]) == 100


@pytest.mark.parametrize(
    ("payload", "message"),
    [
        (b"GIF89a" + b"\x00" * 64, wm.MSG_FORMAT),
        (b'<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"></svg>', wm.MSG_FORMAT),
        (b"isto nao e uma imagem" * 10, wm.MSG_FORMAT),
        (b"", wm.MSG_FORMAT),
        (_apng_bytes(), wm.MSG_FORMAT),
        (_animated_webp_bytes(), wm.MSG_FORMAT),
        (_png_bytes(5000, 20), wm.MSG_TOO_BIG_DIMENSIONS),
        (_png_bytes(20, 5000), wm.MSG_TOO_BIG_DIMENSIONS),
        (_png_bytes(8, 8), wm.MSG_TOO_SMALL_DIMENSIONS),
        (_png_bytes()[:40], wm.MSG_UNREADABLE),  # truncated file with a valid header
        (b"\x89PNG\r\n\x1a\n" + b"\x00" * 40, wm.MSG_UNREADABLE),
        (b"\xff\xd8\xff" + b"\x00" * 40, wm.MSG_UNREADABLE),
    ],
)
def test_invalid_images_are_refused_with_the_right_message(payload: bytes, message: str) -> None:
    with pytest.raises(wm.InvalidWatermarkImageError) as exc:
        wm.validate_and_normalize_image(payload)
    assert str(exc.value) == message


def test_file_over_5_mb_is_refused() -> None:
    big = _png_bytes() + b"\x00" * (6 * 1024 * 1024)
    with pytest.raises(wm.InvalidWatermarkImageError) as exc:
        wm.validate_and_normalize_image(big)
    assert str(exc.value) == wm.MSG_TOO_BIG_FILE


def test_dimension_limits_are_inclusive() -> None:
    wm.validate_and_normalize_image(_png_bytes(16, 16))
    wm.validate_and_normalize_image(_png_bytes(4096, 16))


def test_decompression_bomb_is_refused_by_header_before_decoding() -> None:
    # 30000 x 30000 transparent pixels compress to a tiny PNG; the header check must stop it first.
    raw = zlib.compress(b"\x00" * (30000 * 4 + 1), 9) * 1
    ihdr = struct.pack(">IIBBBBB", 30000, 30000, 8, 6, 0, 0, 0)
    png = b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", ihdr) + _chunk(b"IDAT", raw) + _chunk(b"IEND", b"")
    with patch("cv2.imdecode", side_effect=AssertionError("must not decode")):
        with pytest.raises(wm.InvalidWatermarkImageError) as exc:
            wm.validate_and_normalize_image(png)
    assert str(exc.value) == wm.MSG_TOO_BIG_DIMENSIONS


# ---------------------------------------------------------------------------
# 5. Profile store
# ---------------------------------------------------------------------------


def test_profile_is_created_on_first_read_with_documented_defaults() -> None:
    assert not paths.local_profile_file_path().exists()
    profile = ps.load_profile()
    raw = json.loads(paths.local_profile_file_path().read_text(encoding="utf-8"))
    assert raw["profile_id"] == "p_local"
    assert raw["accounts"] == []
    assert raw["preferences"]["settings"] == {} and raw["preferences"]["tool_configs"] == {}
    assert raw["preferences"]["watermark"] == {
        "mode": "never",
        "file": None,
        "opacity": 0.7,
        "position": "top-right",
        "size_percent": 18,
        "image": None,
    }
    assert profile["schema_version"] == 1
    assert list(paths.local_profile_dir().glob("*.tmp")) == []


def test_profile_writes_preserve_unknown_fields_and_bump_revision() -> None:
    ps.load_profile()
    path = paths.local_profile_file_path()
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["future_field"] = {"keep": True}
    raw["preferences"]["watermark"]["future_wm_field"] = 7
    path.write_text(json.dumps(raw), encoding="utf-8")
    wm.apply_watermark_patch({"opacity": 0.5})
    after = json.loads(path.read_text(encoding="utf-8"))
    assert after["future_field"] == {"keep": True}
    assert after["preferences"]["watermark"]["future_wm_field"] == 7
    assert after["preferences"]["watermark"]["opacity"] == 0.5
    assert after["revision"] == raw["revision"] + 1


def test_unreadable_profile_is_never_overwritten() -> None:
    path = paths.local_profile_file_path()
    path.parent.mkdir(parents=True)
    path.write_bytes(b'{"profile_id": "p_local", "preferen')  # cut by a sync tool
    before = path.read_bytes()
    with pytest.raises(ps.ProfileUnreadableError):
        ps.load_profile()
    with pytest.raises(ps.ProfileUnreadableError):
        wm.apply_watermark_patch({"opacity": 0.5})
    with pytest.raises(ps.ProfileUnreadableError):
        wm.store_watermark_image(_png_bytes())
    assert path.read_bytes() == before
    # a render that did not ask for the watermark still works, and one that asked fails cleanly
    assert wm.decide_watermark(None).apply is False
    with pytest.raises(wm.WatermarkMissingError):
        wm.decide_watermark(True)
    assert path.read_bytes() == before


def test_profile_from_newer_app_version_is_read_but_not_written() -> None:
    ps.load_profile()
    path = paths.local_profile_file_path()
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["schema_version"] = 99
    path.write_text(json.dumps(raw), encoding="utf-8")
    before = path.read_bytes()
    assert wm.build_watermark_settings()["mode"] == "never"
    with pytest.raises(ps.ProfileUnreadableError):
        wm.apply_watermark_patch({"opacity": 0.5})
    assert path.read_bytes() == before


def test_hand_edited_invalid_values_fall_back_to_defaults_when_read() -> None:
    ps.load_profile()
    path = paths.local_profile_file_path()
    raw = json.loads(path.read_text(encoding="utf-8"))
    raw["preferences"]["watermark"].update(
        {"mode": "sometimes", "opacity": 7, "position": "nowhere", "size_percent": "big", "image": {"width": "x"}}
    )
    path.write_text(json.dumps(raw), encoding="utf-8")
    block = ps.get_watermark_block()
    assert block["mode"] == "never"
    assert block["opacity"] == 1.0
    assert block["position"] == "top-right"
    assert block["size_percent"] == 18
    assert block["image"] is None


# ---------------------------------------------------------------------------
# 6. Per-render decision table (architecture.md 11.3): 9 combinations
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("mode", ["always", "never", "ask"])
@pytest.mark.parametrize("requested", [True, False, None])
def test_decision_table(mode: str, requested: bool | None) -> None:
    wm.store_watermark_image(_png_bytes())
    wm.apply_watermark_patch({"mode": mode, "position": "bottom-left", "size_percent": 33, "opacity": 0.4})
    decision = wm.decide_watermark(requested)
    expected_apply = requested is True or (requested is None and mode == "always")
    assert decision.apply is expected_apply
    if expected_apply:
        assert decision.image_path == ps.watermark_image_path()
        assert decision.overlay == wm.build_overlay("bottom-left", 33, 0.4, image_width=64, image_height=48)
    else:
        assert decision.overlay is None and decision.image_path is None
    if requested is None and mode == "ask":
        assert "ask" in decision.log_line()


@pytest.mark.parametrize("requested", [True, None])
def test_decision_without_image_fails_only_when_the_mark_would_be_applied(requested: bool | None) -> None:
    ps.load_profile()
    if requested is True:
        with pytest.raises(wm.WatermarkMissingError) as exc:
            wm.decide_watermark(True)
        assert exc.value.detail == "A imagem da marca d'água não foi encontrada."
    else:
        assert wm.decide_watermark(None).apply is False  # mode never


def test_decision_with_mode_always_and_deleted_image_file_fails() -> None:
    wm.store_watermark_image(_png_bytes())
    wm.apply_watermark_patch({"mode": "always"})
    ps.watermark_image_path().unlink()
    with pytest.raises(wm.WatermarkMissingError):
        wm.decide_watermark(None)
    assert wm.decide_watermark(False).apply is False


def test_decision_with_corrupted_stored_image_fails() -> None:
    wm.store_watermark_image(_png_bytes())
    wm.apply_watermark_patch({"mode": "always"})
    ps.watermark_image_path().write_bytes(b"\x89PNG\r\n\x1a\n" + b"junk" * 20)
    with pytest.raises(wm.WatermarkMissingError):
        wm.decide_watermark(None)


def test_decision_false_does_not_touch_the_profile_on_disk() -> None:
    assert wm.decide_watermark(False).apply is False
    assert not paths.local_profile_dir().exists()


# ---------------------------------------------------------------------------
# 7. require_local_ui
# ---------------------------------------------------------------------------


@pytest.fixture
def outside_client() -> httpx.AsyncClient:
    transport = httpx.ASGITransport(app=create_app(), client=("192.168.0.50", 5555))
    return httpx.AsyncClient(transport=transport, base_url="http://testserver")


@pytest.mark.asyncio
async def test_local_routes_refuse_outside_clients(outside_client: httpx.AsyncClient) -> None:
    async with outside_client as client:
        for method, url, kwargs in (
            ("PUT", "/profiles/active/watermark", {"json": {"opacity": 0.5}}),
            ("POST", "/profiles/active/watermark/image", {"files": {"file": ("a.png", _png_bytes(), "image/png")}}),
            ("DELETE", "/profiles/active/watermark/image", {}),
        ):
            resp = await client.request(method, url, **kwargs)
            assert resp.status_code == 403, url
            assert resp.json() == {"detail": "Esta ação só pode ser feita neste computador.", "code": "local_only"}
        # reading is not restricted
        assert (await client.get("/profiles/active/watermark")).status_code == 200
    assert not ps.watermark_image_path().exists()


@pytest.mark.asyncio
async def test_local_routes_refuse_foreign_origin_and_accept_localhost(async_client: httpx.AsyncClient) -> None:
    for origin in ("http://evil.example.com", "https://localhost.evil.com", "null", "http://192.168.0.5:5173"):
        resp = await async_client.put(
            "/profiles/active/watermark", json={"opacity": 0.5}, headers={"Origin": origin}
        )
        assert resp.status_code == 403, origin
        assert resp.json()["code"] == "local_only"
    for origin in ("http://localhost:5173", "http://127.0.0.1:5173", "http://localhost"):
        resp = await async_client.put(
            "/profiles/active/watermark", json={"opacity": 0.5}, headers={"Origin": origin}
        )
        assert resp.status_code == 200, origin
    # no Origin header at all (same-origin tools, curl, the test client) is accepted from a local peer
    assert (await async_client.put("/profiles/active/watermark", json={"opacity": 0.6})).status_code == 200


@pytest.mark.asyncio
async def test_require_local_ui_accepts_ipv6_loopback_and_rejects_missing_peer() -> None:
    from starlette.requests import Request

    from app.api.local_only import require_local_ui

    def _req(client: tuple[str, int] | None, headers: list[tuple[bytes, bytes]] | None = None) -> Request:
        return Request(
            {"type": "http", "method": "PUT", "path": "/", "headers": headers or [], "client": client, "query_string": b""}
        )

    await require_local_ui(_req(("::1", 1)))
    await require_local_ui(_req(("127.0.0.1", 1)))
    for bad in (None, ("10.0.0.1", 1), ("::2", 1)):
        with pytest.raises(Exception) as exc:
            await require_local_ui(_req(bad))
        assert getattr(exc.value, "status_code", None) == 403


# ---------------------------------------------------------------------------
# 8. Watermark routes
# ---------------------------------------------------------------------------

_DEFAULT_SETTINGS = {
    "mode": "never",
    "has_image": False,
    "image_url": None,
    "opacity": 0.7,
    "position": "top-right",
    "size_percent": 18,
    "image": None,
}


def _upload(content: bytes, name: str = "logo.png", ctype: str = "image/png") -> dict[str, Any]:
    return {"files": {"file": (name, content, ctype)}}


@pytest.mark.asyncio
async def test_get_watermark_returns_defaults_for_a_new_profile(async_client: httpx.AsyncClient) -> None:
    for pid in ("active", "p_local"):
        resp = await async_client.get(f"/profiles/{pid}/watermark")
        assert resp.status_code == 200
        assert resp.json() == _DEFAULT_SETTINGS
    assert paths.local_profile_file_path().exists()


@pytest.mark.asyncio
@pytest.mark.parametrize("pid", ["p_8f3a2c1d", "..", "a b", "x" * 80, "p_local%2F..%2Fx"])
async def test_unknown_or_malformed_profile_ids_are_404(async_client: httpx.AsyncClient, pid: str) -> None:
    for method, url in (
        ("GET", f"/profiles/{pid}/watermark"),
        ("PUT", f"/profiles/{pid}/watermark"),
        ("GET", f"/profiles/{pid}/watermark/image"),
        ("DELETE", f"/profiles/{pid}/watermark/image"),
    ):
        resp = await async_client.request(method, url, **({"json": {}} if method == "PUT" else {}))
        assert resp.status_code == 404, (method, url, resp.text)


@pytest.mark.asyncio
async def test_upload_first_image_keeps_mode_never_and_serves_the_image(async_client: httpx.AsyncClient) -> None:
    resp = await async_client.post("/profiles/active/watermark/image", **_upload(_jpeg_bytes(80, 60), "logo.jpeg", "image/jpeg"))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["mode"] == "never"  # P21: uploading does not switch the mark on
    assert body["has_image"] is True
    assert body["image"]["width"] == 80 and body["image"]["height"] == 60
    assert body["image_url"].startswith("/profiles/p_local/watermark/image?v=")
    served = await async_client.get(body["image_url"])
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/png"
    assert served.content == ps.watermark_image_path().read_bytes()
    assert served.content[:8] == b"\x89PNG\r\n\x1a\n"


@pytest.mark.asyncio
async def test_upload_in_ask_mode_keeps_ask_and_replaces_the_image(async_client: httpx.AsyncClient) -> None:
    await async_client.post("/profiles/active/watermark/image", **_upload(_png_bytes(64, 48)))
    assert (await async_client.put("/profiles/active/watermark", json={"mode": "ask"})).status_code == 200
    resp = await async_client.post("/profiles/active/watermark/image", **_upload(_png_bytes(100, 100)))
    assert resp.status_code == 200
    assert resp.json()["mode"] == "ask"
    assert resp.json()["image"]["width"] == 100


@pytest.mark.asyncio
async def test_remove_image_returns_to_never_and_deletes_the_fixed_file(async_client: httpx.AsyncClient) -> None:
    await async_client.post("/profiles/active/watermark/image", **_upload(_png_bytes()))
    await async_client.put("/profiles/active/watermark", json={"mode": "always", "size_percent": 30})
    resp = await async_client.delete("/profiles/active/watermark/image")
    assert resp.status_code == 200
    body = resp.json()
    assert body["mode"] == "never" and body["has_image"] is False and body["image_url"] is None
    assert body["size_percent"] == 30  # appearance is kept
    assert not ps.watermark_image_path().exists()
    assert (await async_client.get("/profiles/active/watermark/image")).status_code == 404
    assert (await async_client.get("/profiles/active/watermark/image")).json() == {"detail": "Watermark not found"}
    # deleting again is harmless
    assert (await async_client.delete("/profiles/active/watermark/image")).status_code == 200


@pytest.mark.asyncio
async def test_put_mode_other_than_never_without_image_is_400_watermark_missing(async_client: httpx.AsyncClient) -> None:
    for mode in ("always", "ask"):
        resp = await async_client.put("/profiles/active/watermark", json={"mode": mode})
        assert resp.status_code == 400
        assert resp.json()["code"] == "watermark_missing"
    assert (await async_client.put("/profiles/active/watermark", json={"mode": "never"})).status_code == 200
    assert (await async_client.get("/profiles/active/watermark")).json()["mode"] == "never"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        {"opacity": 0.04},
        {"opacity": 1.01},
        {"opacity": "0.5"},
        {"opacity": True},
        {"opacity": None},
        {"position": "middle"},
        {"size_percent": 4},
        {"size_percent": 51},
        {"size_percent": 18.5},
        {"size_percent": True},
        {"mode": "sometimes"},
        {"mode": None},
        [1, 2],
    ],
)
async def test_put_out_of_range_values_are_400_and_change_nothing(async_client: httpx.AsyncClient, body: Any) -> None:
    resp = await async_client.put("/profiles/active/watermark", json=body)
    assert resp.status_code == 400, resp.text
    assert "detail" in resp.json()
    assert (await async_client.get("/profiles/active/watermark")).json() == _DEFAULT_SETTINGS


@pytest.mark.asyncio
async def test_put_invalid_json_is_400(async_client: httpx.AsyncClient) -> None:
    resp = await async_client.put(
        "/profiles/active/watermark", content=b"{nope", headers={"content-type": "application/json"}
    )
    assert resp.status_code == 400


@pytest.mark.asyncio
async def test_put_accepts_partial_updates_and_boundaries(async_client: httpx.AsyncClient) -> None:
    resp = await async_client.put("/profiles/active/watermark", json={"opacity": 0.05, "size_percent": 50})
    assert resp.status_code == 200
    assert (resp.json()["opacity"], resp.json()["size_percent"], resp.json()["position"]) == (0.05, 50, "top-right")
    resp = await async_client.put("/profiles/active/watermark", json={"opacity": 1, "size_percent": 5.0, "position": "center"})
    assert resp.status_code == 200
    assert (resp.json()["opacity"], resp.json()["size_percent"], resp.json()["position"]) == (1.0, 5, "center")
    assert (await async_client.put("/profiles/active/watermark", json={})).status_code == 200


@pytest.mark.asyncio
async def test_restore_defaults_does_not_change_mode_or_remove_image(async_client: httpx.AsyncClient) -> None:
    await async_client.post("/profiles/active/watermark/image", **_upload(_png_bytes()))
    await async_client.put(
        "/profiles/active/watermark",
        json={"mode": "always", "opacity": 0.2, "position": "bottom-left", "size_percent": 40},
    )
    resp = await async_client.put(
        "/profiles/active/watermark", json={"opacity": 0.7, "position": "top-right", "size_percent": 18}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert (body["mode"], body["has_image"]) == ("always", True)
    assert (body["opacity"], body["position"], body["size_percent"]) == (0.7, "top-right", 18)
    assert ps.watermark_image_path().exists()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("payload", "name", "ctype", "message"),
    [
        (b"GIF89a" + b"\x00" * 64, "logo.gif", "image/gif", wm.MSG_FORMAT),
        (b'<svg xmlns="http://www.w3.org/2000/svg"></svg>', "logo.svg", "image/svg+xml", wm.MSG_FORMAT),
        (b"just some text pretending", "logo.png", "image/png", wm.MSG_FORMAT),
        (_png_bytes() + b"\x00" * (6 * 1024 * 1024), "big.png", "image/png", wm.MSG_TOO_BIG_FILE),
        (_png_bytes(5000, 20), "wide.png", "image/png", wm.MSG_TOO_BIG_DIMENSIONS),
        (_png_bytes()[:40], "cut.png", "image/png", wm.MSG_UNREADABLE),
    ],
)
async def test_upload_refuses_bad_images_with_invalid_image_code(
    async_client: httpx.AsyncClient, payload: bytes, name: str, ctype: str, message: str
) -> None:
    resp = await async_client.post("/profiles/active/watermark/image", **_upload(payload, name, ctype))
    assert resp.status_code == 400
    assert resp.json() == {"detail": message, "code": "invalid_image"}
    assert not ps.watermark_image_path().exists()
    assert (await async_client.get("/profiles/active/watermark")).json()["has_image"] is False


@pytest.mark.asyncio
async def test_upload_trusts_bytes_not_extension_or_content_type(async_client: httpx.AsyncClient) -> None:
    # a real PNG labelled as .txt / text/plain is fine; the label never decides
    resp = await async_client.post("/profiles/active/watermark/image", **_upload(_png_bytes(), "notes.txt", "text/plain"))
    assert resp.status_code == 200


@pytest.mark.asyncio
async def test_upload_without_file_field_is_400(async_client: httpx.AsyncClient) -> None:
    resp = await async_client.post("/profiles/active/watermark/image", data={"other": "x"})
    assert resp.status_code in (400, 422)
    resp = await async_client.post(
        "/profiles/active/watermark/image", files={"other": ("a.png", _png_bytes(), "image/png")}
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "invalid_image"


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "client_name",
    ["..\\..\\x.png", "../../x.png", "/etc/passwd", "C:\\Windows\\evil.png", "a/b/c.png", "nul.png", "%2e%2e%2fx.png"],
)
async def test_client_file_name_never_influences_the_stored_path(
    async_client: httpx.AsyncClient, tmp_path: Path, client_name: str
) -> None:
    before = {p for p in tmp_path.rglob("*")}
    resp = await async_client.post("/profiles/active/watermark/image", **_upload(_png_bytes(), client_name))
    assert resp.status_code == 200
    created = {p for p in tmp_path.rglob("*")} - before
    created_files = {p.relative_to(paths.data_dir()).as_posix() for p in created if p.is_file()}
    assert created_files == {"profile/profile.json", "profile/marca-dagua/watermark.png"}
    assert all(paths.data_dir() in p.parents or p == paths.data_dir() for p in created)
    assert not list(tmp_path.rglob("x.png"))


@pytest.mark.asyncio
async def test_uploads_leave_no_temporary_files(async_client: httpx.AsyncClient) -> None:
    await async_client.post("/profiles/active/watermark/image", **_upload(_png_bytes()))
    await async_client.put("/profiles/active/watermark", json={"mode": "ask"})
    await async_client.delete("/profiles/active/watermark/image")
    assert list(paths.local_profile_dir().rglob("*.tmp")) == []


@pytest.mark.asyncio
async def test_fixed_path_ignores_hand_edited_file_field(async_client: httpx.AsyncClient) -> None:
    decoy = paths.data_dir() / "x.png"
    decoy.write_bytes(_png_bytes(20, 20, color=(1, 2, 3)))
    secret = paths.data_dir() / "secret.txt"
    secret.write_text("secret", encoding="utf-8")
    await async_client.get("/profiles/active/watermark")  # creates profile.json
    for evil in ("../x.png", str(secret), "..\\x.png", "marca-dagua/../../x.png"):
        raw = json.loads(paths.local_profile_file_path().read_text(encoding="utf-8"))
        raw["preferences"]["watermark"]["file"] = evil
        paths.local_profile_file_path().write_text(json.dumps(raw), encoding="utf-8")
        # nothing at the fixed path -> nothing is served, whatever `file` says
        assert (await async_client.get("/profiles/active/watermark/image")).status_code == 404
        assert (await async_client.get("/profiles/active/watermark")).json()["has_image"] is False
        resp = await async_client.delete("/profiles/active/watermark/image")
        assert resp.status_code == 200
    assert decoy.exists() and secret.read_text(encoding="utf-8") == "secret"

    # with a real image, the served bytes are the stored PNG and not the decoy
    await async_client.post("/profiles/active/watermark/image", **_upload(_png_bytes(64, 48)))
    raw = json.loads(paths.local_profile_file_path().read_text(encoding="utf-8"))
    raw["preferences"]["watermark"]["file"] = "../x.png"
    paths.local_profile_file_path().write_text(json.dumps(raw), encoding="utf-8")
    served = await async_client.get("/profiles/active/watermark/image")
    assert served.content == ps.watermark_image_path().read_bytes() != decoy.read_bytes()
    await async_client.delete("/profiles/active/watermark/image")
    assert decoy.exists()
    # and the render decision uses the fixed path too
    wm.store_watermark_image(_png_bytes())
    wm.apply_watermark_patch({"mode": "always"})
    assert wm.decide_watermark(None).image_path == ps.watermark_image_path()


@pytest.mark.asyncio
async def test_unreadable_profile_json_is_409_without_overwriting(async_client: httpx.AsyncClient) -> None:
    paths.local_profile_dir().mkdir(parents=True)
    paths.local_profile_file_path().write_bytes(b"")
    resp = await async_client.get("/profiles/active/watermark")
    assert resp.status_code == 409
    assert resp.json()["code"] == "profile_unreadable"
    assert (await async_client.put("/profiles/active/watermark", json={"opacity": 0.5})).status_code == 409
    assert paths.local_profile_file_path().read_bytes() == b""


# ---------------------------------------------------------------------------
# 9. Render: request field, pre-check, FFmpeg command / graph
# ---------------------------------------------------------------------------


def _observations(_s: float, _e: float) -> list[FrameObservation]:
    return [
        FrameObservation(frame_index=0, timestamp=0.0, faces=[FaceBoundingBox(face_id="A", x=900, y=200, width=250, height=250)]),
        FrameObservation(frame_index=8, timestamp=1.0, faces=[FaceBoundingBox(face_id="A", x=920, y=200, width=250, height=250)]),
    ]


def _make_job(container: ServiceContainer, tmp_path: Path, *, cuts: int = 1, status: JobStatus = JobStatus.WAITING_APPROVAL):
    job = container.jobs.create_job("https://example.com/v", status=status)
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"fake_source")
    container.jobs.update_job(job.job_id, {"source_video_path": str(video_file), "video_name": "WmVid"})
    container.jobs.save_cuts(
        job.job_id,
        [Cut(cut_id=f"c{i}", start=2.0 + 10 * i, end=7.0 + 10 * i, title=f"Cut {i}", status="approved") for i in range(cuts)],
    )
    container.jobs.save_transcription_words(
        job.job_id,
        [WordTiming(word="Hello", start=2.5, end=3.0), WordTiming(word="World", start=3.1, end=3.6)],
    )
    return job


class _CapturingRunner:
    """Fake FFmpeg: records the command and the filter script text, then writes the output file."""

    def __init__(self, fail_first: bool = False) -> None:
        self.commands: list[list[str]] = []
        self.scripts: list[str] = []
        self._fail_first = fail_first

    async def __call__(self, cmd: list[str], on_line: Any, cancel_token: Any) -> int:
        self.commands.append(list(cmd))
        script_path = Path(cmd[cmd.index("-filter_complex_script") + 1])
        self.scripts.append(script_path.read_text(encoding="utf-8"))
        if self._fail_first and len(self.commands) == 1:
            return 1  # NVENC failure -> executor falls back to libx264
        Path(cmd[-1]).write_bytes(b"mp4")
        return 0


@pytest.mark.asyncio
async def test_render_without_watermark_produces_the_same_command_and_graph_as_before(
    container: ServiceContainer, tmp_path: Path
) -> None:
    job = _make_job(container, tmp_path)
    runner = _CapturingRunner()
    service = RenderingService(container=container, subprocess_runner=runner)
    urls = await service.render_job(job.job_id, synthetic_observations_provider=_observations)
    assert len(urls) == 1
    cmd = runner.commands[0]
    assert cmd.count("-i") == 1 and "-pattern_type" not in cmd
    assert cmd[:6] == ["ffmpeg", "-y", "-hwaccel", "cuda", "-ss", "2.000"]
    assert cmd[cmd.index("-i") + 2] == "-t"
    script = runner.scripts[0]
    assert "[1:v]" not in script and "overlay=x=" not in script
    assert "[v_base]subtitles=" in script and "[v_sub]format=yuv420p[v_out];" in script
    # job log says why (mode never)
    logs = container.runtime.get_task_logs(job.job_id, "render")
    assert any("Watermark: not applied" in str(line) for line in logs)


@pytest.mark.asyncio
async def test_render_with_mode_always_adds_second_input_and_overlay_in_both_encoders(
    container: ServiceContainer, tmp_path: Path
) -> None:
    wm.store_watermark_image(_png_bytes())
    wm.apply_watermark_patch({"mode": "always", "position": "top-right", "size_percent": 18, "opacity": 0.7})
    job = _make_job(container, tmp_path)
    runner = _CapturingRunner(fail_first=True)  # first (NVENC) call fails -> CPU fallback command too
    service = RenderingService(container=container, subprocess_runner=runner)
    urls = await service.render_job(job.job_id, synthetic_observations_provider=_observations)
    assert len(urls) == 1
    assert len(runner.commands) == 2
    for cmd in runner.commands:
        i_positions = [i for i, a in enumerate(cmd) if a == "-i"]
        assert len(i_positions) == 2
        assert cmd[i_positions[1] + 1] == str(ps.watermark_image_path())
        assert cmd[i_positions[1] + 2] == "-t"
    assert "h264_nvenc" in runner.commands[0] and "libx264" in runner.commands[1]
    for script in runner.scripts:
        lines = script.splitlines()
        sub = next(i for i, ln in enumerate(lines) if "subtitles=" in ln)
        assert lines[sub + 1] == (
            "[1:v]format=rgba,scale=w=194:h=146,colorchannelmixer=aa=0.70[wm];"
        )
        assert lines[sub + 2] == "[v_sub][wm]overlay=x=W-w-44:y=44:eof_action=repeat[v_wm];"
        assert lines[sub + 3] == "[v_wm]format=yuv420p[v_out];"
    logs = container.runtime.get_task_logs(job.job_id, "render")
    assert any("Watermark: applied" in str(line) and "top-right, 18%, opacity 0.70" in str(line) for line in logs)


@pytest.mark.asyncio
async def test_explicit_false_overrides_mode_always_and_true_overrides_mode_never(
    container: ServiceContainer, tmp_path: Path
) -> None:
    wm.store_watermark_image(_png_bytes())
    wm.apply_watermark_patch({"mode": "always"})
    job = _make_job(container, tmp_path)
    runner = _CapturingRunner()
    await RenderingService(container=container, subprocess_runner=runner).render_job(
        job.job_id, synthetic_observations_provider=_observations, watermark=False
    )
    assert runner.commands[0].count("-i") == 1

    wm.apply_watermark_patch({"mode": "never"})
    job2 = _make_job(container, tmp_path)
    runner2 = _CapturingRunner()
    await RenderingService(container=container, subprocess_runner=runner2).render_job(
        job2.job_id, synthetic_observations_provider=_observations, watermark=True
    )
    assert runner2.commands[0].count("-i") == 2


@pytest.mark.asyncio
async def test_ask_mode_without_an_answer_does_not_apply_and_logs_it(
    container: ServiceContainer, tmp_path: Path
) -> None:
    wm.store_watermark_image(_png_bytes())
    wm.apply_watermark_patch({"mode": "ask"})
    job = _make_job(container, tmp_path)
    runner = _CapturingRunner()
    await RenderingService(container=container, subprocess_runner=runner).render_job(
        job.job_id, synthetic_observations_provider=_observations
    )
    assert runner.commands[0].count("-i") == 1
    logs = [str(line) for line in container.runtime.get_task_logs(job.job_id, "render")]
    assert any("Watermark: not applied" in line and "ask" in line for line in logs)


@pytest.mark.asyncio
async def test_render_with_watermark_requested_and_image_missing_never_starts_ffmpeg(
    container: ServiceContainer, tmp_path: Path
) -> None:
    ps.load_profile()  # profile exists, image does not
    job = _make_job(container, tmp_path, cuts=2)
    runner = _CapturingRunner()
    service = RenderingService(container=container, subprocess_runner=runner)
    with pytest.raises(wm.WatermarkMissingError):
        await service.render_job(job.job_id, synthetic_observations_provider=_observations, watermark=True)
    assert runner.commands == []
    reloaded = container.jobs.load_job(job.job_id)
    assert reloaded.status == JobStatus.ERROR  # architecture.md 11.3: error state, never RENDERING
    logs = container.runtime.get_task_logs(job.job_id, "render")
    assert any("A imagem da marca d'água não foi encontrada." in str(line) for line in logs)
    assert not list(container.jobs.shorts_dir_path(job.job_id, create=False).glob("*.mp4"))


@pytest.mark.asyncio
async def test_render_mode_always_with_deleted_image_never_starts_ffmpeg(
    container: ServiceContainer, tmp_path: Path
) -> None:
    wm.store_watermark_image(_png_bytes())
    wm.apply_watermark_patch({"mode": "always"})
    ps.watermark_image_path().unlink()
    job = _make_job(container, tmp_path)
    runner = _CapturingRunner()
    with pytest.raises(wm.WatermarkMissingError):
        await RenderingService(container=container, subprocess_runner=runner).render_job(
            job.job_id, synthetic_observations_provider=_observations
        )
    assert runner.commands == []


class _FakeRenderingService:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    async def render_job(self, job_id: str, **kwargs: Any) -> list[str]:
        self.calls.append({"job_id": job_id, **kwargs})
        return []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "kwargs",
    [{}, {"json": {}}, {"json": {"cut_ids": ["c0"]}}, {"json": {"watermark": None}}, {"content": b"not json"}],
)
async def test_render_route_without_watermark_field_behaves_as_before(
    async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path, kwargs: dict[str, Any]
) -> None:
    job = _make_job(container, tmp_path)
    fake = _FakeRenderingService()
    with patch("app.api.routers.jobs_render.get_rendering_service", return_value=fake):
        resp = await async_client.post(f"/jobs/{job.job_id}/render", **kwargs)
    assert resp.status_code == 200 and resp.json() == {"started": True}
    assert len(fake.calls) == 1
    assert "watermark" not in fake.calls[0]  # exactly the pre-feature call
    expected_cut_ids = ["c0"] if kwargs.get("json", {}).get("cut_ids") else None
    assert fake.calls[0].get("cut_ids") == expected_cut_ids


@pytest.mark.asyncio
async def test_render_route_passes_explicit_watermark_choice(
    async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path
) -> None:
    wm.store_watermark_image(_png_bytes())
    job = _make_job(container, tmp_path)
    fake = _FakeRenderingService()
    with patch("app.api.routers.jobs_render.get_rendering_service", return_value=fake):
        assert (await async_client.post(f"/jobs/{job.job_id}/render", json={"watermark": True})).status_code == 200
        assert (await async_client.post(f"/jobs/{job.job_id}/render", json={"watermark": False})).status_code == 200
    assert [c.get("watermark") for c in fake.calls] == [True, False]


@pytest.mark.asyncio
async def test_render_route_returns_400_watermark_missing_before_starting(
    async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path
) -> None:
    job = _make_job(container, tmp_path)
    fake = _FakeRenderingService()
    with patch("app.api.routers.jobs_render.get_rendering_service", return_value=fake):
        resp = await async_client.post(f"/jobs/{job.job_id}/render", json={"watermark": True})
    assert resp.status_code == 400
    assert resp.json() == {"detail": "A imagem da marca d'água não foi encontrada.", "code": "watermark_missing"}
    assert fake.calls == []
    assert container.jobs.load_job(job.job_id).status == JobStatus.WAITING_APPROVAL


@pytest.mark.asyncio
async def test_render_route_rejects_non_boolean_watermark(
    async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path
) -> None:
    job = _make_job(container, tmp_path)
    fake = _FakeRenderingService()
    with patch("app.api.routers.jobs_render.get_rendering_service", return_value=fake):
        resp = await async_client.post(f"/jobs/{job.job_id}/render", json={"watermark": "yes"})
    assert resp.status_code == 400 and fake.calls == []


@pytest.mark.asyncio
async def test_run_route_validates_and_forwards_watermark(
    async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path
) -> None:
    job = _make_job(container, tmp_path)
    seen: list[dict[str, Any]] = []

    async def _fake_run(job_id: str, include_render: bool = True, container: Any = None, **kwargs: Any) -> Any:
        seen.append({"include_render": include_render, **kwargs})
        return container_job

    container_job = container.jobs.load_job(job.job_id)
    with patch("app.api.routers.jobs.run_job_pipeline", side_effect=_fake_run):
        # no field: identical to before
        assert (await async_client.post(f"/jobs/{job.job_id}/run", json={"include_render": True})).status_code == 200
        # explicit false never needs an image
        assert (await async_client.post(f"/jobs/{job.job_id}/run", json={"include_render": True, "watermark": False})).status_code == 200
        # true without an image fails before the pipeline starts
        resp = await async_client.post(f"/jobs/{job.job_id}/run", json={"include_render": True, "watermark": True})
        assert resp.status_code == 400
        assert resp.json() == {"detail": "A imagem da marca d'água não foi encontrada.", "code": "watermark_missing"}
        # without rendering the flag is irrelevant
        assert (await async_client.post(f"/jobs/{job.job_id}/run", json={"include_render": False, "watermark": True})).status_code == 200
        wm.store_watermark_image(_png_bytes())
        assert (await async_client.post(f"/jobs/{job.job_id}/run", json={"include_render": True, "watermark": True})).status_code == 200
        assert (await async_client.post(f"/jobs/{job.job_id}/run", json={"include_render": True, "watermark": "x"})).status_code == 400
    assert seen == [
        {"include_render": True},
        {"include_render": True, "watermark": False},
        {"include_render": False, "watermark": True},
        {"include_render": True, "watermark": True},
    ]


@pytest.mark.asyncio
async def test_orchestrator_forwards_watermark_to_render_only_when_given(
    async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path
) -> None:
    from app.application.orchestrator import run_job_pipeline
    from app.domain.rendering.rendering_service import get_rendering_service

    job = _make_job(container, tmp_path)
    calls: list[dict[str, Any]] = []

    async def _fake_render(jid: str, **kwargs: Any) -> list[str]:
        calls.append(kwargs)
        container.jobs.update_job_status(jid, JobStatus.DONE)
        return []

    with patch.object(get_rendering_service(), "render_job", side_effect=_fake_render):
        await run_job_pipeline(job.job_id, include_render=True)
        container.jobs.update_job_status(job.job_id, JobStatus.WAITING_APPROVAL)
        await run_job_pipeline(job.job_id, include_render=True, watermark=False)
    assert calls == [{}, {"watermark": False}]


@pytest.mark.asyncio
async def test_batch_route_prechecks_and_forwards_watermark_option(
    async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path
) -> None:
    from app.application.orchestrator import get_batch_runner
    from app.domain.rendering.rendering_service import get_rendering_service

    job = _make_job(container, tmp_path, status=JobStatus.WAITING_APPROVAL)
    # watermark requested, no image: rejected before any batch is queued
    resp = await async_client.post(
        "/jobs/batch/run", json={"job_ids": [job.job_id], "options": {"render": True, "watermark": True}}
    )
    assert resp.status_code == 400
    assert resp.json() == {"detail": "A imagem da marca d'água não foi encontrada.", "code": "watermark_missing"}
    # invalid type
    resp = await async_client.post(
        "/jobs/batch/run", json={"job_ids": [job.job_id], "options": {"render": True, "watermark": 1}}
    )
    assert resp.status_code == 400
    # without rendering the flag is not checked
    calls: list[dict[str, Any]] = []

    async def _fake_render(jid: str, **kwargs: Any) -> list[str]:
        calls.append(kwargs)
        container.jobs.update_job_status(jid, JobStatus.DONE)
        return []

    wm.store_watermark_image(_png_bytes())
    with patch.object(get_rendering_service(), "render_job", side_effect=_fake_render):
        resp = await async_client.post(
            "/jobs/batch/run",
            json={"job_ids": [job.job_id], "options": {"transcription": False, "analysis": True, "render": True, "watermark": False}},
        )
        assert resp.status_code == 200
        task = get_batch_runner()._tasks.get(resp.json()["batch_id"])
        if task:
            await task
    assert calls == [{"watermark": False}]


# ---------------------------------------------------------------------------
# 10. Existing request/response models stay compatible
# ---------------------------------------------------------------------------


def test_request_models_gain_only_optional_watermark_fields() -> None:
    from app.models.schemas import BatchPipelineOptions, RunPipelineRequest

    assert RunPipelineRequest().watermark is None
    assert BatchPipelineOptions().watermark is None
    assert RunPipelineRequest(include_render=True, watermark=True).watermark is True
    assert BatchPipelineOptions(render=False).model_dump()["watermark"] is None


def test_rendering_service_signature_keeps_previous_keyword_arguments() -> None:
    import inspect

    params = inspect.signature(RenderingService.render_job).parameters
    assert list(params)[:4] == ["self", "job_id", "cut_ids", "synthetic_observations_provider"]
    assert params["watermark"].default is None
    exec_params = inspect.signature(ffe.FFmpegNvencExecutor.execute_render_cut).parameters
    assert exec_params["watermark_path"].default is None


@pytest.mark.parametrize(("iw", "ih", "size"), [(4096, 16, 5), (2000, 16, 5), (16, 4096, 5), (4096, 16, 11), (64, 48, 18)])
def test_scaled_size_is_explicit_even_and_never_zero(iw: int, ih: int, size: int) -> None:
    o = wm.build_overlay("center", size, 0.5, image_width=iw, image_height=ih)
    assert o.scaled_width is not None and o.scaled_height is not None
    assert o.scaled_width >= 2 and o.scaled_height >= 2
    assert o.scaled_width % 2 == 0 and o.scaled_height % 2 == 0
    assert o.scaled_width <= o.box_width + 2 and o.scaled_height <= o.box_height + 2


def test_extreme_aspect_image_produces_explicit_scale_in_filter_script() -> None:
    wm.store_watermark_image(_png_bytes(4096, 16))
    wm.apply_watermark_patch({"mode": "always", "position": "center", "size_percent": 5})
    decision = wm.decide_watermark(None)
    assert decision.overlay is not None
    assert (decision.overlay.scaled_width, decision.overlay.scaled_height) == (54, 2)


def test_store_and_remove_image_refuse_before_touching_disk_when_profile_is_newer() -> None:
    wm.store_watermark_image(_png_bytes())
    before = ps.watermark_image_path().read_bytes()
    profile = ps.load_profile()
    profile["schema_version"] = 99
    ps.profile_file().write_text(json.dumps(profile), encoding="utf-8")
    with pytest.raises(ps.ProfileUnreadableError):
        wm.store_watermark_image(_png_bytes(32, 32))
    assert ps.watermark_image_path().read_bytes() == before
    with pytest.raises(ps.ProfileUnreadableError):
        wm.remove_watermark_image()
    assert ps.watermark_image_path().exists()


def test_image_url_version_changes_on_every_write() -> None:
    first = wm.build_watermark_settings(wm.store_watermark_image(_png_bytes()))["image_url"]
    second = wm.build_watermark_settings(wm.store_watermark_image(_png_bytes()))["image_url"]
    assert first != second


@pytest.mark.asyncio
async def test_batch_route_validates_flag_type_even_without_render_and_skips_check_without_analysis(
    async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path
) -> None:
    from unittest.mock import MagicMock

    job = _make_job(container, tmp_path, status=JobStatus.WAITING_APPROVAL)
    resp = await async_client.post(
        "/jobs/batch/run", json={"job_ids": [job.job_id], "options": {"render": False, "watermark": "yes"}}
    )
    assert resp.status_code == 400 and resp.json() == {"detail": "Valor inválido para watermark."}
    # render without analysis never renders: no image needed even with watermark=true
    import app.api.routers.jobs as jobs_router

    fake_runner = MagicMock()
    fake_runner.start_batch.return_value = MagicMock(batch_id="b1")
    with patch.object(jobs_router, "get_batch_runner", return_value=fake_runner):
        resp = await async_client.post(
            "/jobs/batch/run",
            json={"job_ids": [job.job_id], "options": {"analysis": False, "render": True, "watermark": True}},
        )
    assert resp.status_code == 200


def test_jpeg_exif_orientation_is_applied_on_normalize() -> None:
    img = np.full((40, 80, 3), 120, dtype=np.uint8)
    ok, enc = cv2.imencode(".jpg", img)
    assert ok
    raw = enc.tobytes()
    tiff = b"MM\x00\x2a\x00\x00\x00\x08" + b"\x00\x01" + b"\x01\x12\x00\x03\x00\x00\x00\x01\x00\x06\x00\x00" + b"\x00\x00\x00\x00"
    payload = b"Exif\x00\x00" + tiff
    app1 = b"\xff\xe1" + struct.pack(">H", len(payload) + 2) + payload
    data = raw[:2] + app1 + raw[2:]
    _png, width, height = wm.validate_and_normalize_image(data)
    assert (width, height) == (40, 80)  # orientation 6 rotates 80x40 to 40x80


@pytest.mark.asyncio
async def test_image_routes_return_detail_envelope_on_os_error(async_client: httpx.AsyncClient) -> None:
    wm.store_watermark_image(_png_bytes())
    with patch.object(wm, "remove_watermark_image", side_effect=PermissionError(32, "in use")):
        resp = await async_client.delete("/profiles/active/watermark/image")
    assert resp.status_code == 409
    assert resp.json()["code"] == "image_busy"
    with patch.object(wm, "store_watermark_image", side_effect=PermissionError(32, "in use")):
        resp = await async_client.post(
            "/profiles/active/watermark/image", files={"file": ("logo.png", _png_bytes(), "image/png")}
        )
    assert resp.status_code == 409
