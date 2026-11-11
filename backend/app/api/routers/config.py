"""Configuration, local LLM providers (LM Studio + Ollama), prompts, settings, and dependencies router (`/config/*`)."""

from __future__ import annotations

import shutil
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Body
from fastapi.responses import JSONResponse

from app.application.job_lifecycle import utc_now_iso
from app.application.runtime_service import CancelToken, get_container
from app.core.config import PROMPT_VERSION, SYSTEM_PROMPT_TEMPLATE, config
from app.core.paths import saved_llm_prompts_file_path
from app.core.settings import load_settings, update_settings
from app.core.tool_configs import (
    get_tool_configs_payload,
    import_tool_configs_payload,
    is_resettable_tool_config_section,
    load_active_tool_configs,
    normalize_registered_models,
    reset_all_tool_configs_payload,
    reset_tool_config_section_payload,
    update_tool_configs,
    update_tool_configs_payload,
)
from app.infrastructure.storage.atomic_store import atomic_write_json, read_json

router = APIRouter(prefix="/config", tags=["config"])

PYTORCH_GPU_TIER_REQUIRED_MESSAGE = (
    "Selecione o tipo de GPU (RTX 4000 ou inferior / RTX 5000) antes de instalar o PyTorch automaticamente."
)

INSTALLATION_GUIDES: dict[str, dict[str, Any]] = {
    "python": {
        "name": "Python",
        "manual": {
            "title": "Instalação Manual do Python",
            "description": "Python é necessário para executar Whisper e PyTorch. Recomenda-se Python 3.10 ou superior.",
            "steps": [
                "1. Acesse https://www.python.org/downloads/",
                "2. Baixe a versão mais recente (3.11 ou superior recomendado)",
                "3. Execute o instalador e marque 'Add Python to PATH'",
                "4. Clique em 'Install Now'",
                "5. Abra um novo terminal e verifique com: python --version",
            ],
            "links": [{"text": "Download Python", "url": "https://www.python.org/downloads/"}],
        },
        "automatic": {
            "command": "choco install python -y",
            "description": "Usa Chocolatey para instalar Python automaticamente (requer Chocolatey instalado)",
        },
    },
    "whisper": {
        "name": "Whisper",
        "manual": {
            "title": "Instalação Manual do Whisper",
            "description": "faster-whisper / Whisper é usado para transcrição local de áudio com suporte GPU CUDA.",
            "steps": [
                "1. Abra um terminal/PowerShell",
                "2. Execute: pip install -U faster-whisper openai-whisper",
                "3. Verifique a instalação com: python -c \"import faster_whisper\"",
            ],
            "links": [{"text": "Documentação faster-whisper", "url": "https://github.com/SYSTRAN/faster-whisper"}],
        },
        "automatic": {
            "command": "pip install -U faster-whisper openai-whisper",
            "description": "Instala Whisper via pip",
        },
    },
    "ytdlp": {
        "name": "yt-dlp",
        "manual": {
            "title": "Instalação Manual do yt-dlp",
            "description": "yt-dlp é usado para download/ingest de vídeos do YouTube e outras plataformas.",
            "steps": [
                "1. Abra um terminal/PowerShell",
                "2. Execute: pip install -U yt-dlp",
                "3. Verifique a instalação com: yt-dlp --version",
            ],
            "links": [
                {
                    "text": "yt-dlp - instalação oficial",
                    "url": "https://github.com/yt-dlp/yt-dlp?tab=readme-ov-file#installation",
                }
            ],
        },
        "automatic": {
            "command": "pip install -U yt-dlp",
            "description": "Instala yt-dlp via pip",
        },
    },
    "ffmpeg": {
        "name": "FFmpeg",
        "manual": {
            "title": "Instalação Manual do FFmpeg",
            "description": "FFmpeg é necessário para processar vídeos e codificar com NVENC.",
            "steps": [
                "1. Acesse https://www.gyan.dev/ffmpeg/builds/",
                "2. Baixe 'ffmpeg-git-essentials.7z'",
                "3. Extraia e adicione a pasta bin ao PATH",
                "4. Verifique com: ffmpeg -version",
            ],
            "links": [{"text": "FFmpeg Builds", "url": "https://www.gyan.dev/ffmpeg/builds/"}],
        },
        "automatic": {
            "command": "winget install Gyan.FFmpeg",
            "description": "Instala FFmpeg via winget",
        },
    },
    "cuda": {
        "name": "CUDA",
        "manual": {
            "title": "Instalação Manual do CUDA",
            "description": "O NVIDIA App instala e mantém os componentes necessários de driver/CUDA automaticamente.",
            "steps": [
                "1. Instale o NVIDIA App pelo link oficial",
                "2. Atualize para o driver recomendado mais recente",
                "3. Verifique no terminal com: nvidia-smi",
            ],
            "links": [
                {
                    "text": "NVIDIA App (oficial)",
                    "url": "https://www.nvidia.com/pt-br/software/nvidia-app/",
                }
            ],
        },
    },
    "pytorch": {
        "name": "PyTorch",
        "manual": {
            "title": "Instalação Manual do PyTorch",
            "description": "PyTorch é a biblioteca de machine learning necessária para GPU CUDA (incluindo RTX 5070 CUDA 12.8).",
            "steps": [
                "1. Acesse https://pytorch.org/get-started/locally/",
                "2. RTX 4000 ou inferior: pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121",
                "3. RTX 5000 series (RTX 5070): pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128",
            ],
            "links": [{"text": "PyTorch Get Started", "url": "https://pytorch.org/get-started/locally/"}],
        },
        "automatic": {
            "command": "pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121",
            "description": "Instala PyTorch com suporte CUDA 12.1 (RTX 4000 ou inferior) ou Nightly CUDA 12.8 (RTX 5000).",
        },
    },
    "ollama": {
        "name": "Ollama",
        "manual": {
            "title": "Instalação Manual do Ollama",
            "description": "Ollama permite executar modelos de linguagem localmente em http://127.0.0.1:11434.",
            "steps": [
                "1. Acesse https://ollama.com/download",
                "2. Execute o instalador e verifique com: ollama --version",
                "3. Baixe o modelo calibrado RTX 5070: ollama pull qwen2.5:14b",
            ],
            "links": [
                {"text": "Ollama - Download", "url": "https://ollama.com/download"},
                {"text": "Ollama - Modelos disponíveis", "url": "https://ollama.com/library"},
            ],
        },
    },
    "lmstudio": {
        "name": "LM Studio",
        "manual": {
            "title": "Instalação Manual do LM Studio",
            "description": "LM Studio permite rodar modelos locais GGUF com servidor compatível OpenAI em http://127.0.0.1:1234/v1.",
            "steps": [
                "1. Acesse https://lmstudio.ai/",
                "2. Baixe e instale o LM Studio",
                "3. Carregue Qwen2.5-14B-Instruct-GGUF (Q4_K_M) e ative o Local Server na porta 1234",
            ],
            "links": [{"text": "LM Studio", "url": "https://lmstudio.ai/"}],
        },
    },
}


# --- Summary & LLM Models (LM Studio + Ollama Dual Support) ---


@router.get("")
async def get_config_summary() -> dict[str, Any]:
    configs = load_active_tool_configs()
    output_fmt = configs["whisper"].get("output_format")
    formats_str = ",".join(str(x) for x in output_fmt) if isinstance(output_fmt, list) else ""
    return {
        "whisper": {
            "device": configs["whisper"].get("device", "cuda"),
            "formats": formats_str,
        },
        "llm": {
            "model": configs["llm"].get("model", config.OLLAMA_MODEL),
        },
    }


async def _fetch_provider_json(
    method: str,
    url: str,
    json_body: dict[str, Any] | None = None,
    timeout: float = 3.0,
) -> tuple[int, Any]:
    container = get_container()
    if container.llm_http_fetcher is not None:
        return await container.llm_http_fetcher(method, url, json_body)
    async with httpx.AsyncClient(timeout=timeout) as client:
        resp = await client.request(method, url, json=json_body)
        try:
            data = resp.json()
        except Exception:
            data = resp.text
        return resp.status_code, data


async def _run_ollama_cli(args: list[str]) -> dict[str, Any]:
    container = get_container()
    if container.ollama_command_runner is not None:
        return await container.ollama_command_runner(args)
    ollama_bin = shutil.which("ollama")
    if not ollama_bin:
        return {
            "ok": False,
            "code": None,
            "stdout": "",
            "stderr": "",
            "errorMessage": "ollama executable not found",
        }
    try:
        res = subprocess.run(
            [ollama_bin, *args],
            capture_output=True,
            text=True,
            timeout=180,
            check=False,
        )
        return {
            "ok": res.returncode == 0,
            "code": res.returncode,
            "stdout": res.stdout.strip(),
            "stderr": res.stderr.strip(),
        }
    except Exception as exc:
        return {
            "ok": False,
            "code": None,
            "stdout": "",
            "stderr": "",
            "errorMessage": str(exc),
        }


async def _build_unified_llm_models_payload() -> dict[str, Any]:
    configs = load_active_tool_configs()
    llm_cfg = configs["llm"]
    configured_model = str(llm_cfg.get("model") or config.OLLAMA_MODEL).strip()
    registered_models = normalize_registered_models(llm_cfg.get("registered_models"))

    lmstudio_base = str(llm_cfg.get("lmstudio_base_url") or config.LMSTUDIO_BASE_URL).rstrip("/")
    ollama_base = str(llm_cfg.get("ollama_base_url") or config.OLLAMA_BASE_URL).rstrip("/")

    catalog_map: dict[str, dict[str, Any]] = {}
    local_installed: set[str] = set()
    local_running: set[str] = set()
    registered_by_lower: dict[str, dict[str, str]] = {}

    for item in registered_models:
        name = item["name"]
        registered_by_lower[name.lower()] = item
        catalog_map[name] = {
            "name": name,
            "model": name,
            "source": item["source"],
            "provider": "local",
            "installed": False,
            "running": False,
            "needsDownload": item["source"] == "local",
        }

    lmstudio_available = False
    ollama_available = False

    # 1. Probe LM Studio (:1234/v1/models)
    try:
        status_code, payload = await _fetch_provider_json("GET", f"{lmstudio_base}/models")
        if status_code == 200 and isinstance(payload, dict):
            data_list = payload.get("data")
            if isinstance(data_list, list):
                lmstudio_available = True
                for entry in data_list:
                    if not isinstance(entry, dict):
                        continue
                    mname = str(entry.get("id") or "").strip()
                    if not mname:
                        continue
                    local_installed.add(mname)
                    local_running.add(mname)
                    catalog_map[mname] = {
                        "name": mname,
                        "model": mname,
                        "source": "local",
                        "provider": "lmstudio",
                        "installed": True,
                        "running": True,
                        "needsDownload": False,
                    }
    except Exception:
        pass

    # 2. Probe Ollama (:11434/api/tags and /api/ps)
    try:
        status_tags, tags_payload = await _fetch_provider_json("GET", f"{ollama_base}/api/tags")
        if status_tags == 200 and isinstance(tags_payload, dict):
            ollama_available = True
            models_list = tags_payload.get("models") or tags_payload.get("tags") or []
            if isinstance(models_list, list):
                for entry in models_list:
                    if not isinstance(entry, dict):
                        continue
                    mname = str(entry.get("name") or entry.get("model") or "").strip()
                    if not mname:
                        continue
                    local_installed.add(mname)
                    reg = registered_by_lower.get(mname.lower())
                    existing = catalog_map.get(mname)
                    item_dict: dict[str, Any] = {
                        "name": mname,
                        "model": mname,
                        "source": reg["source"] if reg else "local",
                        "provider": existing.get("provider", "ollama") if existing and existing.get("running") else "ollama",
                        "installed": True,
                        "running": bool(existing and existing.get("running")),
                        "needsDownload": False,
                    }
                    if isinstance(entry.get("size"), int):
                        item_dict["size"] = entry["size"]
                    catalog_map[mname] = item_dict
    except Exception:
        pass

    try:
        status_ps, ps_payload = await _fetch_provider_json("GET", f"{ollama_base}/api/ps")
        if status_ps == 200 and isinstance(ps_payload, dict):
            ollama_available = True
            running_list = ps_payload.get("models") or []
            if isinstance(running_list, list):
                for entry in running_list:
                    if not isinstance(entry, dict):
                        continue
                    mname = str(entry.get("name") or entry.get("model") or "").strip()
                    if not mname:
                        continue
                    local_running.add(mname)
                    local_installed.add(mname)
                    existing = catalog_map.get(mname)
                    if existing:
                        existing["running"] = True
                        existing["installed"] = True
                        existing["source"] = "local"
                        existing["needsDownload"] = False
                        if existing.get("provider") in (None, "local"):
                            existing["provider"] = "ollama"
                    else:
                        catalog_map[mname] = {
                            "name": mname,
                            "model": mname,
                            "source": "local",
                            "provider": "ollama",
                            "installed": True,
                            "running": True,
                            "needsDownload": False,
                        }
    except Exception:
        pass

    if configured_model and configured_model not in catalog_map:
        inst = configured_model in local_installed
        run = configured_model in local_running
        catalog_map[configured_model] = {
            "name": configured_model,
            "model": configured_model,
            "source": "local" if (inst or run) else "cloud",
            "provider": "local",
            "installed": inst,
            "running": run,
            "needsDownload": not (inst or run),
        }

    def _sort_key(item: dict[str, Any]) -> tuple[int, int, int, str]:
        return (
            0 if item["name"] == configured_model else 1,
            0 if item["running"] else 1,
            0 if item["installed"] else 1,
            item["name"],
        )

    catalog = sorted(catalog_map.values(), key=_sort_key)
    models = [c["name"] for c in catalog]
    local_available = lmstudio_available or ollama_available

    return {
        "online": len(models) > 0,
        "configuredModel": configured_model,
        "models": models,
        "catalog": catalog,
        "localAvailable": local_available,
        "remoteAvailable": False,
    }


@router.get("/llm-models")
@router.get("/ollama-models")
async def list_llm_models() -> dict[str, Any]:
    return await _build_unified_llm_models_payload()


async def _verify_model(model: str) -> tuple[bool, str]:
    configs = load_active_tool_configs()
    llm_cfg = configs["llm"]
    lmstudio_base = str(llm_cfg.get("lmstudio_base_url") or config.LMSTUDIO_BASE_URL).rstrip("/")
    ollama_base = str(llm_cfg.get("ollama_base_url") or config.OLLAMA_BASE_URL).rstrip("/")

    # Try LM Studio first if model is served there
    try:
        st, lms_models = await _fetch_provider_json("GET", f"{lmstudio_base}/models")
        if st == 200 and isinstance(lms_models, dict):
            ids = [str(m.get("id") or "") for m in (lms_models.get("data") or []) if isinstance(m, dict)]
            if any(i.lower() == model.lower() for i in ids):
                st_chat, chat_resp = await _fetch_provider_json(
                    "POST",
                    f"{lmstudio_base}/chat/completions",
                    {
                        "model": model,
                        "messages": [{"role": "user", "content": "Responda apenas com: ok"}],
                        "max_tokens": 8,
                    },
                )
                if st_chat == 200:
                    return True, "ok"
    except Exception:
        pass

    # Try Ollama /api/chat
    try:
        st, payload = await _fetch_provider_json(
            "POST",
            f"{ollama_base}/api/chat",
            {
                "model": model,
                "messages": [{"role": "user", "content": "Responda apenas com: ok"}],
                "stream": False,
            },
        )
        if st != 200:
            if st in (401, 403):
                return False, "Ollama rejeitou a autenticação da requisição. Verifique suas credenciais."
            if st == 404:
                return False, f"Modelo '{model}' não encontrado. Verifique o nome ou baixe localmente com 'ollama pull {model}'."
            if st == 429:
                return False, "Limite de requisições no Ollama (429). Aguarde alguns instantes e tente novamente."
            return False, f"Teste do modelo falhou ({st})."
        if isinstance(payload, dict):
            msg = payload.get("message")
            content = str(
                (msg.get("content") if isinstance(msg, dict) else None)
                or payload.get("response")
                or ""
            ).strip()
            if not content:
                return False, "O modelo respondeu sem conteúdo no teste."
            return True, content
        return False, "Resposta inválida do servidor local."
    except Exception as exc:
        return False, f"Não foi possível conectar ao LM Studio ou Ollama ({exc})."


@router.post("/llm-models/register", response_model=None)
@router.post("/ollama-models/register", response_model=None)
async def register_llm_model(body: dict[str, Any] = Body(default_factory=dict)) -> Any:
    raw_name = str((body or {}).get("name") or "").strip()
    source_raw = str((body or {}).get("source") or "").strip()

    if not raw_name:
        return JSONResponse(
            status_code=400,
            content={"detail": "O nome do modelo é obrigatório."},
        )
    if source_raw not in ("cloud", "local"):
        return JSONResponse(
            status_code=400,
            content={"detail": "A origem do modelo deve ser cloud ou local."},
        )

    resolved_name = raw_name
    if source_raw == "local":
        # Check if already available in LM Studio before requiring ollama pull
        lms_has_model = False
        try:
            configs = load_active_tool_configs()
            lmstudio_base = str(configs["llm"].get("lmstudio_base_url") or config.LMSTUDIO_BASE_URL).rstrip("/")
            st, lms_payload = await _fetch_provider_json("GET", f"{lmstudio_base}/models")
            if st == 200 and isinstance(lms_payload, dict):
                ids = [str(m.get("id") or "") for m in (lms_payload.get("data") or []) if isinstance(m, dict)]
                lms_has_model = any(i.lower() == raw_name.lower() for i in ids)
        except Exception:
            lms_has_model = False

        if not lms_has_model:
            pull = await _run_ollama_cli(["pull", raw_name])
            if not pull.get("ok"):
                detail_msg = (
                    f"Falha ao baixar o modelo '{raw_name}'. "
                    f"{pull.get('stderr') or pull.get('stdout') or pull.get('errorMessage') or ''}"
                ).strip()
                return JSONResponse(status_code=400, content={"detail": detail_msg})

    candidates = (
        [raw_name, f"{raw_name}-cloud"]
        if source_raw == "cloud" and not raw_name.endswith("-cloud")
        else [raw_name]
    )
    verified = False
    last_error = "Falha ao verificar o modelo."
    for candidate in candidates:
        ok, err_or_content = await _verify_model(candidate)
        if ok:
            verified = True
            resolved_name = candidate
            break
        last_error = err_or_content

    if not verified:
        return JSONResponse(status_code=400, content={"detail": last_error})

    active = load_active_tool_configs()
    current = normalize_registered_models(active["llm"].get("registered_models"))
    filtered = [m for m in current if m["name"].lower() != resolved_name.lower()]
    filtered.append({"name": resolved_name, "source": source_raw})

    updated = update_tool_configs(
        {
            "llm": {
                **active["llm"],
                "registered_models": filtered,
            }
        }
    )
    return {
        "success": True,
        "message": "Modelo cadastrado e verificado com sucesso.",
        "model": {"name": resolved_name, "source": source_raw},
        "configuredModel": updated["llm"]["model"],
    }


@router.delete("/llm-models/{model_name}", response_model=None)
@router.delete("/ollama-models/{model_name}", response_model=None)
async def delete_llm_model(model_name: str) -> Any:
    decoded = urllib.parse.unquote(model_name or "").strip()
    if not decoded:
        return JSONResponse(status_code=400, content={"detail": "Nome do modelo inválido."})

    active = load_active_tool_configs()
    current = normalize_registered_models(active["llm"].get("registered_models"))
    remaining = [m for m in current if m["name"].lower() != decoded.lower()]

    update_tool_configs(
        {
            "llm": {
                **active["llm"],
                "registered_models": remaining,
            }
        }
    )

    rm_res = await _run_ollama_cli(["rm", decoded])
    rm_ok = bool(rm_res.get("ok"))
    rm_msg = (
        f"Modelo '{decoded}' removido do Ollama local."
        if rm_ok
        else f"Cadastro removido. Não foi possível remover no Ollama local: {rm_res.get('stderr') or rm_res.get('stdout') or rm_res.get('errorMessage') or 'sem detalhes'}"
    )
    return {
        "success": True,
        "message": rm_msg,
        "removedModel": decoded,
        "removedFromLocal": rm_ok,
    }


# --- Settings (`/config/settings`) ---


@router.get("/settings")
async def get_settings_route() -> dict[str, Any]:
    return load_settings().model_dump()


@router.post("/settings")
async def update_settings_route(body: dict[str, Any] = Body(default_factory=dict)) -> dict[str, Any]:
    return update_settings(body or {}).model_dump()


# --- Tool Configs (`/config/tool-configs*`) ---


@router.get("/tool-configs")
async def get_tool_configs_route() -> dict[str, Any]:
    return get_tool_configs_payload()


@router.post("/tool-configs")
async def update_tool_configs_route(
    body: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    return update_tool_configs_payload(body or {})


@router.post("/tool-configs/reset")
async def reset_all_tool_configs_route() -> dict[str, Any]:
    return reset_all_tool_configs_payload()


@router.post("/tool-configs/reset/{section}", response_model=None)
async def reset_tool_config_section_route(section: str) -> Any:
    if not section or not is_resettable_tool_config_section(section):
        return JSONResponse(status_code=400, content={"detail": "Invalid section"})
    return reset_tool_config_section_payload(section)  # type: ignore[arg-type]


@router.post("/tool-configs/import")
async def import_tool_configs_route(
    body: dict[str, Any] = Body(default_factory=dict),
) -> dict[str, Any]:
    return import_tool_configs_payload(body or {})


# --- Prompts (`/config/llm-prompt*` & `/config/llm-saved-prompts`) ---


def _load_saved_prompts() -> list[dict[str, str]]:
    sf = saved_llm_prompts_file_path()
    if not sf.exists():
        atomic_write_json(sf, [], trailing_newline=True)
        return []
    try:
        raw = read_json(sf)
        if not isinstance(raw, list):
            return []
        items: list[dict[str, str]] = []
        now = utc_now_iso()
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            pid = str(entry.get("id") or "").strip()
            name = str(entry.get("name") or "").strip()
            prompt = str(entry.get("prompt") or "")
            created_at = str(entry.get("created_at") or "").strip() or now
            updated_at = str(entry.get("updated_at") or "").strip() or created_at
            if not pid or not name or not prompt:
                continue
            items.append(
                {
                    "id": pid,
                    "name": name,
                    "prompt": prompt,
                    "created_at": created_at,
                    "updated_at": updated_at,
                }
            )
        items.sort(key=lambda x: x["updated_at"], reverse=True)
        return items
    except Exception:
        return []


def _upsert_saved_prompt(name: str, prompt: str) -> dict[str, list[dict[str, str]]]:
    sf = saved_llm_prompts_file_path()
    now = utc_now_iso()
    prompts = _load_saved_prompts()
    existing_idx = next(
        (i for i, item in enumerate(prompts) if item["name"].lower() == name.lower()),
        -1,
    )
    if existing_idx >= 0:
        prompts[existing_idx] = {
            **prompts[existing_idx],
            "name": name,
            "prompt": prompt,
            "updated_at": now,
        }
    else:
        pid = f"p_{int(time.time() * 1000):x}_{int(time.monotonic_ns()) % 1000000:06x}"
        prompts.insert(
            0,
            {
                "id": pid,
                "name": name,
                "prompt": prompt,
                "created_at": now,
                "updated_at": now,
            },
        )
    atomic_write_json(sf, prompts, trailing_newline=True)
    return {"prompts": _load_saved_prompts()}


@router.get("/llm-prompt")
async def get_llm_prompt() -> dict[str, str]:
    configs = load_active_tool_configs()
    return {
        "prompt": str(configs["llm"].get("system_prompt") or SYSTEM_PROMPT_TEMPLATE),
        "version": PROMPT_VERSION,
    }


@router.get("/llm-prompt/default")
async def get_default_llm_prompt() -> dict[str, str]:
    return {
        "prompt": SYSTEM_PROMPT_TEMPLATE,
        "version": PROMPT_VERSION,
    }


@router.get("/llm-saved-prompts")
async def get_saved_llm_prompts() -> dict[str, list[dict[str, str]]]:
    return {"prompts": _load_saved_prompts()}


@router.post("/llm-saved-prompts", response_model=None)
async def save_llm_prompt(body: dict[str, Any] = Body(default_factory=dict)) -> Any:
    name = str((body or {}).get("name") or "").strip()
    prompt = str((body or {}).get("prompt") or "").strip()
    if not name:
        return JSONResponse(
            status_code=400,
            content={"detail": "Nome do prompt é obrigatório."},
        )
    if not prompt:
        return JSONResponse(
            status_code=400,
            content={"detail": "Prompt não pode estar vazio."},
        )
    return _upsert_saved_prompt(name, prompt)


# --- Folders (`/config/common-folders` & `/config/select-folder`) ---


@router.get("/common-folders")
async def get_common_folders() -> dict[str, list[dict[str, Any]]]:
    home = Path.home()
    candidates = [
        ("📥 Downloads", home / "Downloads"),
        ("📄 Documentos", home / "Documents"),
        ("🏠 Home", home),
        ("🖥️ Desktop", home / "Desktop"),
    ]
    folders = [
        {"name": label, "path": str(path), "exists": path.exists()}
        for label, path in candidates
    ]
    return {"folders": folders}


def _default_select_folder() -> dict[str, Any]:
    return {"selected": False, "path": None}


@router.post("/select-folder")
async def select_folder() -> dict[str, Any]:
    container = get_container()
    picker = container.folder_picker or _default_select_folder
    return picker()


# --- Dependencies (`/config/dependencies*`) ---


async def _default_probe_dependencies() -> dict[str, Any]:
    py_ver = f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}"
    return {
        "dependencies": {
            "python": {"installed": True, "version": py_ver},
            "whisper": {"installed": True, "version": "1.2.1"},
            "ytdlp": {"installed": True, "version": "installed"},
            "ffmpeg": {
                "installed": shutil.which("ffmpeg") is not None,
                "version": "installed" if shutil.which("ffmpeg") else None,
            },
            "cuda": {
                "installed": shutil.which("nvidia-smi") is not None,
                "version": "installed" if shutil.which("nvidia-smi") else None,
            },
            "pytorch": {"installed": False, "version": None},
            "ollama": {
                "installed": shutil.which("ollama") is not None,
                "version": "installed" if shutil.which("ollama") else None,
            },
        },
        "diagnostics": [],
    }


def _parse_pytorch_gpu_tier(body: dict[str, Any] | None) -> str | None:
    tier = (body or {}).get("pytorchGpuTier")
    if tier in ("rtx_4000_or_lower", "rtx_5000"):
        return str(tier)
    return None


@router.get("/dependencies")
async def get_dependencies() -> dict[str, Any]:
    container = get_container()
    prober = container.dependency_prober or _default_probe_dependencies
    return await prober()


@router.get("/dependencies/{name}/instructions", response_model=None)
async def get_dependency_instructions(name: str) -> Any:
    guide = INSTALLATION_GUIDES.get(name)
    if not guide:
        return JSONResponse(status_code=404, content={"error": "Dependency not found"})
    return guide


async def _execute_dependency_install(
    name: str,
    options: dict[str, Any] | None = None,
    token: CancelToken | None = None,
    on_log: Any = None,
) -> tuple[int, dict[str, Any]]:
    container = get_container()
    if container.dependency_installer is not None:
        return await container.dependency_installer(name, options, token, on_log)

    guide = INSTALLATION_GUIDES.get(name)
    if not guide:
        return 404, {"success": False, "message": f"Dependency '{name}' not found"}

    if name == "pytorch" and not (options or {}).get("pytorchGpuTier"):
        return 400, {"success": False, "message": PYTORCH_GPU_TIER_REQUIRED_MESSAGE}

    if not guide.get("automatic"):
        snap = await (container.dependency_prober or _default_probe_dependencies)()
        return 400, {
            "success": False,
            "error": "Automatic installation not available for this dependency",
            "message": f"Use manual installation for {name}",
            "dependencies": snap.get("dependencies"),
        }

    if token is not None and token.is_set():
        return 499, {
            "success": False,
            "message": f"Instalação de {guide['name']} cancelada pelo usuário",
        }

    snap = await (container.dependency_prober or _default_probe_dependencies)()
    return 200, {
        "success": True,
        "message": f"{guide['name']} installed and validated successfully",
        "dependencies": snap.get("dependencies"),
        "diagnostics": snap.get("diagnostics", []),
    }


async def _execute_dependency_uninstall(
    name: str,
    token: CancelToken | None = None,
    on_log: Any = None,
) -> tuple[int, dict[str, Any]]:
    container = get_container()
    if container.dependency_uninstaller is not None:
        return await container.dependency_uninstaller(name, token, on_log)

    guide = INSTALLATION_GUIDES.get(name)
    if not guide:
        return 404, {"success": False, "message": f"Dependency '{name}' not found"}

    if token is not None and token.is_set():
        return 499, {
            "success": False,
            "message": f"Desinstalação de {guide['name']} cancelada pelo usuário",
        }

    snap = await (container.dependency_prober or _default_probe_dependencies)()
    return 200, {
        "success": True,
        "message": f"{guide['name']} uninstalled and validated successfully",
        "dependencies": snap.get("dependencies"),
        "diagnostics": snap.get("diagnostics", []),
    }


@router.post("/dependencies/{name}/install", response_model=None)
async def install_dependency(
    name: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    tier = _parse_pytorch_gpu_tier(body)
    if name == "pytorch" and not tier:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": PYTORCH_GPU_TIER_REQUIRED_MESSAGE},
        )
    options = {"pytorchGpuTier": tier} if tier else {}
    status_code, payload = await _execute_dependency_install(name, options)
    return JSONResponse(status_code=status_code, content=payload)


@router.post("/dependencies/{name}/uninstall", response_model=None)
async def uninstall_dependency(name: str) -> Any:
    status_code, payload = await _execute_dependency_uninstall(name)
    return JSONResponse(status_code=status_code, content=payload)


@router.post("/dependencies/{name}/install/start", response_model=None)
async def start_install_dependency(
    name: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    tier = _parse_pytorch_gpu_tier(body)
    if name == "pytorch" and not tier:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": PYTORCH_GPU_TIER_REQUIRED_MESSAGE},
        )
    options = {"pytorchGpuTier": tier} if tier else {}
    container = get_container()

    async def _runner(token: CancelToken, on_log: Any) -> dict[str, Any]:
        _code, payload = await _execute_dependency_install(name, options, token, on_log)
        return payload

    started = container.runtime.start_dependency_session(name, "install", _runner)
    return JSONResponse(status_code=202, content=started)


@router.post("/dependencies/{name}/uninstall/start", response_model=None)
async def start_uninstall_dependency(name: str) -> Any:
    container = get_container()

    async def _runner(token: CancelToken, on_log: Any) -> dict[str, Any]:
        _code, payload = await _execute_dependency_uninstall(name, token, on_log)
        return payload

    started = container.runtime.start_dependency_session(name, "uninstall", _runner)
    return JSONResponse(status_code=202, content=started)


@router.get("/dependencies/install-sessions/{session_id}", response_model=None)
async def get_install_session(session_id: str) -> Any:
    container = get_container()
    session = container.runtime.get_dependency_session(session_id)
    if session is None:
        return JSONResponse(
            status_code=404,
            content={
                "success": False,
                "message": f"Install session '{session_id}' was not found",
            },
        )
    return session


@router.post("/dependencies/install-sessions/{session_id}/cancel", response_model=None)
async def cancel_install_session(session_id: str) -> Any:
    container = get_container()
    status_code, payload = container.runtime.cancel_dependency_session(session_id)
    return JSONResponse(status_code=status_code, content=payload)


def _get_terminal_command(name: str, mode: str, tier: str | None) -> str | None:
    if name not in INSTALLATION_GUIDES:
        return None
    if name == "pytorch":
        if mode == "uninstall":
            return "pip uninstall -y torch torchvision torchaudio"
        if not tier:
            return None
        if tier == "rtx_5000":
            return "pip install --pre torch torchvision torchaudio --index-url https://download.pytorch.org/whl/nightly/cu128"
        return "pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu121"
    if mode == "uninstall":
        uninstall_cmds = {
            "python": "winget uninstall Python.Python.3.11",
            "ffmpeg": "winget uninstall Gyan.FFmpeg",
            "whisper": "pip uninstall -y faster-whisper openai-whisper",
            "ytdlp": "pip uninstall -y yt-dlp",
        }
        return uninstall_cmds.get(name)
    auto = INSTALLATION_GUIDES[name].get("automatic")
    return auto.get("command") if isinstance(auto, dict) else None


def _default_open_terminal(command: str) -> dict[str, Any]:
    if os.name != "nt":
        return {"success": False, "error": "Opening a system terminal is supported on Windows."}
    try:
        subprocess.Popen(["cmd.exe", "/c", "start", "", "powershell.exe", "-NoExit", "-Command", command])
        return {"success": True}
    except Exception as exc:
        return {"success": False, "error": str(exc)}


@router.post("/dependencies/{name}/open-terminal", response_model=None)
async def open_dependency_terminal(
    name: str,
    body: dict[str, Any] = Body(default_factory=dict),
) -> Any:
    mode = "uninstall" if (body or {}).get("mode") == "uninstall" else "install"
    tier = _parse_pytorch_gpu_tier(body)
    if name == "pytorch" and mode == "install" and not tier:
        return JSONResponse(
            status_code=400,
            content={"success": False, "message": PYTORCH_GPU_TIER_REQUIRED_MESSAGE},
        )
    command = _get_terminal_command(name, mode, tier)
    if not command:
        return JSONResponse(
            status_code=400,
            content={
                "success": False,
                "message": f"No terminal command available for {name} ({mode})",
            },
        )
    container = get_container()
    opener = container.terminal_opener or _default_open_terminal
    opened = opener(command)
    if not opened.get("success"):
        return JSONResponse(
            status_code=500,
            content={
                "success": False,
                "message": opened.get("error") or "Failed to open terminal",
                "command": command,
            },
        )
    return {
        "success": True,
        "message": f"Opened the default system terminal with the {mode} command.",
        "command": command,
    }
