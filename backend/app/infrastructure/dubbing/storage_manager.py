"""Storage usage scanner and safe per-model cache cleanup (excluding LM Studio external dirs)."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from pathlib import Path
from typing import Any, Callable

from app.application.runtime_service import ServiceContainer, get_container
from app.core import paths as app_paths
from app.core.paths import (
    dubbing_base_venv_dir,
    dubbing_engine_venv_dir,
    dubbing_hf_cache_dir,
    dubbing_sep_cache_dir,
    dubbing_sherpa_cache_dir,
    is_hidden_or_internal_dir_name,
    jobs_dir,
    project_root,
    whisper_models_dir,
)
from app.core.settings import archived_videos_dir, load_settings
from app.infrastructure.dubbing.env_manager import (
    CHATTERBOX_REPO,
    QWEN3_TTS_REPO,
)
from app.models.domain import LmStudioModelStorageItem, ModelStorageItem, StorageUsageSummary

VALID_DELETABLE_MODEL_IDS = (
    "qwen3_tts",
    "chatterbox",
    "demucs",
    "sherpa_onnx",
    "whisper",
    "venv_base",
    "venv_qwen3",
    "venv_chatterbox",
)

DISPLAY_MODEL_IDS = VALID_DELETABLE_MODEL_IDS + ("venv_backend",)


class ModelInUseError(RuntimeError):
    """Raised when attempting to delete a model/venv while an active task uses it."""

    def __init__(self, model_id: str, active_tasks: list[str] | None = None) -> None:
        tasks_str = ", ".join(active_tasks or [])
        msg = f"Modelo '{model_id}' está em uso por tarefa(s) ativa(s): {tasks_str}" if tasks_str else f"Modelo '{model_id}' está em uso."
        super().__init__(msg)
        self.model_id = model_id
        self.active_tasks = active_tasks or []


def _path_size_bytes(path: Path, *, seen_inodes: set[tuple[int, int]] | None = None) -> int:
    """Recursively compute size in bytes without following symlinks or double-counting hardlinks."""
    if not path.exists():
        return 0
    inodes = seen_inodes if seen_inodes is not None else set()

    def _stat_unique_size(stat_res: os.stat_result) -> int:
        ino = int(getattr(stat_res, "st_ino", 0) or 0)
        dev = int(getattr(stat_res, "st_dev", 0) or 0)
        if ino > 0:
            key = (dev, ino)
            if key in inodes:
                return 0
            inodes.add(key)
        return int(stat_res.st_size)

    if path.is_file() or path.is_symlink():
        try:
            if path.is_symlink():
                return 0
            return _stat_unique_size(path.lstat())
        except OSError:
            return 0

    total = 0
    stack: list[Path] = [path]
    while stack:
        cur = stack.pop()
        try:
            with os.scandir(cur) as it:
                for entry in it:
                    try:
                        if entry.is_symlink():
                            continue
                        if entry.is_file(follow_symlinks=False):
                            total += _stat_unique_size(entry.stat(follow_symlinks=False))
                        elif entry.is_dir(follow_symlinks=False):
                            stack.append(Path(entry.path))
                    except OSError:
                        continue
        except OSError:
            continue
    return total


def _dedup_existing_paths(paths: list[Path]) -> list[Path]:
    seen: set[str] = set()
    out: list[Path] = []
    for p in paths:
        if not p.exists():
            continue
        key = os.path.normcase(os.path.normpath(str(p.resolve())))
        if key not in seen:
            seen.add(key)
            out.append(p)
    return out


def _legacy_cache_roots(legacy_hf_hub_dir: Path | None) -> tuple[Path, Path | None, Path | None]:
    """Return `(hf_hub_root, legacy_whisper_root, legacy_torch_hub_root)`."""
    if legacy_hf_hub_dir is not None:
        return legacy_hf_hub_dir, None, None
    cache_root = Path.home() / ".cache"
    return (
        cache_root / "huggingface" / "hub",
        cache_root / "whisper",
        cache_root / "torch" / "hub",
    )


def _resolve_model_target_paths(
    model_id: str,
    *,
    legacy_hf_hub_dir: Path | None = None,
) -> list[Path]:
    hf_cache = dubbing_hf_cache_dir(create=False)
    legacy_hub, legacy_whisper_dir, legacy_torch_hub = _legacy_cache_roots(legacy_hf_hub_dir)

    if model_id == "qwen3_tts":
        folder = f"models--{QWEN3_TTS_REPO.replace('/', '--')}"
        return [hf_cache / "hub" / folder, hf_cache / folder, legacy_hub / folder]

    if model_id == "chatterbox":
        folder = f"models--{CHATTERBOX_REPO.replace('/', '--')}"
        return [hf_cache / "hub" / folder, hf_cache / folder, legacy_hub / folder]

    if model_id == "demucs":
        targets = [dubbing_sep_cache_dir(create=False)]
        if legacy_torch_hub is not None and (legacy_torch_hub / "checkpoints").is_dir():
            try:
                for entry in sorted((legacy_torch_hub / "checkpoints").iterdir()):
                    if entry.is_file() and "demucs" in entry.name.lower():
                        targets.append(entry)
            except OSError:
                pass
        return targets

    if model_id == "sherpa_onnx":
        return [dubbing_sherpa_cache_dir(create=False)]

    if model_id == "whisper":
        targets: list[Path] = [whisper_models_dir(create=False)]
        for hub_root in (legacy_hub, hf_cache / "hub", hf_cache):
            if hub_root.is_dir():
                try:
                    for entry in sorted(hub_root.iterdir()):
                        if entry.is_dir() and entry.name.startswith("models--") and "whisper" in entry.name.lower():
                            targets.append(entry)
                except OSError:
                    pass
        if legacy_whisper_dir is not None and legacy_whisper_dir.is_dir():
            targets.append(legacy_whisper_dir)
        if legacy_torch_hub is not None and legacy_torch_hub.is_dir():
            try:
                for entry in sorted(legacy_torch_hub.iterdir()):
                    if entry.is_dir() and "silero-vad" in entry.name.lower():
                        targets.append(entry)
            except OSError:
                pass
        return targets

    if model_id == "venv_base":
        return [dubbing_base_venv_dir()]

    if model_id == "venv_qwen3":
        return [dubbing_engine_venv_dir("qwen3_tts")]

    if model_id == "venv_chatterbox":
        return [dubbing_engine_venv_dir("chatterbox")]

    if model_id == "venv_backend":
        return [project_root() / "backend" / ".venv"]

    raise ValueError(f"Unknown model_id: {model_id}")


_MODEL_METADATA: dict[str, tuple[str, str]] = {
    "qwen3_tts": ("Qwen3-TTS-12Hz-1.7B-Base", "tts"),
    "chatterbox": ("Chatterbox Multilingual TTS", "tts"),
    "demucs": ("Demucs (htdemucs_ft)", "audio_separation"),
    "sherpa_onnx": ("sherpa-onnx Diarizer", "diarization"),
    "whisper": ("faster-whisper (local + cache legado)", "transcription"),
    "venv_base": ("Ambiente Base PyTorch cu128 (.venv-dubbing-base)", "venv"),
    "venv_qwen3": ("Sub-ambiente Qwen3-TTS (.venv-qwen3)", "venv"),
    "venv_chatterbox": ("Sub-ambiente Chatterbox (.venv-chatterbox)", "venv"),
    "venv_backend": ("Ambiente Python Principal (backend/.venv)", "venv"),
}


def _resolve_lms_executable() -> str | None:
    found = shutil.which("lms") or shutil.which("lms.exe")
    if found:
        return found
    candidate = Path.home() / ".lmstudio" / "bin" / ("lms.exe" if os.name == "nt" else "lms")
    if candidate.is_file():
        return str(candidate)
    return None


def _read_lmstudio_settings_and_index(lm_root: Path) -> tuple[Path, list[dict[str, Any]]]:
    downloads_folder = lm_root / "models"
    settings_file = lm_root / "settings.json"
    if settings_file.is_file():
        try:
            raw_settings = json.loads(settings_file.read_text(encoding="utf-8", errors="replace"))
            custom = str((raw_settings or {}).get("downloadsFolder") or "").strip()
            if custom:
                downloads_folder = Path(custom)
        except Exception:
            pass

    index_entries: list[dict[str, Any]] = []
    index_file = lm_root / ".internal" / "model-index-cache.json"
    if index_file.is_file():
        try:
            raw_idx = json.loads(index_file.read_text(encoding="utf-8", errors="replace"))
            if isinstance(raw_idx, dict) and isinstance(raw_idx.get("models"), list):
                index_entries = [m for m in raw_idx["models"] if isinstance(m, dict)]
        except Exception:
            pass

    return downloads_folder, index_entries


def _run_lms_ls_json(lms_exe: str | None) -> list[dict[str, Any]]:
    if not lms_exe:
        return []
    try:
        proc = subprocess.run(
            [lms_exe, "ls", "--json"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=8,
            check=False,
        )
        if proc.returncode != 0 or not proc.stdout.strip():
            return []
        parsed = json.loads(proc.stdout)
        if isinstance(parsed, list):
            return [item for item in parsed if isinstance(item, dict)]
    except Exception:
        pass
    return []


def _is_under_any_root(candidate: Path, roots: list[Path]) -> bool:
    try:
        resolved = candidate.resolve()
    except OSError:
        resolved = candidate
    for root in roots:
        try:
            r_root = root.resolve()
        except OSError:
            r_root = root
        if resolved == r_root:
            continue
        try:
            resolved.relative_to(r_root)
            return True
        except ValueError:
            continue
    return False


def scan_lmstudio_models(
    *,
    lmstudio_root: Path | None = None,
    lms_list_runner: Callable[[], list[dict[str, Any]]] | None = None,
) -> tuple[list[LmStudioModelStorageItem], int]:
    """Read downloaded LM Studio models (`lms ls --json` + internal cache index) and disk sizes."""
    if lmstudio_root is None and lms_list_runner is None and app_paths._override_project_root is not None:
        return [], 0

    lm_root = lmstudio_root if lmstudio_root is not None else (Path.home() / ".lmstudio")
    downloads_folder, index_entries = _read_lmstudio_settings_and_index(lm_root)

    if lms_list_runner is not None:
        raw_cli = [item for item in (lms_list_runner() or []) if isinstance(item, dict)]
    else:
        raw_cli = _run_lms_ls_json(_resolve_lms_executable())

    # Index cache entries by identifiers so `lms ls` modelKeys resolve physical directories reliably
    idx_by_key: dict[str, list[dict[str, Any]]] = {}
    for entry in index_entries:
        keys: list[str] = []
        for field in ("indexedModelIdentifier", "containingDirSubpath", "defaultIdentifier"):
            val = str(entry.get(field) or "").strip()
            if val:
                keys.append(val)
        for field in ("autoIdentifiers", "baselessAutoIdentifiers"):
            vals = entry.get(field)
            if isinstance(vals, list):
                for item in vals:
                    if isinstance(item, str) and item.strip():
                        keys.append(item.strip())
        for k in keys:
            idx_by_key.setdefault(k, []).append(entry)

    allowed_delete_roots = [downloads_folder, lm_root / "models", lm_root / "hub" / "models"]
    internal_dir = lm_root / ".internal"

    items: list[LmStudioModelStorageItem] = []
    seen_model_keys: set[str] = set()
    counted_dirs: set[str] = set()
    total_bytes = 0

    for entry in raw_cli:
        model_key = str(entry.get("modelKey") or entry.get("indexedModelIdentifier") or entry.get("path") or "").strip()
        if not model_key or model_key in seen_model_keys:
            continue
        seen_model_keys.add(model_key)

        display_name = str(entry.get("displayName") or model_key).strip()
        model_type = str(entry.get("type") or "llm").strip().lower()
        quant_raw = entry.get("quantization")
        quant_name = str(quant_raw.get("name") or "").strip() if isinstance(quant_raw, dict) else (str(quant_raw).strip() if quant_raw else None)

        lookup_keys = [
            model_key,
            str(entry.get("indexedModelIdentifier") or "").strip(),
            str(entry.get("path") or "").strip(),
        ]
        matched_idx: list[dict[str, Any]] = []
        for lk in lookup_keys:
            if lk and lk in idx_by_key:
                matched_idx.extend(idx_by_key[lk])

        candidate_paths: list[Path] = []
        concrete_dirs: list[Path] = []
        is_bundled = False

        for idx_item in matched_idx:
            src_type = str(idx_item.get("sourceDirectoryType") or "").strip().lower()
            if src_type == "bundled":
                is_bundled = True
            for p_field in ("concreteModelDirAbsolutePath", "containingDirAbsolutePath"):
                raw_p = str(idx_item.get(p_field) or "").strip()
                if raw_p:
                    p_obj = Path(raw_p)
                    candidate_paths.append(p_obj)
                    if p_field == "concreteModelDirAbsolutePath" or src_type != "hub":
                        concrete_dirs.append(p_obj)

        # Fallback: direct path inside downloads_folder when matched index is absent
        if not candidate_paths:
            rel_path = str(entry.get("path") or model_key).strip()
            rel_dir = Path(rel_path)
            if rel_dir.suffix.lower() in (".gguf", ".bin", ".safetensors"):
                rel_dir = rel_dir.parent
            direct = downloads_folder / rel_dir
            if direct.exists():
                candidate_paths.append(direct)
                concrete_dirs.append(direct)

        dedup_paths = _dedup_existing_paths(candidate_paths)
        dedup_concrete = _dedup_existing_paths(concrete_dirs)

        if any(_is_under_any_root(p, [internal_dir]) for p in dedup_paths):
            is_bundled = True

        cli_size = int(entry.get("sizeBytes") or 0)
        if dedup_concrete:
            disk_size = sum(_path_size_bytes(p) for p in dedup_concrete)
            item_size = disk_size if disk_size > 0 else cli_size
        else:
            item_size = cli_size

        added_bytes = 0
        had_disk_bytes = False
        for p in (dedup_concrete or dedup_paths):
            norm_p = os.path.normcase(os.path.normpath(str(p.resolve())))
            if norm_p not in counted_dirs:
                counted_dirs.add(norm_p)
                sz = _path_size_bytes(p)
                if sz > 0:
                    had_disk_bytes = True
                    total_bytes += sz
                    added_bytes += sz
            elif _path_size_bytes(p) > 0:
                had_disk_bytes = True
        if added_bytes == 0 and not had_disk_bytes and cli_size > 0:
            total_bytes += cli_size

        deletable_targets = [
            p for p in dedup_paths if _is_under_any_root(p, allowed_delete_roots)
        ]
        can_delete = (not is_bundled) and len(deletable_targets) > 0

        items.append(
            LmStudioModelStorageItem(
                model_key=model_key,
                display_name=display_name,
                model_type=model_type or "llm",
                quantization=quant_name or None,
                size_bytes=item_size,
                paths=[str(p) for p in dedup_paths],
                bundled=is_bundled,
                deletable=can_delete,
            )
        )

    # Fallback when CLI is unavailable: inspect user `downloadsFolder` (`publisher/repo`)
    if not raw_cli and downloads_folder.is_dir():
        try:
            for publisher_dir in sorted(downloads_folder.iterdir(), key=lambda p: p.name):
                if not publisher_dir.is_dir() or publisher_dir.name.startswith("."):
                    continue
                for model_dir in sorted(publisher_dir.iterdir(), key=lambda p: p.name):
                    if not model_dir.is_dir() or model_dir.name.startswith("."):
                        continue
                    sz = _path_size_bytes(model_dir)
                    if sz <= 0:
                        continue
                    key = f"{publisher_dir.name}/{model_dir.name}"
                    if key in seen_model_keys:
                        continue
                    seen_model_keys.add(key)
                    total_bytes += sz
                    items.append(
                        LmStudioModelStorageItem(
                            model_key=key,
                            display_name=model_dir.name,
                            model_type="llm",
                            quantization=None,
                            size_bytes=sz,
                            paths=[str(model_dir)],
                            bundled=False,
                            deletable=True,
                        )
                    )
        except OSError:
            pass

    items.sort(key=lambda it: (it.bundled, -it.size_bytes, it.display_name.lower()))
    return items, total_bytes


def compute_app_storage_usage(
    *,
    legacy_hf_hub_dir: Path | None = None,
    lmstudio_root: Path | None = None,
    lms_list_runner: Callable[[], list[dict[str, Any]]] | None = None,
) -> StorageUsageSummary:
    """Compute app-owned disk usage across models, venvs, and media (excluding LM Studio dirs)."""
    models: list[ModelStorageItem] = []
    total_models_bytes = 0

    for model_id in DISPLAY_MODEL_IDS:
        label, category = _MODEL_METADATA[model_id]
        raw_paths = _resolve_model_target_paths(model_id, legacy_hf_hub_dir=legacy_hf_hub_dir)
        existing = _dedup_existing_paths(raw_paths)
        if not existing:
            continue
        seen_inodes: set[tuple[int, int]] = set()
        size_bytes = sum(_path_size_bytes(p, seen_inodes=seen_inodes) for p in existing)
        if size_bytes <= 0:
            continue
        display_path = str(existing[0])
        is_deletable = model_id in VALID_DELETABLE_MODEL_IDS
        total_models_bytes += size_bytes
        models.append(
            ModelStorageItem(
                model_id=model_id,
                label=label,
                size_bytes=size_bytes,
                path=display_path,
                paths=[str(p) for p in existing],
                installed=True,
                deletable=is_deletable,
                category=category,
            )
        )

    videos_bytes = 0
    dubs_bytes = 0
    stems_bytes = 0
    shorts_bytes = 0
    archives_bytes = 0

    base_dir = Path(load_settings().media.base_dir)
    if base_dir.is_dir():
        try:
            for entry in sorted(base_dir.iterdir(), key=lambda p: p.name):
                if not entry.is_dir():
                    continue
                if entry.name == "_archived":
                    archives_bytes += _path_size_bytes(entry)
                    continue
                if entry.name.lower() == "logs":
                    continue
                if is_hidden_or_internal_dir_name(entry.name):
                    continue

                for child in entry.iterdir():
                    if child.name == "dubs" and child.is_dir():
                        for dub_child in child.iterdir():
                            if dub_child.name == "_stems":
                                stems_bytes += _path_size_bytes(dub_child)
                            else:
                                dubs_bytes += _path_size_bytes(dub_child)
                    elif child.name == "_stems" and child.is_dir():
                        stems_bytes += _path_size_bytes(child)
                    elif child.name == "shorts" and child.is_dir():
                        shorts_bytes += _path_size_bytes(child)
                    else:
                        videos_bytes += _path_size_bytes(child)
        except OSError:
            pass

    arch_dir = archived_videos_dir(create=False)
    if arch_dir.exists() and os.path.normcase(str(arch_dir.resolve())) != os.path.normcase(
        str((base_dir / "_archived").resolve())
    ):
        archives_bytes += _path_size_bytes(arch_dir)

    # Also count archived attempt snapshots/renders persisted under data/jobs/*/attempts/
    root_jobs = jobs_dir()
    if root_jobs.is_dir():
        try:
            for job_entry in root_jobs.iterdir():
                if not job_entry.is_dir():
                    continue
                attempts_dir = job_entry / "attempts"
                if attempts_dir.is_dir():
                    archives_bytes += _path_size_bytes(attempts_dir)
        except OSError:
            pass

    total_media_bytes = videos_bytes + dubs_bytes + stems_bytes + shorts_bytes + archives_bytes
    total_app_bytes = total_media_bytes + total_models_bytes
    lmstudio_models, lmstudio_models_bytes = scan_lmstudio_models(
        lmstudio_root=lmstudio_root,
        lms_list_runner=lms_list_runner,
    )
    total_with_lmstudio_bytes = total_app_bytes + lmstudio_models_bytes

    return StorageUsageSummary(
        videos_bytes=videos_bytes,
        dubs_bytes=dubs_bytes,
        stems_bytes=stems_bytes,
        shorts_bytes=shorts_bytes,
        archives_bytes=archives_bytes,
        total_media_bytes=total_media_bytes,
        total_models_bytes=total_models_bytes,
        total_app_bytes=total_app_bytes,
        lmstudio_models_bytes=lmstudio_models_bytes,
        total_with_lmstudio_bytes=total_with_lmstudio_bytes,
        models=models,
        lmstudio_models=lmstudio_models,
    )


def _active_tasks_for_model(model_id: str, container: ServiceContainer) -> list[str]:
    runtime = container.runtime
    relevant = {"dubbing", "transcription"} if model_id == "whisper" else {"dubbing"}
    active: list[str] = []

    cancel_tokens = getattr(runtime, "_cancel_tokens", {}) or {}
    for (_jid, task), token in list(cancel_tokens.items()):
        if task in relevant and not token.is_set() and task not in active:
            active.append(task)

    proc_pids = getattr(runtime, "_process_pids", {}) or {}
    for (_jid, task), pids in list(proc_pids.items()):
        if task in relevant and len(pids) > 0 and task not in active:
            active.append(task)

    return active


def _safe_remove_path(target: Path) -> bool:
    if not target.exists():
        return False
    if target.is_file() or target.is_symlink():
        target.unlink(missing_ok=True)
        return True
    last_err: OSError | None = None
    for attempt in range(3):
        try:
            shutil.rmtree(target)
            return True
        except OSError as exc:
            last_err = exc
            if attempt < 2:
                time.sleep(0.1)
    # Fallback rename to .trash_ for deferred sweep on Windows lock contention
    trash = target.parent / f".trash_{target.name}_{int(time.time() * 1000)}"
    try:
        os.replace(target, trash)
        shutil.rmtree(trash, ignore_errors=True)
        return True
    except OSError as exc:
        raise OSError(f"Failed to delete '{target}': {last_err or exc}") from exc


def delete_individual_model(
    model_id: str,
    *,
    force: bool = False,
    legacy_hf_hub_dir: Path | None = None,
    container: ServiceContainer | None = None,
) -> dict[str, Any]:
    """Safely delete ONLY the requested model cache or isolated venv directory."""
    if model_id not in VALID_DELETABLE_MODEL_IDS:
        raise ValueError(f"Unknown model_id: {model_id}")

    active_container = container or get_container()
    if not force:
        blocking_tasks = _active_tasks_for_model(model_id, active_container)
        if blocking_tasks:
            raise ModelInUseError(model_id, blocking_tasks)

    targets = _dedup_existing_paths(
        _resolve_model_target_paths(model_id, legacy_hf_hub_dir=legacy_hf_hub_dir)
    )
    cleared_dependents: list[str] = []

    if model_id == "venv_base":
        for dep_id in ("venv_qwen3", "venv_chatterbox"):
            dep_paths = _dedup_existing_paths(_resolve_model_target_paths(dep_id))
            if dep_paths:
                cleared_dependents.append(dep_id)
                targets.extend(dep_paths)
        targets = _dedup_existing_paths(targets)

    freed_bytes = 0
    deleted_paths: list[str] = []
    for target in targets:
        sz = _path_size_bytes(target)
        if _safe_remove_path(target):
            freed_bytes += sz
            deleted_paths.append(str(target))

    return {
        "ok": True,
        "model_id": model_id,
        "freed_bytes": freed_bytes,
        "deleted_paths": deleted_paths,
        "cleared_dependents": cleared_dependents,
    }


def _active_tasks_for_lmstudio(container: ServiceContainer) -> list[str]:
    runtime = container.runtime
    relevant = {"analysis", "dubbing"}
    active: list[str] = []

    cancel_tokens = getattr(runtime, "_cancel_tokens", {}) or {}
    for (_jid, task), token in list(cancel_tokens.items()):
        if task in relevant and not token.is_set() and task not in active:
            active.append(task)

    proc_pids = getattr(runtime, "_process_pids", {}) or {}
    for (_jid, task), pids in list(proc_pids.items()):
        if task in relevant and len(pids) > 0 and task not in active:
            active.append(task)

    return active


def delete_lmstudio_model(
    model_key: str,
    *,
    force: bool = False,
    lmstudio_root: Path | None = None,
    lms_list_runner: Callable[[], list[dict[str, Any]]] | None = None,
    container: ServiceContainer | None = None,
) -> dict[str, Any]:
    """Safely delete a user-downloaded LM Studio model directory outside .internal/."""
    normalized_key = model_key.strip()
    if not normalized_key:
        raise ValueError("model_key não pode estar vazio.")

    active_container = container or get_container()
    if not force:
        blocking_tasks = _active_tasks_for_lmstudio(active_container)
        if blocking_tasks:
            raise ModelInUseError(normalized_key, blocking_tasks)

    items, _ = scan_lmstudio_models(
        lmstudio_root=lmstudio_root,
        lms_list_runner=lms_list_runner,
    )
    target_item = next((it for it in items if it.model_key == normalized_key), None)
    if target_item is None:
        raise ValueError(f"Modelo do LM Studio não encontrado: {normalized_key}")
    if target_item.bundled or not target_item.deletable:
        raise ValueError(
            f"Modelo embutido do LM Studio ('{normalized_key}') não pode ser removido por aqui."
        )

    lm_root = lmstudio_root if lmstudio_root is not None else (Path.home() / ".lmstudio")
    downloads_folder, _ = _read_lmstudio_settings_and_index(lm_root)
    internal_dir = lm_root / ".internal"
    allowed_delete_roots = [downloads_folder, lm_root / "models", lm_root / "hub" / "models"]

    dedup_targets = _dedup_existing_paths([Path(p) for p in target_item.paths if p])
    safe_targets = [
        p
        for p in dedup_targets
        if _is_under_any_root(p, allowed_delete_roots)
        and not _is_under_any_root(p, [internal_dir])
    ]
    if not safe_targets:
        raise ValueError(
            f"Nenhum diretório removível encontrado fora de '.internal' para '{normalized_key}'."
        )

    freed_bytes = 0
    deleted_paths: list[str] = []
    for target in safe_targets:
        sz = _path_size_bytes(target)
        parent = target.parent
        if _safe_remove_path(target):
            freed_bytes += sz
            deleted_paths.append(str(target))
            # Prune empty publisher directory cleanly if strictly inside an allowed model root
            if (
                parent.is_dir()
                and _is_under_any_root(parent, allowed_delete_roots)
                and not _is_under_any_root(parent, [internal_dir])
            ):
                try:
                    if not any(parent.iterdir()):
                        parent.rmdir()
                except OSError:
                    pass

    return {
        "ok": True,
        "model_key": normalized_key,
        "freed_bytes": freed_bytes,
        "deleted_paths": deleted_paths,
    }
