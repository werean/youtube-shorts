"""Shared pytest fixtures isolating all filesystem and external OS/HTTP state to tmp_path."""

from __future__ import annotations

import json
from pathlib import Path
from typing import AsyncIterator, Iterator

import httpx
import pytest
import pytest_asyncio

from app.application.runtime_service import (
    ServiceContainer,
    get_container,
    reset_container,
    set_container_override,
)
from app.core import paths, settings, tool_configs
from app.main import create_app


def _requested_schema(body: dict | None) -> dict:
    """Extract the JSON schema requested by an LM Studio or Ollama chat body."""
    body = body or {}
    rf = body.get("response_format")
    if isinstance(rf, dict):
        inner = rf.get("json_schema")
        if isinstance(inner, dict) and isinstance(inner.get("schema"), dict):
            return inner["schema"]
    fmt = body.get("format")
    if isinstance(fmt, dict):
        return fmt
    return {}


def _empty_valid_document(body: dict | None) -> dict:
    """Minimal document valid for the requested schema: every required array is empty."""
    schema = _requested_schema(body)
    props = schema.get("properties") or {}
    doc: dict = {}
    for key in schema.get("required") or list(props):
        ptype = (props.get(key) or {}).get("type")
        doc[key] = [] if ptype == "array" else {} if ptype == "object" else "" if ptype == "string" else 0
    return doc


@pytest.fixture(autouse=True)
def isolated_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Point all data/ and media base_dir paths to tmp_path so tests never touch real data/."""
    test_data_dir = tmp_path / "data"
    test_uploads_dir = tmp_path / "uploads"
    test_data_dir.mkdir(parents=True, exist_ok=True)
    test_uploads_dir.mkdir(parents=True, exist_ok=True)

    monkeypatch.setenv("YTS_DATA_DIR", str(test_data_dir))
    monkeypatch.setenv("YTS_MEDIA_BASE_DIR", str(test_uploads_dir))
    paths.set_data_dir_override(test_data_dir)
    settings.set_default_base_dir_override(test_uploads_dir)
    settings.invalidate_settings_cache()
    tool_configs.invalidate_tool_configs_cache()

    container = reset_container()

    # Default safe mocks for OS/network adapters in tests
    container.folder_picker = lambda: {"selected": True, "path": str(test_uploads_dir)}
    container.folder_opener = lambda file_path, allowed_roots=None: (
        {"ok": True}
        if Path(file_path).exists() and Path(file_path).is_file()
        else {"ok": False, "detail": "File not found", "status_code": 404}
    )
    container.terminal_opener = lambda command: {"success": True, "command": command}

    async def _fake_llm_fetcher(method: str, url: str, body: dict | None = None) -> tuple[int, dict]:
        if url.endswith("/v1/models") or url.endswith(":1234/models"):
            return 200, {"data": [{"id": "qwen2.5:14b"}]}
        if url.endswith("/api/tags"):
            return 200, {"models": [{"name": "qwen2.5:14b", "size": 9500000000}]}
        if url.endswith("/api/ps"):
            return 200, {"models": [{"name": "qwen2.5:14b"}]}
        if url.endswith("/chat/completions") or url.endswith("/api/chat"):
            content = json.dumps(_empty_valid_document(body))
            return 200, {"message": {"content": content}, "choices": [{"message": {"content": content}}]}
        return 404, {}

    async def _fake_ollama_cmd(args: list[str]) -> dict:
        return {"ok": True, "code": 0, "stdout": "success", "stderr": ""}

    container.llm_http_fetcher = _fake_llm_fetcher
    container.ollama_command_runner = _fake_ollama_cmd

    yield tmp_path

    set_container_override(None)
    paths.set_data_dir_override(None)
    settings.set_default_base_dir_override(None)
    settings.invalidate_settings_cache()
    tool_configs.invalidate_tool_configs_cache()


@pytest.fixture
def container() -> ServiceContainer:
    return get_container()


@pytest_asyncio.fixture
async def async_client() -> AsyncIterator[httpx.AsyncClient]:
    app = create_app()
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        yield client
