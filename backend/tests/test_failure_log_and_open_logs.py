"""Failure record (`erro.log` + `last_error`) and `POST /jobs/:id/logs/open-folder` (100% mocked: no explorer, no GPU)."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import httpx
import pytest

from app.application.runtime_service import OperationCancelledError, ServiceContainer
from app.core import paths
from app.domain.ingest import set_custom_ytdlp_factory
from app.domain.rendering.rendering_service import RenderingService
from app.domain.segmentation.semantic_blocks import build_semantic_blocks
from app.infrastructure.audio.pcm_extractor import set_custom_media_prober, set_custom_pcm_extractor
from app.models.domain import JobStatus


@pytest.fixture(autouse=True)
def _reset_ingest_mocks():
    set_custom_ytdlp_factory(None)
    set_custom_media_prober(None)
    set_custom_pcm_extractor(None)
    yield
    set_custom_ytdlp_factory(None)
    set_custom_media_prober(None)
    set_custom_pcm_extractor(None)


def _read_error_log(job_id: str) -> str:
    return paths.job_error_log_path(job_id).read_text(encoding="utf-8")


class _FailingYoutubeDL:
    def __init__(self, opts: dict[str, Any]) -> None:
        self.opts = opts

    def __enter__(self) -> "_FailingYoutubeDL":
        return self

    def __exit__(self, *args: Any) -> None:
        pass

    def extract_info(self, url: str, download: bool = True) -> dict[str, Any]:
        raise RuntimeError("Private video unavailable")


@pytest.mark.asyncio
async def test_ingest_failure_writes_error_entry_and_last_error(
    async_client: httpx.AsyncClient, container: ServiceContainer
) -> None:
    job = (await async_client.post("/jobs", json={"youtube_url": "https://youtu.be/broken"})).json()["job"]
    job_id = job["job_id"]
    set_custom_ytdlp_factory(_FailingYoutubeDL)

    resp = await async_client.post(f"/jobs/{job_id}/ingest")
    assert resp.status_code == 500

    text = _read_error_log(job_id)
    assert "ERRO na etapa: ingest" in text
    assert "Private video unavailable" in text
    assert "Traceback:" in text
    assert "Tipo: " in text
    assert paths.job_error_log_path(job_id).parent == paths.job_logs_dir(job_id)

    payload = (await async_client.get(f"/jobs/{job_id}")).json()
    assert payload["status"] == "ERROR"
    assert payload["last_error"]["stage"] == "ingest"
    assert "Private video unavailable" in payload["last_error"]["message"]
    assert payload["last_error"]["at"]

    videos_job = container.jobs.load_job(job_id)
    assert "last_error" not in videos_job.model_dump()  # never persisted into job.json


def test_blocks_failure_and_second_failure_append_separate_entries(container: ServiceContainer) -> None:
    job = container.jobs.create_job("https://youtu.be/x", status=JobStatus.DOWNLOADED)
    with pytest.raises(ValueError):
        build_semantic_blocks(job.job_id, container=container)
    with pytest.raises(ValueError):
        build_semantic_blocks(job.job_id, container=container)

    text = _read_error_log(job.job_id)
    assert text.count("ERRO na etapa: blocks") == 2
    assert text.count("=" * 78) == 2
    assert "No transcription segments available" in text
    assert container.jobs.load_job(job.job_id).status == "ERROR"


@pytest.mark.asyncio
async def test_render_failure_writes_error_entry(container: ServiceContainer) -> None:
    job = container.jobs.create_job("https://youtu.be/r", status=JobStatus.WAITING_APPROVAL)
    service = RenderingService(container=container)
    with pytest.raises(FileNotFoundError):
        await service.render_job(job.job_id, watermark=False)

    text = _read_error_log(job.job_id)
    assert "ERRO na etapa: render" in text
    assert "Source video not found for job" in text


def test_cancellation_is_not_an_error(container: ServiceContainer) -> None:
    job = container.jobs.create_job("https://youtu.be/c")
    container.runtime.log_exception(job.job_id, "transcription", OperationCancelledError(job.job_id, "transcription"))
    assert not paths.job_error_log_path(job.job_id).exists()
    assert not paths.job_last_error_path(job.job_id).exists()


def test_diagnostic_details_and_dedup_of_wrapped_exception(container: ServiceContainer) -> None:
    job = container.jobs.create_job("https://youtu.be/d")

    class _Diag(RuntimeError):
        def diagnostic(self) -> str:
            return "finish_reason=length; raw=<cut>"

    inner = _Diag("LLM output truncated")
    container.runtime.log_exception(job.job_id, "analysis", inner)
    # The orchestrator logs the same failure again (possibly re-wrapped): still one entry.
    try:
        raise RuntimeError("Pipeline wrapper") from inner
    except RuntimeError as wrapped:
        container.runtime.log_exception(job.job_id, "orchestrator", wrapped)
    container.runtime.log_exception(job.job_id, "batch", inner)

    text = _read_error_log(job.job_id)
    assert text.count("ERRO na etapa:") == 1
    assert "ERRO na etapa: analysis" in text
    assert "Diagnóstico:" in text and "finish_reason=length" in text


@pytest.mark.asyncio
async def test_logging_failure_never_masks_the_real_error(
    async_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    job = (await async_client.post("/jobs", json={"youtube_url": "https://youtu.be/m"})).json()["job"]
    set_custom_ytdlp_factory(_FailingYoutubeDL)

    def _boom(job_id: str) -> Path:
        raise OSError("disk full")

    monkeypatch.setattr(paths, "job_error_log_path", _boom)
    resp = await async_client.post(f"/jobs/{job['job_id']}/ingest")
    assert resp.status_code == 500
    assert "Private video unavailable" in resp.json()["detail"]


def test_last_error_cleared_when_job_leaves_error(container: ServiceContainer) -> None:
    job = container.jobs.create_job("https://youtu.be/l")
    container.runtime.log_exception(job.job_id, "ingest", RuntimeError("boom"))
    container.jobs.update_job_status(job.job_id, JobStatus.ERROR)
    assert paths.job_last_error_path(job.job_id).exists()

    container.jobs.update_job_status(job.job_id, JobStatus.DOWNLOADING)  # a new run starts
    assert not paths.job_last_error_path(job.job_id).exists()
    assert paths.job_error_log_path(job.job_id).exists()  # history stays


@pytest.mark.asyncio
async def test_last_error_present_in_videos_listing_only_in_error(
    async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path
) -> None:
    base = Path(container.load_settings().media.base_dir)
    vdir = base / "Video A"
    vdir.mkdir(parents=True)
    video = vdir / "video.mp4"
    video.write_bytes(b"x")
    job = container.jobs.create_job(
        "[Local Video] Video A", status=JobStatus.DOWNLOADED, source_video_path=str(video), video_name="Video A"
    )
    container.runtime.log_exception(job.job_id, "transcription", RuntimeError("whisper died"))
    container.jobs.update_job_status(job.job_id, JobStatus.ERROR)

    items = (await async_client.get("/videos")).json()
    mine = next(i for i in items if i["job_id"] == job.job_id)
    assert mine["job"]["last_error"]["stage"] == "transcription"
    assert "whisper died" in mine["job"]["last_error"]["message"]


@pytest.mark.asyncio
async def test_open_logs_folder_selects_error_file(
    async_client: httpx.AsyncClient, container: ServiceContainer
) -> None:
    job = container.jobs.create_job("https://youtu.be/o")
    container.runtime.log_exception(job.job_id, "ingest", RuntimeError("boom"))
    calls: list[tuple[str, Path]] = []
    container.folder_opener = lambda p, roots=None: (calls.append(("file", Path(p))) or {"ok": True})
    container.dir_opener = lambda p, roots=None: (calls.append(("dir", Path(p))) or {"ok": True})

    resp = await async_client.post(f"/jobs/{job.job_id}/logs/open-folder")
    assert resp.status_code == 200
    assert resp.json() == {"ok": True}
    assert calls == [("file", paths.job_error_log_path(job.job_id))]


@pytest.mark.asyncio
async def test_open_logs_folder_creates_missing_folder_and_opens_it(
    async_client: httpx.AsyncClient, container: ServiceContainer
) -> None:
    job = container.jobs.create_job("https://youtu.be/n")
    assert not paths.job_logs_dir(job.job_id).exists()
    calls: list[tuple[str, Path]] = []
    container.dir_opener = lambda p, roots=None: (calls.append(("dir", Path(p))) or {"ok": True})

    resp = await async_client.post(f"/jobs/{job.job_id}/logs/open-folder")
    assert resp.status_code == 200
    assert paths.job_logs_dir(job.job_id).is_dir()
    assert calls == [("dir", paths.job_logs_dir(job.job_id))]


@pytest.mark.asyncio
async def test_open_logs_folder_unknown_job_and_traversal_rejected(
    async_client: httpx.AsyncClient, container: ServiceContainer
) -> None:
    calls: list[Path] = []
    container.folder_opener = lambda p, roots=None: (calls.append(Path(p)) or {"ok": True})
    container.dir_opener = lambda p, roots=None: (calls.append(Path(p)) or {"ok": True})

    missing = await async_client.post("/jobs/doesnotexist/logs/open-folder")
    assert missing.status_code == 404

    for bad in ("..", "%2e%2e%2f..", "a%2Fb", "..%5C..", "x" * 200):
        resp = await async_client.post(f"/jobs/{bad}/logs/open-folder")
        assert resp.status_code in (400, 404), bad
    assert calls == []


@pytest.mark.asyncio
async def test_open_logs_folder_is_local_only(container: ServiceContainer) -> None:
    from app.main import create_app

    job = container.jobs.create_job("https://youtu.be/lo")
    app = create_app()
    transport = httpx.ASGITransport(app=app, client=("203.0.113.9", 5000))
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as remote:
        resp = await remote.post(f"/jobs/{job.job_id}/logs/open-folder")
    assert resp.status_code == 403
