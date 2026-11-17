"""Isolated `.venv-dubbing-*` environment manager, preflight checker, and resumable weight downloader.

Architecture:
- Base venv (`.venv-dubbing-base`): Python 3.11+ with PyTorch `cu128` (RTX 5070 `sm_120`),
  `audio-separator` (Demucs), `sherpa-onnx` (CPU diarization), `huggingface-hub`, `soundfile`, `librosa`.
- Isolated engine sub-venvs (`.venv-qwen3` / `.venv-chatterbox`): created ONLY on demand
  for the active engine, linked via `dubbing_base.pth` appending `.venv-dubbing-base`
  site-packages at the **end** of `sys.path` (zero duplication of 6.5 GB PyTorch!).
- Dedicated `_download_lock` (`asyncio.Lock`) — NEVER holds `IOQueue` or `GPUMutex`.
"""

from __future__ import annotations

import asyncio
import inspect
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Awaitable, Callable

from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.core.paths import (
    dubbing_base_venv_dir,
    dubbing_engine_venv_dir,
    dubbing_hf_cache_dir,
    dubbing_sep_cache_dir,
    dubbing_sherpa_cache_dir,
    models_root_dir,
)

CommandRunner = Callable[..., Awaitable[Any]]

_download_lock = asyncio.Lock()

VALID_DUBBING_ENGINES = ("qwen3_tts", "chatterbox")

QWEN3_TTS_REPO = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
CHATTERBOX_REPO = "ResembleAI/chatterbox"
CHATTERBOX_ALLOW_PATTERNS: list[str] = [
    "ve.pt",
    "t3_mtl23ls_v2.safetensors",
    "s3gen.pt",
    "grapheme_mtl_merged_expanded_v1.json",
    "conds.pt",
    "*.json",
]

SHERPA_SEG_TARBALL_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/"
    "sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
)
SHERPA_EMB_ONNX_URL = (
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/"
    "3dspeaker_speech_eres2net_base_sv_zh-cn_3dspeaker_16k.onnx"
)

PYTORCH_CU128_INDEX_URL = "https://download.pytorch.org/whl/cu128"

ESTIMATED_DOWNLOAD_GB: dict[str, float] = {
    "venv_base": 3.5,
    "venv_qwen3": 0.4,
    "venv_chatterbox": 0.4,
    "qwen3_tts": 3.6,
    "chatterbox": 3.5,
    "demucs": 0.35,
    "sherpa_onnx": 0.05,
}


def normalize_dubbing_engine(engine: str | None) -> str:
    val = (engine or "qwen3_tts").strip().lower()
    if val in ("qwen", "qwen3", "qwen3_tts", "qwen3-tts"):
        return "qwen3_tts"
    if val in ("chatterbox", "chatterbox_tts", "chatterbox-tts"):
        return "chatterbox"
    raise ValueError(f"Unsupported dubbing engine: {engine}")


def venv_python_path(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Scripts" / "python.exe"
    return venv_dir / "bin" / "python"


def venv_site_packages_dir(venv_dir: Path) -> Path:
    if os.name == "nt":
        return venv_dir / "Lib" / "site-packages"
    lib_dir = venv_dir / "lib"
    if lib_dir.is_dir():
        for child in sorted(lib_dir.iterdir()):
            if child.is_dir() and child.name.startswith("python"):
                sp = child / "site-packages"
                if sp.exists():
                    return sp
    return lib_dir / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages"


def is_venv_installed(venv_dir: Path) -> bool:
    py = venv_python_path(venv_dir)
    if not py.is_file():
        return False
    if (venv_dir / ".install_incomplete").exists():
        return False
    return True


def _hf_repo_dir(hf_cache_dir: Path, repo_id: str) -> Path:
    folder = f"models--{repo_id.replace('/', '--')}"
    hub_candidate = hf_cache_dir / "hub" / folder
    if hub_candidate.exists():
        return hub_candidate
    direct_candidate = hf_cache_dir / folder
    if direct_candidate.exists():
        return direct_candidate
    return hub_candidate


def _has_incomplete_blobs(repo_dir: Path) -> bool:
    blobs_dir = repo_dir / "blobs"
    if not blobs_dir.is_dir():
        return False
    return any(p.name.endswith(".incomplete") for p in blobs_dir.iterdir() if p.is_file())


def is_engine_weights_cached(engine: str, hf_cache_dir: Path | None = None) -> bool:
    normalized = normalize_dubbing_engine(engine)
    cache_dir = hf_cache_dir or dubbing_hf_cache_dir(create=False)

    if normalized == "qwen3_tts":
        repo_dir = _hf_repo_dir(cache_dir, QWEN3_TTS_REPO)
        snaps_dir = repo_dir / "snapshots"
        if not snaps_dir.is_dir() or _has_incomplete_blobs(repo_dir):
            return False
        for snap in snaps_dir.iterdir():
            if not snap.is_dir():
                continue
            has_cfg = (snap / "config.json").is_file()
            has_weights = any(
                f.is_file() and f.stat().st_size > 0 and f.suffix.lower() in {".safetensors", ".bin", ".pt"}
                for f in snap.rglob("*")
            )
            if has_cfg and has_weights:
                return True
        return False

    repo_dir = _hf_repo_dir(cache_dir, CHATTERBOX_REPO)
    snaps_dir = repo_dir / "snapshots"
    if not snaps_dir.is_dir() or _has_incomplete_blobs(repo_dir):
        return False
    required_files = ("ve.pt", "t3_mtl23ls_v2.safetensors", "s3gen.pt")
    for snap in snaps_dir.iterdir():
        if not snap.is_dir():
            continue
        if all((snap / fname).is_file() and (snap / fname).stat().st_size > 0 for fname in required_files):
            return True
    return False


def is_demucs_weights_cached(sep_cache_dir: Path | None = None) -> bool:
    cache_dir = sep_cache_dir or dubbing_sep_cache_dir(create=False)
    if not cache_dir.is_dir():
        return False
    if any(p.name.endswith(".incomplete") for p in cache_dir.rglob("*") if p.is_file()):
        return False
    has_weights = any(
        p.is_file()
        and p.stat().st_size > 0
        and p.suffix.lower() in {".th", ".ckpt", ".pt", ".onnx", ".safetensors"}
        for p in cache_dir.rglob("*")
    )
    if has_weights:
        return True
    return (cache_dir / ".demucs_ready").is_file()


def is_sherpa_weights_cached(sherpa_cache_dir: Path | None = None) -> bool:
    cache_dir = sherpa_cache_dir or dubbing_sherpa_cache_dir(create=False)
    if not cache_dir.is_dir():
        return False
    if any(p.name.endswith(".incomplete") for p in cache_dir.rglob("*") if p.is_file()):
        return False
    onnx_files = [
        p for p in cache_dir.rglob("*.onnx") if p.is_file() and p.stat().st_size > 0
    ]
    has_seg = any("segment" in str(p).lower() or "pyannote" in str(p).lower() for p in onnx_files)
    has_emb = any(
        "embed" in str(p).lower() or "3dspeaker" in str(p).lower() or "speakernet" in str(p).lower()
        for p in onnx_files
    )
    return has_seg and has_emb


def _existing_disk_probe_path(target_dir: Path) -> Path:
    cur = target_dir
    while not cur.exists() and cur != cur.parent:
        cur = cur.parent
    return cur


def check_dubbing_preflight(engine: str = "qwen3_tts", target_dir: Path | None = None) -> dict[str, Any]:
    """Check isolated venvs, active engine weights, Demucs, sherpa-onnx, and free disk space."""
    normalized = normalize_dubbing_engine(engine)
    base_venv = dubbing_base_venv_dir()
    engine_venv = dubbing_engine_venv_dir(normalized)
    hf_cache = dubbing_hf_cache_dir(create=False)
    sep_cache = dubbing_sep_cache_dir(create=False)
    sherpa_cache = dubbing_sherpa_cache_dir(create=False)

    missing: list[dict[str, Any]] = []

    if not is_venv_installed(base_venv):
        missing.append(
            {
                "id": "venv_base",
                "label": "Ambiente base PyTorch CUDA 12.8 (.venv-dubbing-base)",
                "category": "venv",
                "estimated_gb": ESTIMATED_DOWNLOAD_GB["venv_base"],
                "path": str(base_venv),
            }
        )

    engine_venv_key = "venv_qwen3" if normalized == "qwen3_tts" else "venv_chatterbox"
    if not is_venv_installed(engine_venv):
        missing.append(
            {
                "id": engine_venv_key,
                "label": f"Sub-ambiente TTS ({engine_venv.name})",
                "category": "venv",
                "estimated_gb": ESTIMATED_DOWNLOAD_GB[engine_venv_key],
                "path": str(engine_venv),
            }
        )

    if not is_engine_weights_cached(normalized, hf_cache):
        label = (
            "Qwen3-TTS-12Hz-1.7B-Base (pesos)"
            if normalized == "qwen3_tts"
            else "Chatterbox Multilingual TTS (pesos)"
        )
        missing.append(
            {
                "id": normalized,
                "label": label,
                "category": "model",
                "estimated_gb": ESTIMATED_DOWNLOAD_GB[normalized],
                "path": str(hf_cache),
            }
        )

    if not is_demucs_weights_cached(sep_cache):
        missing.append(
            {
                "id": "demucs",
                "label": "Demucs (htdemucs_ft)",
                "category": "model",
                "estimated_gb": ESTIMATED_DOWNLOAD_GB["demucs"],
                "path": str(sep_cache),
            }
        )

    if not is_sherpa_weights_cached(sherpa_cache):
        missing.append(
            {
                "id": "sherpa_onnx",
                "label": "sherpa-onnx Diarizer (ONNX CPU)",
                "category": "model",
                "estimated_gb": ESTIMATED_DOWNLOAD_GB["sherpa_onnx"],
                "path": str(sherpa_cache),
            }
        )

    total_download_gb = round(sum(float(item["estimated_gb"]) for item in missing), 2)
    probe_dir = _existing_disk_probe_path(target_dir or models_root_dir(create=False))
    usage = shutil.disk_usage(str(probe_dir))
    free_disk_gb = round(float(usage.free) / (1024.0**3), 2)
    required_gb = total_download_gb + (0.5 if total_download_gb > 0 else 0.0)
    disk_sufficient = free_disk_gb >= required_gb

    return {
        "ready": len(missing) == 0,
        "engine": normalized,
        "missing": missing,
        "total_download_gb": total_download_gb,
        "free_disk_gb": free_disk_gb,
        "disk_sufficient": disk_sufficient,
        "paths": {
            "base_venv": str(base_venv),
            "engine_venv": str(engine_venv),
            "hf_cache": str(hf_cache),
            "sep_cache": str(sep_cache),
            "sherpa_cache": str(sherpa_cache),
        },
    }


async def _notify_progress(
    on_progress: Callable[..., Any] | None,
    message: str,
    percent: float | None = None,
) -> None:
    if on_progress is None:
        return
    try:
        sig = inspect.signature(on_progress)
        pos_params = [
            p
            for p in sig.parameters.values()
            if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
        ]
        has_varargs = any(p.kind == p.VAR_POSITIONAL for p in sig.parameters.values())
        if len(pos_params) >= 2 and not has_varargs:
            res = on_progress(0.0 if percent is None else float(percent), message)
        else:
            res = on_progress(message)
        if inspect.isawaitable(res):
            await res
    except Exception:
        res = on_progress(message)
        if inspect.isawaitable(res):
            await res


def _build_hf_env(hf_cache_dir: Path) -> dict[str, str]:
    env = os.environ.copy()
    env["HF_HOME"] = str(hf_cache_dir)
    env["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    env["PYTHONUNBUFFERED"] = "1"
    return env


async def _invoke_command_runner(
    runner: CommandRunner,
    cmd: list[str],
    env: dict[str, str],
    cancel_token: CancelToken | None,
) -> int:
    sig = inspect.signature(runner)
    pos_params = [
        p
        for p in sig.parameters.values()
        if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD)
    ]
    has_varargs = any(p.kind == p.VAR_POSITIONAL for p in sig.parameters.values())
    if has_varargs or len(pos_params) >= 3:
        res = runner(cmd, env, cancel_token)
    elif len(pos_params) == 2:
        res = runner(cmd, cancel_token)
    else:
        res = runner(cmd)
    if inspect.isawaitable(res):
        res = await res
    if isinstance(res, dict):
        if not res.get("ok", True) and res.get("returncode", 0) == 0:
            return 1
        return int(res.get("returncode", 0))
    return int(res)


async def _exec_install_command(
    cmd: list[str],
    *,
    env: dict[str, str],
    cancel_token: CancelToken | None = None,
    command_runner: CommandRunner | None = None,
    container: ServiceContainer | None = None,
) -> None:
    if cancel_token and cancel_token.is_set():
        raise OperationCancelledError(cancel_token.job_id, cancel_token.task)

    active_container = container or get_container()
    runner = command_runner or getattr(active_container, "dubbing_command_runner", None)
    if runner is not None:
        rc = await _invoke_command_runner(runner, cmd, env, cancel_token)
        if cancel_token and cancel_token.is_set():
            raise OperationCancelledError(cancel_token.job_id, cancel_token.task)
        if rc != 0:
            raise RuntimeError(f"Command failed ({rc}): {' '.join(cmd)}")
        return

    try:
        proc = await asyncio.create_subprocess_exec(
            cmd[0],
            *cmd[1:],
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            env=env,
        )
        if cancel_token is not None:
            cancel_token.on_cancel(lambda: active_container.runtime.kill_process_tree(proc.pid))
        stdout_b, _ = await proc.communicate()
        rc = int(proc.returncode if proc.returncode is not None else 1)
        output = stdout_b.decode("utf-8", errors="replace") if stdout_b else ""
    except NotImplementedError:
        def _sync_run() -> tuple[int, str]:
            p = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                env=env,
            )
            if cancel_token is not None:
                cancel_token.on_cancel(lambda: active_container.runtime.kill_process_tree(p.pid))
            out, _ = p.communicate()
            return int(p.returncode), out or ""

        rc, output = await asyncio.to_thread(_sync_run)

    if cancel_token and cancel_token.is_set():
        raise OperationCancelledError(cancel_token.job_id, cancel_token.task)

    if rc != 0:
        tail = " | ".join(output.strip().splitlines()[-5:]) if output.strip() else ""
        raise RuntimeError(f"Command failed ({rc}): {' '.join(cmd[:4])} {tail}".strip())


def _write_dubbing_base_pth(base_venv: Path, engine_venv: Path) -> Path:
    """Create `dubbing_base.pth` in `engine_venv` pointing to `base_venv`'s site-packages."""
    engine_sp = venv_site_packages_dir(engine_venv)
    engine_sp.mkdir(parents=True, exist_ok=True)
    base_sp = venv_site_packages_dir(base_venv)
    pth_file = engine_sp / "dubbing_base.pth"
    pth_file.write_text(f"{base_sp}\n", encoding="utf-8")
    return pth_file


def _build_hf_download_script(repo_id: str, allow_patterns: list[str] | None = None) -> str:
    if allow_patterns:
        return (
            "from huggingface_hub import snapshot_download; "
            f"snapshot_download(repo_id={repo_id!r}, allow_patterns={allow_patterns!r})"
        )
    return (
        "from huggingface_hub import snapshot_download; "
        f"snapshot_download(repo_id={repo_id!r})"
    )


def _build_demucs_download_script(sep_cache_dir: Path) -> str:
    return (
        "from audio_separator.separator import Separator; "
        f"sep = Separator(model_file_dir={str(sep_cache_dir)!r}, output_format='FLAC'); "
        "sep.load_model(model_filename='htdemucs_ft.yaml')"
    )


def _build_sherpa_download_script(sherpa_cache_dir: Path) -> str:
    return (
        "import os, shutil, tarfile, urllib.request; "
        "from pathlib import Path; "
        f"dest = Path({str(sherpa_cache_dir)!r}); "
        "dest.mkdir(parents=True, exist_ok=True); "
        f"seg_url = {SHERPA_SEG_TARBALL_URL!r}; "
        f"emb_url = {SHERPA_EMB_ONNX_URL!r}; "
        "seg_tmp = dest / 'seg.tar.bz2.incomplete'; "
        "seg_tar = dest / 'seg.tar.bz2'; "
        "urllib.request.urlretrieve(seg_url, seg_tmp); "
        "os.replace(seg_tmp, seg_tar); "
        "with tarfile.open(seg_tar, 'r:bz2') as tf: tf.extractall(dest); "
        "seg_tar.unlink(missing_ok=True); "
        "emb_tmp = dest / 'speaker_embedding.onnx.incomplete'; "
        "emb_out = dest / 'speaker_embedding.onnx'; "
        "urllib.request.urlretrieve(emb_url, emb_tmp); "
        "os.replace(emb_tmp, emb_out)"
    )


async def install_dubbing_dependencies(
    engine: str = "qwen3_tts",
    *,
    cancel_token: CancelToken | None = None,
    on_progress: Callable[..., Any] | None = None,
    command_runner: CommandRunner | None = None,
    container: ServiceContainer | None = None,
) -> dict[str, Any]:
    """Install isolated dubbing venvs and download active-engine + Demucs + sherpa-onnx weights.

    Serializes under dedicated `_download_lock` (never holds `IOQueue` or `GPUMutex`).
    Preserves HuggingFace `.incomplete` blobs on cancel/timeout for seamless resume.
    """
    normalized = normalize_dubbing_engine(engine)
    if cancel_token and cancel_token.is_set():
        raise OperationCancelledError(cancel_token.job_id, cancel_token.task)

    if _download_lock.locked():
        await _notify_progress(on_progress, "Aguardando download em andamento...", 2.0)

    async with _download_lock:
        if cancel_token and cancel_token.is_set():
            raise OperationCancelledError(cancel_token.job_id, cancel_token.task)

        active_container = container or get_container()
        runner = command_runner or getattr(active_container, "dubbing_command_runner", None)

        preflight = check_dubbing_preflight(normalized)
        if not preflight["disk_sufficient"] and runner is None:
            raise RuntimeError(
                f"Espaço em disco insuficiente ({preflight['free_disk_gb']:.1f} GB livres, "
                f"necessário ~{preflight['total_download_gb']:.1f} GB)."
            )

        base_venv = dubbing_base_venv_dir()
        engine_venv = dubbing_engine_venv_dir(normalized)
        hf_cache = dubbing_hf_cache_dir(create=True)
        sep_cache = dubbing_sep_cache_dir(create=True)
        sherpa_cache = dubbing_sherpa_cache_dir(create=True)
        env = _build_hf_env(hf_cache)

        installed_steps: list[str] = []

        # 1. Base venv (.venv-dubbing-base)
        if not is_venv_installed(base_venv):
            await _notify_progress(on_progress, "Criando ambiente base de dublagem (PyTorch cu128)...", 10.0)
            base_venv.parent.mkdir(parents=True, exist_ok=True)
            await _exec_install_command(
                [sys.executable, "-m", "venv", str(base_venv)],
                env=env,
                cancel_token=cancel_token,
                command_runner=runner,
                container=active_container,
            )
            base_venv.mkdir(parents=True, exist_ok=True)
            marker = base_venv / ".install_incomplete"
            marker.write_text("installing\n", encoding="utf-8")

            base_py = str(venv_python_path(base_venv))
            await _exec_install_command(
                [base_py, "-m", "pip", "install", "--upgrade", "pip"],
                env=env,
                cancel_token=cancel_token,
                command_runner=runner,
                container=active_container,
            )
            await _notify_progress(on_progress, "Instalando PyTorch cu128 no ambiente base...", 20.0)
            await _exec_install_command(
                [
                    base_py,
                    "-m",
                    "pip",
                    "install",
                    "torch>=2.8.0",
                    "torchaudio>=2.8.0",
                    "--index-url",
                    PYTORCH_CU128_INDEX_URL,
                ],
                env=env,
                cancel_token=cancel_token,
                command_runner=runner,
                container=active_container,
            )
            await _notify_progress(on_progress, "Instalando Demucs, sherpa-onnx e dependências de áudio...", 35.0)
            await _exec_install_command(
                [
                    base_py,
                    "-m",
                    "pip",
                    "install",
                    "numpy>=1.26,<2",
                    "scipy",
                    "soundfile",
                    "librosa",
                    "audio-separator",
                    "sherpa-onnx",
                    "huggingface-hub",
                ],
                env=env,
                cancel_token=cancel_token,
                command_runner=runner,
                container=active_container,
            )
            marker.unlink(missing_ok=True)
            installed_steps.append("venv_base")

        # 2. Isolated Engine sub-venv (.venv-qwen3 OR .venv-chatterbox) with dubbing_base.pth
        if not is_venv_installed(engine_venv):
            await _notify_progress(on_progress, f"Criando sub-ambiente isolado ({engine_venv.name})...", 45.0)
            engine_venv.parent.mkdir(parents=True, exist_ok=True)
            await _exec_install_command(
                [sys.executable, "-m", "venv", str(engine_venv)],
                env=env,
                cancel_token=cancel_token,
                command_runner=runner,
                container=active_container,
            )
            engine_venv.mkdir(parents=True, exist_ok=True)
            eng_marker = engine_venv / ".install_incomplete"
            eng_marker.write_text("installing\n", encoding="utf-8")

            # Link .venv-dubbing-base site-packages at the END of sys.path via .pth
            _write_dubbing_base_pth(base_venv, engine_venv)

            engine_py = str(venv_python_path(engine_venv))
            await _exec_install_command(
                [engine_py, "-m", "pip", "install", "--upgrade", "pip"],
                env=env,
                cancel_token=cancel_token,
                command_runner=runner,
                container=active_container,
            )
            if normalized == "qwen3_tts":
                await _notify_progress(on_progress, "Instalando Qwen3-TTS no sub-ambiente isolado...", 55.0)
                await _exec_install_command(
                    [
                        engine_py,
                        "-m",
                        "pip",
                        "install",
                        "qwen-tts",
                        "transformers==4.57.3",
                        "tokenizers>=0.22,<0.23",
                        "accelerate==1.12.0",
                        "einops",
                    ],
                    env=env,
                    cancel_token=cancel_token,
                    command_runner=runner,
                    container=active_container,
                )
            else:
                await _notify_progress(on_progress, "Instalando Chatterbox TTS no sub-ambiente isolado...", 55.0)
                await _exec_install_command(
                    [
                        engine_py,
                        "-m",
                        "pip",
                        "install",
                        "chatterbox-tts",
                        "numpy>=1.26,<2",
                    ],
                    env=env,
                    cancel_token=cancel_token,
                    command_runner=runner,
                    container=active_container,
                )
            eng_marker.unlink(missing_ok=True)
            installed_steps.append(engine_venv.name)

        base_py = str(venv_python_path(base_venv))

        # 3. Engine HuggingFace weights (resumable, Chatterbox uses strict allow_patterns)
        if not is_engine_weights_cached(normalized, hf_cache):
            if normalized == "qwen3_tts":
                await _notify_progress(on_progress, "Baixando pesos Qwen3-TTS-12Hz-1.7B-Base (~3.6 GB)...", 65.0)
                hf_script = _build_hf_download_script(QWEN3_TTS_REPO, allow_patterns=None)
            else:
                await _notify_progress(
                    on_progress,
                    "Baixando pesos essenciais ResembleAI/chatterbox (~3.5 GB)...",
                    65.0,
                )
                hf_script = _build_hf_download_script(
                    CHATTERBOX_REPO,
                    allow_patterns=CHATTERBOX_ALLOW_PATTERNS,
                )
            await _exec_install_command(
                [base_py, "-c", hf_script],
                env=env,
                cancel_token=cancel_token,
                command_runner=runner,
                container=active_container,
            )
            installed_steps.append(normalized)

        # 4. Demucs weights (htdemucs_ft)
        if not is_demucs_weights_cached(sep_cache):
            await _notify_progress(on_progress, "Baixando pesos Demucs (htdemucs_ft)...", 82.0)
            await _exec_install_command(
                [base_py, "-c", _build_demucs_download_script(sep_cache)],
                env=env,
                cancel_token=cancel_token,
                command_runner=runner,
                container=active_container,
            )
            installed_steps.append("demucs")

        # 5. sherpa-onnx diarization weights (ungated)
        if not is_sherpa_weights_cached(sherpa_cache):
            await _notify_progress(on_progress, "Baixando modelos sherpa-onnx de diarização...", 92.0)
            await _exec_install_command(
                [base_py, "-c", _build_sherpa_download_script(sherpa_cache)],
                env=env,
                cancel_token=cancel_token,
                command_runner=runner,
                container=active_container,
            )
            installed_steps.append("sherpa_onnx")

        await _notify_progress(on_progress, "Dependências e pesos de dublagem prontos.", 100.0)
        return {
            "ok": True,
            "engine": normalized,
            "installed": installed_steps,
            "preflight": check_dubbing_preflight(normalized),
        }
