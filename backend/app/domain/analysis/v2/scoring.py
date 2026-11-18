"""S4 - scoring (one LLM call per candidate) and the defect-guided merge."""

from __future__ import annotations

from collections.abc import Sequence

from app.application.runtime_service import OperationCancelledError
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2.candidates import LLMCall, LogFn, _index, _log, merge_candidate
from app.domain.analysis.v2.models import Brief, Candidate, ScoreAnswers, ScoredCandidate, Sentence, Unit
from app.domain.analysis.v2.prompts import (
    SCORING_JSON_SCHEMA,
    SCORING_SCHEMA_NAME,
    build_scoring_system_prompt,
    build_scoring_system_prompt_with_examples,
    build_scoring_user_prompt,
    build_scoring_user_prompt_with_visual,
    summarize_brief_for_prompt,
)
from app.domain.analysis.v2.sentences import format_sentence_line
from app.infrastructure.llm.unified_adapter import (
    LLMContextOverflowError,
    LLMEmptyResponseError,
    LocalLLMUnavailableError,
)


def compute_gates_and_score(answers: ScoreAnswers, *, apply_visual_penalty: bool = True) -> tuple[bool, float]:
    gates_ok = bool(answers.understandable_alone and answers.ends_complete and not answers.is_non_content)
    score = answers.interest * C.SCORE_INTEREST_WEIGHT
    if not answers.has_payoff:
        score -= C.SCORE_PENALTY_NO_PAYOFF
    # Phase 6: a candidate that went through the vision stage has seen its picture described, so "depends on visuals"
    # no longer counts against it (the gates still apply).
    if answers.depends_on_visuals and apply_visual_penalty:
        score -= C.SCORE_PENALTY_DEPENDS_ON_VISUALS
    score = max(C.SCORE_MIN, min(C.SCORE_MAX, score))
    return gates_ok, float(score)


def _as_scored(candidate: Candidate, **updates: object) -> ScoredCandidate:
    data = candidate.model_dump()
    data.update(updates)
    return ScoredCandidate(**data)


async def score_candidate(
    candidate: Candidate,
    sentences: Sequence[Sentence],
    brief: Brief,
    *,
    llm: LLMCall,
    examples_block: str = "",
    visual_summary: str = "",
) -> ScoredCandidate:
    try:
        idx = _index(sentences)
        a, b = idx[candidate.start_sentence_id], idx[candidate.end_sentence_id]
        if a > b:
            raise ValueError("candidate start after end")
        before = sentences[max(0, a - C.SCORING_CONTEXT_SENTENCES_BEFORE) : a]
        inside = sentences[a : b + 1]
        after = sentences[b + 1 : b + 1 + C.SCORING_CONTEXT_SENTENCES_AFTER]
        brief_summary = summarize_brief_for_prompt(brief.model_dump())
        # examples_block is "" unless analysis_v2.scoring_examples is on; then it is the same for every candidate of
        # the video, so the system prompt stays byte-identical across them.
        system = (
            build_scoring_system_prompt_with_examples(brief_summary, examples_block)
            if examples_block
            else build_scoring_system_prompt(brief_summary)
        )
        user_parts = {
            "context_before": [format_sentence_line(s) for s in before],
            "cut_lines": [format_sentence_line(s) for s in inside],
            "context_after": [format_sentence_line(s) for s in after],
        }
        # visual_summary is "" unless the vision stage described this candidate (analysis_v2.vision on).
        user = (
            build_scoring_user_prompt_with_visual(**user_parts, visual_summary=visual_summary)
            if visual_summary.strip()
            else build_scoring_user_prompt(**user_parts)
        )
        parsed, _raw = await llm(
            system,
            user,
            json_schema=SCORING_JSON_SCHEMA,
            schema_name=SCORING_SCHEMA_NAME,
            max_tokens=C.MAX_TOKENS_SCORING,
            acquire_gpu_slot=False,
        )
        if not isinstance(parsed, dict):
            raise ValueError("scoring answer is not a JSON object")
        answers = ScoreAnswers.model_validate(parsed)
        if isinstance(answers.interest, bool) or not C.INTEREST_MIN <= answers.interest <= C.INTEREST_MAX:
            raise ValueError(f"interest out of range: {answers.interest!r}")
    except (OperationCancelledError, LocalLLMUnavailableError, LLMContextOverflowError, LLMEmptyResponseError):
        # An unreachable LLM, a prompt that does not fit or an empty answer are job errors
        # (pipeline-v2 "Chamadas ao LLM" / "Falhas"), not per-candidate failures.
        raise
    except Exception as exc:  # noqa: BLE001 - one bad candidate never stops the run
        return _as_scored(candidate, outcome="error", outcome_reason=f"scoring failed: {exc}")
    gates_ok, score = compute_gates_and_score(answers, apply_visual_penalty=not visual_summary.strip())
    return _as_scored(candidate, answers=answers, gates_ok=gates_ok, score=score)


async def score_all(
    candidates: Sequence[Candidate],
    units: Sequence[Unit],
    sentences: Sequence[Sentence],
    brief: Brief,
    *,
    llm: LLMCall,
    log: LogFn | None = None,
    examples_block: str = "",
) -> list[ScoredCandidate]:
    originals: list[ScoredCandidate] = []
    for cand in candidates:
        scored = await score_candidate(cand, sentences, brief, llm=llm, examples_block=examples_block)
        if scored.outcome == "error":
            _log(log, f"S4: candidate {cand.candidate_id} discarded: {scored.outcome_reason}")
        originals.append(scored)

    taken = {(c.start_sentence_id, c.end_sentence_id) for c in originals}
    merged: list[ScoredCandidate] = []
    for orig in originals:
        ans = orig.answers
        if ans is None or orig.origin.startswith("merge") or orig.gates_ok:
            continue
        if ans.interest < C.MERGE_MIN_INTEREST:
            continue
        sides: list[str] = []
        if not ans.understandable_alone:
            sides.append("prev")
        if not ans.ends_complete:
            sides.append("next")
        # One merge per side per original (MAX_MERGES_PER_SIDE == 1, one pass per side).
        for side in sides:
            span = merge_candidate(orig, units, sentences, brief, side=side)
            if span is None:
                continue
            key = (span.start_sentence_id, span.end_sentence_id)
            if key in taken:
                continue
            taken.add(key)
            # Merge candidates take the next kN (S3 id convention); the link stays in merged_from.
            span = span.model_copy(update={"candidate_id": f"k{len(originals) + len(merged) + 1}"})
            m = await score_candidate(span, sentences, brief, llm=llm, examples_block=examples_block)
            m = _as_scored(m, merge_side=side)
            if m.outcome == "error":
                _log(log, f"S4: merge candidate {m.candidate_id} discarded: {m.outcome_reason}")
            elif m.gates_ok:
                # The contract outcome enum has no "superseded"; select() keeps the link in the reason.
                orig.outcome = "rejected_gates"
                orig.superseded_by = m.candidate_id
                orig.outcome_reason = f"superseded by {m.candidate_id}"
            merged.append(m)
    return [*originals, *merged]
