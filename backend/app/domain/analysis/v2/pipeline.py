"""Analysis pipeline v2: S0 sentences, S1 brief, S2 units, S3 candidates, S4 scoring, S5 boundaries, S6 selection.

Stages S1, S2 and S5 are switchable through the optional llm key ``analysis_v2`` (see ``resolve_stage_toggles``).

Mirrors `narrative_miner.analyze_job` for everything outside the algorithm: prerequisite artifacts,
status transitions, stage logs, progress events, the single `lmstudio.stage` and single `gpu_slot`
around every LLM call, and the error path (status ERROR, exception re-raised, `cuts.suggested.json`
never overwritten with partial results).
"""

from __future__ import annotations

import json
from collections import Counter
from contextlib import AsyncExitStack
from collections.abc import Callable
from typing import Any

import numpy as np

from app.application.runtime_service import (
    CancelToken,
    OperationCancelledError,
    ServiceContainer,
    get_container,
)
from app.core.config import config
from app.domain.analysis.rms_snap import snap_cut_boundaries
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.audience import normalize_heatmap
from app.domain.analysis.v2.boundaries import preselect, refine_all
from app.domain.analysis.v2.brief import build_brief, estimate_brief_calls
from app.domain.analysis.v2.candidates import build_candidates
from app.domain.analysis.v2.examples import select_examples
from app.domain.analysis.v2.history import load_history
from app.domain.analysis.v2.legacy_artifacts import derive_legacy_artifacts
from app.domain.analysis.v2.models import Brief, Candidate, OutlineEntry, ScoredCandidate, Unit
from app.domain.analysis.v2.prompts import (
    PROMPTS_VERSION,
    build_scoring_examples_block,
    optional_prompt_hashes,
    prompt_hashes,
)
from app.domain.analysis.v2.provisional import provisional_brief, units_from_topics
from app.domain.analysis.v2.scoring import score_all, score_candidate
from app.domain.analysis.v2.selection import select, to_cuts, used_fallback
from app.domain.analysis.v2.sentences import build_sentences
from app.domain.analysis.v2.units import build_units, build_windows
from app.domain.analysis.v2.vision import run_vision_step
from app.domain.segmentation.semantic_blocks import build_semantic_blocks
from app.domain.segmentation.topic_segmentation import build_topic_segments
from app.infrastructure.llm.lmstudio_cli import _models_match, resolve_lmstudio_context_length
from app.infrastructure.llm.unified_adapter import UnifiedLocalLLMAdapter
from app.infrastructure.vision.frames import extract_frames
from app.infrastructure.vision.vlm import make_vlm_call, verify_vram_released, vlm_stage
from app.models.domain import Cut, JobStatus

TASK = "analysis"
ARTIFACT_VERSION = 1

# Stage toggles of the optional llm key "analysis_v2": key -> (allowed values, default).
_STAGE_TOGGLES: dict[str, tuple[tuple[Any, ...], Any]] = {
    "brief": (("llm", "provisional"), "llm"),
    "units": (("llm", "topics"), "llm"),
    "refine_boundaries": ((True, False), True),
    "topic_embeddings": ((True, False), True),
}


def resolve_stage_toggles(raw: Any, warn: Callable[[str], None] | None = None) -> dict[str, Any]:
    """Merge the configured ``analysis_v2`` dict over the defaults; unknown keys/values warn and use the default."""
    toggles = {key: default for key, (_allowed, default) in _STAGE_TOGGLES.items()}
    if raw is None:
        return toggles
    if not isinstance(raw, dict):
        if warn:
            warn(f"analysis_v2={raw!r} is not an object; using the defaults.")
        return toggles
    for key, value in raw.items():
        if key in (_REASONING_KEY, _DERIVE_KEY, _AUDIENCE_KEY, _EXAMPLES_KEY, _VISION_KEY):
            continue  # handled by resolve_reasoning_stages / resolve_derive_legacy
        if key not in _STAGE_TOGGLES:
            if warn:
                warn(f"analysis_v2.{key} is not a known stage toggle; ignored.")
            continue
        allowed, default = _STAGE_TOGGLES[key]
        # bool is a subclass of int: compare by type too, so 1 is not accepted for True.
        if any(value == a and type(value) is type(a) for a in allowed):
            toggles[key] = value
        elif warn:
            warn(f"analysis_v2.{key}={value!r} is not one of {list(allowed)!r}; using {default!r}.")
    return toggles


# Stages that may run with reasoning on (optional ``analysis_v2.reasoning_stages``): D16 variant.
# "scoring" covers S4 and the re-score after S5; "refine" covers the S5 border calls.
REASONING_STAGES = ("scoring", "refine")
_REASONING_KEY = "reasoning_stages"


def resolve_reasoning_stages(raw: Any, warn: Callable[[str], None] | None = None) -> frozenset[str]:
    """Stages named in ``analysis_v2.reasoning_stages``; absent -> empty; anything else warns and is ignored."""
    if not isinstance(raw, dict) or _REASONING_KEY not in raw:
        return frozenset()
    value = raw[_REASONING_KEY]
    if not isinstance(value, list):
        if warn:
            warn(f"analysis_v2.{_REASONING_KEY}={value!r} is not a list; ignored.")
        return frozenset()
    chosen: set[str] = set()
    for item in value:
        if isinstance(item, str) and item in REASONING_STAGES:
            chosen.add(item)
        elif warn:
            warn(f"analysis_v2.{_REASONING_KEY} entry {item!r} is not one of {list(REASONING_STAGES)!r}; ignored.")
    return frozenset(chosen)


# Optional bool ``analysis_v2.derive_legacy_artifacts`` (phase 4): write semantic.blocks.json and
# topic.segments.json derived from sentences and units instead of calling the v1 builders.
_DERIVE_KEY = "derive_legacy_artifacts"


def resolve_derive_legacy(raw: Any, warn: Callable[[str], None] | None = None) -> bool:
    """``analysis_v2.derive_legacy_artifacts``: absent -> False; a non-bool warns and counts as False."""
    if not isinstance(raw, dict) or _DERIVE_KEY not in raw:
        return False
    value = raw[_DERIVE_KEY]
    if isinstance(value, bool):
        return value
    if warn:
        warn(f"analysis_v2.{_DERIVE_KEY}={value!r} is not a boolean; using False.")
    return False


# Optional ``analysis_v2.audience_signal`` (phase 5 part A): "off" (default) | "tiebreak" | "bonus".
_AUDIENCE_KEY = "audience_signal"
AUDIENCE_MODES = ("off", "tiebreak", "bonus")


def resolve_audience_signal(raw: Any, warn: Callable[[str], None] | None = None) -> str:
    """``analysis_v2.audience_signal``: absent -> "off"; an unknown value warns and counts as "off"."""
    if not isinstance(raw, dict) or _AUDIENCE_KEY not in raw:
        return "off"
    value = raw[_AUDIENCE_KEY]
    if isinstance(value, str) and value in AUDIENCE_MODES:
        return value
    if warn:
        warn(f"analysis_v2.{_AUDIENCE_KEY}={value!r} is not one of {list(AUDIENCE_MODES)!r}; using 'off'.")
    return "off"


# Optional int ``analysis_v2.scoring_examples`` (phase 7): how many past owner decisions S4 sees; 0 (default) = off.
_EXAMPLES_KEY = "scoring_examples"


def resolve_scoring_examples(raw: Any, warn: Callable[[str], None] | None = None) -> int:
    """``analysis_v2.scoring_examples``: absent -> 0; a non-integer or negative value warns and counts as 0."""
    if not isinstance(raw, dict) or _EXAMPLES_KEY not in raw:
        return C.SCORING_EXAMPLES_DEFAULT
    value = raw[_EXAMPLES_KEY]
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        if warn:
            warn(f"analysis_v2.{_EXAMPLES_KEY}={value!r} is not a non-negative integer; using 0.")
        return C.SCORING_EXAMPLES_DEFAULT
    if value > C.SCORING_EXAMPLES_MAX:
        if warn:
            warn(f"analysis_v2.{_EXAMPLES_KEY}={value} is above {C.SCORING_EXAMPLES_MAX}; using {C.SCORING_EXAMPLES_MAX}.")
        return C.SCORING_EXAMPLES_MAX
    return value


# Optional bool ``analysis_v2.vision`` (phase 6): look at still frames of candidates that depend on the picture.
# It also needs the llm key ``vision_model``; without it the stage is skipped with a warning.
_VISION_KEY = "vision"


def resolve_vision(raw: Any, warn: Callable[[str], None] | None = None) -> bool:
    """``analysis_v2.vision``: absent -> False; a non-bool warns and counts as False."""
    if not isinstance(raw, dict) or _VISION_KEY not in raw:
        return False
    value = raw[_VISION_KEY]
    if isinstance(value, bool):
        return value
    if warn:
        warn(f"analysis_v2.{_VISION_KEY}={value!r} is not a boolean; using False.")
    return False


def resolve_auto_approve(llm_cfg: dict[str, Any], warn: Callable[[str], None] | None = None) -> int | None:
    """``llm.auto_approve`` (bool, default False) -> the minimum interest to auto-approve, or None when off.

    A minimum outside the interest scale (1..5) would approve everything or nothing: it warns and falls back to the
    conservative default.
    """
    if llm_cfg.get("auto_approve") is not True:
        return None
    raw = llm_cfg.get("auto_approve_min_interest")
    value = _int_or_default(raw, C.AUTO_APPROVE_DEFAULT_MIN_INTEREST)
    if not C.INTEREST_MIN <= value <= C.INTEREST_MAX:
        if warn:
            warn(
                f"llm.auto_approve_min_interest={raw!r} is outside {C.INTEREST_MIN}..{C.INTEREST_MAX}; "
                f"using {C.AUTO_APPROVE_DEFAULT_MIN_INTEREST}."
            )
        return C.AUTO_APPROVE_DEFAULT_MIN_INTEREST
    return value


def _resolve_seed(llm_cfg: dict[str, Any]) -> int:
    raw = llm_cfg.get("analysis_seed")
    if raw is not None and not isinstance(raw, bool):
        try:
            return int(raw)
        except (TypeError, ValueError):
            pass
    return int(getattr(config, "ANALYSIS_SEED", C.DEFAULT_ANALYSIS_SEED))


def _int_or_default(raw: Any, default: int) -> int:
    if isinstance(raw, int) and not isinstance(raw, bool):
        return raw
    return default


async def analyze_job_v2(
    job_id: str,
    *,
    llm_adapter: UnifiedLocalLLMAdapter | None = None,
    pcm_samples: np.ndarray | None = None,
    rms_10ms: np.ndarray | None = None,
    container: ServiceContainer | None = None,
    cancel_token: CancelToken | None = None,
) -> dict[str, Any]:
    """Run the v2 analysis for `job_id` and persist its artifacts. Same return shape as v1 `analyze_job`.

    Cancellation is cooperative: `cancel_token` (default: the job's "analysis" token, which the /analyze
    route and the batch runner create before calling) or any cancel request on the job
    (`runtime.is_cancel_requested`, which also sees the single-job orchestrator's token) stops the run before
    the next LLM call; the call in flight finishes (the HTTP request cannot be interrupted).
    """
    c = container or get_container()
    job = c.jobs.load_job(job_id)
    if cancel_token is None:
        cancel_token = c.runtime.get_cancel_token(job_id, TASK)

    def check_cancelled() -> None:
        if cancel_token is not None:
            cancel_token.raise_if_cancelled()
        if c.runtime.is_cancel_requested(job_id):
            raise OperationCancelledError(job_id, TASK)

    def warn(message: str) -> None:
        c.runtime.log_warning(job_id, TASK, message)

    llm_cfg = dict(c.load_active_tool_configs().get("llm") or {})
    toggles = resolve_stage_toggles(llm_cfg.get("analysis_v2"), warn)
    reasoning_stages = resolve_reasoning_stages(llm_cfg.get("analysis_v2"), warn)
    derive_legacy = resolve_derive_legacy(llm_cfg.get("analysis_v2"), warn)
    audience_mode = resolve_audience_signal(llm_cfg.get("analysis_v2"), warn)
    examples_count = resolve_scoring_examples(llm_cfg.get("analysis_v2"), warn)
    auto_approve_min = resolve_auto_approve(llm_cfg, warn)
    vision_on = resolve_vision(llm_cfg.get("analysis_v2"), warn)
    vision_model = str(llm_cfg.get("vision_model") or "").strip()
    if derive_legacy and toggles["units"] == "topics":
        warn(
            "analysis_v2.derive_legacy_artifacts=true contradicts units='topics' (units would come from topics "
            "that are derived from units); treating derive_legacy_artifacts as false."
        )
        derive_legacy = False

    def guarded(base: Callable[..., Any], *, reasoning: bool = False) -> Callable[..., Any]:
        """`base` (the adapter call) with the cancel check before every call and the per-stage reasoning flag.

        Extra kwargs are added only when needed, so a stage without them sends exactly the v1-shaped call.
        """

        async def call(*args: Any, **kwargs: Any) -> tuple[Any, str]:
            check_cancelled()
            if cancel_token is not None:
                kwargs.setdefault("cancel_token", cancel_token)
            if reasoning:
                kwargs["reasoning"] = True
                if kwargs.get("max_tokens"):
                    kwargs["max_tokens"] = int(kwargs["max_tokens"]) * C.REASONING_MAX_TOKENS_MULTIPLIER
            return await base(*args, **kwargs)

        return call

    # Compatibility: canonical Stage 3 artifacts are still produced by the v1 builders (pipeline-v2 "Compatibilidade").
    # With derive_legacy_artifacts both are derived from sentences and units after S2 and the v1 builders never run.
    blocks: list[Any] = []
    topics: list[Any] = []
    if not derive_legacy:
        blocks = c.jobs.load_semantic_blocks(job_id)
        if not blocks:
            blocks = build_semantic_blocks(job_id, container=c)
        topics = c.jobs.load_topic_segments(job_id)
    topics_built_here = not topics and not derive_legacy
    if not derive_legacy and not topics:
        topics = await build_topic_segments(
            job_id,
            use_embeddings=bool(toggles["topic_embeddings"]),
            llm_adapter=llm_adapter,
            container=c,
        )

    if not derive_legacy and not topics_built_here and not toggles["topic_embeddings"]:
        warn("analysis_v2.topic_embeddings=false has no effect: topic.segments.json already existed and was reused.")

    c.jobs.update_job_status(job_id, JobStatus.ANALYZING)
    start_msg = "[analysis] Executando analise v2 (frases, brief, unidades, candidatos, pontuacao, bordas, selecao)..."
    c.runtime.log_stage_start(job_id, TASK, message=start_msg)
    c.runtime.publish_state_change(job_id, status=JobStatus.ANALYZING.value, message=start_msg)

    def progress(percent: float, message: str) -> None:
        c.runtime.publish_progress(
            job_id, status=JobStatus.ANALYZING, task=TASK, percent=percent, message=f"[analysis] {message}"
        )

    try:
        min_interest = _int_or_default(llm_cfg.get("analysis_min_interest"), C.DEFAULT_MIN_INTEREST)
        max_cuts = int(llm_cfg.get("max_suggested_cuts") or config.MAX_SUGGESTED_CUTS)
        seed = _resolve_seed(llm_cfg)

        # Title, duration and chapters come from the same sources v1 analyze_job uses.
        source_info = c.jobs.load_source_info(job_id) or {}
        chapters = source_info.get("chapters") if isinstance(source_info, dict) else None
        chapters = chapters if isinstance(chapters, list) else None
        if isinstance(source_info, dict):
            video_title = str(source_info.get("title") or job.video_name or "").strip() or None
        else:
            video_title = str(job.video_name or "").strip() or None
        video_duration = job.video_duration_seconds
        # Only read when the toggle is on; videos without a heatmap follow the "off" path exactly.
        heatmap: list[dict[str, float]] = []
        if audience_mode != "off":
            heatmap = normalize_heatmap(source_info.get("heatmap")) if isinstance(source_info, dict) else []
            if not heatmap:
                warn(f"analysis_v2.audience_signal={audience_mode!r} but the video has no heatmap; using 'off'.")

        words = c.jobs.load_transcription_words(job_id)
        audio_wav = c.jobs.audio_16k_path(job_id)

        adapter = llm_adapter or UnifiedLocalLLMAdapter(container=c)
        configured_model = str(llm_cfg.get("model") or config.OLLAMA_MODEL).strip() or None
        provider_pref = str(llm_cfg.get("provider") or "auto").strip().lower()
        lmstudio = getattr(c, "lmstudio", None)
        # Same resolver the adapter's context guard uses.
        context_tokens = int(resolve_lmstudio_context_length(configured_model, llm_cfg))

        registered_models = llm_cfg.get("registered_models")
        if configured_model and isinstance(registered_models, list):
            for entry in registered_models:
                if (
                    isinstance(entry, dict)
                    and str(entry.get("name") or "").strip().lower() == configured_model.lower()
                    and str(entry.get("source") or "").strip().lower() == "cloud"
                ):
                    warn(f"Model '{configured_model}' is registered as cloud; the product premise is 100% local.")
                    break

        # --- S0: sentences (code) ---------------------------------------------------------
        progress(C.PROGRESS_PCT_S0, "S0: construindo frases")
        segments = [] if words else c.jobs.load_transcription_segments(job_id)
        sentences, s0_meta = build_sentences(words or None, segments or None)
        c.jobs.save_sentences(
            job_id,
            {
                "version": ARTIFACT_VERSION,
                "source": s0_meta["source"],
                "pause_threshold_seconds": s0_meta["pause_threshold_seconds"],
                "low_punctuation": s0_meta["low_punctuation"],
                "sentences": [s.model_dump(mode="json") for s in sentences],
            },
        )

        if not sentences:
            warn("S0 produced no sentences (empty transcription); no cuts generated.")

        # Phase 7, opt-in: past decisions of the owner for S4. Chosen once, so every candidate sees the same block.
        examples_used: list[dict[str, Any]] = []
        examples_block = ""
        if examples_count > 0 and sentences:
            examples_used = select_examples(load_history(c), examples_count, current_job_id=job_id)
            examples_block = build_scoring_examples_block(examples_used)
            if not examples_block:
                examples_used = []
                warn(
                    f"analysis_v2.scoring_examples={examples_count} but there is no usable history "
                    "(data/analysis_history.json missing or without cuts from other videos); running without examples."
                )
        examples_kwargs: dict[str, Any] = {"examples_block": examples_block} if examples_block else {}

        def snap(start: float, end: float) -> tuple[float, float]:
            return snap_cut_boundaries(
                start,
                end,
                words=words,
                pcm_samples=pcm_samples,
                rms_10ms=rms_10ms,
                audio_wav_path=audio_wav if audio_wav.exists() else None,
            )

        def save_brief(brief: Brief, outline: list[OutlineEntry], *, provisional: bool) -> None:
            payload: dict[str, Any] = {
                "version": ARTIFACT_VERSION,
                "brief": brief.model_dump(mode="json"),
                "outline": [e.model_dump(mode="json") for e in outline],
            }
            if provisional:
                payload["provisional"] = True
            c.jobs.save_video_brief(job_id, payload)

        def save_units(units: list[Unit], *, provisional: bool) -> None:
            payload: dict[str, Any] = {
                "version": ARTIFACT_VERSION,
                "units": [u.model_dump(mode="json") for u in units],
            }
            if provisional:
                payload["provisional"] = True
            c.jobs.save_units(job_id, payload)

        discarded_units: list[dict[str, Any]] = []
        meta: dict[str, Any] = {"s1": None, "s2": None, "s5": None}
        topic_units = units_from_topics(topics, sentences)
        derived: dict[str, list[Any]] = {"blocks": blocks, "topics": []}

        def derive(units: list[Unit]) -> None:
            """Derive blocks and topics from sentences and units, kept in memory (to_cuts needs the blocks).

            They are written only after the last LLM call, next to cuts.suggested.json, so a failed or cancelled run
            never leaves new blocks beside the previous run's cuts.
            """
            derived["blocks"], derived["topics"] = derive_legacy_artifacts(sentences, units)

        def stage_llm(
            label: str, first: float, last: float, total: int, *, reasoning: bool = False
        ) -> Callable[..., Any]:
            """The adapter call with an "i/N" progress message per call inside this stage."""
            calls = {"n": 0}
            inner = guarded(adapter.chat_json, reasoning=reasoning)

            async def call(*args: Any, **kwargs: Any) -> tuple[Any, str]:
                check_cancelled()
                calls["n"] += 1
                shown = max(total, calls["n"])
                progress(first + (last - first) * (calls["n"] - 1) / shown, f"{label}: {calls['n']}/{shown}")
                return await inner(*args, **kwargs)

            return call

        # The text LLM stage lives in an exit stack so the optional vision step can leave it (unload) and enter it
        # again. Without vision it is entered once before _run and left once after, exactly as a plain `async with`.
        text_stack = AsyncExitStack()
        text_stage_enabled = bool(
            lmstudio is not None and provider_pref in ("auto", "lmstudio") and lmstudio.cli_enabled()
        )
        vision_record: dict[str, Any] = {}

        def text_stage() -> Any:
            return lmstudio.stage(model_type="llm", preferred_model=configured_model, job_id=job_id, task_log=TASK)

        async def enter_text_stage() -> None:
            if text_stage_enabled:
                await text_stack.enter_async_context(text_stage())

        async def leave_text_stage() -> None:
            await text_stack.aclose()

        async def vision_step(
            scored_in: list[ScoredCandidate], brief: Brief, rescore_call: Callable[..., Any]
        ) -> list[ScoredCandidate]:
            """Phase 6; runs inside the gpu_slot, after S4. Records everything in `vision_record`."""
            vision_record.update({"enabled": True, "model": vision_model or None, "applied": False})
            if not vision_model:
                vision_record["skipped"] = "llm.vision_model is not set"
                warn("analysis_v2.vision=true but llm.vision_model is not set; the vision stage is skipped.")
                return scored_in
            progress(C.PROGRESS_PCT_S4_END, "Visao: candidatos que dependem da imagem")

            async def rescore_visual(cand: ScoredCandidate, summary: str) -> ScoredCandidate:
                return await score_candidate(
                    cand, sentences, brief, llm=rescore_call, visual_summary=summary, **examples_kwargs
                )

            async def verify() -> tuple[bool, float | None]:
                return await verify_vram_released(
                    adapter.container.scheduler.vram_manager,
                    min_free_gb=C.VISION_MIN_FREE_VRAM_GB,
                    checks=C.VISION_VRAM_CHECKS,
                    delay_seconds=C.VISION_VRAM_CHECK_DELAY_SECONDS,
                    check_cancelled=check_cancelled,
                )

            out, record = await run_vision_step(
                scored_in,
                sentences,
                video_duration=video_duration,
                vision_model=vision_model,
                same_model=bool(configured_model and _models_match(configured_model, vision_model)),
                can_swap=text_stage_enabled,
                video_path=c.jobs.find_source_video(job_id),
                extract=extract_frames,
                vlm_call=make_vlm_call(adapter, cancel_token=cancel_token, check_cancelled=check_cancelled),
                vlm_stage=lambda: vlm_stage(lmstudio, vision_model, job_id=job_id, task_log=TASK),
                leave_text_stage=leave_text_stage,
                enter_text_stage=enter_text_stage,
                verify_vram=verify,
                rescore=rescore_visual,
                check_cancelled=check_cancelled,
                log=warn,
            )
            vision_record.update(record)
            return out

        async def _run() -> tuple[list[ScoredCandidate], list[Cut]]:
            if not sentences:
                save_brief(provisional_brief(), [], provisional=True)
                save_units(topic_units, provisional=True)
                return [], []
            brief: Brief = provisional_brief()
            outline: list[OutlineEntry] = []
            units: list[Unit] = topic_units
            async with adapter.container.scheduler.gpu_slot(holder="analysis"):
                check_cancelled()  # the cancel may have arrived while waiting for the slot
                # --- S1: brief and outline ---
                brief_provisional = True
                if toggles["brief"] == "llm":
                    progress(C.PROGRESS_PCT_S1_START, "S1: brief do video")
                    brief, outline, meta["s1"] = await build_brief(
                        sentences,
                        title=video_title,
                        duration_seconds=video_duration,
                        chapters=chapters,
                        llm=stage_llm(
                            "S1",
                            C.PROGRESS_PCT_S1_START,
                            C.PROGRESS_PCT_S1_END,
                            estimate_brief_calls(sentences, video_duration),
                        ),
                        log=warn,
                    )
                    brief_provisional = bool(meta["s1"].get("fallback"))
                save_brief(brief, outline, provisional=brief_provisional)

                # --- S2: units ---
                units_provisional = True
                if toggles["units"] == "llm":
                    progress(C.PROGRESS_PCT_S2_START, "S2: unidades")
                    total_windows = len(
                        build_windows(
                            len(sentences),
                            window=C.UNITS_WINDOW_SENTENCES,
                            overlap=C.UNITS_WINDOW_OVERLAP_SENTENCES,
                        )
                    )
                    units, meta["s2"] = await build_units(
                        sentences,
                        brief,
                        outline,
                        llm=stage_llm("S2", C.PROGRESS_PCT_S2_START, C.PROGRESS_PCT_S2_END, total_windows),
                        # Without topics there is nothing to fall back to: units.py then uses typical-duration units.
                        fallback_units=topic_units if topics and not derive_legacy else None,
                        context_tokens=context_tokens,
                        log=warn,
                    )
                    units_provisional = False
                save_units(units, provisional=units_provisional)
                if derive_legacy:
                    derive(units)

                # --- S3: candidates ---
                progress(C.PROGRESS_PCT_S3, "S3: gerando candidatos")
                candidates = await build_candidates(
                    units, sentences, brief, llm=guarded(adapter.chat_json), log=warn, discarded=discarded_units
                )

                # --- S4: scoring ---
                total = len(candidates)
                calls = {"n": 0}
                scoring_call = guarded(adapter.chat_json, reasoning="scoring" in reasoning_stages)

                async def scoring_llm(*args: Any, **kwargs: Any) -> tuple[Any, str]:
                    check_cancelled()
                    calls["n"] += 1
                    shown_total = max(total, calls["n"])
                    span = C.PROGRESS_PCT_S4_END - C.PROGRESS_PCT_S4_START
                    pct = C.PROGRESS_PCT_S4_START + span * (calls["n"] - 1) / shown_total
                    progress(pct, f"S4: pontuando candidato {calls['n']}/{shown_total}")
                    return await scoring_call(*args, **kwargs)

                scored = await score_all(
                    candidates, units, sentences, brief, llm=scoring_llm, log=warn, **examples_kwargs
                )

                # --- Phase 6 (opt-in): vision for candidates that depend on the picture ---
                if vision_on:
                    scored = await vision_step(scored, brief, scoring_call)

                # --- S5: boundary refinement ---
                if toggles["refine_boundaries"]:
                    chosen = preselect(scored, min_interest=min_interest, max_cuts=max_cuts)
                    progress(C.PROGRESS_PCT_S5_START, "S5: refinando bordas")

                    # A candidate the vision stage described keeps its ON SCREEN block when S5 scores its new span.
                    summaries = {
                        s.candidate_id: str(getattr(s, "visual_summary", None) or "")
                        for s in scored
                        if getattr(s, "visual_summary", None)
                    }

                    async def rescore(cand: Candidate) -> ScoredCandidate:
                        return await score_candidate(
                            cand,
                            sentences,
                            brief,
                            llm=scoring_call,
                            visual_summary=summaries.get(cand.candidate_id, ""),
                            **examples_kwargs,
                        )

                    scored = await refine_all(
                        scored,
                        units,
                        sentences,
                        brief,
                        min_interest=min_interest,
                        max_cuts=max_cuts,
                        llm=stage_llm("S5", C.PROGRESS_PCT_S5_START, C.PROGRESS_PCT_S5_END, 2 * len(chosen), reasoning="refine" in reasoning_stages),
                        rescore=rescore,
                        log=warn,
                    )
                    meta["s5"] = {
                        "preselected": len(chosen),
                        "refined": sum(1 for s in scored if getattr(s, "refined_from", None)),
                        "outcomes": dict(
                            sorted(Counter(getattr(s, "refine_outcome", None) for s in scored if getattr(s, "refine_outcome", None)).items())
                        ),
                        "fallbacks": sum(len(getattr(s, "refine_fallbacks", None) or []) for s in scored),
                    }

            progress(C.PROGRESS_PCT_S6, "S6: selecionando cortes")
            selected = select(
                scored,
                min_interest=min_interest,
                max_cuts=max_cuts,
                iou_threshold=C.IOU_THRESHOLD,
                **({"audience_mode": audience_mode, "heatmap": heatmap} if heatmap else {}),
            )
            if used_fallback(selected):
                warn(
                    f"No candidate reached interest {min_interest}; kept up to {C.FALLBACK_CANDIDATE_COUNT} "
                    f"gate-passing candidates of the highest interest below it (at least {C.FALLBACK_INTEREST}) "
                    "for manual review."
                )
            return scored, to_cuts(
                selected,
                sentences,
                derived["blocks"],
                snap=snap,
                **({"auto_approve_min_interest": auto_approve_min} if auto_approve_min is not None else {}),
            )

        check_cancelled()  # before starting the server and loading the model
        async with text_stack:
            await enter_text_stage()
            scored, cuts = await _run()

        # A cancel that arrived after the last LLM call (S6, the RMS snap, the model unload) is still honored:
        # nothing has been written yet, and the status stays what the cancel route set.
        check_cancelled()
        if derive_legacy and sentences:
            c.jobs.save_semantic_blocks(job_id, derived["blocks"])
            c.jobs.save_topic_segments(job_id, derived["topics"])
        units_doc = c.jobs.load_units(job_id) or {}
        outcomes = Counter(s.outcome for s in scored)
        c.jobs.save_scored_candidates(
            job_id,
            {
                "version": ARTIFACT_VERSION,
                "model": configured_model,
                "seed": seed,
                "prompts_version": PROMPTS_VERSION,
                "prompt_hashes": prompt_hashes(),
                "min_interest": min_interest,
                "max_suggested_cuts": max_cuts,
                "stage_toggles": toggles,
                "reasoning_stages": sorted(reasoning_stages),
                **({"derive_legacy_artifacts": True} if derive_legacy else {}),
                **({"audience_signal": audience_mode} if heatmap else {}),
                **(
                    {
                        "scoring_examples": {
                            "requested": examples_count,
                            "used_ids": [e["id"] for e in examples_used],
                            "optional_prompt_hashes": optional_prompt_hashes(),
                        }
                    }
                    if examples_used
                    else {}
                ),
                **(
                    {
                        "vision": {
                            **vision_record,
                            **({"optional_prompt_hashes": optional_prompt_hashes()} if vision_record.get("answers") else {}),
                        }
                    }
                    if vision_on and vision_record
                    else {}
                ),
                **(
                    {"auto_approve": {"enabled": True, "min_interest": auto_approve_min}}
                    if auto_approve_min is not None
                    else {}
                ),
                "topic_segments_built_here": topics_built_here,
                "s1_meta": meta["s1"],
                "s2_meta": meta["s2"],
                "s5_meta": meta["s5"],
                "discarded_units": discarded_units,
                "candidates": [s.model_dump(mode="json") for s in scored],
            },
        )
        c.jobs.save_cuts(job_id, cuts)
        c.jobs.update_job_status(job_id, JobStatus.WAITING_APPROVAL)
        end_msg = f"[analysis] {len(cuts)} corte(s) sugerido(s) pela analise v2."
        c.runtime.log_stage_end(job_id, TASK, message=end_msg)
        c.runtime.publish_state_change(job_id, status=JobStatus.WAITING_APPROVAL.value, message=end_msg)
        raw_response = json.dumps(
            {
                "pipeline": "v2",
                "sentences": len(sentences),
                "units": len(units_doc.get("units") or []),
                "candidates": len(scored),
                "outcomes": dict(sorted(outcomes.items())),
                "cuts": len(cuts),
            },
            ensure_ascii=False,
        )
        return {"cuts": cuts, "raw_response": raw_response}
    except OperationCancelledError:
        # Same as the orchestrator and transcription on cancel: log it and leave ANALYZING (back to DOWNLOADED).
        # cuts.suggested.json was not touched: it is only written after the last LLM call.
        cancel_msg = "[analysis] Analise v2 cancelada pelo usuario."
        c.runtime.append_task_log(job_id, TASK, cancel_msg)
        c.jobs.update_job_status(job_id, JobStatus.DOWNLOADED)
        c.runtime.publish_state_change(job_id, status=JobStatus.DOWNLOADED.value, message=cancel_msg)
        raise
    except Exception as exc:
        c.runtime.log_exception(job_id, TASK, exc, message="[analysis] Erro durante analise v2")
        c.jobs.update_job_status(job_id, JobStatus.ERROR)
        c.runtime.publish_state_change(job_id, JobStatus.ERROR.value, f"[analysis] {exc}")
        raise
