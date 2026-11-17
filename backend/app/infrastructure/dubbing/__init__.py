"""Isolated dubbing infrastructure (`.venv-dubbing-*`, preflight, storage scanner, workers)."""

from app.infrastructure.dubbing.env_manager import (
    CHATTERBOX_ALLOW_PATTERNS,
    CHATTERBOX_REPO,
    QWEN3_TTS_REPO,
    VALID_DUBBING_ENGINES,
    check_dubbing_preflight,
    install_dubbing_dependencies,
    is_demucs_weights_cached,
    is_engine_weights_cached,
    is_sherpa_weights_cached,
    is_venv_installed,
    normalize_dubbing_engine,
    venv_python_path,
    venv_site_packages_dir,
)
from app.infrastructure.dubbing.storage_manager import (
    VALID_DELETABLE_MODEL_IDS,
    ModelInUseError,
    compute_app_storage_usage,
    delete_individual_model,
)
from app.infrastructure.dubbing.subprocess_runner import (
    WorkerExecutionResult,
    build_worker_env,
    resolve_venv_python,
    run_demucs_worker,
    run_diarize_worker,
    run_dubbing_worker,
    run_tts_worker,
)

__all__ = [
    "CHATTERBOX_ALLOW_PATTERNS",
    "CHATTERBOX_REPO",
    "ModelInUseError",
    "QWEN3_TTS_REPO",
    "VALID_DELETABLE_MODEL_IDS",
    "VALID_DUBBING_ENGINES",
    "WorkerExecutionResult",
    "build_worker_env",
    "check_dubbing_preflight",
    "compute_app_storage_usage",
    "delete_individual_model",
    "install_dubbing_dependencies",
    "is_demucs_weights_cached",
    "is_engine_weights_cached",
    "is_sherpa_weights_cached",
    "is_venv_installed",
    "normalize_dubbing_engine",
    "resolve_venv_python",
    "run_demucs_worker",
    "run_diarize_worker",
    "run_dubbing_worker",
    "run_tts_worker",
    "venv_python_path",
    "venv_site_packages_dir",
]
