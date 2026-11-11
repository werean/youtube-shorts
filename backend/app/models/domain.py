"""Domain models (Pydantic v2) compatible with shared/contracts.ts and DESIGN.md."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, model_validator


class JobStatus(str, Enum):
    CREATED = "CREATED"
    DOWNLOADING = "DOWNLOADING"
    DOWNLOADED = "DOWNLOADED"
    TRANSCRIBING = "TRANSCRIBING"
    BUILDING_BLOCKS = "BUILDING_BLOCKS"
    BUILDING_TOPICS = "BUILDING_TOPICS"
    ANALYZING = "ANALYZING"
    WAITING_APPROVAL = "WAITING_APPROVAL"
    RENDERING = "RENDERING"
    DONE = "DONE"
    ERROR = "ERROR"

    def __str__(self) -> str:
        return self.value


class Job(BaseModel):
    model_config = ConfigDict(extra="allow", use_enum_values=True)

    job_id: str
    youtube_url: str
    status: JobStatus = JobStatus.CREATED
    created_at: str
    updated_at: str | None = None
    source_video_path: str | None = None
    source_file_name: str | None = None
    video_name: str | None = None
    video_duration_seconds: float | None = None


class Segment(BaseModel):
    model_config = ConfigDict(extra="allow")

    segment_id: str | None = None
    id: int | str | None = None
    start: float
    end: float
    text: str
    speaker: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _coerce_segment_id(cls, data: Any) -> Any:
        if isinstance(data, dict):
            if "segment_id" not in data and "id" in data:
                data["segment_id"] = str(data["id"])
            elif "segment_id" in data and "id" not in data:
                data["id"] = data["segment_id"]
        return data


class WordTiming(BaseModel):
    model_config = ConfigDict(extra="allow")

    word: str
    start: float
    end: float
    probability: float = 1.0
    speaker: str | None = None
    segment_id: str | None = None


class SemanticBlock(BaseModel):
    model_config = ConfigDict(extra="allow")

    block_id: str
    start: float
    end: float
    text: str
    segment_ids: list[str] = Field(default_factory=list)
    speaker: str | None = None
    is_topic_opener: bool | None = None


class TopicSegment(BaseModel):
    model_config = ConfigDict(extra="allow")

    topic_id: str
    start: float
    end: float
    block_ids: list[str] = Field(default_factory=list)
    blockCount: int = 0
    durationSeconds: float = 0.0
    title: str | None = None


class NarrativeArc(BaseModel):
    model_config = ConfigDict(extra="allow")

    hook: str = ""
    development: str = ""
    climax: str = ""
    resolution: str = ""


class Cut(BaseModel):
    model_config = ConfigDict(extra="allow")

    cut_id: str
    id: str | None = None
    block_ids: list[str] = Field(default_factory=list)
    start: float
    end: float
    duration: float | None = None
    title: str | None = None
    status: str = "pending"
    summary: str | None = None
    reasoning: str | None = None
    score: float | int | None = None
    approved: bool = False
    rejected: bool = False
    subtitle: str | None = None
    narrative_arc: NarrativeArc | None = None
    vertical_mode: str | None = None

    # Backward compatibility fields
    beginning_hook: str | None = None
    middle_development: str | None = None
    end_conclusion: str | None = None
    hook_reason: str | None = None
    content_reason: str | None = None
    duration_seconds: float | None = None

    @model_validator(mode="after")
    def _sync_cut_fields(self) -> Cut:
        if not self.id:
            self.id = self.cut_id
        if self.duration is None and self.duration_seconds is not None:
            self.duration = self.duration_seconds
        elif self.duration is not None and self.duration_seconds is None:
            self.duration_seconds = self.duration
        elif self.duration is None:
            self.duration = max(0.0, round(self.end - self.start, 2))
            self.duration_seconds = self.duration

        if self.status == "approved":
            self.approved = True
            self.rejected = False
        elif self.status == "rejected":
            self.rejected = True
            self.approved = False

        if self.narrative_arc is None and (
            self.beginning_hook or self.middle_development or self.end_conclusion
        ):
            self.narrative_arc = NarrativeArc(
                hook=self.beginning_hook or "",
                development=self.middle_development or "",
                climax="",
                resolution=self.end_conclusion or "",
            )
        return self


class ChapterAnchor(BaseModel):
    model_config = ConfigDict(extra="allow")

    title: str | None = None
    start_time: float
    end_time: float


class SourceVideoInfo(BaseModel):
    model_config = ConfigDict(extra="allow")

    id: str | None = None
    title: str | None = None
    duration: float | None = None
    webpage_url: str | None = None
    chapters: list[ChapterAnchor] = Field(default_factory=list)
    raw_info: dict[str, Any] | None = None
