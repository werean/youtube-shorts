"""Deterministic and cross-OS filesystem path resolution with test override support."""

from __future__ import annotations

import os
from pathlib import Path

_override_data_dir: Path | None = None
_override_project_root: Path | None = None


def set_data_dir_override(path: str | Path | None) -> None:
    """Override the data directory (used by pytest fixtures so tests never touch real data/)."""
    global _override_data_dir
    _override_data_dir = Path(path).resolve() if path is not None else None


def set_project_root_override(path: str | Path | None) -> None:
    """Override the project root directory for tests."""
    global _override_project_root
    _override_project_root = Path(path).resolve() if path is not None else None


def project_root() -> Path:
    """Return the repository root directory."""
    if _override_project_root is not None:
        return _override_project_root
    env_root = os.environ.get("YTS_PROJECT_ROOT")
    if env_root:
        return Path(env_root).resolve()
    # backend/app/core/paths.py -> core -> app -> backend -> repo root
    return Path(__file__).resolve().parents[3]


def data_dir() -> Path:
    """Return the root data/ directory (respects override or YTS_DATA_DIR env var)."""
    if _override_data_dir is not None:
        return _override_data_dir
    env_data = os.environ.get("YTS_DATA_DIR")
    if env_data:
        return Path(env_data).resolve()
    return project_root() / "data"


def settings_file_path() -> Path:
    return data_dir() / "settings.json"


def default_configs_file_path() -> Path:
    return data_dir() / "default_configs.json"


def custom_configs_file_path() -> Path:
    return data_dir() / "custom_settings.json"


def saved_llm_prompts_file_path() -> Path:
    return data_dir() / "saved_llm_prompts.json"


def jobs_dir() -> Path:
    return data_dir() / "jobs"


def job_dir(job_id: str) -> Path:
    return jobs_dir() / job_id


def ensure_job_dir(job_id: str) -> Path:
    d = job_dir(job_id)
    d.mkdir(parents=True, exist_ok=True)
    return d


def job_metadata_path(job_id: str) -> Path:
    return job_dir(job_id) / "job.json"


def source_video_info_path(job_id: str) -> Path:
    return ensure_job_dir(job_id) / "source.info.json"


def semantic_blocks_path(job_id: str) -> Path:
    return ensure_job_dir(job_id) / "semantic.blocks.json"


def topic_segments_path(job_id: str) -> Path:
    return ensure_job_dir(job_id) / "topic.segments.json"


def cuts_path(job_id: str) -> Path:
    return ensure_job_dir(job_id) / "cuts.suggested.json"


def upload_dir() -> Path:
    return project_root() / "upload"


def upload_job_dir(job_id: str) -> Path:
    return upload_dir() / job_id


def archived_dir() -> Path:
    return project_root() / "archived"


def archived_job_dir(job_id: str) -> Path:
    return archived_dir() / job_id
