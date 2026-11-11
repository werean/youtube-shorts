"""Domain models (Pydantic v2) compatible with shared/contracts.ts and DESIGN.md."""

from __future__ import annotations

from enum import Enum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


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

    segment_id: str
    start: float
    end: float
    text: str
    speaker: str | None = None


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


class Cut(BaseModel):
    model_config = ConfigDict(extra="allow")

    cut_id: str
    block_ids: list[str] = Field(default_factory=list)
    start: float
    end: float
    title: str | None = None
    status: str = "pending"
    score: float | int | None = None
    beginning_hook: str | None = None
    middle_development: str | None = None
    end_conclusion: str | None = None
    hook_reason: str | None = None
    content_reason: str | None = None
    duration_seconds: float | None = None


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
