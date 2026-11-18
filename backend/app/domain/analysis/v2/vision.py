"""Phase 6: conditional vision between S4 and S5 (opt-in via analysis_v2.vision and llm.vision_model).

The step looks only at candidates whose value may be in the picture (depends_on_visuals with a real interest, or
any candidate of a video with little speech), asks a vision model four narrow questions about a few still frames
per candidate, and then scores only those candidates again with the description of the picture attached.

Nothing here has ever run against a real model. The model swap (D8), the frame extraction and the image requests
are written from documentation; the pipeline records every decision in candidates.scored.json.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Sequence
from typing import Any

from app.application.runtime_service import OperationCancelledError
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.candidates import LogFn, _index, _log
from app.domain.analysis.v2.models import Candidate, ScoredCandidate, Sentence
from app.domain.analysis.v2.prompts import (
    VISION_JSON_SCHEMA,
    VISION_SCHEMA_NAME,
    VISION_SYSTEM_PROMPT,
    build_vision_user_prompt,
)
from app.domain.analysis.v2.sentences import format_sentence_line
from app.infrastructure.vision.frames import frame_timestamps

# (video_path, timestamps, *, max_side_px) -> JPEG bytes per frame that could be extracted.
ExtractFn = Callable[..., Awaitable[list[bytes]]]
# (system_prompt, user_prompt, images, *, json_schema, schema_name, max_tokens) -> (parsed, raw)
VlmCall = Callable[..., Awaitable[tuple[Any, str]]]
FramesMap = dict[str, tuple[list[float], list[bytes]]]
_VISION_FIELDS = ("on_screen", "speech_refers_to_screen", "understandable_without_picture", "visual_summary")


def spoken_fraction(sentences: Sequence[Sentence], duration_seconds: float | None) -> float:
    """Seconds of speech (sum of sentence durations) over the video duration; 1.0 when the duration is unknown.

    Unknown means "do not assume a low-speech video".
    """
    duration = float(duration_seconds or 0.0)
    if not sentences:
        return 1.0 if duration <= 0 else 0.0
    if duration <= 0:
        duration = max(s.end for s in sentences)
    if duration <= 0:
        return 1.0
    speech = sum(max(0.0, s.end - s.start) for s in sentences)
    return min(1.0, speech / duration)


def _eligibility_reason(c: ScoredCandidate, *, min_interest: int, low_speech: bool) -> str | None:
    ans = c.answers
    if ans is None or c.outcome != "pending" or ans.interest < min_interest:
        return None
    if ans.depends_on_visuals:
        return "depends_on_visuals"
    if low_speech and not ans.is_non_content:
        return "low_speech"
    return None


def eligible_for_vision(
    scored: Sequence[ScoredCandidate],
    *,
    spoken_fraction: float,
    min_interest: int,
    low_speech_threshold: float,
    max_candidates: int | None = None,
) -> list[ScoredCandidate]:
    """Candidates worth a look at the picture, best first, at most `max_candidates` (default: the constants' cap).

    - depends_on_visuals is true and interest >= `min_interest`; or
    - the video's spoken fraction is below `low_speech_threshold` and the candidate is gate-relevant: it was scored,
      is not non-content and has interest >= `min_interest` (a candidate below that can never be selected).
    Candidates without answers (scoring errors) and the ones already superseded by a merge never qualify. Order:
    score descending, interest descending, start, id.
    """
    low_speech = spoken_fraction < low_speech_threshold
    picked = [c for c in scored if _eligibility_reason(c, min_interest=min_interest, low_speech=low_speech)]
    picked.sort(key=lambda c: (-c.score, -(c.answers.interest if c.answers else 0), c.start, c.candidate_id))
    limit = C.VISION_MAX_CANDIDATES if max_candidates is None else max_candidates
    return picked[: max(0, int(limit))]


def _span_sentences(candidate: Candidate, sentences: Sequence[Sentence]) -> list[Sentence]:
    idx = _index(sentences)
    return list(sentences[idx[candidate.start_sentence_id] : idx[candidate.end_sentence_id] + 1])


async def collect_frames(eligible: Sequence[ScoredCandidate], *, video_path: Any, extract: ExtractFn) -> FramesMap:
    """candidate_id -> (timestamps, frames) for each candidate; frames is empty when none could be extracted."""
    out: FramesMap = {}
    for cand in eligible:
        stamps = frame_timestamps(cand.start, cand.end, count=C.VISION_FRAME_COUNT)
        out[cand.candidate_id] = (stamps, await extract(video_path, stamps, max_side_px=C.VISION_FRAME_MAX_SIDE_PX))
    return out


def _valid_answer(parsed: Any) -> dict[str, Any]:
    if not isinstance(parsed, dict):
        raise ValueError("vision answer is not a JSON object")
    missing = [k for k in _VISION_FIELDS if k not in parsed]
    if missing:
        raise ValueError(f"vision answer lacks {missing}")
    if not isinstance(parsed["visual_summary"], str) or not parsed["visual_summary"].strip():
        raise ValueError("vision answer has an empty visual_summary")
    for key in ("speech_refers_to_screen", "understandable_without_picture"):
        if not isinstance(parsed[key], bool):
            raise ValueError(f"vision answer field {key} is not a boolean")
    return {k: parsed[k] for k in _VISION_FIELDS}


async def describe_candidates(
    eligible: Sequence[ScoredCandidate],
    sentences: Sequence[Sentence],
    *,
    video_path: Any,
    vlm_call: VlmCall,
    extract: ExtractFn,
    log: LogFn | None = None,
    frames: FramesMap | None = None,
    check_cancelled: Callable[[], None] | None = None,
) -> dict[str, dict[str, Any]]:
    """One vision call per candidate. candidate_id -> the four answers plus "frames_used", or {"failed": reason}.

    A failed call (or a candidate with no frame) is recorded and skipped; cancellation always propagates.
    `frames` lets the caller pass frames it extracted earlier (the pipeline does, before touching the GPU).
    """
    out: dict[str, dict[str, Any]] = {}
    for cand in eligible:
        if check_cancelled is not None:
            check_cancelled()
        try:
            if frames is not None and cand.candidate_id in frames:
                stamps, images = frames[cand.candidate_id]
            else:
                stamps = frame_timestamps(cand.start, cand.end, count=C.VISION_FRAME_COUNT)
                images = await extract(video_path, stamps, max_side_px=C.VISION_FRAME_MAX_SIDE_PX)
            if not images:
                raise ValueError("no frame could be extracted")
            user = build_vision_user_prompt(
                cut_lines=[format_sentence_line(s) for s in _span_sentences(cand, sentences)],
                frame_count=len(images),
            )
            parsed, _raw = await vlm_call(
                VISION_SYSTEM_PROMPT,
                user,
                images,
                json_schema=VISION_JSON_SCHEMA,
                schema_name=VISION_SCHEMA_NAME,
                max_tokens=C.MAX_TOKENS_VISION,
            )
            answer = _valid_answer(parsed)
            answer["frames_used"] = len(images)
            answer["timestamps"] = list(stamps)
            out[cand.candidate_id] = answer
        except OperationCancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - one bad call never stops the stage
            out[cand.candidate_id] = {"failed": str(exc)}
            _log(log, f"Vision: candidate {cand.candidate_id} skipped: {exc}")
    return out


async def run_vision_step(
    scored: list[ScoredCandidate],
    sentences: Sequence[Sentence],
    *,
    video_duration: float | None,
    vision_model: str,
    same_model: bool,
    can_swap: bool,
    video_path: Any | None,
    extract: ExtractFn,
    vlm_call: VlmCall,
    vlm_stage: Callable[[], Any],
    leave_text_stage: Callable[[], Awaitable[None]],
    enter_text_stage: Callable[[], Awaitable[None]],
    verify_vram: Callable[[], Awaitable[tuple[bool, float | None]]],
    rescore: Callable[[ScoredCandidate, str], Awaitable[ScoredCandidate]],
    check_cancelled: Callable[[], None],
    log: LogFn,
) -> tuple[list[ScoredCandidate], dict[str, Any]]:
    """Run eligibility, frames, the model swap, the descriptions and the re-score. Returns (scored, record).

    Order of model operations (different vision model): leave_text_stage (unload), verify_vram, vlm_stage (load),
    vlm calls, vlm_stage exit (unload), verify_vram, enter_text_stage (load), rescore. If a precondition fails the
    step is skipped with a warning and `scored` comes back untouched; the text stage is always back (or never left)
    when this returns normally. On cancellation or an error the exception propagates and the caller's stage
    handling releases whatever is loaded.
    """
    fraction = spoken_fraction(sentences, video_duration)
    low_speech = fraction < C.VISION_LOW_SPEECH_FRACTION
    eligible = eligible_for_vision(
        scored,
        spoken_fraction=fraction,
        min_interest=C.VISION_MIN_INTEREST,
        low_speech_threshold=C.VISION_LOW_SPEECH_FRACTION,
    )
    record: dict[str, Any] = {
        "enabled": True,
        "model": vision_model,
        "applied": False,
        "spoken_fraction": round(fraction, 4),
        "low_speech": low_speech,
        "eligible": [
            {
                "candidate_id": c.candidate_id,
                "interest": c.answers.interest if c.answers else None,
                "score": c.score,
                "reason": _eligibility_reason(c, min_interest=C.VISION_MIN_INTEREST, low_speech=low_speech),
            }
            for c in eligible
        ],
    }

    def skip(reason: str, *, warn: bool = True) -> tuple[list[ScoredCandidate], dict[str, Any]]:
        record["skipped"] = reason
        if warn:
            log(f"Vision stage skipped: {reason}")
        return scored, record

    if not eligible:
        return skip("no eligible candidate", warn=False)
    if video_path is None:
        return skip("the source video file was not found")

    if not same_model and not can_swap:
        return skip("loading a separate vision model needs the LM Studio CLI stage, which is not available")

    frames = await collect_frames(eligible, video_path=video_path, extract=extract)
    record["frames"] = {cid: len(imgs) for cid, (_stamps, imgs) in frames.items()}
    if not any(imgs for _stamps, imgs in frames.values()):
        return skip("zero frames could be extracted")
    described_input = [c for c in eligible if frames[c.candidate_id][1]]

    answers: dict[str, dict[str, Any]] = {}
    if same_model:
        # The vision model is the text model: nothing to swap, the loaded model gets the images.
        answers = await describe_candidates(
            described_input,
            sentences,
            video_path=video_path,
            vlm_call=vlm_call,
            extract=extract,
            log=log,
            frames=frames,
            check_cancelled=check_cancelled,
        )
    else:
        check_cancelled()
        await leave_text_stage()
        ok, free = await verify_vram()
        record["vram_free_gb_after_text_unload"] = free
        if not ok:
            await enter_text_stage()
            return skip(f"VRAM was not released after unloading the text model (free: {free} GB)")
        loaded = False
        async with vlm_stage() as key:
            if key:
                loaded = True
                answers = await describe_candidates(
                    described_input,
                    sentences,
                    video_path=video_path,
                    vlm_call=vlm_call,
                    extract=extract,
                    log=log,
                    frames=frames,
                    check_cancelled=check_cancelled,
                )
        ok2, free2 = await verify_vram()
        record["vram_free_gb_after_vision_unload"] = free2
        # Accepted exception to the D8 "check before every load": the job must continue and needs the text model, so
        # it is reloaded even when the check failed. The vision answers are then discarded (skip below) and the
        # failed check is recorded in the artifact; the stage exit unloads every LM Studio model first.
        await enter_text_stage()
        record["answers"] = answers
        if not loaded:
            return skip(f"the vision model '{vision_model}' could not be loaded")
        if not ok2:
            return skip(f"VRAM was not released after unloading the vision model (free: {free2} GB); answers not used")
    record["answers"] = answers

    described = {cid: a for cid, a in answers.items() if "failed" not in a}
    rescored: list[dict[str, Any]] = []
    out = list(scored)
    for i, cand in enumerate(out):
        answer = described.get(cand.candidate_id)
        if answer is None:
            continue
        check_cancelled()
        new = await rescore(cand, str(answer["visual_summary"]))
        if new.outcome == "error" or new.answers is None:
            log(f"Vision: re-score of candidate {cand.candidate_id} failed ({new.outcome_reason}); original score kept.")
            rescored.append({"candidate_id": cand.candidate_id, "kept_original": True, "reason": new.outcome_reason})
            continue
        before = cand.answers
        out[i] = cand.model_copy(
            update={
                "answers": new.answers,
                "gates_ok": new.gates_ok,
                "score": new.score,
                "visual_summary": answer["visual_summary"],
                "before_vision": {
                    "score": cand.score,
                    "interest": before.interest if before else None,
                    "gates_ok": cand.gates_ok,
                },
            }
        )
        rescored.append(
            {
                "candidate_id": cand.candidate_id,
                "score_before": cand.score,
                "score_after": new.score,
                "interest_before": before.interest if before else None,
                "interest_after": new.answers.interest,
                "gates_ok_before": cand.gates_ok,
                "gates_ok_after": new.gates_ok,
            }
        )
    record["rescored"] = rescored
    record["applied"] = any("score_after" in r for r in rescored)
    if not described:
        record["skipped"] = "no candidate was described"
    return out, record
