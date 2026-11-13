"""Tests for cut curation (`approve-all`/`reject-all`), `include_render=False` pipeline stop,
progressive atomic render placement (`temp -> shorts_dir`), and selective cut rendering.

100% Logical Tests (ZERO real GPU / FFmpeg / downloads).
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from app.application.orchestrator import run_job_pipeline
from app.application.runtime_service import OperationCancelledError, ServiceContainer
from app.domain.rendering.rendering_service import (
    RenderingService,
    cancel_rendering_job,
    get_rendering_service,
    list_render_output_urls,
)
from app.infrastructure.vision.face_tracker import FaceBoundingBox, FrameObservation
from app.models.domain import Cut, JobStatus


def _synthetic_observations(start: float, end: float) -> list[FrameObservation]:
    return [
        FrameObservation(
            frame_index=0,
            timestamp=0.0,
            faces=[FaceBoundingBox(face_id="A", x=800, y=200, width=250, height=250)],
        ),
        FrameObservation(
            frame_index=8,
            timestamp=1.0,
            faces=[FaceBoundingBox(face_id="A", x=810, y=200, width=250, height=250)],
        ),
    ]


@pytest.mark.asyncio
async def test_run_job_pipeline_include_render_false_stops_at_waiting_approval_with_events(
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    """include_render=False must end at WAITING_APPROVAL and emit both progress=100% and state SSE events."""
    c = container
    job = c.jobs.create_job("https://www.youtube.com/watch?v=curate_stop")
    jid = job.job_id

    vdir = c.jobs.video_dir_path(jid)
    vdir.mkdir(parents=True, exist_ok=True)
    vfile = vdir / "video.mp4"
    vfile.write_bytes(b"dummy_mp4")
    c.jobs.update_job(
        jid,
        {
            "source_video_path": str(vfile),
            "source_file_name": "video.mp4",
            "video_duration_seconds": 120.0,
        },
    )
    c.jobs.update_job_status(jid, JobStatus.DOWNLOADED)

    render_called = False

    async def fake_transcribe(job_id: str, container=None):
        c.jobs.update_job_status(job_id, JobStatus.BUILDING_BLOCKS)
        return {}

    async def fake_blocks(job_id: str, container=None):
        c.jobs.update_job_status(job_id, JobStatus.BUILDING_TOPICS)
        return []

    async def fake_topics(job_id: str, container=None):
        c.jobs.update_job_status(job_id, JobStatus.ANALYZING)
        return []

    async def fake_analyze(job_id: str, container=None):
        c.jobs.save_cuts(
            job_id,
            [
                Cut(cut_id="c1", block_ids=["b1"], start=5.0, end=35.0, status="pending"),
                Cut(cut_id="c2", block_ids=["b2"], start=40.0, end=80.0, status="pending"),
            ],
        )
        c.jobs.update_job_status(job_id, JobStatus.WAITING_APPROVAL)
        return {"cuts": c.jobs.load_cuts(job_id)}

    async def fake_render(job_id: str, cut_ids=None):
        nonlocal render_called
        render_called = True
        return []

    with patch("app.application.orchestrator.transcribe_job", side_effect=fake_transcribe), \
         patch("app.application.orchestrator.build_semantic_blocks", side_effect=fake_blocks), \
         patch("app.application.orchestrator.build_topic_segments", side_effect=fake_topics), \
         patch("app.application.orchestrator.analyze_job", side_effect=fake_analyze), \
         patch.object(get_rendering_service(), "render_job", side_effect=fake_render):

        final_job = await run_job_pipeline(jid, include_render=False, container=c)

    assert not render_called, "render_job must not run when include_render=False"
    assert final_job.status == JobStatus.WAITING_APPROVAL
    assert c.jobs.load_job(jid).status == JobStatus.WAITING_APPROVAL

    history = c.runtime.event_bus.get_history(jid)
    expected_msg = "Cortes prontos para curadoria — revise e aprove antes de renderizar"

    progress_events = [
        evt for evt in history
        if evt.event == "progress"
        and evt.data.get("status") == "WAITING_APPROVAL"
        and evt.data.get("percent") == 100.0
        and evt.data.get("message") == expected_msg
    ]
    assert progress_events, f"Expected WAITING_APPROVAL 100% progress event, got: {history}"

    state_events = [
        evt for evt in history
        if evt.event == "state"
        and evt.data.get("status") == "WAITING_APPROVAL"
        and evt.data.get("message") == expected_msg
    ]
    assert state_events, f"Expected WAITING_APPROVAL state event, got: {history}"


@pytest.mark.asyncio
async def test_progressive_atomic_file_placement_during_multi_cut_render(
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    """While cut 2 is still writing into temp work_dir, cut 1 is already atomically moved to shorts_dir
    and reflected in job.rendered_files, while cut 2's partial .mp4 is NOT exposed in shorts_dir.
    """
    c = container
    job = c.jobs.create_job("https://example.com/v", status=JobStatus.WAITING_APPROVAL)
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"fake_source")
    c.jobs.update_job(job.job_id, {"source_video_path": str(video_file), "video_name": "AtomicVid"})
    c.jobs.save_cuts(
        job.job_id,
        [
            Cut(cut_id="c1", start=1.0, end=5.0, title="Cut 1", status="approved"),
            Cut(cut_id="c2", start=10.0, end=16.0, title="Cut 2", status="approved"),
        ],
    )

    cut1_finished_observed = asyncio.Event()
    cut2_started_writing = asyncio.Event()
    allow_cut2_finish = asyncio.Event()
    observed_mid_render: dict[str, Any] = {}

    async def _staged_runner(cmd: list[str], on_line: Any, cancel_token: Any) -> int:
        out_f = Path(cmd[-1])
        # Verify FFmpeg writes to a temp file inside .work_<cut_id>, never directly to shorts_dir
        assert out_f.parent.name.startswith(".work_"), f"Expected temp output inside .work_*, got {out_f}"

        if out_f.name == "00_01-00_05.mp4":
            out_f.write_bytes(b"complete_cut_1")
            return 0

        # Cut 2: write partial bytes to temp file and pause before completing
        out_f.write_bytes(b"partial_cut_2_half_written")
        cut2_started_writing.set()
        await allow_cut2_finish.wait()
        out_f.write_bytes(b"complete_cut_2")
        return 0

    service = RenderingService(container=container, subprocess_runner=_staged_runner)
    render_task = asyncio.create_task(
        service.render_job(job.job_id, synthetic_observations_provider=_synthetic_observations)
    )

    await asyncio.wait_for(cut2_started_writing.wait(), timeout=2.0)

    # Wait briefly until cut 1's os.replace + progressive job.json update lands
    shorts_dir = c.jobs.shorts_dir_path(job.job_id, create=False)
    for _ in range(50):
        c.jobs.invalidate_job_cache(job.job_id)
        mid_job = c.jobs.load_job(job.job_id)
        if getattr(mid_job, "rendered_files", None) == ["00_01-00_05.mp4"]:
            cut1_finished_observed.set()
            break
        await asyncio.sleep(0.02)

    assert cut1_finished_observed.is_set(), "job.rendered_files should progressively reflect cut 1 immediately"
    observed_mid_render["urls"] = list_render_output_urls(job.job_id, container=c)
    observed_mid_render["shorts_files"] = sorted(
        f.name for f in shorts_dir.iterdir() if f.is_file()
    )
    observed_mid_render["job_status"] = c.jobs.load_job(job.job_id).status

    assert observed_mid_render["urls"] == [f"/media/shorts/{job.job_id}/00_01-00_05.mp4"]
    assert observed_mid_render["shorts_files"] == ["00_01-00_05.mp4"]
    assert "00_10-00_16.mp4" not in observed_mid_render["shorts_files"]
    assert observed_mid_render["job_status"] == JobStatus.RENDERING

    allow_cut2_finish.set()
    final_urls = await render_task
    assert final_urls == [
        f"/media/shorts/{job.job_id}/00_01-00_05.mp4",
        f"/media/shorts/{job.job_id}/00_10-00_16.mp4",
    ]
    final_job = c.jobs.load_job(job.job_id)
    assert final_job.status == JobStatus.DONE
    assert final_job.rendered_files == ["00_01-00_05.mp4", "00_10-00_16.mp4"]
    assert not list(shorts_dir.glob(".work_*"))


@pytest.mark.asyncio
async def test_mocked_execute_render_cut_writing_output_path_kwarg_moves_atomically(
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    """If a test mocks `execute_render_cut` and writes to `output_path` kwarg, `_render_single_cut`
    must pass `temp_output_path` and `os.replace` it into `shorts_dir / filename` cleanly.
    """
    c = container
    job = c.jobs.create_job("https://example.com/v", status=JobStatus.WAITING_APPROVAL)
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"fake_source")
    c.jobs.update_job(job.job_id, {"source_video_path": str(video_file), "video_name": "MockExecVid"})
    c.jobs.save_cuts(job.job_id, [Cut(cut_id="c1", start=2.0, end=8.0, status="approved")])

    seen_output_paths: list[Path] = []

    async def fake_execute_render_cut(*, output_path: Path, **kwargs: Any) -> bool:
        seen_output_paths.append(output_path)
        output_path.write_bytes(b"mocked_mp4")
        return True

    service = RenderingService(container=container)
    with patch.object(service.ffmpeg_executor, "execute_render_cut", side_effect=fake_execute_render_cut):
        urls = await service.render_job(
            job.job_id,
            synthetic_observations_provider=_synthetic_observations,
        )

    assert len(seen_output_paths) == 1
    assert seen_output_paths[0].parent.name == ".work_c1"
    shorts_dir = c.jobs.shorts_dir_path(job.job_id, create=False)
    assert (shorts_dir / "00_02-00_08.mp4").read_bytes() == b"mocked_mp4"
    assert not seen_output_paths[0].exists()
    assert urls == [f"/media/shorts/{job.job_id}/00_02-00_08.mp4"]


@pytest.mark.asyncio
async def test_partial_temp_mp4_cleaned_up_on_cancel_and_not_exposed_in_shorts_dir(
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    """Cancelling while FFmpeg writes a temp .mp4 cleans up partial files and never places it in shorts_dir."""
    c = container
    job = c.jobs.create_job("https://example.com/v", status=JobStatus.WAITING_APPROVAL)
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"fake_source")
    c.jobs.update_job(job.job_id, {"source_video_path": str(video_file), "video_name": "CancelTempVid"})
    c.jobs.save_cuts(job.job_id, [Cut(cut_id="c1", start=0.0, end=12.0, status="approved")])

    writing_started = asyncio.Event()
    temp_file_seen: list[Path] = []

    async def _blocking_runner(cmd: list[str], on_line: Any, cancel_token: Any) -> int:
        out_f = Path(cmd[-1])
        out_f.write_bytes(b"half_written_mp4")
        temp_file_seen.append(out_f)
        writing_started.set()
        while cancel_token and not cancel_token.is_set():
            await asyncio.sleep(0.01)
        raise OperationCancelledError()

    service = RenderingService(container=container, subprocess_runner=_blocking_runner)
    task = asyncio.create_task(
        service.render_job(job.job_id, synthetic_observations_provider=_synthetic_observations)
    )

    await asyncio.wait_for(writing_started.wait(), timeout=2.0)
    assert cancel_rendering_job(job.job_id, container=c) is True
    await task

    shorts_dir = c.jobs.shorts_dir_path(job.job_id, create=False)
    assert list_render_output_urls(job.job_id, container=c) == []
    assert not (shorts_dir / "00_00-00_12.mp4").exists()
    assert not temp_file_seen[0].exists()
    assert not list(shorts_dir.glob(".work_*"))


@pytest.mark.asyncio
async def test_approve_all_and_reject_all_endpoints_and_selective_rendering(
    async_client: httpx.AsyncClient,
    container: ServiceContainer,
    tmp_path: Path,
) -> None:
    """Test POST /cuts/approve-all, POST /cuts/reject-all, 404 handling, and selective cut rendering."""
    c = container

    # 404 for unknown job
    r_404 = await async_client.post("/jobs/missing_job/cuts/approve-all")
    assert r_404.status_code == 404
    r_404_rej = await async_client.post("/jobs/missing_job/cuts/reject-all")
    assert r_404_rej.status_code == 404

    job = c.jobs.create_job("https://example.com/v", status=JobStatus.ANALYZING)
    video_file = tmp_path / "video.mp4"
    video_file.write_bytes(b"fake_source")
    c.jobs.update_job(job.job_id, {"source_video_path": str(video_file), "video_name": "CurateVid"})
    c.jobs.save_cuts(
        job.job_id,
        [
            Cut(cut_id="c1", start=0.0, end=10.0, status="pending"),
            Cut(cut_id="c2", start=15.0, end=25.0, status="rejected"),
            Cut(cut_id="c3", start=30.0, end=40.0, status="pending"),
        ],
    )

    # 1. Approve all
    resp_app = await async_client.post(f"/jobs/{job.job_id}/cuts/approve-all")
    assert resp_app.status_code == 200, resp_app.text
    approved_cuts = resp_app.json()
    assert len(approved_cuts) == 3
    assert all(ct["status"] == "approved" and ct["approved"] is True and ct["rejected"] is False for ct in approved_cuts)
    assert c.jobs.load_job(job.job_id).status == JobStatus.WAITING_APPROVAL

    # 2. Reject all
    resp_rej = await async_client.post(f"/jobs/{job.job_id}/cuts/reject-all")
    assert resp_rej.status_code == 200, resp_rej.text
    rejected_cuts = resp_rej.json()
    assert len(rejected_cuts) == 3
    assert all(ct["status"] == "rejected" and ct["approved"] is False and ct["rejected"] is True for ct in rejected_cuts)
    assert c.jobs.load_job(job.job_id).status == JobStatus.WAITING_APPROVAL

    # 3. Attempting to render when ALL cuts are rejected must fail (never fall back to rendering rejected cuts)
    async def _fake_runner(cmd: list[str], on_line: Any, cancel_token: Any) -> int:
        Path(cmd[-1]).write_bytes(b"mp4")
        return 0

    service = RenderingService(container=c, subprocess_runner=_fake_runner)
    with pytest.raises(ValueError, match="No cuts found to render"):
        await service.render_job(job.job_id, synthetic_observations_provider=_synthetic_observations)

    # 4. Selective rendering: only c2 has approved=True (even if status wasn't changed from pending),
    #    c1 is pending, c3 is rejected -> ONLY c2 should be rendered.
    c.jobs.save_cuts(
        job.job_id,
        [
            Cut(cut_id="c1", start=0.0, end=10.0, status="pending", approved=False, rejected=False),
            Cut(cut_id="c2", start=15.0, end=25.0, status="pending", approved=True, rejected=False),
            Cut(cut_id="c3", start=30.0, end=40.0, status="rejected", approved=False, rejected=True),
        ],
    )
    c.jobs.update_job_status(job.job_id, JobStatus.WAITING_APPROVAL)

    urls = await service.render_job(job.job_id, synthetic_observations_provider=_synthetic_observations)
    assert urls == [f"/media/shorts/{job.job_id}/00_15-00_25.mp4"]
    shorts_dir = c.jobs.shorts_dir_path(job.job_id, create=False)
    assert sorted(f.name for f in shorts_dir.iterdir() if f.is_file()) == ["00_15-00_25.mp4"]
