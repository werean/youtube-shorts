"""100% mocked unit tests for dependency probing, WinGet/PATH discovery, command generation, and install/cancel flows."""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest

from app.api.routers import config as config_router
from app.application.runtime_service import CancelToken
from app.core import paths


def _create_fake_dist_info(site_packages: Path, name: str, version: str) -> None:
    dist_name = name.replace("-", "_")
    dist_info = site_packages / f"{dist_name}-{version}.dist-info"
    dist_info.mkdir(parents=True, exist_ok=True)
    (dist_info / "METADATA").write_text(
        f"Metadata-Version: 2.1\nName: {name}\nVersion: {version}\n",
        encoding="utf-8",
    )


def _create_fake_venv(repo_root: Path, py_version: str = "3.12.10") -> tuple[Path, Path, Path]:
    venv_dir = repo_root / "backend" / ".venv"
    venv_dir.mkdir(parents=True, exist_ok=True)
    (venv_dir / "pyvenv.cfg").write_text(
        f"home = C:\\Python312\ninclude-system-site-packages = false\nversion = {py_version}\n",
        encoding="utf-8",
    )
    if os.name == "nt":
        venv_py = venv_dir / "Scripts" / "python.exe"
        site_packages = venv_dir / "Lib" / "site-packages"
    else:
        venv_py = venv_dir / "bin" / "python"
        site_packages = venv_dir / "lib" / "python3.12" / "site-packages"
    venv_py.parent.mkdir(parents=True, exist_ok=True)
    venv_py.write_text("", encoding="utf-8")
    site_packages.mkdir(parents=True, exist_ok=True)
    return venv_dir, venv_py, site_packages


@pytest.fixture
def isolated_repo_root(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    repo_root = tmp_path / "repo"
    (repo_root / "backend").mkdir(parents=True, exist_ok=True)
    paths.set_project_root_override(repo_root)
    try:
        yield repo_root
    finally:
        paths.set_project_root_override(None)


# ---------------------------------------------------------------------------
# 1. Real Venv Distribution & Python Version Probing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_probe_dependencies_reads_real_venv_distributions_and_version(
    isolated_repo_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, _, site_packages = _create_fake_venv(isolated_repo_root, py_version="3.12.10")
    _create_fake_dist_info(site_packages, "faster-whisper", "1.1.1")
    _create_fake_dist_info(site_packages, "yt-dlp", "2025.03.21")
    _create_fake_dist_info(site_packages, "torch", "2.11.0+cu128")

    monkeypatch.setattr(config_router.shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(config_router, "_find_ffmpeg_executable", lambda: None)

    probed = await config_router._default_probe_dependencies()
    deps = probed["dependencies"]

    assert deps["python"] == {"installed": True, "version": "3.12.10"}
    assert deps["whisper"] == {"installed": True, "version": "1.1.1"}
    assert deps["ytdlp"] == {"installed": True, "version": "2025.03.21"}
    assert deps["pytorch"] == {"installed": True, "version": "2.11.0+cu128"}
    assert deps["ffmpeg"] == {"installed": False, "version": None}
    assert deps["cuda"] == {"installed": False, "version": None}
    assert deps["ollama"] == {"installed": False, "version": None}


@pytest.mark.asyncio
async def test_probe_whisper_ignores_openai_whisper_only(
    isolated_repo_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, _, site_packages = _create_fake_venv(isolated_repo_root, py_version="3.12.9")
    _create_fake_dist_info(site_packages, "openai-whisper", "20240930")

    monkeypatch.setattr(config_router.shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(config_router, "_find_ffmpeg_executable", lambda: None)

    probed = await config_router._default_probe_dependencies()
    assert probed["dependencies"]["whisper"] == {"installed": False, "version": None}


def test_read_venv_python_version_falls_back_to_venv_executable(
    isolated_repo_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    venv_dir, venv_py, _ = _create_fake_venv(isolated_repo_root, py_version="3.12.10")
    # Remove version from pyvenv.cfg to force fallback query on venv_py
    (venv_dir / "pyvenv.cfg").write_text("include-system-site-packages = false\n", encoding="utf-8")

    called_cmds: list[list[str]] = []

    def fake_run(cmd: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        called_cmds.append(cmd)
        return subprocess.CompletedProcess(cmd, 0, stdout="3.12.8\n", stderr="")

    monkeypatch.setattr(config_router.subprocess, "run", fake_run)
    ver = config_router._read_venv_python_version(venv_dir, venv_py)
    assert ver == "3.12.8"
    assert called_cmds and called_cmds[0][0] == str(venv_py)


# ---------------------------------------------------------------------------
# 2. Compatible Python Selection & Venv Creation
# ---------------------------------------------------------------------------


def test_ensure_project_venv_prefers_py_312_then_313_then_311(
    isolated_repo_root: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    py313_exe = tmp_path / "Python313" / "python.exe"
    py313_exe.parent.mkdir(parents=True, exist_ok=True)
    py313_exe.write_text("", encoding="utf-8")

    monkeypatch.setattr(config_router.shutil, "which", lambda name: "C:\\Windows\\py.exe" if name == "py" else None)

    recorded_cmds: list[list[str]] = []

    def fake_run(cmd: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        recorded_cmds.append(cmd)
        if cmd[:2] == ["C:\\Windows\\py.exe", "-3.12"]:
            return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="not installed")
        if cmd[:2] == ["C:\\Windows\\py.exe", "-3.13"]:
            return subprocess.CompletedProcess(cmd, 0, stdout=f"{py313_exe}\n", stderr="")
        if "-m" in cmd and "venv" in cmd:
            venv_py = config_router._project_venv_python()
            venv_py.parent.mkdir(parents=True, exist_ok=True)
            venv_py.write_text("", encoding="utf-8")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="")

    monkeypatch.setattr(config_router.subprocess, "run", fake_run)
    result = config_router._ensure_project_venv_sync()

    assert result == config_router._project_venv_python()
    venv_calls = [c for c in recorded_cmds if "-m" in c and "venv" in c]
    assert venv_calls == [[str(py313_exe), "-m", "venv", str(isolated_repo_root / "backend" / ".venv")]]


def test_ensure_project_venv_falls_back_to_which_and_sys_executable(
    isolated_repo_root: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    py312_exe = tmp_path / "bin" / "python3.12"
    py312_exe.parent.mkdir(parents=True, exist_ok=True)
    py312_exe.write_text("", encoding="utf-8")

    monkeypatch.setattr(
        config_router.shutil,
        "which",
        lambda name: str(py312_exe) if name == "python3.12" else None,
    )

    recorded_cmds: list[list[str]] = []

    def fake_run(cmd: list[str], **_kwargs: Any) -> subprocess.CompletedProcess[str]:
        recorded_cmds.append(cmd)
        if cmd[0] == str(py312_exe) and cmd[1] == "-c":
            return subprocess.CompletedProcess(cmd, 0, stdout="3.12\n", stderr="")
        if "-m" in cmd and "venv" in cmd:
            venv_py = config_router._project_venv_python()
            venv_py.parent.mkdir(parents=True, exist_ok=True)
            venv_py.write_text("", encoding="utf-8")
            return subprocess.CompletedProcess(cmd, 0, stdout="", stderr="")
        return subprocess.CompletedProcess(cmd, 1, stdout="", stderr="")

    monkeypatch.setattr(config_router.subprocess, "run", fake_run)
    result = config_router._ensure_project_venv_sync()
    assert result == config_router._project_venv_python()
    assert any(c[:3] == [str(py312_exe), "-m", "venv"] for c in recorded_cmds)

    # Now verify fallback to sys.executable when nothing compatible exists
    monkeypatch.setattr(config_router.shutil, "which", lambda _name: None)
    monkeypatch.setattr(config_router.os, "name", "posix")
    assert config_router._find_compatible_python_executable() == sys.executable


# ---------------------------------------------------------------------------
# 3. FFmpeg WinGet / Registry Path Discovery
# ---------------------------------------------------------------------------


def test_find_ffmpeg_discovers_winget_package_and_updates_path(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    local_app = tmp_path / "LocalAppData"
    pkg_bin = (
        local_app
        / "Microsoft"
        / "WinGet"
        / "Packages"
        / "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe"
        / "ffmpeg-7.1-essentials_build"
        / "bin"
    )
    pkg_bin.mkdir(parents=True, exist_ok=True)
    ffmpeg_exe = pkg_bin / "ffmpeg.exe"
    ffmpeg_exe.write_text("", encoding="utf-8")

    monkeypatch.setenv("LOCALAPPDATA", str(local_app))
    monkeypatch.setenv("ProgramFiles", str(tmp_path / "ProgramFiles"))
    monkeypatch.setenv("PATH", r"C:\Windows\System32")
    monkeypatch.setattr(config_router.os, "name", "nt")
    monkeypatch.setattr(config_router.shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(config_router, "_refresh_windows_path_from_registry", lambda: None)

    found = config_router._find_ffmpeg_executable()
    assert found == str(ffmpeg_exe)
    assert str(pkg_bin) in os.environ["PATH"].split(os.pathsep)


def test_find_ffmpeg_discovers_winget_links_and_registry_refresh(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    local_app = tmp_path / "LocalAppData"
    links_dir = local_app / "Microsoft" / "WinGet" / "Links"
    links_dir.mkdir(parents=True, exist_ok=True)
    link_ffmpeg = links_dir / "ffmpeg.exe"
    link_ffmpeg.write_text("", encoding="utf-8")

    monkeypatch.setenv("LOCALAPPDATA", str(local_app))
    monkeypatch.setenv("ProgramFiles", str(tmp_path / "ProgramFiles"))
    monkeypatch.setenv("PATH", r"C:\Windows\System32")
    monkeypatch.setattr(config_router.os, "name", "nt")

    # Case 1: WinGet Links directory fallback
    monkeypatch.setattr(config_router.shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(config_router, "_refresh_windows_path_from_registry", lambda: None)
    assert config_router._find_ffmpeg_executable() == str(link_ffmpeg)
    assert str(links_dir) in os.environ["PATH"].split(os.pathsep)

    # Case 2: Registry PATH refresh populates PATH so second shutil.which succeeds
    refreshed = {"done": False}

    def fake_refresh() -> None:
        refreshed["done"] = True
        os.environ["PATH"] = os.environ["PATH"] + os.pathsep + r"C:\CustomFFmpeg\bin"

    def fake_which(cmd: str) -> str | None:
        if cmd == "ffmpeg" and refreshed["done"]:
            return r"C:\CustomFFmpeg\bin\ffmpeg.exe"
        return None

    monkeypatch.setattr(config_router, "_refresh_windows_path_from_registry", fake_refresh)
    monkeypatch.setattr(config_router.shutil, "which", fake_which)
    assert config_router._find_ffmpeg_executable() == r"C:\CustomFFmpeg\bin\ffmpeg.exe"


# ---------------------------------------------------------------------------
# 4. Command Generation & Manual-Only Dependencies
# ---------------------------------------------------------------------------


def test_command_generation_for_all_automatic_dependencies(
    isolated_repo_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, venv_py, _ = _create_fake_venv(isolated_repo_root, py_version="3.12.10")
    monkeypatch.setattr(config_router.os, "name", "nt")

    # Python (winget, NOT choco)
    py_install = config_router._build_dependency_process_args("python", "install", ensure_venv=False)
    assert py_install == [
        "winget",
        "install",
        "--id",
        "Python.Python.3.12",
        "-e",
        "--accept-source-agreements",
        "--accept-package-agreements",
    ]
    assert config_router._build_dependency_process_args("python", "uninstall", ensure_venv=False) == [
        "winget",
        "uninstall",
        "--id",
        "Python.Python.3.12",
        "-e",
    ]
    py_term = config_router._get_terminal_command("python", "install", None)
    assert py_term is not None
    assert "winget install --id Python.Python.3.12" in py_term
    assert "choco" not in py_term

    # Whisper (faster-whisper only on install, both on uninstall)
    assert config_router._build_dependency_process_args("whisper", "install", ensure_venv=False) == [
        str(venv_py),
        "-m",
        "pip",
        "install",
        "-U",
        "faster-whisper",
    ]
    assert config_router._build_dependency_process_args("whisper", "uninstall", ensure_venv=False) == [
        str(venv_py),
        "-m",
        "pip",
        "uninstall",
        "-y",
        "faster-whisper",
        "openai-whisper",
    ]
    whisper_term = config_router._get_terminal_command("whisper", "install", None)
    assert whisper_term == f'"{venv_py}" -m pip install -U faster-whisper'
    assert "openai-whisper" not in whisper_term

    # yt-dlp
    assert config_router._build_dependency_process_args("ytdlp", "install", ensure_venv=False) == [
        str(venv_py),
        "-m",
        "pip",
        "install",
        "-U",
        "yt-dlp",
    ]
    assert config_router._build_dependency_process_args("ytdlp", "uninstall", ensure_venv=False) == [
        str(venv_py),
        "-m",
        "pip",
        "uninstall",
        "-y",
        "yt-dlp",
    ]

    # PyTorch (cu126 for rtx_4000_or_lower, cu128 for rtx_5000, None without tier)
    assert config_router._build_dependency_process_args("pytorch", "install", None, ensure_venv=False) is None
    assert config_router._get_terminal_command("pytorch", "install", None) is None

    pt_4000 = config_router._build_dependency_process_args("pytorch", "install", "rtx_4000_or_lower", ensure_venv=False)
    assert pt_4000 == [
        str(venv_py),
        "-m",
        "pip",
        "install",
        "torch",
        "torchvision",
        "torchaudio",
        "--index-url",
        "https://download.pytorch.org/whl/cu126",
    ]
    pt_5000 = config_router._build_dependency_process_args("pytorch", "install", "rtx_5000", ensure_venv=False)
    assert pt_5000 == [
        str(venv_py),
        "-m",
        "pip",
        "install",
        "torch",
        "torchvision",
        "torchaudio",
        "--index-url",
        "https://download.pytorch.org/whl/cu128",
    ]
    assert "cu128" in (config_router._get_terminal_command("pytorch", "install", "rtx_5000") or "")
    assert "cu126" in (config_router._get_terminal_command("pytorch", "install", "rtx_4000_or_lower") or "")

    # FFmpeg
    assert config_router._build_dependency_process_args("ffmpeg", "install", ensure_venv=False) == [
        "winget",
        "install",
        "--id",
        "Gyan.FFmpeg",
        "-e",
        "--accept-source-agreements",
        "--accept-package-agreements",
    ]
    assert config_router._build_dependency_process_args("ffmpeg", "uninstall", ensure_venv=False) == [
        "winget",
        "uninstall",
        "--id",
        "Gyan.FFmpeg",
        "-e",
    ]


@pytest.mark.asyncio
async def test_cuda_and_ollama_remain_manual_only(
    async_client: httpx.AsyncClient,
    isolated_repo_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(config_router.shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(config_router, "_find_ffmpeg_executable", lambda: None)

    for dep in ("cuda", "ollama"):
        assert "automatic" not in config_router.INSTALLATION_GUIDES[dep]
        assert config_router._build_dependency_process_args(dep, "install", ensure_venv=False) is None
        assert config_router._build_dependency_process_args(dep, "uninstall", ensure_venv=False) is None
        assert config_router._get_terminal_command(dep, "install", None) is None
        assert config_router._get_terminal_command(dep, "uninstall", None) is None

        resp = await async_client.post(f"/config/dependencies/{dep}/install", json={})
        assert resp.status_code == 400
        body = resp.json()
        assert body["success"] is False
        assert body["error"] == "Automatic installation not available for this dependency"


# ---------------------------------------------------------------------------
# 5. Subprocess Execution, Streaming Logs, Errors & Cancellation
# ---------------------------------------------------------------------------


class _FakeAsyncStdout:
    def __init__(self, lines: list[bytes]) -> None:
        self._lines = list(lines)

    async def readline(self) -> bytes:
        if self._lines:
            await asyncio.sleep(0)
            return self._lines.pop(0)
        return b""


class _FakeAsyncProcess:
    def __init__(self, lines: list[bytes], returncode: int = 0, hang: bool = False) -> None:
        self.stdout = _FakeAsyncStdout(lines)
        self.returncode: int | None = None
        self._final_rc = returncode
        self._hang = hang
        self.terminated = False
        self.killed = False

    async def wait(self) -> int:
        if self._hang and not (self.terminated or self.killed):
            await asyncio.sleep(5)
        if self.returncode is None:
            self.returncode = self._final_rc
        return self.returncode

    def terminate(self) -> None:
        self.terminated = True
        self.returncode = -15

    def kill(self) -> None:
        self.killed = True
        self.returncode = -9


@pytest.mark.asyncio
async def test_execute_install_and_uninstall_subprocess_success_and_failure(
    isolated_repo_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, _, site_packages = _create_fake_venv(isolated_repo_root, py_version="3.12.10")
    monkeypatch.setattr(config_router.shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(config_router, "_find_ffmpeg_executable", lambda: None)

    recorded_cmds: list[tuple[str, ...]] = []

    async def fake_exec(*cmd: str, **_kwargs: Any) -> _FakeAsyncProcess:
        recorded_cmds.append(cmd)
        if "install" in cmd and "faster-whisper" in cmd:
            _create_fake_dist_info(site_packages, "faster-whisper", "1.1.1")
            return _FakeAsyncProcess([b"Collecting faster-whisper\n", b"Successfully installed faster-whisper-1.1.1\n"], 0)
        return _FakeAsyncProcess([b"Some pip failure\n"], 1)

    monkeypatch.setattr(config_router.asyncio, "create_subprocess_exec", fake_exec)

    logs: list[str] = []
    status, payload = await config_router._execute_dependency_install("whisper", on_log=logs.append)
    assert status == 200
    assert payload["success"] is True
    assert payload["dependencies"]["whisper"] == {"installed": True, "version": "1.1.1"}
    assert any("Successfully installed faster-whisper-1.1.1" in line for line in logs)
    assert recorded_cmds[0][-1] == "faster-whisper"

    # Failure exit code returns 500
    fail_status, fail_payload = await config_router._execute_dependency_uninstall("whisper")
    assert fail_status == 500
    assert fail_payload["success"] is False
    assert "exit code 1" in fail_payload["message"]


@pytest.mark.asyncio
async def test_execute_install_missing_binary_returns_500(
    isolated_repo_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _create_fake_venv(isolated_repo_root, py_version="3.12.10")
    monkeypatch.setattr(config_router.os, "name", "nt")
    monkeypatch.setattr(config_router.shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(config_router, "_find_ffmpeg_executable", lambda: None)

    async def missing_exec(*_cmd: str, **_kwargs: Any) -> Any:
        raise FileNotFoundError("winget")

    monkeypatch.setattr(config_router.asyncio, "create_subprocess_exec", missing_exec)

    status, payload = await config_router._execute_dependency_install("ffmpeg")
    assert status == 500
    assert payload["success"] is False
    assert "Installer command not found" in payload["message"]


@pytest.mark.asyncio
async def test_run_dependency_command_cancellation_terminates_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_proc = _FakeAsyncProcess([b"Downloading...\n"], returncode=0, hang=True)

    async def hanging_exec(*_cmd: str, **_kwargs: Any) -> _FakeAsyncProcess:
        return fake_proc

    monkeypatch.setattr(config_router.asyncio, "create_subprocess_exec", hanging_exec)
    token = CancelToken(job_id="sess_1", task="dep_install")

    async def trigger_cancel() -> None:
        await asyncio.sleep(0.05)
        token.set()

    canceller = asyncio.create_task(trigger_cancel())
    rc, cancelled = await config_router._run_dependency_command(["winget", "install"], token=token)
    await canceller

    assert cancelled is True
    assert rc == -1
    assert fake_proc.terminated is True


@pytest.mark.asyncio
async def test_install_session_routes_end_to_end_with_mocked_subprocess(
    async_client: httpx.AsyncClient,
    isolated_repo_root: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _, _, site_packages = _create_fake_venv(isolated_repo_root, py_version="3.12.10")
    monkeypatch.setattr(config_router.shutil, "which", lambda _cmd: None)
    monkeypatch.setattr(config_router, "_find_ffmpeg_executable", lambda: None)

    async def fake_exec(*cmd: str, **_kwargs: Any) -> _FakeAsyncProcess:
        _create_fake_dist_info(site_packages, "yt-dlp", "2025.04.01")
        return _FakeAsyncProcess([b"Successfully installed yt-dlp-2025.04.01\n"], 0)

    monkeypatch.setattr(config_router.asyncio, "create_subprocess_exec", fake_exec)

    r_start = await async_client.post("/config/dependencies/ytdlp/install/start", json={})
    assert r_start.status_code == 202
    session_id = r_start.json()["sessionId"]

    for _ in range(30):
        r_status = await async_client.get(f"/config/dependencies/install-sessions/{session_id}")
        assert r_status.status_code == 200
        data = r_status.json()
        if data["status"] != "running":
            break
        await asyncio.sleep(0.02)

    assert data["status"] == "success"
    assert data["result"]["success"] is True
    assert data["result"]["dependencies"]["ytdlp"] == {"installed": True, "version": "2025.04.01"}
