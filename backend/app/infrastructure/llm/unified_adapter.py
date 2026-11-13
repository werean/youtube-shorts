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
import logging
import re
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Any, AsyncIterator, Awaitable, Callable, Literal, Sequence

import httpx

logger = logging.getLogger(__name__)

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

    async def detect_provider_and_model(
        self,
        *,
        preferred_model_override: str | None = None,
    ) -> ProviderResolution:
        """Auto-detect active local LLM provider (LM Studio :1234 or Ollama :11434) and model."""
        cfg = self.get_configured_urls_and_models()
        provider_pref = cfg["provider"]
        configured_model = preferred_model_override or cfg["model"]
        lms_url = cfg["lmstudio_base_url"]
        ollama_url = cfg["ollama_base_url"]

        if provider_pref == "lmstudio":
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
            if lms_ok and not lms_models:
                logger.warning(
                    "LM Studio at %s is online but has no loaded model; probing Ollama fallback.",
                    lms_url,
                )
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
            if lms_ok and not lms_models:
                raise LocalLLMUnavailableError(
                    f"LM Studio is reachable at {lms_url} but has no loaded model, and Ollama is offline."
                )
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
            if lms_ok and lms_models:
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

        if lms_ok and not lms_models:
            raise LocalLLMUnavailableError(
                f"LM Studio is reachable at {lms_url} with no model loaded, and Ollama is unavailable."
            )

        raise LocalLLMUnavailableError()

    def _match_embedding_model_id(
        self,
        lms_models: Sequence[str],
        preferred: str,
        stage_key: str | None = None,
    ) -> str:
        emb_candidates = [m for m in lms_models if _is_embedding_model_name(m)]
        pool = emb_candidates or list(lms_models)
        if not pool:
            return stage_key or preferred

        for hint in (stage_key, preferred):
            if not hint:
                continue
            hint_low = hint.strip().lower()
            hint_norm = re.sub(r"[^a-z0-9]+", "-", hint_low).strip("-")
            for m in pool:
                if m.lower() == hint_low:
                    return m
            if hint_norm:
                for m in pool:
                    m_norm = re.sub(r"[^a-z0-9]+", "-", m.lower()).strip("-")
                    if m_norm == hint_norm or hint_norm in m_norm or m_norm in hint_norm:
                        return m
        return emb_candidates[0] if emb_candidates else (stage_key or preferred)

    async def _request_lmstudio_embeddings(
        self,
        lms_url: str,
        clean_texts: Sequence[str],
        emb_model: str,
        *,
        stage_key: str | None = None,
        lms_models: Sequence[str] | None = None,
    ) -> list[list[float]] | None:
        try:
            models = list(lms_models) if lms_models is not None else []
            if lms_models is None:
                lms_ok, probed = await self._probe_lmstudio(lms_url)
                if lms_ok:
                    models = probed
            lms_emb_model = self._match_embedding_model_id(models, emb_model, stage_key=stage_key)
            status, payload = await self._request_json(
                "POST",
                f"{lms_url}/embeddings",
                {
                    "model": lms_emb_model,
                    "input": list(clean_texts),
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
            else:
                logger.warning(
                    "LM Studio embedding request returned HTTP %s for model=%s",
                    status,
                    lms_emb_model,
                )
        except Exception as exc:
            logger.warning("LM Studio embedding request failed (%s): %s", emb_model, exc)
        return None

    async def _request_ollama_embeddings(
        self,
        ollama_url: str,
        clean_texts: Sequence[str],
        emb_model: str,
    ) -> list[list[float]] | None:
        try:
            status, payload = await self._request_json(
                "POST",
                f"{ollama_url}/api/embed",
                {
                    "model": emb_model,
                    "input": list(clean_texts),
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
            else:
                logger.warning(
                    "Ollama embedding request returned HTTP %s for model=%s",
                    status,
                    emb_model,
                )
        except Exception as exc:
            logger.warning("Ollama embedding request failed (%s): %s", emb_model, exc)
        return None

    async def embed_texts(
        self,
        texts: Sequence[str],
        *,
        model: str | None = None,
        acquire_gpu_slot: bool = True,
    ) -> list[list[float]]:
        """Generate embeddings via LM Studio on-demand (`--gpu off`) or Ollama (`num_gpu=0` CPU offload)."""
        clean_texts = [str(t or "").strip() for t in texts]
        if not clean_texts:
            return []

        cfg = self.get_configured_urls_and_models()
        emb_model = (model or cfg["embedding_model"] or config.EMBEDDING_MODEL).strip()
        ollama_url = cfg["ollama_base_url"]
        lms_url = cfg["lmstudio_base_url"]
        provider_pref = cfg["provider"]
        c = self.container
        lmstudio_cli = getattr(c, "lmstudio", None)
        cli_enabled = bool(lmstudio_cli is not None and lmstudio_cli.cli_enabled())

        async with self._maybe_gpu_slot(acquire_gpu_slot, holder="embeddings"):
            if provider_pref in ("auto", "lmstudio") and cli_enabled and lmstudio_cli is not None:
                active_emb = lmstudio_cli.active_stage_model("embedding")
                if active_emb:
                    vecs = await self._request_lmstudio_embeddings(
                        lms_url, clean_texts, emb_model, stage_key=active_emb
                    )
                    if vecs is not None:
                        return vecs
                else:
                    lms_ok, lms_models = await self._probe_lmstudio(lms_url)
                    if lms_ok and any(_is_embedding_model_name(m) for m in lms_models):
                        vecs = await self._request_lmstudio_embeddings(
                            lms_url, clean_texts, emb_model, lms_models=lms_models
                        )
                        if vecs is not None:
                            return vecs
                    else:
                        async with lmstudio_cli.stage(
                            model_type="embedding",
                            preferred_model=emb_model,
                            gpu="off",
                            task_log="topics",
                        ) as loaded_emb_key:
                            if loaded_emb_key:
                                vecs = await self._request_lmstudio_embeddings(
                                    lms_url,
                                    clean_texts,
                                    emb_model,
                                    stage_key=loaded_emb_key,
                                )
                                if vecs is not None:
                                    return vecs

                if provider_pref == "auto":
                    vecs = await self._request_ollama_embeddings(ollama_url, clean_texts, emb_model)
                    if vecs is not None:
                        return vecs
                return []

            # HTTP-only path (e.g. Ollama pinned, or HTTP-mocked unit tests without CLI runner)
            if provider_pref in ("auto", "lmstudio"):
                lms_ok, lms_models = await self._probe_lmstudio(lms_url)
                if lms_ok and (
                    provider_pref == "lmstudio"
                    or any(_is_embedding_model_name(m) for m in lms_models)
                ):
                    vecs = await self._request_lmstudio_embeddings(
                        lms_url, clean_texts, emb_model, lms_models=lms_models
                    )
                    if vecs is not None:
                        return vecs

            if provider_pref in ("auto", "ollama"):
                vecs = await self._request_ollama_embeddings(ollama_url, clean_texts, emb_model)
                if vecs is not None:
                    return vecs

            if provider_pref == "lmstudio":
                vecs = await self._request_lmstudio_embeddings(lms_url, clean_texts, emb_model)
                if vecs is not None:
                    return vecs

        return []

    async def generate_structured(self, *args: Any, **kwargs: Any) -> Any:
        res = await self.chat_json(*args, **kwargs)
        if isinstance(res, tuple):
            return res[0]
        return res

    async def _resolve_chat_provider(
        self,
        *,
        lms_url: str,
        stage_key: str | None = None,
    ) -> ProviderResolution:
        try:
            return await self.detect_provider_and_model(preferred_model_override=stage_key)
        except LocalLLMUnavailableError:
            if stage_key:
                resolved = ProviderResolution(
                    provider="lmstudio",
                    base_url=lms_url,
                    model=stage_key,
                    online=True,
                )
                self.last_resolution = resolved
                return resolved
            raise

    async def _execute_chat_json(
        self,
        resolution: ProviderResolution,
        system_prompt: str,
        user_prompt: str,
        *,
        json_schema: dict[str, Any],
        schema_name: str,
        temperature: float,
        cancel_token: CancelToken | None,
    ) -> tuple[dict[str, Any] | list[Any], str]:
        if cancel_token is not None:
            cancel_token.raise_if_cancelled()

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
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
                if status == 400:
                    logger.warning(
                        "LM Studio returned HTTP 400 for json_schema response_format; retrying with json_object."
                    )
                    fallback_body = dict(req_body)
                    fallback_body["response_format"] = {"type": "json_object"}
                    status, payload = await self._request_json(
                        "POST",
                        f"{resolution.base_url}/chat/completions",
                        fallback_body,
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
        except (httpx.TimeoutException, httpx.RequestError, OSError) as exc:
            raise LocalLLMUnavailableError(
                f"Local LLM request failed ({resolution.provider} at {resolution.base_url}): {exc}"
            ) from exc

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
        """Execute a structured JSON chat completion on LM Studio or Ollama (auto-starting LMS if needed)."""
        if cancel_token is not None:
            cancel_token.raise_if_cancelled()

        cfg = self.get_configured_urls_and_models()
        provider_pref = cfg["provider"]
        configured_model = cfg["model"]
        lms_url = cfg["lmstudio_base_url"]
        c = self.container
        lmstudio_cli = getattr(c, "lmstudio", None)
        cli_enabled = bool(lmstudio_cli is not None and lmstudio_cli.cli_enabled())

        async with self._maybe_gpu_slot(acquire_gpu_slot, holder="analysis"):
            if provider_pref in ("auto", "lmstudio") and cli_enabled and lmstudio_cli is not None:
                active_llm = lmstudio_cli.active_stage_model("llm")
                if active_llm:
                    resolution = await self._resolve_chat_provider(
                        lms_url=lms_url, stage_key=active_llm
                    )
                    return await self._execute_chat_json(
                        resolution,
                        system_prompt,
                        user_prompt,
                        json_schema=json_schema,
                        schema_name=schema_name,
                        temperature=temperature,
                        cancel_token=cancel_token,
                    )

                lms_ok, lms_models = await self._probe_lmstudio(lms_url)
                has_chat_model = lms_ok and any(not _is_embedding_model_name(m) for m in lms_models)
                if not has_chat_model:
                    async with lmstudio_cli.stage(
                        model_type="llm",
                        preferred_model=configured_model,
                        task_log="analysis",
                    ) as loaded_key:
                        resolution = await self._resolve_chat_provider(
                            lms_url=lms_url, stage_key=loaded_key
                        )
                        return await self._execute_chat_json(
                            resolution,
                            system_prompt,
                            user_prompt,
                            json_schema=json_schema,
                            schema_name=schema_name,
                            temperature=temperature,
                            cancel_token=cancel_token,
                        )

            resolution = await self.detect_provider_and_model()
            return await self._execute_chat_json(
                resolution,
                system_prompt,
                user_prompt,
                json_schema=json_schema,
                schema_name=schema_name,
                temperature=temperature,
                cancel_token=cancel_token,
            )
