"""Unified local LLM adapter supporting LM Studio (:1234/v1) and Ollama (:11434).

Features:
- Dual local provider support (LM Studio OpenAI-compatible v1 & Ollama native API).
- Zero-config auto-detection of loaded/installed chat models (calibrated for RTX 5070 12GB).
- Embeddings via `nomic-embed-text` with CPU offload (`options={"num_gpu": 0}`, `keep_alive: 0`)
  to prevent VRAM model thrashing against the 14B chat model.
- Structured Outputs via strict JSON Schema (`CUTS_RESPONSE_JSON_SCHEMA` and
  `BOUNDARY_LOOKAROUND_JSON_SCHEMA`).
- Hardware concurrency protection via `c.scheduler.gpu_slot("analysis")`.
"""

from __future__ import annotations

import json
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator, Awaitable, Callable, Literal, Sequence

import httpx

from app.application.runtime_service import CancelToken, ServiceContainer, get_container
from app.core.config import CUTS_RESPONSE_JSON_SCHEMA, config

HttpFetcherFn = Callable[[str, str, dict[str, Any] | None], Awaitable[tuple[int, Any]]]

PREFERRED_CHAT_MODELS: tuple[str, ...] = (
    "qwen2.5:14b",
    "qwen2.5-14b-instruct",
    "qwen2.5:7b",
    "qwen2.5-7b-instruct",
    "gemma3:12b",
    "llama3.1:8b",
)

BOUNDARY_LOOKAROUND_JSON_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "adjustments": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "candidate_index": {"type": "integer"},
                    "adjusted_start_block_id": {"type": "string"},
                    "adjusted_end_block_id": {"type": "string"},
                    "is_complete_story": {"type": "boolean"},
                    "reason": {"type": "string"},
                },
                "required": [
                    "candidate_index",
                    "adjusted_start_block_id",
                    "adjusted_end_block_id",
                    "is_complete_story",
                ],
                "additionalProperties": False,
            },
        }
    },
    "required": ["adjustments"],
    "additionalProperties": False,
}


class LocalLLMUnavailableError(RuntimeError):
    """Raised when neither LM Studio (:1234) nor Ollama (:11434) is reachable."""

    def __init__(
        self,
        detail: str = (
            "Não foi possível conectar ao LM Studio (127.0.0.1:1234) nem ao Ollama (127.0.0.1:11434). "
            "Abra o LM Studio ou Ollama com um modelo local carregado."
        ),
        *,
        error_code: str = "LOCAL_LLM_UNAVAILABLE",
        stage: str = "ANALYZING",
        recoverable: bool = True,
    ) -> None:
        super().__init__(detail)
        self.detail = detail
        self.status_code = 503
        self.error_code = error_code
        self.stage = stage
        self.recoverable = recoverable

    def to_dict(self) -> dict[str, Any]:
        return {
            "detail": self.detail,
            "error_code": self.error_code,
            "stage": self.stage,
            "recoverable": self.recoverable,
        }


class InvalidLLMJsonResponseError(ValueError):
    """Raised when the LLM returns a response that cannot be parsed as JSON."""

    def __init__(self, raw_text: str, message: str | None = None) -> None:
        msg = message or f"LLM response is not valid JSON. Raw: {raw_text[:300]}"
        super().__init__(msg)
        self.raw_text = raw_text


@dataclass
class ProviderResolution:
    provider: Literal["lmstudio", "ollama"]
    base_url: str
    model: str
    online: bool = True


def _is_embedding_model_name(name: str) -> bool:
    low = name.lower()
    return "embed" in low or "bge-" in low or "e5-" in low


def _match_best_model(available: Sequence[str], configured: str) -> str:
    """Select configured model if available, otherwise pick the best local chat model."""
    chat_models = [m for m in available if m and not _is_embedding_model_name(m)]
    pool = chat_models or list(available)
    if not pool:
        return configured or config.OLLAMA_MODEL

    cfg_lower = (configured or "").strip().lower()
    if cfg_lower:
        for m in pool:
            if m.lower() == cfg_lower:
                return m
        # Normalized match (e.g. qwen2.5:14b <-> qwen2.5-14b-instruct)
        cfg_norm = re.sub(r"[^a-z0-9]+", "-", cfg_lower).strip("-")
        for m in pool:
            m_norm = re.sub(r"[^a-z0-9]+", "-", m.lower()).strip("-")
            if cfg_norm in m_norm or m_norm in cfg_norm:
                return m

    for pref in PREFERRED_CHAT_MODELS:
        pref_norm = re.sub(r"[^a-z0-9]+", "-", pref.lower()).strip("-")
        for m in pool:
            m_norm = re.sub(r"[^a-z0-9]+", "-", m.lower()).strip("-")
            if m.lower() == pref.lower() or pref_norm in m_norm:
                return m

    return pool[0]


def _extract_json_payload(raw_content: Any) -> tuple[dict[str, Any] | list[Any], str]:
    """Parse JSON object or array from LLM content string or structured dict."""
    if isinstance(raw_content, (dict, list)):
        return raw_content, json.dumps(raw_content, ensure_ascii=False)

    text = str(raw_content or "").strip()
    if not text:
        raise InvalidLLMJsonResponseError(text, "LLM returned empty response")

    # Strip optional markdown code fences
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE)
    candidate = fence_match.group(1).strip() if fence_match else text

    try:
        parsed = json.loads(candidate)
        if isinstance(parsed, (dict, list)):
            return parsed, text
    except json.JSONDecodeError:
        pass

    # Try locating outermost JSON object or array
    for start_char, end_char in (("{", "}"), ("[", "]")):
        s_idx = candidate.find(start_char)
        e_idx = candidate.rfind(end_char)
        if s_idx != -1 and e_idx != -1 and e_idx > s_idx:
            snippet = candidate[s_idx : e_idx + 1]
            try:
                parsed = json.loads(snippet)
                if isinstance(parsed, (dict, list)):
                    return parsed, text
            except json.JSONDecodeError:
                continue

    raise InvalidLLMJsonResponseError(text)


class UnifiedLocalLLMAdapter:
    """Unified client for LM Studio (`:1234/v1`) and Ollama (`:11434`)."""

    def __init__(
        self,
        *,
        container: ServiceContainer | None = None,
        http_fetcher: HttpFetcherFn | None = None,
        http_client: httpx.AsyncClient | None = None,
        provider: str | None = None,
        model: str | None = None,
        embedding_model: str | None = None,
        lmstudio_base_url: str | None = None,
        ollama_base_url: str | None = None,
        timeout: float = float(config.OLLAMA_TIMEOUT_SECONDS),
    ) -> None:
        self._container = container
        self._http_fetcher = http_fetcher
        self._http_client = http_client
        self._provider_override = provider
        self._model_override = model
        self._embedding_model_override = embedding_model
        self._lmstudio_url_override = lmstudio_base_url
        self._ollama_url_override = ollama_base_url
        self.timeout = timeout
        self.last_resolution: ProviderResolution | None = None

    @property
    def container(self) -> ServiceContainer:
        return self._container or get_container()

    def _get_llm_config(self) -> dict[str, Any]:
        try:
            active = self.container.load_active_tool_configs()
            return dict(active.get("llm") or {})
        except Exception:
            return {}

    def get_configured_urls_and_models(self) -> dict[str, str]:
        llm_cfg = self._get_llm_config()
        provider = (
            self._provider_override
            or str(llm_cfg.get("provider") or "auto").strip().lower()
            or "auto"
        )
        model = (
            self._model_override
            or str(llm_cfg.get("model") or config.OLLAMA_MODEL).strip()
            or config.OLLAMA_MODEL
        )
        embedding_model = (
            self._embedding_model_override
            or str(llm_cfg.get("embedding_model") or config.EMBEDDING_MODEL).strip()
            or config.EMBEDDING_MODEL
        )
        lmstudio_base = (
            self._lmstudio_url_override
            or str(llm_cfg.get("lmstudio_base_url") or config.LMSTUDIO_BASE_URL).strip()
            or config.LMSTUDIO_BASE_URL
        ).rstrip("/")
        ollama_base = (
            self._ollama_url_override
            or str(llm_cfg.get("ollama_base_url") or config.OLLAMA_BASE_URL).strip()
            or config.OLLAMA_BASE_URL
        ).rstrip("/")
        return {
            "provider": provider,
            "model": model,
            "embedding_model": embedding_model,
            "lmstudio_base_url": lmstudio_base,
            "ollama_base_url": ollama_base,
        }

    async def _request_json(
        self,
        method: str,
        url: str,
        json_body: dict[str, Any] | None = None,
        *,
        timeout: float | None = None,
    ) -> tuple[int, Any]:
        fetcher = self._http_fetcher or self.container.llm_http_fetcher
        if fetcher is not None:
            return await fetcher(method, url, json_body)

        req_timeout = timeout if timeout is not None else self.timeout
        if self._http_client is not None:
            resp = await self._http_client.request(
                method, url, json=json_body, timeout=req_timeout
            )
            try:
                return resp.status_code, resp.json()
            except Exception:
                return resp.status_code, resp.text

        async with httpx.AsyncClient(timeout=req_timeout) as client:
            resp = await client.request(method, url, json=json_body)
            try:
                return resp.status_code, resp.json()
            except Exception:
                return resp.status_code, resp.text

    @asynccontextmanager
    async def _maybe_gpu_slot(self, acquire: bool, holder: str = "analysis") -> AsyncIterator[None]:
        sched = self.container.scheduler
        # Avoid deadlocking if the current task already holds GPUMutex
        if not acquire or sched.gpu_mutex.locked:
            yield
            return
        async with sched.gpu_slot(holder=holder):
            yield

    async def _probe_lmstudio(self, base_url: str) -> tuple[bool, list[str]]:
        try:
            status, payload = await self._request_json("GET", f"{base_url}/models", timeout=3.0)
            if status == 200 and isinstance(payload, dict):
                data = payload.get("data")
                if isinstance(data, list):
                    models = [
                        str(item.get("id") or "").strip()
                        for item in data
                        if isinstance(item, dict) and str(item.get("id") or "").strip()
                    ]
                    return True, models
        except Exception:
            pass
        return False, []

    async def _probe_ollama(self, base_url: str) -> tuple[bool, list[str]]:
        try:
            status, payload = await self._request_json("GET", f"{base_url}/api/tags", timeout=3.0)
            if status == 200 and isinstance(payload, dict):
                raw_models = payload.get("models")
                if isinstance(raw_models, list):
                    models = [
                        str(item.get("name") or item.get("model") or "").strip()
                        for item in raw_models
                        if isinstance(item, dict)
                        and str(item.get("name") or item.get("model") or "").strip()
                    ]
                    return True, models
                return True, []
        except Exception:
            pass
        return False, []

    async def detect_provider_and_model(self) -> ProviderResolution:
        """Auto-detect active local LLM provider (LM Studio :1234 or Ollama :11434) and model."""
        cfg = self.get_configured_urls_and_models()
        provider_pref = cfg["provider"]
        configured_model = cfg["model"]
        lms_url = cfg["lmstudio_base_url"]
        ollama_url = cfg["ollama_base_url"]

        if provider_pref == "lmstudio":
            lms_ok, lms_models = await self._probe_lmstudio(lms_url)
            if lms_ok:
                resolved = ProviderResolution(
                    provider="lmstudio",
                    base_url=lms_url,
                    model=_match_best_model(lms_models, configured_model),
                    online=True,
                )
                self.last_resolution = resolved
                return resolved
            ollama_ok, ollama_models = await self._probe_ollama(ollama_url)
            if ollama_ok:
                resolved = ProviderResolution(
                    provider="ollama",
                    base_url=ollama_url,
                    model=_match_best_model(ollama_models, configured_model),
                    online=True,
                )
                self.last_resolution = resolved
                return resolved
            raise LocalLLMUnavailableError()

        if provider_pref == "ollama":
            ollama_ok, ollama_models = await self._probe_ollama(ollama_url)
            if ollama_ok:
                resolved = ProviderResolution(
                    provider="ollama",
                    base_url=ollama_url,
                    model=_match_best_model(ollama_models, configured_model),
                    online=True,
                )
                self.last_resolution = resolved
                return resolved
            lms_ok, lms_models = await self._probe_lmstudio(lms_url)
            if lms_ok:
                resolved = ProviderResolution(
                    provider="lmstudio",
                    base_url=lms_url,
                    model=_match_best_model(lms_models, configured_model),
                    online=True,
                )
                self.last_resolution = resolved
                return resolved
            raise LocalLLMUnavailableError()

        # Default "auto": prioritize LM Studio if open with loaded model, otherwise Ollama
        lms_ok, lms_models = await self._probe_lmstudio(lms_url)
        if lms_ok and lms_models:
            resolved = ProviderResolution(
                provider="lmstudio",
                base_url=lms_url,
                model=_match_best_model(lms_models, configured_model),
                online=True,
            )
            self.last_resolution = resolved
            return resolved

        ollama_ok, ollama_models = await self._probe_ollama(ollama_url)
        if ollama_ok:
            resolved = ProviderResolution(
                provider="ollama",
                base_url=ollama_url,
                model=_match_best_model(ollama_models, configured_model),
                online=True,
            )
            self.last_resolution = resolved
            return resolved

        if lms_ok:
            resolved = ProviderResolution(
                provider="lmstudio",
                base_url=lms_url,
                model=configured_model,
                online=True,
            )
            self.last_resolution = resolved
            return resolved

        raise LocalLLMUnavailableError()

    async def embed_texts(
        self,
        texts: Sequence[str],
        *,
        model: str | None = None,
        acquire_gpu_slot: bool = True,
    ) -> list[list[float]]:
        """Generate embeddings via Ollama (`num_gpu=0` CPU offload) or LM Studio (`/v1/embeddings`).

        Uses `options={"num_gpu": 0}` and `keep_alive: 0` on Ollama to avoid evicting
        the 14B chat LLM from the RTX 5070 12GB VRAM.
        """
        clean_texts = [str(t or "").strip() for t in texts]
        if not clean_texts:
            return []

        cfg = self.get_configured_urls_and_models()
        emb_model = (model or cfg["embedding_model"] or config.EMBEDDING_MODEL).strip()
        ollama_url = cfg["ollama_base_url"]
        lms_url = cfg["lmstudio_base_url"]
        provider_pref = cfg["provider"]

        async with self._maybe_gpu_slot(acquire_gpu_slot, holder="embeddings"):
            # Try Ollama /api/embed first (unless explicitly pinned to lmstudio only)
            if provider_pref in ("auto", "ollama"):
                try:
                    status, payload = await self._request_json(
                        "POST",
                        f"{ollama_url}/api/embed",
                        {
                            "model": emb_model,
                            "input": clean_texts,
                            "options": {"num_gpu": 0},
                            "keep_alive": 0,
                        },
                        timeout=30.0,
                    )
                    if status == 200 and isinstance(payload, dict):
                        embeddings = payload.get("embeddings")
                        if isinstance(embeddings, list) and len(embeddings) == len(clean_texts):
                            return [[float(x) for x in vec] for vec in embeddings]
                        single = payload.get("embedding")
                        if isinstance(single, list) and len(clean_texts) == 1:
                            return [[float(x) for x in single]]
                except Exception:
                    pass

            # Try LM Studio /v1/embeddings
            if provider_pref in ("auto", "lmstudio", "ollama"):
                try:
                    status, payload = await self._request_json(
                        "POST",
                        f"{lms_url}/embeddings",
                        {
                            "model": emb_model,
                            "input": clean_texts,
                        },
                        timeout=30.0,
                    )
                    if status == 200 and isinstance(payload, dict):
                        data = payload.get("data")
                        if isinstance(data, list) and len(data) == len(clean_texts):
                            return [
                                [float(x) for x in item.get("embedding", [])]
                                for item in data
                                if isinstance(item, dict)
                            ]
                except Exception:
                    pass

        return []

    async def generate_structured(self, *args: Any, **kwargs: Any) -> Any:
        res = await self.chat_json(*args, **kwargs)
        if isinstance(res, tuple):
            return res[0]
        return res

    async def chat_json(
        self,
        system_prompt: str,
        user_prompt: str,
        *,
        json_schema: dict[str, Any] = CUTS_RESPONSE_JSON_SCHEMA,
        schema_name: str = "narrative_cuts",
        temperature: float = 0.2,
        acquire_gpu_slot: bool = True,
        cancel_token: CancelToken | None = None,
    ) -> tuple[dict[str, Any] | list[Any], str]:
        """Execute a structured JSON chat completion on LM Studio or Ollama."""
        if cancel_token is not None:
            cancel_token.raise_if_cancelled()

        async with self._maybe_gpu_slot(acquire_gpu_slot, holder="analysis"):
            resolution = await self.detect_provider_and_model()
            if cancel_token is not None:
                cancel_token.raise_if_cancelled()

            messages = [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]

            if resolution.provider == "lmstudio":
                req_body: dict[str, Any] = {
                    "model": resolution.model,
                    "messages": messages,
                    "temperature": temperature,
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": schema_name,
                            "strict": True,
                            "schema": json_schema,
                        },
                    },
                }
                status, payload = await self._request_json(
                    "POST",
                    f"{resolution.base_url}/chat/completions",
                    req_body,
                )
            else:
                req_body = {
                    "model": resolution.model,
                    "messages": messages,
                    "stream": False,
                    "format": json_schema,
                    "options": {
                        "temperature": temperature,
                        "num_ctx": 8192,
                    },
                }
                status, payload = await self._request_json(
                    "POST",
                    f"{resolution.base_url}/api/chat",
                    req_body,
                )

            if cancel_token is not None:
                cancel_token.raise_if_cancelled()

            if status >= 500 or status == 0:
                raise LocalLLMUnavailableError(
                    f"Local LLM provider ({resolution.provider}) returned HTTP {status}."
                )
            if status >= 400:
                detail = (
                    payload.get("detail") or payload.get("error")
                    if isinstance(payload, dict)
                    else str(payload)
                )
                raise RuntimeError(f"LLM request failed with HTTP {status}: {detail}")

            raw_content: Any = None
            if isinstance(payload, dict):
                choices = payload.get("choices")
                if isinstance(choices, list) and choices:
                    first_choice = choices[0]
                    if isinstance(first_choice, dict):
                        msg = first_choice.get("message")
                        if isinstance(msg, dict) and "content" in msg:
                            raw_content = msg["content"]
                if raw_content is None:
                    msg = payload.get("message")
                    if isinstance(msg, dict) and "content" in msg:
                        raw_content = msg["content"]
                if raw_content is None and ("cuts" in payload or "adjustments" in payload):
                    raw_content = payload
            elif isinstance(payload, (list, str)):
                raw_content = payload

            return _extract_json_payload(raw_content)
