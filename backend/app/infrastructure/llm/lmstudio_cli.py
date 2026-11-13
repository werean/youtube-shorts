"""LM Studio CLI (`lms`) lifecycle manager for on-demand local model loading & VRAM cleanup.

Features:
- Cross-OS binary discovery (`shutil.which("lms")` + Windows `%USERPROFILE%\\.lmstudio\\bin\\lms.exe`).
- Resilient JSON extraction from noisy CLI stdout/stderr (`Starting local model service...\\n[...]`).
- Windows asyncio-safe subprocess runner with `asyncio.to_thread(subprocess.run, ...)` fallback.
- Ref-counted `pipeline_session()` and `stage()` async context managers so models and the
  LM Studio daemon are started ONLY when needed and deterministically unloaded (`lms unload --all`)
  + stopped (`lms server stop`) in `finally:` on success, failure, or cancellation.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shutil
import subprocess
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import TYPE_CHECKING, Any, AsyncIterator, Awaitable, Callable, Literal

import httpx

from app.core.config import config

if TYPE_CHECKING:
    from app.application.runtime_service import ServiceContainer

logger = logging.getLogger(__name__)

ModelType = Literal["llm", "embedding"]
LmsCommandRunner = Callable[[list[str], float], Awaitable[tuple[int, str, str]]]

_ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;]*[A-Za-z]")


def resolve_lms_binary() -> str | None:
    """Locate the LM Studio CLI binary (`lms` / `lms.exe`) on PATH or default install dir."""
    found = shutil.which("lms")
    if found:
        return found

    if os.name == "nt":
        found_exe = shutil.which("lms.exe")
        if found_exe:
            return found_exe

    candidate = Path.home() / ".lmstudio" / "bin" / ("lms.exe" if os.name == "nt" else "lms")
    try:
        if candidate.exists() and candidate.is_file():
            return str(candidate)
    except OSError:
        pass
    return None


def _find_matching_json_end(text: str, start_idx: int) -> int | None:
    """Return inclusive end index of balanced `{...}` or `[...]` starting at `start_idx`."""
    opener = text[start_idx]
    closer = "}" if opener == "{" else "]"
    depth = 0
    in_string = False
    escaped = False

    for idx in range(start_idx, len(text)):
        ch = text[idx]
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == opener:
            depth += 1
        elif ch == closer:
            depth -= 1
            if depth == 0:
                return idx
    return None


def extract_json_from_cli_output(raw: str) -> Any:
    """Extract and parse the first valid JSON object/array from CLI output with leading/trailing noise."""
    cleaned = _ANSI_ESCAPE_RE.sub("", str(raw or "")).strip()
    if not cleaned:
        raise ValueError("CLI output is empty")

    # Fast path when output is already pure JSON
    if cleaned[0] in "{[":
        try:
            return json.loads(cleaned)
        except json.JSONDecodeError:
            pass

    pos = 0
    while pos < len(cleaned):
        next_obj = cleaned.find("{", pos)
        next_arr = cleaned.find("[", pos)
        candidates = [idx for idx in (next_obj, next_arr) if idx != -1]
        if not candidates:
            break
        start_idx = min(candidates)
        end_idx = _find_matching_json_end(cleaned, start_idx)
        if end_idx is not None:
            snippet = cleaned[start_idx : end_idx + 1]
            try:
                return json.loads(snippet)
            except json.JSONDecodeError:
                pass
        pos = start_idx + 1

    raise ValueError(f"Could not extract valid JSON from CLI output: {cleaned[:200]}")


def _normalize_model_token(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(name or "").strip().lower()).strip("-")


def _extract_model_key(item: dict[str, Any]) -> str:
    for field in ("modelKey", "identifier", "id", "model", "path"):
        val = str(item.get(field) or "").strip()
        if val:
            return val
    return ""


def _item_matches_model_type(item: dict[str, Any], model_type: ModelType) -> bool:
    raw_type = str(item.get("type") or "").strip().lower()
    if raw_type:
        return raw_type == model_type
    key = _extract_model_key(item).lower()
    is_emb = "embed" in key or "bge-" in key or "e5-" in key
    return is_emb if model_type == "embedding" else not is_emb


def _models_match(candidate_key: str, target_key: str) -> bool:
    cand_low = candidate_key.strip().lower()
    tgt_low = target_key.strip().lower()
    if not cand_low or not tgt_low:
        return False
    if cand_low == tgt_low:
        return True
    cand_norm = _normalize_model_token(cand_low)
    tgt_norm = _normalize_model_token(tgt_low)
    if not cand_norm or not tgt_norm:
        return False
    return cand_norm == tgt_norm or tgt_norm in cand_norm or cand_norm in tgt_norm


async def run_lms_subprocess(
    lms_bin: str,
    args: list[str],
    timeout: float = 15.0,
) -> tuple[int, str, str]:
    """Execute `lms` subprocess safely on Windows and POSIX event loops."""
    cmd = [lms_bin, *args]
    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            return (
                int(proc.returncode if proc.returncode is not None else 1),
                stdout_b.decode("utf-8", errors="replace"),
                stderr_b.decode("utf-8", errors="replace"),
            )
        except asyncio.TimeoutError:
            try:
                proc.kill()
                await proc.wait()
            except Exception:
                pass
            return 124, "", f"Command timed out after {timeout:.1f}s: {' '.join(cmd)}"
    except NotImplementedError:
        try:
            res = await asyncio.to_thread(
                subprocess.run,
                cmd,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=timeout,
                check=False,
            )
            return int(res.returncode), res.stdout or "", res.stderr or ""
        except subprocess.TimeoutExpired:
            return 124, "", f"Command timed out after {timeout:.1f}s: {' '.join(cmd)}"
        except Exception as exc:
            return 1, "", str(exc)
    except Exception as exc:
        return 1, "", str(exc)


class LMStudioCLIManager:
    """Manages on-demand LM Studio daemon & model lifecycle via `lms` CLI."""

    def __init__(
        self,
        *,
        container: ServiceContainer | None = None,
        runner: LmsCommandRunner | None = None,
        base_url: str | None = None,
    ) -> None:
        self._container = container
        self._runner = runner
        self._base_url = base_url
        self._state_lock = asyncio.Lock()
        self._session_depth: int = 0
        self._stage_depth: int = 0
        self._active_model_key: str | None = None
        self._active_model_type: ModelType | None = None
        self._active_gpu: str | None = None

    def _get_runner(self) -> LmsCommandRunner | None:
        if self._runner is not None:
            return self._runner
        if self._container is not None:
            return getattr(self._container, "lms_command_runner", None)
        return None

    def _has_custom_runner(self) -> bool:
        return self._get_runner() is not None

    def is_installed(self) -> bool:
        if self._has_custom_runner():
            return True
        return resolve_lms_binary() is not None

    def cli_enabled(self) -> bool:
        """Return True when CLI automation should run (custom runner or real runtime without HTTP test mock)."""
        if self._has_custom_runner():
            return True
        if self._container is not None and getattr(self._container, "llm_http_fetcher", None) is not None:
            return False
        return resolve_lms_binary() is not None

    def in_session(self) -> bool:
        return self._session_depth > 0

    def in_stage(self) -> bool:
        return self._stage_depth > 0

    def active_stage_model(self, model_type: ModelType | None = None) -> str | None:
        if self._stage_depth <= 0 or not self._active_model_key:
            return None
        if model_type is not None and self._active_model_type != model_type:
            return None
        return self._active_model_key

    def _get_base_url(self) -> str:
        if self._base_url:
            return self._base_url.rstrip("/")
        if self._container is not None:
            try:
                active = self._container.load_active_tool_configs()
                llm_cfg = active.get("llm") or {}
                configured = str(llm_cfg.get("lmstudio_base_url") or "").strip()
                if configured:
                    return configured.rstrip("/")
            except Exception:
                pass
        return config.LMSTUDIO_BASE_URL.rstrip("/")

    def _log(self, job_id: str | None, task_log: str, message: str) -> None:
        logger.info(message)
        if job_id and self._container is not None:
            runtime = getattr(self._container, "runtime", None)
            if runtime is not None and hasattr(runtime, "append_task_log"):
                try:
                    runtime.append_task_log(job_id, task_log, message)
                except Exception:
                    pass

    async def _run_lms(self, args: list[str], *, timeout: float = 15.0) -> tuple[int, str, str]:
        runner = self._get_runner()
        if runner is not None:
            return await runner(list(args), float(timeout))
        if not self.cli_enabled():
            return 1, "", "LM Studio CLI automation is disabled"
        lms_bin = resolve_lms_binary()
        if not lms_bin:
            return 1, "", "lms binary not found"
        return await run_lms_subprocess(lms_bin, list(args), timeout=timeout)

    async def _http_server_ready(self) -> bool:
        base_url = self._get_base_url()
        if self._container is not None:
            fetcher = getattr(self._container, "llm_http_fetcher", None)
            if fetcher is not None:
                try:
                    status, payload = await fetcher("GET", f"{base_url}/models", None)
                    return status == 200 and isinstance(payload, dict)
                except Exception:
                    return False
        try:
            async with httpx.AsyncClient(timeout=1.5) as client:
                resp = await client.get(f"{base_url}/models")
                return resp.status_code == 200
        except Exception:
            return False

    async def server_status(self) -> bool:
        """Check whether the LM Studio local server is running via `lms server status --json`."""
        if not self.cli_enabled():
            return False
        rc, stdout, stderr = await self._run_lms(["server", "status", "--json"], timeout=10.0)
        for raw in (stdout, stderr, f"{stdout}\n{stderr}"):
            if not raw.strip():
                continue
            try:
                parsed = extract_json_from_cli_output(raw)
                if isinstance(parsed, dict) and "running" in parsed:
                    return bool(parsed["running"])
            except Exception:
                continue
        combined = f"{stdout}\n{stderr}".lower()
        if rc == 0 and "running" in combined and "not running" not in combined and "stopped" not in combined:
            return True
        return False

    async def start_server(self, timeout_s: float = 15.0) -> bool:
        """Start the LM Studio local server if not already running and wait until ready."""
        if not self.cli_enabled():
            return False
        if await self.server_status():
            return True

        rc, _stdout, stderr = await self._run_lms(["server", "start"], timeout=max(10.0, timeout_s))
        deadline = time.monotonic() + max(1.0, float(timeout_s))

        while True:
            if await self.server_status():
                return True
            if await self._http_server_ready():
                return True
            if rc != 0 and time.monotonic() >= deadline:
                break
            if time.monotonic() >= deadline:
                break
            await asyncio.sleep(0.25)

        if stderr.strip():
            logger.warning("LM Studio server start did not confirm ready state: %s", stderr.strip())
        return False

    async def stop_server(self) -> bool:
        """Stop the LM Studio local server (`lms server stop`)."""
        if not self.cli_enabled():
            return False
        rc, stdout, stderr = await self._run_lms(["server", "stop"], timeout=15.0)
        if rc == 0:
            return True
        combined = f"{stdout}\n{stderr}".lower()
        if "not running" in combined or "already stopped" in combined:
            return True
        return False

    async def list_installed_models(
        self,
        model_type: ModelType | None = None,
    ) -> list[dict[str, Any]]:
        """List models downloaded in LM Studio via `lms ls --json`, optionally filtered by type."""
        if not self.cli_enabled():
            return []
        rc, stdout, stderr = await self._run_lms(["ls", "--json"], timeout=15.0)
        if rc != 0 and not stdout.strip():
            return []

        parsed: Any = None
        for raw in (stdout, stderr, f"{stdout}\n{stderr}"):
            if not raw.strip():
                continue
            try:
                parsed = extract_json_from_cli_output(raw)
                break
            except Exception:
                continue

        if isinstance(parsed, dict):
            parsed = parsed.get("models") or parsed.get("data") or []
        if not isinstance(parsed, list):
            return []

        items = [item for item in parsed if isinstance(item, dict)]
        if model_type is not None:
            items = [item for item in items if _item_matches_model_type(item, model_type)]
        return items

    async def list_loaded_models(self) -> list[dict[str, Any]]:
        """List currently loaded models via `lms ps --json` (short-circuits to `[]` if server stopped)."""
        if not self.cli_enabled():
            return []
        if not await self.server_status():
            return []

        rc, stdout, stderr = await self._run_lms(["ps", "--json"], timeout=10.0)
        if rc != 0 and not stdout.strip():
            return []

        parsed: Any = None
        for raw in (stdout, stderr, f"{stdout}\n{stderr}"):
            if not raw.strip():
                continue
            try:
                parsed = extract_json_from_cli_output(raw)
                break
            except Exception:
                continue

        if isinstance(parsed, dict):
            parsed = parsed.get("models") or parsed.get("data") or []
        if not isinstance(parsed, list):
            return []
        return [item for item in parsed if isinstance(item, dict)]

    async def resolve_model_key(
        self,
        preferred: str | None,
        *,
        model_type: ModelType = "llm",
        fallback_to_preferred_when_empty: bool = False,
    ) -> str | None:
        """Resolve an installed LM Studio `modelKey` matching `preferred` or falling back to first installed."""
        installed = await self.list_installed_models(model_type=model_type)
        keyed_items: list[tuple[str, dict[str, Any]]] = []
        for item in installed:
            key = _extract_model_key(item)
            if key:
                keyed_items.append((key, item))

        if not keyed_items:
            if fallback_to_preferred_when_empty and preferred and preferred.strip():
                return preferred.strip()
            return None

        pref = (preferred or "").strip()
        if pref:
            pref_low = pref.lower()
            pref_norm = _normalize_model_token(pref)

            # 1. Exact case-insensitive match on modelKey / identifier
            for key, item in keyed_items:
                if key.lower() == pref_low:
                    return key
                for alias_field in ("identifier", "id", "displayName"):
                    alias_val = str(item.get(alias_field) or "").strip().lower()
                    if alias_val and alias_val == pref_low:
                        return key

            # 2. Exact normalized match
            if pref_norm:
                for key, item in keyed_items:
                    if _normalize_model_token(key) == pref_norm:
                        return key
                    disp_norm = _normalize_model_token(str(item.get("displayName") or ""))
                    if disp_norm and disp_norm == pref_norm:
                        return key

                # 3. Substring normalized match (e.g., nomic-embed-text -> text-embedding-nomic-embed-text-v1.5)
                for key, item in keyed_items:
                    key_norm = _normalize_model_token(key)
                    disp_norm = _normalize_model_token(str(item.get("displayName") or ""))
                    if (
                        (key_norm and (pref_norm in key_norm or key_norm in pref_norm))
                        or (disp_norm and (pref_norm in disp_norm or disp_norm in pref_norm))
                    ):
                        return key

        # 4. Clean fallback to the first installed model of `model_type`
        return keyed_items[0][0]

    async def load_model(
        self,
        model_key: str,
        *,
        gpu: str | None = None,
        context_length: int | None = None,
        ttl_seconds: int = 300,
    ) -> bool:
        """Load `model_key` via `lms load`, skipping if compatible already loaded and unloading conflicts."""
        if not self.cli_enabled() or not model_key or not model_key.strip():
            return False

        target_key = model_key.strip()
        loaded = await self.list_loaded_models()

        compatible_loaded = False
        has_conflict = False
        for item in loaded:
            loaded_key = _extract_model_key(item)
            if loaded_key and _models_match(loaded_key, target_key):
                item_gpu = item.get("gpu")
                if gpu == "off" and item_gpu is not None and str(item_gpu).strip().lower() not in ("off", "0", "0.0"):
                    has_conflict = True
                else:
                    compatible_loaded = True
            elif loaded_key:
                has_conflict = True

        if compatible_loaded and not has_conflict:
            return True

        if has_conflict:
            await self.unload_all()

        cmd = ["load", target_key, "-y", "--ttl", str(int(ttl_seconds))]
        if gpu is not None and str(gpu).strip():
            cmd.extend(["--gpu", str(gpu).strip()])
        if context_length is not None and int(context_length) > 0:
            cmd.extend(["-c", str(int(context_length))])

        rc, _stdout, stderr = await self._run_lms(cmd, timeout=120.0)
        if rc != 0 and stderr.strip():
            logger.warning("LM Studio load failed for '%s': %s", target_key, stderr.strip())
        return rc == 0

    async def unload_all(self) -> bool:
        """Unload all active models from VRAM and RAM (`lms unload --all`)."""
        if not self.cli_enabled():
            return False
        rc, stdout, stderr = await self._run_lms(["unload", "--all"], timeout=20.0)
        if rc == 0:
            return True
        combined = f"{stdout}\n{stderr}".lower()
        if "no models" in combined or "not running" in combined:
            return True
        return False

    def _clear_loaded_tracking(self) -> None:
        self._active_model_key = None
        self._active_model_type = None
        self._active_gpu = None

    @asynccontextmanager
    async def pipeline_session(
        self,
        *,
        job_id: str | None = None,
        task_log: str = "orchestrator",
    ) -> AsyncIterator[None]:
        """Ref-counted outer session wrapping sequential Topic + Analysis stages.

        Does NOT eagerly start LM Studio; inner `stage()` calls start/load on demand
        and unload immediately in their `finally:`. Only calls `stop_server()` when
        the outermost session exits (`_session_depth == 0`) if the server is running.
        """
        if not self.cli_enabled():
            yield
            return

        async with self._state_lock:
            self._session_depth += 1

        try:
            yield
        finally:
            should_cleanup = False
            async with self._state_lock:
                self._session_depth = max(0, self._session_depth - 1)
                if self._session_depth == 0 and self._stage_depth == 0:
                    should_cleanup = True

            if should_cleanup:
                try:
                    if self._active_model_key is not None or await self.server_status():
                        self._log(
                            job_id,
                            task_log,
                            "[lmstudio] Encerrando sessão LLM e liberando VRAM/RAM (unload + server stop)...",
                        )
                        await self.unload_all()
                        await self.stop_server()
                except Exception as exc:
                    logger.warning("LM Studio pipeline_session cleanup warning: %s", exc)
                finally:
                    self._clear_loaded_tracking()

    @asynccontextmanager
    async def stage(
        self,
        model_type: ModelType,
        *,
        preferred_model: str | None = None,
        gpu: str | None = None,
        context_length: int | None = None,
        ttl_seconds: int = 300,
        job_id: str | None = None,
        task_log: str = "analysis",
    ) -> AsyncIterator[str | None]:
        """Acquire an on-demand LM Studio model stage and deterministically unload + stop on exit."""
        if not self.cli_enabled():
            yield preferred_model
            return

        is_nested_reuse = False
        async with self._state_lock:
            if (
                self._stage_depth > 0
                and self._active_model_type == model_type
                and self._active_gpu == gpu
                and self._active_model_key is not None
            ):
                is_nested_reuse = True
            self._session_depth += 1
            self._stage_depth += 1
            existing_key = self._active_model_key

        if is_nested_reuse:
            try:
                yield existing_key
            finally:
                async with self._state_lock:
                    self._stage_depth = max(0, self._stage_depth - 1)
                    self._session_depth = max(0, self._session_depth - 1)
            return

        resolved_key: str | None = None
        server_started_or_active = False
        try:
            self._log(
                job_id,
                task_log,
                f"[lmstudio] Iniciando servidor LM Studio para estágio '{model_type}'...",
            )
            server_started_or_active = await self.start_server()
            resolved_key = await self.resolve_model_key(
                preferred_model,
                model_type=model_type,
            )
            if resolved_key:
                gpu_tag = f" (--gpu {gpu})" if gpu else ""
                self._log(
                    job_id,
                    task_log,
                    f"[lmstudio] Carregando modelo '{resolved_key}'{gpu_tag}...",
                )
                loaded_ok = await self.load_model(
                    resolved_key,
                    gpu=gpu,
                    context_length=context_length,
                    ttl_seconds=ttl_seconds,
                )
                if loaded_ok:
                    async with self._state_lock:
                        self._active_model_key = resolved_key
                        self._active_model_type = model_type
                        self._active_gpu = gpu
                else:
                    self._log(
                        job_id,
                        task_log,
                        f"[lmstudio] Falha ao carregar '{resolved_key}' via CLI.",
                    )
            else:
                self._log(
                    job_id,
                    task_log,
                    f"[lmstudio] Nenhum modelo '{model_type}' instalado no LM Studio.",
                )

            yield resolved_key
        finally:
            try:
                if server_started_or_active or resolved_key is not None or self._active_model_key is not None:
                    self._log(
                        job_id,
                        task_log,
                        f"[lmstudio] Descarregando modelo ({model_type}) da VRAM/RAM...",
                    )
                    await self.unload_all()
            except Exception as exc:
                logger.warning("LM Studio stage unload warning: %s", exc)
            finally:
                self._clear_loaded_tracking()
                should_stop = False
                async with self._state_lock:
                    self._stage_depth = max(0, self._stage_depth - 1)
                    self._session_depth = max(0, self._session_depth - 1)
                    if self._session_depth == 0 and self._stage_depth == 0:
                        should_stop = True

                if should_stop and (server_started_or_active or resolved_key is not None):
                    try:
                        self._log(
                            job_id,
                            task_log,
                            "[lmstudio] Parando servidor LM Studio ocioso (lms server stop)...",
                        )
                        await self.stop_server()
                    except Exception as exc:
                        logger.warning("LM Studio stage stop_server warning: %s", exc)

    async def ensure_idle_vram_released(
        self,
        job_id: str | None = None,
        task_log: str = "render",
    ) -> bool:
        """Unload models and stop LM Studio daemon if no active session/stage holds it."""
        if not self.cli_enabled():
            return False

        async with self._state_lock:
            if self._session_depth > 0 or self._stage_depth > 0:
                return False

        running = await self.server_status()
        if not running and self._active_model_key is None:
            return False

        self._log(
            job_id,
            task_log,
            f"[lmstudio] Liberando VRAM/RAM ociosa antes de '{task_log}' (unload --all + server stop)...",
        )
        unloaded = await self.unload_all()
        stopped = await self.stop_server()
        self._clear_loaded_tracking()
        return bool(unloaded or stopped)


__all__ = [
    "LMStudioCLIManager",
    "LmsCommandRunner",
    "ModelType",
    "extract_json_from_cli_output",
    "resolve_lms_binary",
    "run_lms_subprocess",
]
