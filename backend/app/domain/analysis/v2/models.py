"""Pydantic models of the v2 pipeline artifacts (see docs/analysis-v2/stage-contracts.md)."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field


class _V2Model(BaseModel):
    model_config = ConfigDict(extra="allow")


class Sentence(_V2Model):
    sentence_id: str
    start: float
    end: float
    text: str
    speaker: str | None = None
    word_start: int | None = None
    word_end: int | None = None


class UnitSeconds(_V2Model):
    min: float
    typical: float
    max: float


class Brief(_V2Model):
    language: str = ""
    format_description: str = ""
    speakers: str = ""
    unit_definition: str = ""
    good_cut_criteria: list[str] = Field(default_factory=list)
    non_content: str = ""
    unit_seconds: UnitSeconds


class OutlineEntry(_V2Model):
    start_sentence_id: str
    end_sentence_id: str
    start: float
    end: float
    summary: str = ""
    kind: str = "content"


class Unit(_V2Model):
    unit_id: str
    start_sentence_id: str
    end_sentence_id: str
    start: float
    end: float
    label: str = ""
    kind: str = "content"  # "content" | "non_content"


class Candidate(_V2Model):
    candidate_id: str
    start_sentence_id: str
    end_sentence_id: str
    start: float
    end: float
    unit_ids: list[str] = Field(default_factory=list)
    origin: str = "unit"  # unit | subspan | merge_prev | merge_next | refined


class ScoreAnswers(_V2Model):
    premise: str
    missing_context: str
    understandable_alone: bool
    has_payoff: bool
    ends_complete: bool
    depends_on_visuals: bool
    is_non_content: bool
    interest: int
    title: str


class ScoredCandidate(Candidate):
    answers: ScoreAnswers | None = None
    gates_ok: bool = False
    score: float = 0.0
    # pending | selected | rejected_gates | below_min_interest | overlap | over_cap
    # | error | superseded_by_merge
    outcome: str = "pending"
    outcome_reason: str = ""
    cut_id: str | None = None
