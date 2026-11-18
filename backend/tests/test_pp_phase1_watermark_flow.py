"""Phase 1 integration: full watermark flow through the HTTP layer (ffmpeg mocked, no GPU, no network)."""

from __future__ import annotations

from pathlib import Path
from typing import Any
from unittest.mock import patch

import httpx
import pytest

from app.application.runtime_service import ServiceContainer
from app.domain.rendering.rendering_service import RenderingService

from tests.test_pp_phase1_watermark import (  # noqa: F401  (autouse fixture re-exported)
    _CapturingRunner,
    _make_job,
    _observations,
    _png_bytes,
    _stable_filter_flag,
)


async def _render_via_http(
    client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path, body: dict[str, Any] | None
) -> tuple[httpx.Response, _CapturingRunner]:
    job = _make_job(container, tmp_path)
    runner = _CapturingRunner()
    service = RenderingService(container=container, subprocess_runner=runner)

    original = service.render_job

    async def _render_job(job_id: str, **kwargs: Any) -> list[str]:
        return await original(job_id, synthetic_observations_provider=_observations, **kwargs)

    service.render_job = _render_job  # type: ignore[method-assign]
    with patch("app.api.routers.jobs_render.get_rendering_service", return_value=service):
        resp = await client.post(f"/jobs/{job.job_id}/render", **({"json": body} if body is not None else {}))
    return resp, runner


def _shape(runner: _CapturingRunner) -> list[str]:
    """The command with the per-job paths (script, output) masked."""
    cmd = list(runner.commands[0])
    cmd[cmd.index("-filter_complex_script") + 1] = "<SCRIPT>"
    cmd[-1] = "<OUT>"
    return [a if a != str(runner.commands[0][cmd.index("-i") + 1]) else "<SRC>" for a in cmd]


def _has_overlay(runner: _CapturingRunner) -> bool:
    cmd, script = runner.commands[0], runner.scripts[0]
    assert (cmd.count("-i") == 2) == ("overlay=x=" in script) == ("[1:v]" in script)
    return cmd.count("-i") == 2


@pytest.mark.asyncio
async def test_full_watermark_flow_over_http(
    async_client: httpx.AsyncClient, container: ServiceContainer, tmp_path: Path
) -> None:
    # Baseline: nothing configured.
    base_resp, base = await _render_via_http(async_client, container, tmp_path, None)
    assert base_resp.status_code == 200 and not _has_overlay(base)

    # Upload image: mode stays "never".
    up = await async_client.post(
        "/profiles/active/watermark/image", files={"file": ("logo.png", _png_bytes(), "image/png")}
    )
    assert up.status_code == 200 and up.json()["has_image"] is True and up.json()["mode"] == "never"
    assert (await async_client.get(up.json()["image_url"])).headers["content-type"] == "image/png"

    # Change appearance and mode.
    put = await async_client.put(
        "/profiles/active/watermark",
        json={"opacity": 0.5, "position": "bottom-left", "size_percent": 33, "mode": "always"},
    )
    assert put.status_code == 200
    got = (await async_client.get("/profiles/active/watermark")).json()
    assert (got["mode"], got["opacity"], got["position"], got["size_percent"]) == ("always", 0.5, "bottom-left", 33)

    # always, no field -> applied, with the configured appearance.
    resp, r = await _render_via_http(async_client, container, tmp_path, None)
    assert resp.status_code == 200 and _has_overlay(r)
    assert "colorchannelmixer=aa=0.50" in r.scripts[0] and "scale=w=356:h=268" in r.scripts[0]
    assert "overlay=x=44:y=H-h-44" in r.scripts[0]
    # always, explicit false -> overridden, identical to the baseline.
    resp, r = await _render_via_http(async_client, container, tmp_path, {"watermark": False})
    assert resp.status_code == 200 and not _has_overlay(r)
    assert _shape(r) == _shape(base)
    assert r.scripts[0] == base.scripts[0]

    # never, explicit true -> applied.
    assert (await async_client.put("/profiles/active/watermark", json={"mode": "never"})).status_code == 200
    resp, r = await _render_via_http(async_client, container, tmp_path, {"watermark": True})
    assert resp.status_code == 200 and _has_overlay(r)
    resp, r = await _render_via_http(async_client, container, tmp_path, None)
    assert not _has_overlay(r)

    # ask: no answer -> off; true -> on; false -> off.
    assert (await async_client.put("/profiles/active/watermark", json={"mode": "ask"})).status_code == 200
    resp, r = await _render_via_http(async_client, container, tmp_path, {})
    assert resp.status_code == 200 and not _has_overlay(r)
    resp, r = await _render_via_http(async_client, container, tmp_path, {"watermark": True})
    assert _has_overlay(r)
    resp, r = await _render_via_http(async_client, container, tmp_path, {"watermark": False})
    assert not _has_overlay(r)

    # Remove the image: mode back to "never", has_image false, requesting the mark is a 400 and nothing runs.
    rm = await async_client.delete("/profiles/active/watermark/image")
    assert rm.status_code == 200 and rm.json()["has_image"] is False and rm.json()["mode"] == "never"
    assert (await async_client.get("/profiles/active/watermark/image")).status_code == 404
    job = _make_job(container, tmp_path)
    miss = await async_client.post(f"/jobs/{job.job_id}/render", json={"watermark": True})
    assert miss.status_code == 400 and miss.json()["code"] == "watermark_missing"

    # Render again: identical to the no-watermark baseline (same script, same command shape).
    resp, after = await _render_via_http(async_client, container, tmp_path, None)
    assert resp.status_code == 200 and not _has_overlay(after)
    assert after.scripts[0] == base.scripts[0]
    assert _shape(after) == _shape(base)
