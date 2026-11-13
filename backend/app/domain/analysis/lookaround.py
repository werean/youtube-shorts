"""Phase 4B: Top-K Pre-Filter (Top-18) & Hybrid Boundary Lookaround (`[-3, +3]` neighbor blocks).

Guarantees every candidate cut has:
1. Self-contained beginning (Look-Behind `[-3, -1]`): backs up `start_block_id` when the opening
   block starts on a dependent/anaphoric connective or answers a preceding question.
2. Complete ending (Look-Ahead `[+1, +3]`): extends `end_block_id` when the closing block ends
   mid-thought or when a neighboring block within `+3` delivers the conclusion/takeaway.
3. Optional batched LLM audit (`BOUNDARY_LOOKAROUND_PROMPT_TEMPLATE` from `ARCHITECTURE.md` §6.3).
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Sequence

logger = logging.getLogger(__name__)

from app.application.runtime_service import CancelToken
from app.core.config import BOUNDARY_LOOKAROUND_PROMPT_TEMPLATE
from app.domain.segmentation.semantic_blocks import (
    ends_sentence,
    is_topic_opener_text,
    starts_with_blocking_connective,
)
from app.infrastructure.llm.unified_adapter import (
    BOUNDARY_LOOKAROUND_JSON_SCHEMA,
    UnifiedLocalLLMAdapter,
)
from app.models.domain import SemanticBlock

TOP_K_PREFILTER: int = 18
LOOKAROUND_NEIGHBOR_COUNT: int = 3
DEFAULT_IOU_THRESHOLD: float = 0.35

ANAPHORIC_OPENING_MARKERS_PT_EN: tuple[str, ...] = (
    "isso acontece",
    "isso ocorre",
    "essa segunda",
    "esse segundo",
    "essa primeira",
    "esse primeiro",
    "como eu falei",
    "como eu disse",
    "como falei",
    "como disse",
    "por isso",
    "é por isso",
    "e por isso",
    "nesse caso",
    "nessa situação",
    "dessa maneira",
    "desse jeito",
    "that happens",
    "this happens",
    "this second",
    "that second",
    "as i said",
    "as i mentioned",
    "that's why",
    "that is why",
    "in that case",
    "for that reason",
)

CONCLUSION_MARKERS_PT_EN: tuple[str, ...] = (
    "resumindo",
    "em resumo",
    "portanto",
    "concluindo",
    "em conclusão",
    "e é por isso que",
    "é por isso que",
    "por isso que",
    "a regra prática",
    "a lição é",
    "então a lição",
    "no final das contas",
    "no fim das contas",
    "moral da história",
    "o segredo é",
    "para fechar",
    "pra fechar",
    "in summary",
    "to summarize",
    "therefore",
    "in conclusion",
    "to wrap up",
    "the takeaway",
    "the key takeaway",
    "and that's why",
    "that is why",
    "the bottom line",
)


@dataclass
class CandidateCut:
    """Intermediate candidate cut flowing through Phases 4A -> 4B -> 4C."""

    title: str
    start_block_id: str
    end_block_id: str
    score: float = 80.0
    beginning_hook: str = ""
    middle_development: str = ""
    climax: str = ""
    end_conclusion: str = ""
    hook_reason: str = ""
    content_reason: str = ""
    reasoning: str = ""
    block_ids: list[str] = field(default_factory=list)
    start: float = 0.0
    end: float = 0.0
    is_complete_story: bool = True


def expand_block_range(
    blocks: Sequence[SemanticBlock],
    start_block_id: str,
    end_block_id: str,
) -> tuple[list[SemanticBlock], list[str], float, float]:
    """Deterministically expand `(start_block_id, end_block_id)` to all consecutive blocks and timestamps."""
    idx_map = {b.block_id: i for i, b in enumerate(blocks)}
    if start_block_id not in idx_map or end_block_id not in idx_map:
        return [], [], 0.0, 0.0

    s_idx = idx_map[start_block_id]
    e_idx = idx_map[end_block_id]
    if s_idx > e_idx:
        s_idx, e_idx = e_idx, s_idx

    span = list(blocks[s_idx : e_idx + 1])
    ids = [b.block_id for b in span]
    return span, ids, float(span[0].start), float(span[-1].end)


def compute_temporal_iou(start_a: float, end_a: float, start_b: float, end_b: float) -> float:
    """Compute Intersection-over-Union (IoU) of two temporal intervals `[start_a, end_a]` and `[start_b, end_b]`."""
    inter_start = max(float(start_a), float(start_b))
    inter_end = min(float(end_a), float(end_b))
    inter = max(0.0, inter_end - inter_start)
    if inter <= 0.0:
        return 0.0
    union_start = min(float(start_a), float(start_b))
    union_end = max(float(end_a), float(end_b))
    union = max(0.0, union_end - union_start)
    if union <= 1e-9:
        return 0.0
    return float(inter / union)


def deduplicate_candidates_by_iou(
    candidates: Sequence[CandidateCut],
    blocks: Sequence[SemanticBlock],
    *,
    iou_threshold: float = DEFAULT_IOU_THRESHOLD,
    max_overlap_seconds: float | None = None,
    top_k: int | None = None,
) -> list[CandidateCut]:
    """Deduplicate overlapping candidates (`IoU > iou_threshold`), keeping higher-scoring cuts."""
    hydrated: list[CandidateCut] = []
    for cand in candidates:
        if not cand.is_complete_story:
            continue
        span, ids, s_time, e_time = expand_block_range(
            blocks, cand.start_block_id, cand.end_block_id
        )
        if not span or e_time <= s_time:
            continue
        copy_cand = CandidateCut(
            title=cand.title,
            start_block_id=span[0].block_id,
            end_block_id=span[-1].block_id,
            score=float(cand.score),
            beginning_hook=cand.beginning_hook,
            middle_development=cand.middle_development,
            climax=getattr(cand, "climax", ""),
            end_conclusion=cand.end_conclusion,
            hook_reason=cand.hook_reason,
            content_reason=cand.content_reason,
            reasoning=getattr(cand, "reasoning", ""),
            block_ids=ids,
            start=s_time,
            end=e_time,
            is_complete_story=cand.is_complete_story,
        )
        hydrated.append(copy_cand)

    # Sort by score descending, then earlier start time
    hydrated.sort(key=lambda c: (-float(c.score), float(c.start)))

    accepted: list[CandidateCut] = []
    for cand in hydrated:
        overlaps = False
        for kept in accepted:
            iou = compute_temporal_iou(cand.start, cand.end, kept.start, kept.end)
            if iou > iou_threshold:
                overlaps = True
                break
            if max_overlap_seconds is not None:
                inter = max(0.0, min(cand.end, kept.end) - max(cand.start, kept.start))
                if inter > max_overlap_seconds:
                    overlaps = True
                    break
        if not overlaps:
            accepted.append(cand)
            if top_k is not None and len(accepted) >= top_k:
                break

    return accepted


def _has_anaphoric_or_dependent_opening(text: str) -> bool:
    if starts_with_blocking_connective(text):
        return True
    cleaned = (text or "").strip().lstrip("\"'“”‘’—- ").lower()
    for marker in ANAPHORIC_OPENING_MARKERS_PT_EN:
        if cleaned.startswith(marker):
            return True
    return False


def _has_conclusion_marker(text: str) -> bool:
    cleaned = (text or "").strip().lstrip("\"'“”‘’—- ").lower()
    if not cleaned:
        return False
    for marker in CONCLUSION_MARKERS_PT_EN:
        if cleaned.startswith(marker) or f" {marker}" in cleaned[:80]:
            return True
    return False


def apply_deterministic_lookaround_single(
    candidate: CandidateCut,
    blocks: Sequence[SemanticBlock],
    *,
    neighbor_k: int = LOOKAROUND_NEIGHBOR_COUNT,
) -> CandidateCut:
    """Inspect `[-3, +3]` neighboring blocks and deterministically fix dependent starts and cut-off endings."""
    idx_map = {b.block_id: i for i, b in enumerate(blocks)}
    if candidate.start_block_id not in idx_map or candidate.end_block_id not in idx_map:
        return candidate

    orig_s = idx_map[candidate.start_block_id]
    orig_e = idx_map[candidate.end_block_id]
    if orig_s > orig_e:
        orig_s, orig_e = orig_e, orig_s

    min_s = max(0, orig_s - max(1, int(neighbor_k)))
    max_e = min(len(blocks) - 1, orig_e + max(1, int(neighbor_k)))

    s_idx = orig_s
    e_idx = orig_e

    # 1. Look-Behind [-3, -1]: back up if opening block is dependent/anaphoric or preceded by a question
    while s_idx > min_s:
        curr_blk = blocks[s_idx]
        prev_blk = blocks[s_idx - 1]
        prev_is_question = prev_blk.text.strip().endswith("?")

        if _has_anaphoric_or_dependent_opening(curr_blk.text):
            s_idx -= 1
            continue

        if prev_is_question:
            s_idx -= 1
            break

        # Also check if a question occurred 2 or 3 blocks back and intermediate blocks are part of the setup
        question_idx = None
        for back_idx in range(s_idx - 1, min_s - 1, -1):
            if blocks[back_idx].text.strip().endswith("?"):
                question_idx = back_idx
                break
        if question_idx is not None and (
            curr_blk.speaker != blocks[question_idx].speaker
            or _has_anaphoric_or_dependent_opening(curr_blk.text)
        ):
            s_idx = question_idx
        break

    # 2. Look-Ahead [+1, +3]: extend if closing block lacks terminal punctuation or neighbor has conclusion marker
    # First, if closing block doesn't end a sentence, advance until sentence ends (within +3)
    while e_idx < max_e and not ends_sentence(blocks[e_idx].text):
        e_idx += 1

    # Second, check if any block in [e_idx + 1 .. max_e] has an explicit conclusion marker for the same thought
    for fwd_idx in range(e_idx + 1, max_e + 1):
        fwd_blk = blocks[fwd_idx]
        # Stop if a completely new topic explicitly opens
        if is_topic_opener_text(fwd_blk.text) and not _has_conclusion_marker(fwd_blk.text):
            break
        if _has_conclusion_marker(fwd_blk.text):
            e_idx = fwd_idx
            # If the conclusion block itself doesn't end with punctuation, include its completion within max_e
            while e_idx < max_e and not ends_sentence(blocks[e_idx].text):
                e_idx += 1

    span, ids, s_time, e_time = expand_block_range(
        blocks, blocks[s_idx].block_id, blocks[e_idx].block_id
    )
    return CandidateCut(
        title=candidate.title,
        start_block_id=blocks[s_idx].block_id,
        end_block_id=blocks[e_idx].block_id,
        score=candidate.score,
        beginning_hook=candidate.beginning_hook,
        middle_development=candidate.middle_development,
        climax=getattr(candidate, "climax", ""),
        end_conclusion=candidate.end_conclusion,
        hook_reason=candidate.hook_reason,
        content_reason=candidate.content_reason,
        reasoning=getattr(candidate, "reasoning", ""),
        block_ids=ids,
        start=s_time,
        end=e_time,
        is_complete_story=candidate.is_complete_story,
    )


def build_lookaround_user_payload(
    candidates: Sequence[CandidateCut],
    blocks: Sequence[SemanticBlock],
    *,
    neighbor_k: int = LOOKAROUND_NEIGHBOR_COUNT,
) -> dict[str, Any]:
    """Build the structured JSON input payload for `BOUNDARY_LOOKAROUND_PROMPT_TEMPLATE`."""
    idx_map = {b.block_id: i for i, b in enumerate(blocks)}
    items: list[dict[str, Any]] = []

    def _fmt_block(b: SemanticBlock) -> dict[str, Any]:
        return {
            "id": b.block_id,
            "start": round(float(b.start), 2),
            "end": round(float(b.end), 2),
            "speaker": b.speaker or "SPEAKER_00",
            "text": b.text,
        }

    for c_idx, cand in enumerate(candidates):
        s_idx = idx_map.get(cand.start_block_id, 0)
        e_idx = idx_map.get(cand.end_block_id, s_idx)
        if s_idx > e_idx:
            s_idx, e_idx = e_idx, s_idx

        preceding = blocks[max(0, s_idx - neighbor_k) : s_idx]
        cut_span = blocks[s_idx : e_idx + 1]
        first_blocks = cut_span[: min(2, len(cut_span))]
        last_blocks = cut_span[max(0, len(cut_span) - 2) :]
        following = blocks[e_idx + 1 : min(len(blocks), e_idx + 1 + neighbor_k)]

        items.append(
            {
                "candidate_index": c_idx,
                "title": cand.title,
                "start_block_id": cand.start_block_id,
                "end_block_id": cand.end_block_id,
                "preceding_blocks": [_fmt_block(b) for b in preceding],
                "first_blocks": [_fmt_block(b) for b in first_blocks],
                "last_blocks": [_fmt_block(b) for b in last_blocks],
                "following_blocks": [_fmt_block(b) for b in following],
            }
        )

    return {"candidates": items}


async def run_phase_4b_top_k_lookaround(
    raw_candidates: Sequence[CandidateCut],
    blocks: Sequence[SemanticBlock],
    *,
    top_k: int = TOP_K_PREFILTER,
    iou_threshold: float = DEFAULT_IOU_THRESHOLD,
    neighbor_k: int = LOOKAROUND_NEIGHBOR_COUNT,
    enable_boundary_lookaround: bool = True,
    use_llm_lookaround: bool = True,
    llm_adapter: UnifiedLocalLLMAdapter | None = None,
    cancel_token: CancelToken | None = None,
) -> list[CandidateCut]:
    """Execute Phase 4B: preliminary IoU dedup + Top-18 pre-filter + hybrid `[-3, +3]` boundary lookaround."""
    if not raw_candidates or not blocks:
        return []

    # Step 1: Preliminary IoU deduplication (> 0.35) and Top-18 selection by score
    top_candidates = deduplicate_candidates_by_iou(
        raw_candidates,
        blocks,
        iou_threshold=iou_threshold,
        top_k=top_k,
    )
    if not enable_boundary_lookaround:
        return top_candidates

    idx_map = {b.block_id: i for i, b in enumerate(blocks)}
    orig_bounds: list[tuple[int, int]] = []
    for cand in top_candidates:
        s_i = idx_map.get(cand.start_block_id, 0)
        e_i = idx_map.get(cand.end_block_id, s_i)
        orig_bounds.append((min(s_i, e_i), max(s_i, e_i)))

    # Step 2a: Deterministic Lookaround [-3, +3]
    det_adjusted = [
        apply_deterministic_lookaround_single(cand, blocks, neighbor_k=neighbor_k)
        for cand in top_candidates
    ]

    # Step 2b: Optional batched LLM Lookaround refinement
    if use_llm_lookaround and llm_adapter is not None and det_adjusted:
        try:
            payload = build_lookaround_user_payload(
                top_candidates, blocks, neighbor_k=neighbor_k
            )
            parsed, _raw = await llm_adapter.chat_json(
                BOUNDARY_LOOKAROUND_PROMPT_TEMPLATE,
                json.dumps(payload, ensure_ascii=False),
                json_schema=BOUNDARY_LOOKAROUND_JSON_SCHEMA,
                schema_name="boundary_lookaround",
                acquire_gpu_slot=False,
                cancel_token=cancel_token,
            )
            adjustments = parsed.get("adjustments") if isinstance(parsed, dict) else None
            if isinstance(adjustments, list):
                for adj in adjustments:
                    if not isinstance(adj, dict):
                        continue
                    c_idx = adj.get("candidate_index")
                    if not isinstance(c_idx, int) or c_idx < 0 or c_idx >= len(det_adjusted):
                        continue
                    if adj.get("is_complete_story") is False:
                        det_adjusted[c_idx].is_complete_story = False
                        continue

                    orig_s, orig_e = orig_bounds[c_idx]
                    min_allowed_s = max(0, orig_s - neighbor_k)
                    max_allowed_e = min(len(blocks) - 1, orig_e + neighbor_k)

                    cur_cand = det_adjusted[c_idx]
                    cur_s = idx_map.get(cur_cand.start_block_id, orig_s)
                    cur_e = idx_map.get(cur_cand.end_block_id, orig_e)

                    adj_s_id = str(adj.get("adjusted_start_block_id") or "").strip()
                    adj_e_id = str(adj.get("adjusted_end_block_id") or "").strip()

                    if adj_s_id in idx_map:
                        cand_s = idx_map[adj_s_id]
                        if min_allowed_s <= cand_s <= cur_s and not _has_anaphoric_or_dependent_opening(
                            blocks[cand_s].text
                        ):
                            cur_s = cand_s

                    if adj_e_id in idx_map:
                        cand_e = idx_map[adj_e_id]
                        if cur_e <= cand_e <= max_allowed_e:
                            cur_e = cand_e

                    span, ids, s_time, e_time = expand_block_range(
                        blocks, blocks[cur_s].block_id, blocks[cur_e].block_id
                    )
                    if span:
                        cur_cand.start_block_id = span[0].block_id
                        cur_cand.end_block_id = span[-1].block_id
                        cur_cand.block_ids = ids
                        cur_cand.start = s_time
                        cur_cand.end = e_time
        except Exception as exc:
            # Graceful fallback to deterministic lookaround results when LLM lookaround response fails
            logger.warning(
                "LLM boundary lookaround failed; falling back to deterministic lookaround: %s",
                exc,
            )

    return [c for c in det_adjusted if c.is_complete_story]
