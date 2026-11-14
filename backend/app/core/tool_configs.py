"""Atomic reading/writing of data/default_configs.json and data/custom_settings.json."""

from __future__ import annotations

import copy
import json
import os
import time
from pathlib import Path
from typing import Any, Literal

from app.core.config import PREVIOUS_DEFAULT_SYSTEM_PROMPT_V3, SYSTEM_PROMPT_TEMPLATE, config
from app.core.paths import custom_configs_file_path, default_configs_file_path
from app.infrastructure.storage.atomic_store import atomic_write_json, read_json

ResettableSection = Literal["whisper", "ffmpeg", "llm"]

_default_cache: tuple[dict[str, Any], float, Path] | None = None
_custom_cache: tuple[dict[str, Any] | None, float, Path] | None = None
_active_cache: tuple[Literal["default", "custom"], dict[str, Any], float, Path] | None = None


def _cache_ttl_seconds() -> float:
    raw = os.environ.get("TOOL_CONFIGS_CACHE_TTL_MS")
    if raw:
        try:
            val = int(raw)
            if val > 0:
                return val / 1000.0
        except ValueError:
            pass
    return 3.0


def invalidate_tool_configs_cache() -> None:
    global _default_cache, _custom_cache, _active_cache
    _default_cache = None
    _custom_cache = None
    _active_cache = None


def _to_number_or_none(value: Any) -> int | float | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return value
    if isinstance(value, str):
        s = value.strip()
        if not s:
            return None
        try:
            f = float(s)
            return int(f) if f.is_integer() else f
        except ValueError:
            return None
    return None


def _to_str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s if s else None


def default_tool_configs() -> dict[str, Any]:
    """Return canonical defaults matching ARCHITECTURE.md §6.4."""
    return {
        "whisper": {
            "model": config.WHISPER_MODEL_NAME,
            "device": "cuda",
            "output_format": ["json", "vtt", "txt"],
            "verbose": True,
            "task": "transcribe",
            "language": None,
            "temperature": 0,
            "best_of": 5,
            "beam_size": 5,
            "patience": None,
            "length_penalty": None,
            "suppress_tokens": "-1",
            "initial_prompt": None,
            "carry_initial_prompt": False,
            "condition_on_previous_text": True,
            "fp16": True,
            "temperature_increment_on_fallback": 0.2,
            "compression_ratio_threshold": 2.4,
            "logprob_threshold": -1,
            "no_speech_threshold": 0.6,
            "word_timestamps": True,
            "prepend_punctuations": None,
            "append_punctuations": None,
            "highlight_words": True,
            "max_line_width": None,
            "max_line_count": None,
            "max_words_per_line": None,
            "threads": 0,
            "clip_timestamps": "0",
            "hallucination_silence_threshold": 1.5,
        },
        "ffmpeg": {
            "format": "mp4",
            "video_codec": config.RENDER_VIDEO_CODEC,
            "audio_codec": config.RENDER_AUDIO_CODEC,
            "video_preset": config.RENDER_VIDEO_PRESET,
            "video_bitrate": None,
            "audio_bitrate": None,
            "framerate": None,
            "aspect_ratio": "9:16",
            "audio_sample_rate": None,
            "audio_channels": None,
            "disable_video": False,
            "disable_audio": False,
            "disable_subtitle": False,
            "video_filter": None,
            "audio_filter": None,
            "metadata": None,
            "vertical_mode": "auto_reframe",
            "burn_subtitles": True,
            "subtitle_style": "word_highlight",
            "normalize_audio": True,
            "trim_internal_silence": False,
        },
        "llm": {
            "model": config.OLLAMA_MODEL,
            "provider": "auto",
            "lmstudio_base_url": config.LMSTUDIO_BASE_URL,
            "ollama_base_url": config.OLLAMA_BASE_URL,
            "embedding_model": config.EMBEDDING_MODEL,
            "context_length": None,
            "target_cut_duration_seconds": config.TARGET_CUT_DURATION_SECONDS,
            "max_suggested_cuts": config.MAX_SUGGESTED_CUTS,
            "enable_boundary_lookaround": config.ENABLE_BOUNDARY_LOOKAROUND,
            "registered_embedding_models": ["nomic-embed-text"],
            "system_prompt": SYSTEM_PROMPT_TEMPLATE,
            "registered_models": [
                {"name": "qwen2.5:14b", "source": "local"},
                {"name": "qwen2.5:7b", "source": "local"},
                {"name": "gemma3:12b", "source": "local"},
            ],
        },
    }


def normalize_whisper_config(raw: dict[str, Any] | None) -> dict[str, Any]:
    w = dict(raw or {})
    defaults = default_tool_configs()["whisper"]
    merged = {**defaults, **w}
    output_fmt = merged.get("output_format")
    if not isinstance(output_fmt, list) or len(output_fmt) == 0:
        output_fmt = ["json", "vtt", "txt"]
    else:
        output_fmt = [str(x) for x in output_fmt]

    return {
        **merged,
        "model": str(merged.get("model") or config.WHISPER_MODEL_NAME).strip() or config.WHISPER_MODEL_NAME,
        "device": "cpu" if merged.get("device") == "cpu" else "cuda",
        "output_format": output_fmt,
        "verbose": True if merged.get("verbose") is None else bool(merged.get("verbose")),
        "task": "translate" if merged.get("task") == "translate" else "transcribe",
        "language": _to_str_or_none(merged.get("language")),
        "temperature": _to_number_or_none(merged.get("temperature")) if _to_number_or_none(merged.get("temperature")) is not None else 0,
        "best_of": _to_number_or_none(merged.get("best_of")) if _to_number_or_none(merged.get("best_of")) is not None else 5,
        "beam_size": _to_number_or_none(merged.get("beam_size")) if _to_number_or_none(merged.get("beam_size")) is not None else 5,
        "patience": _to_number_or_none(merged.get("patience")),
        "length_penalty": _to_number_or_none(merged.get("length_penalty")),
        "suppress_tokens": str(merged.get("suppress_tokens")) if merged.get("suppress_tokens") is not None else "-1",
        "initial_prompt": _to_str_or_none(merged.get("initial_prompt")),
        "carry_initial_prompt": bool(merged.get("carry_initial_prompt", False)),
        "condition_on_previous_text": True if merged.get("condition_on_previous_text") is None else bool(merged.get("condition_on_previous_text")),
        "fp16": True if merged.get("fp16") is None else bool(merged.get("fp16")),
        "temperature_increment_on_fallback": _to_number_or_none(merged.get("temperature_increment_on_fallback")) if _to_number_or_none(merged.get("temperature_increment_on_fallback")) is not None else 0.2,
        "compression_ratio_threshold": _to_number_or_none(merged.get("compression_ratio_threshold")) if _to_number_or_none(merged.get("compression_ratio_threshold")) is not None else 2.4,
        "logprob_threshold": _to_number_or_none(merged.get("logprob_threshold")) if _to_number_or_none(merged.get("logprob_threshold")) is not None else -1,
        "no_speech_threshold": _to_number_or_none(merged.get("no_speech_threshold")) if _to_number_or_none(merged.get("no_speech_threshold")) is not None else 0.6,
        "word_timestamps": bool(merged.get("word_timestamps", True)),
        "prepend_punctuations": _to_str_or_none(merged.get("prepend_punctuations")),
        "append_punctuations": _to_str_or_none(merged.get("append_punctuations")),
        "highlight_words": bool(merged.get("highlight_words", True)),
        "max_line_width": _to_number_or_none(merged.get("max_line_width")),
        "max_line_count": _to_number_or_none(merged.get("max_line_count")),
        "max_words_per_line": _to_number_or_none(merged.get("max_words_per_line")),
        "threads": _to_number_or_none(merged.get("threads")) if _to_number_or_none(merged.get("threads")) is not None else 0,
        "clip_timestamps": str(merged.get("clip_timestamps")) if merged.get("clip_timestamps") is not None else "0",
        "hallucination_silence_threshold": _to_number_or_none(merged.get("hallucination_silence_threshold")),
    }


def normalize_ffmpeg_config(raw: dict[str, Any] | None) -> dict[str, Any]:
    f = dict(raw or {})
    defaults = default_tool_configs()["ffmpeg"]
    merged = {**defaults, **f}
    vertical_mode = merged.get("vertical_mode")
    if vertical_mode not in ("auto_reframe", "split_podcast", "crop", "zoom", "blur"):
        vertical_mode = "auto_reframe"
    subtitle_style = merged.get("subtitle_style")
    if subtitle_style not in ("word_highlight", "sentence"):
        subtitle_style = "word_highlight"

    disable_subtitle = bool(merged.get("disable_subtitle", False))
    burn_subtitles = (
        bool(merged["burn_subtitles"])
        if "burn_subtitles" in merged and merged["burn_subtitles"] is not None
        else not disable_subtitle
    )

    return {
        **merged,
        "format": _to_str_or_none(merged.get("format")) or "mp4",
        "video_codec": _to_str_or_none(merged.get("video_codec")) or config.RENDER_VIDEO_CODEC,
        "audio_codec": _to_str_or_none(merged.get("audio_codec")) or config.RENDER_AUDIO_CODEC,
        "video_preset": _to_str_or_none(merged.get("video_preset")) or config.RENDER_VIDEO_PRESET,
        "video_bitrate": _to_str_or_none(merged.get("video_bitrate")),
        "audio_bitrate": _to_str_or_none(merged.get("audio_bitrate")),
        "framerate": _to_str_or_none(merged.get("framerate")),
        "aspect_ratio": _to_str_or_none(merged.get("aspect_ratio")) or "9:16",
        "audio_sample_rate": _to_str_or_none(merged.get("audio_sample_rate")),
        "audio_channels": _to_str_or_none(merged.get("audio_channels")),
        "disable_video": bool(merged.get("disable_video", False)),
        "disable_audio": bool(merged.get("disable_audio", False)),
        "disable_subtitle": disable_subtitle,
        "video_filter": _to_str_or_none(merged.get("video_filter")),
        "audio_filter": _to_str_or_none(merged.get("audio_filter")),
        "metadata": _to_str_or_none(merged.get("metadata")),
        "vertical_mode": vertical_mode,
        "burn_subtitles": burn_subtitles,
        "subtitle_style": subtitle_style,
        "normalize_audio": True if merged.get("normalize_audio") is None else bool(merged.get("normalize_audio")),
        "trim_internal_silence": bool(merged.get("trim_internal_silence", False)),
    }


def normalize_registered_models(value: Any) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    seen: set[str] = set()
    models: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        source = "local" if item.get("source") == "local" else ("cloud" if item.get("source") == "cloud" else "local")
        models.append({"name": name, "source": source})
    return models


def normalize_registered_embedding_models(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    seen: set[str] = set()
    models: list[str] = []
    for item in value:
        name = str(item or "").strip()
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        models.append(name)
    return models


def normalize_llm_config(raw: dict[str, Any] | None) -> dict[str, Any]:
    l = dict(raw or {})
    defaults = default_tool_configs()["llm"]
    merged = {**defaults, **l}

    model = str(merged.get("model") or config.OLLAMA_MODEL).strip() or config.OLLAMA_MODEL
    embedding_model = (
        str(merged.get("embedding_model") or config.EMBEDDING_MODEL).strip() or config.EMBEDDING_MODEL
    )
    prompt = str(merged.get("system_prompt") or SYSTEM_PROMPT_TEMPLATE)
    if not prompt.strip() or prompt.strip() == PREVIOUS_DEFAULT_SYSTEM_PROMPT_V3.strip():
        prompt = SYSTEM_PROMPT_TEMPLATE
    provider = merged.get("provider")
    if provider not in ("auto", "lmstudio", "ollama"):
        provider = "auto"

    lmstudio_url = str(merged.get("lmstudio_base_url") or config.LMSTUDIO_BASE_URL).strip() or config.LMSTUDIO_BASE_URL
    ollama_url = str(merged.get("ollama_base_url") or config.OLLAMA_BASE_URL).strip() or config.OLLAMA_BASE_URL

    ctx_len_raw = _to_number_or_none(merged.get("context_length"))
    context_length = int(ctx_len_raw) if (ctx_len_raw is not None and int(ctx_len_raw) > 0) else None

    target_dur = _to_number_or_none(merged.get("target_cut_duration_seconds"))
    if target_dur is None or target_dur <= 0:
        target_dur = config.TARGET_CUT_DURATION_SECONDS

    max_cuts = _to_number_or_none(merged.get("max_suggested_cuts"))
    if max_cuts is None or max_cuts <= 0:
        max_cuts = config.MAX_SUGGESTED_CUTS

    enable_lookaround = (
        True
        if merged.get("enable_boundary_lookaround") is None
        else bool(merged.get("enable_boundary_lookaround"))
    )

    registered = normalize_registered_models(merged.get("registered_models"))
    if not any(m["name"].lower() == model.lower() for m in registered):
        registered.insert(
            0,
            {"name": model, "source": "cloud" if model.endswith("-cloud") else "local"},
        )

    registered_emb = normalize_registered_embedding_models(merged.get("registered_embedding_models"))
    if not any(m.lower() == embedding_model.lower() for m in registered_emb):
        registered_emb.insert(0, embedding_model)

    return {
        **merged,
        "model": model,
        "provider": provider,
        "lmstudio_base_url": lmstudio_url,
        "ollama_base_url": ollama_url,
        "embedding_model": embedding_model,
        "context_length": context_length,
        "target_cut_duration_seconds": target_dur,
        "max_suggested_cuts": int(max_cuts),
        "enable_boundary_lookaround": enable_lookaround,
        "registered_embedding_models": registered_emb,
        "system_prompt": prompt,
        "registered_models": registered,
    }


def _configs_equal(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def _read_json_or_none(path: Path) -> dict[str, Any] | None:
    if not path.exists():
        return None
    try:
        data = read_json(path)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


def load_default_tool_configs() -> dict[str, Any]:
    global _default_cache
    df = default_configs_file_path()
    now = time.monotonic()
    if _default_cache is not None and _default_cache[2] == df and _default_cache[1] > now:
        return copy.deepcopy(_default_cache[0])

    defaults = default_tool_configs()
    current = _read_json_or_none(df)
    if current is None or not _configs_equal(current, defaults):
        atomic_write_json(df, defaults)
        current = defaults

    _default_cache = (copy.deepcopy(current), now + _cache_ttl_seconds(), df)
    return copy.deepcopy(current)


def load_custom_tool_configs() -> dict[str, Any] | None:
    global _custom_cache
    cf = custom_configs_file_path()
    now = time.monotonic()
    if _custom_cache is not None and _custom_cache[2] == cf and _custom_cache[1] > now:
        return copy.deepcopy(_custom_cache[0])

    if not cf.exists():
        _custom_cache = (None, now + _cache_ttl_seconds(), cf)
        return None

    parsed = _read_json_or_none(cf)
    if parsed is not None:
        parsed = merge_with_defaults(parsed)
    _custom_cache = (copy.deepcopy(parsed), now + _cache_ttl_seconds(), cf)
    return copy.deepcopy(parsed)


def merge_with_defaults(partial: dict[str, Any] | None) -> dict[str, Any]:
    p = partial or {}
    defaults = load_default_tool_configs()
    return {
        "whisper": normalize_whisper_config({**defaults["whisper"], **(p.get("whisper") or {})}),
        "ffmpeg": normalize_ffmpeg_config({**defaults["ffmpeg"], **(p.get("ffmpeg") or {})}),
        "llm": normalize_llm_config({**defaults["llm"], **(p.get("llm") or {})}),
    }


def tool_configs_source() -> Literal["default", "custom"]:
    return "custom" if load_custom_tool_configs() is not None else "default"


def load_active_tool_configs() -> dict[str, Any]:
    global _active_cache
    cf = custom_configs_file_path()
    now = time.monotonic()
    if _active_cache is not None and _active_cache[3] == cf and _active_cache[2] > now:
        return copy.deepcopy(_active_cache[1])

    custom = load_custom_tool_configs()
    if custom is not None:
        _active_cache = ("custom", copy.deepcopy(custom), now + _cache_ttl_seconds(), cf)
        return copy.deepcopy(custom)

    defaults = load_default_tool_configs()
    _active_cache = ("default", copy.deepcopy(defaults), now + _cache_ttl_seconds(), cf)
    return copy.deepcopy(defaults)


def update_tool_configs(partial: dict[str, Any] | None) -> dict[str, Any]:
    p = partial or {}
    defaults = load_default_tool_configs()
    active = load_active_tool_configs()
    next_cfg = merge_with_defaults(
        {
            "whisper": {**active["whisper"], **(p.get("whisper") or {})},
            "ffmpeg": {**active["ffmpeg"], **(p.get("ffmpeg") or {})},
            "llm": {**active["llm"], **(p.get("llm") or {})},
        }
    )
    cf = custom_configs_file_path()
    if _configs_equal(next_cfg, merge_with_defaults(defaults)):
        if cf.exists():
            cf.unlink(missing_ok=True)
        invalidate_tool_configs_cache()
        return copy.deepcopy(defaults)

    atomic_write_json(cf, next_cfg)
    invalidate_tool_configs_cache()
    return copy.deepcopy(next_cfg)


def reset_all_tool_configs() -> dict[str, Any]:
    defaults = load_default_tool_configs()
    cf = custom_configs_file_path()
    if cf.exists():
        cf.unlink(missing_ok=True)
    invalidate_tool_configs_cache()
    return copy.deepcopy(defaults)


def is_resettable_tool_config_section(section: str) -> bool:
    return section in ("whisper", "ffmpeg", "llm")


def reset_tool_config_section(section: ResettableSection) -> dict[str, Any]:
    defaults = load_default_tool_configs()
    active = load_active_tool_configs()
    next_cfg = {
        "whisper": defaults["whisper"] if section == "whisper" else active["whisper"],
        "ffmpeg": defaults["ffmpeg"] if section == "ffmpeg" else active["ffmpeg"],
        "llm": defaults["llm"] if section == "llm" else active["llm"],
    }
    cf = custom_configs_file_path()
    if _configs_equal(next_cfg, defaults):
        if cf.exists():
            cf.unlink(missing_ok=True)
        invalidate_tool_configs_cache()
        return copy.deepcopy(defaults)

    full_next = merge_with_defaults(next_cfg)
    atomic_write_json(cf, full_next)
    invalidate_tool_configs_cache()
    return copy.deepcopy(full_next)


def import_tool_configs(input_cfg: dict[str, Any] | None) -> dict[str, Any]:
    normalized = merge_with_defaults(input_cfg or {})
    cf = custom_configs_file_path()
    atomic_write_json(cf, normalized)
    invalidate_tool_configs_cache()
    return copy.deepcopy(normalized)


def get_tool_configs_payload() -> dict[str, Any]:
    defaults = load_default_tool_configs()
    active = load_active_tool_configs()
    return {"source": tool_configs_source(), "defaults": defaults, "active": active}


def update_tool_configs_payload(body: dict[str, Any] | None) -> dict[str, Any]:
    defaults = load_default_tool_configs()
    active = update_tool_configs(body)
    return {"source": tool_configs_source(), "defaults": defaults, "active": active}


def reset_all_tool_configs_payload() -> dict[str, Any]:
    defaults = load_default_tool_configs()
    active = reset_all_tool_configs()
    return {"source": tool_configs_source(), "defaults": defaults, "active": active}


def reset_tool_config_section_payload(section: ResettableSection) -> dict[str, Any]:
    defaults = load_default_tool_configs()
    active = reset_tool_config_section(section)
    return {"source": tool_configs_source(), "defaults": defaults, "active": active}


def import_tool_configs_payload(body: dict[str, Any] | None) -> dict[str, Any]:
    defaults = load_default_tool_configs()
    active = import_tool_configs(body)
    return {"source": tool_configs_source(), "defaults": defaults, "active": active}
