"""Vision-model plumbing for the optional vision stage (phase 6, D8, D10).

Three small pieces, none of which ever loads a model by itself except `vlm_stage`, which does it through the same
LM Studio CLI mechanism the text LLM uses (`lmstudio.stage(model_type="llm", ...)`: the CLI wrapper has no separate
vision model type, and `lms ls` reports vision models as "llm"/"vlm" which the wrapper already treats alike).

NOT RUN on real hardware: the VRAM thresholds, the stage load of a vision model and the image request shapes are
written from documentation only.
"""

from __future__ import annotations

import asyncio
import inspect
import logging
from collections.abc import AsyncIterator, Awaitable, Callable, Sequence
from contextlib import asynccontextmanager
from typing import Any

from app.infrastructure.llm.lmstudio_cli import _models_match

logger = logging.getLogger(__name__)


async def verify_vram_released(
    vram_manager: Any | None,
    *,
    min_free_gb: float,
    checks: int,
    delay_seconds: float,
    check_cancelled: Callable[[], None] | None = None,
) -> tuple[bool, float | None]:
    """True when the manager reports at least `min_free_gb` free VRAM; retried `checks` times, `delay_seconds` apart.

    Returns (ok, last reading). Without a manager, or when the probe raises, the answer is (False, None): memory
    that cannot be checked is treated as not released (D8).
    """
    if vram_manager is None:
        return False, None
    last: float | None = None
    for attempt in range(max(1, int(checks))):
        if check_cancelled is not None:
            check_cancelled()
        try:
            res = vram_manager.probe_free_vram_gb()
            last = float(await res if inspect.isawaitable(res) else res)
        except Exception as exc:  # noqa: BLE001 - an unreadable probe counts as "not verified"
            logger.warning("VRAM probe failed: %s", exc)
            return False, None
        if last >= float(min_free_gb):
            return True, last
        if attempt + 1 < int(checks) and delay_seconds > 0:
            await asyncio.sleep(delay_seconds)
    return False, last


@asynccontextmanager
async def vlm_stage(
    lmstudio: Any, model: str, *, job_id: str | None = None, task_log: str = "analysis"
) -> AsyncIterator[str | None]:
    """Load `model` for a vision stage and unload it on exit; yields its key, or None when it cannot be used.

    `lmstudio.stage` falls back to the first installed model when the preferred one is not installed; here that
    counts as "cannot load" (yields None), so a different model never describes the frames by accident.
    """
    async with lmstudio.stage(model_type="llm", preferred_model=model, job_id=job_id, task_log=task_log) as key:
        yield key if key and _models_match(key, model) else None


def make_vlm_call(
    adapter: Any, *, cancel_token: Any = None, check_cancelled: Callable[[], None] | None = None
) -> Callable[..., Awaitable[tuple[Any, str]]]:
    """The adapter's image chat call with a cancel check before each request; the pipeline already holds the GPU slot."""

    async def call(system_prompt: str, user_prompt: str, images: Sequence[bytes], **kwargs: Any) -> tuple[Any, str]:
        if check_cancelled is not None:
            check_cancelled()
        if cancel_token is not None:
            kwargs.setdefault("cancel_token", cancel_token)
        kwargs.setdefault("acquire_gpu_slot", False)
        return await adapter.chat_json_with_images(system_prompt, user_prompt, images, **kwargs)

    return call
