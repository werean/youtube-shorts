"""Still-frame extraction for the optional vision stage (phase 6).

Frames are JPEG bytes produced by ffmpeg on the CPU and piped back through stdout: nothing is written to disk, so
the job directory is never touched. The ffmpeg call follows the project's other helpers (`pcm_extractor`): a plain
argv list run through asyncio, with a thread fallback for event loops without subprocess support. It has never been
run against a real video in this workflow; the tests replace `run_ffmpeg_frame`.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
import subprocess
from collections.abc import Awaitable, Callable, Sequence
from pathlib import Path

logger = logging.getLogger(__name__)

# One ffmpeg invocation: argv in, (return code, stdout bytes) out.
FrameRunner = Callable[[list[str]], Awaitable[tuple[int, bytes]]]


def frame_timestamps(start: float, end: float, *, count: int) -> list[float]:
    """`count` evenly spaced instants strictly inside (start, end): the centres of `count` equal slices.

    Centres, not the ends, so no frame sits on a cut boundary (where the picture may already belong to the
    neighbouring scene). `count` must lie in the constants' 4..8 range.
    """
    # Imported here, not at module level: the analysis package imports this module, so a top-level import of its
    # constants would be circular when this module is the first one loaded.
    from app.domain.analysis.v2 import constants as C

    if not C.VISION_FRAME_COUNT_MIN <= count <= C.VISION_FRAME_COUNT_MAX:
        raise ValueError(
            f"frame count must be between {C.VISION_FRAME_COUNT_MIN} and {C.VISION_FRAME_COUNT_MAX}, got {count}"
        )
    if not end > start:
        raise ValueError(f"cut end ({end}) must be after its start ({start})")
    step = (end - start) / count
    return [round(start + (i + 0.5) * step, 3) for i in range(count)]


def build_frame_command(video_path: str | Path, timestamp: float, *, max_side_px: int) -> list[str]:
    """ffmpeg argv that writes one JPEG to stdout, longer side at most `max_side_px` (never upscaled)."""
    side = int(max_side_px)
    # min(side, iw) and min(side, ih) with decrease keep the aspect ratio and never enlarge the picture.
    comma = "\\,"  # ffmpeg filter-graph escape for a comma inside an expression
    scale = f"scale=min({side}{comma}iw):min({side}{comma}ih):force_original_aspect_ratio=decrease"
    return [
        "ffmpeg",
        "-v",
        "error",
        "-ss",
        f"{timestamp:.3f}",
        "-i",
        str(video_path),
        "-frames:v",
        "1",
        "-vf",
        scale,
        "-f",
        "image2pipe",
        "-vcodec",
        "mjpeg",
        "pipe:1",
    ]


async def run_ffmpeg_frame(cmd: list[str]) -> tuple[int, bytes]:
    """Run one ffmpeg command and return (return code, stdout)."""
    from app.domain.analysis.v2 import constants as C

    timeout = C.VISION_FRAME_TIMEOUT_SECONDS
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        try:
            out, _err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()
            return 124, b""
        return int(proc.returncode or 0), out or b""
    except NotImplementedError:
        try:
            res = await asyncio.to_thread(
                subprocess.run, cmd, capture_output=True, timeout=timeout, check=False
            )
            return int(res.returncode), res.stdout or b""
        except subprocess.TimeoutExpired:
            return 124, b""


async def extract_frames(
    video_path: str | Path,
    timestamps: Sequence[float],
    *,
    max_side_px: int | None = None,
) -> list[bytes]:
    """JPEG bytes of the frame at each timestamp, in order; a frame that fails is skipped (the list may be shorter).

    `max_side_px` defaults to the constants' VISION_FRAME_MAX_SIDE_PX.
    """
    if max_side_px is None:
        from app.domain.analysis.v2 import constants as C

        max_side_px = C.VISION_FRAME_MAX_SIDE_PX
    frames: list[bytes] = []
    for ts in timestamps:
        cmd = build_frame_command(video_path, float(ts), max_side_px=max_side_px)
        try:
            # Looked up at call time so tests can replace the module-level runner.
            res = run_ffmpeg_frame(cmd)
            code, data = await res if inspect.isawaitable(res) else res
        except Exception as exc:  # noqa: BLE001 - a missing ffmpeg or a crash skips the frame, never the run
            logger.warning("Frame at %.3fs skipped: %s", ts, exc)
            continue
        if code != 0 or not data:
            logger.warning("Frame at %.3fs skipped: ffmpeg returned %s with %d bytes", ts, code, len(data or b""))
            continue
        frames.append(bytes(data))
    return frames
