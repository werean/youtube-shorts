"""API Request/Response DTOs compatible with shared/contracts.ts and DESIGN.md."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models.domain import Cut, Job, Segment


class ErrorDetailResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    detail: str
    error_code: str | None = None
    stage: str | None = None
    recoverable: bool | None = None


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"


class CreateJobRequest(BaseModel):
    youtube_url: str


class CreateJobResponse(BaseModel):
    job: Job


class UploadJobResponse(BaseModel):
    job: Job
    video_path: str


class RenameJobRequest(BaseModel):
    new_name: str


class IngestJobResponse(BaseModel):
    video_path: str
    metadata_path: str
    full_path: str
    job_id: str
    status: str


class TaskLogsResponse(BaseModel):
    task: str
    logs: list[str]


class AvailableTranscriptionFormats(BaseModel):
    segments: bool
    text: bool
    vtt: bool


class TranscribeJobResponse(BaseModel):
    transcription: str
    segments: list[Segment]
    available_formats: AvailableTranscriptionFormats
    job_id: str
    status: str
    segments_count: int


class GetTranscriptionResponse(BaseModel):
    transcription: str
    segments: list[Segment]
    available_formats: AvailableTranscriptionFormats


class DeleteTranscriptionResponse(BaseModel):
    ok: bool = True
    job_id: str
    available_formats: AvailableTranscriptionFormats


class AnalyzeJobResponse(BaseModel):
    cuts: list[Cut]
    raw_response: str | None = None


class UpdateCutsRequest(BaseModel):
    cuts: list[Cut]


class UpdateCutsResponse(BaseModel):
    ok: bool = True
    cuts: list[Cut]


class RunPipelineRequest(BaseModel):
    include_render: bool = False


class BatchPipelineOptions(BaseModel):
    transcription: bool = True
    analysis: bool = True
    render: bool = True
    preApprove: bool = False


class BatchPipelineRequest(BaseModel):
    job_ids: list[str]
    options: BatchPipelineOptions


class FailedJobEntry(BaseModel):
    job_id: str
    error: str


class BatchPipelineProgress(BaseModel):
    model_config = ConfigDict(extra="allow")

    current_job_index: int
    current_job_id: str
    current_step: str
    completed_jobs: list[str] = Field(default_factory=list)
    failed_jobs: list[FailedJobEntry] = Field(default_factory=list)
    is_running: bool = True
    waiting_for_approval: bool | None = None
    pending_cuts: list[Any] | None = None


class BatchRunResponse(BaseModel):
    batch_id: str
    status: Literal["started"] = "started"


class BatchActionResponse(BaseModel):
    status: Literal["cancelled", "continued"]


class VideoRecord(BaseModel):
    model_config = ConfigDict(extra="allow")

    job: Job | None
    job_id: str
    video_path: str
    archived: bool
    hasTranscription: bool = False
    hasAnalysis: bool = False


class MediaSettings(BaseModel):
    base_dir: str
    download_resolution: Literal["1080p", "1440p", "4k"] = "1080p"


class PreferencesSettings(BaseModel):
    ask_move_on_upload: bool = True
    move_uploads: bool = True
    ask_delete_cut_confirm: bool = True


class WhisperSettings(BaseModel):
    device: Literal["cpu", "cuda"] = "cuda"
    formats: list[str] = Field(default_factory=lambda: ["json", "vtt", "txt"])


class LlmSettings(BaseModel):
    model: str = "qwen2.5:14b"


class AppSettings(BaseModel):
    media: MediaSettings
    preferences: PreferencesSettings
    whisper: WhisperSettings
    llm: LlmSettings


class SavedLLMPrompt(BaseModel):
    id: str
    name: str
    prompt: str
    created_at: str
    updated_at: str


class OllamaCatalogEntry(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: str
    model: str
    source: Literal["cloud", "local"] = "local"
    provider: str | None = None
    installed: bool = False
    running: bool = False
    needsDownload: bool = False
    size: int | None = None


class OllamaModelsResponse(BaseModel):
    model_config = ConfigDict(extra="allow")

    online: bool
    configuredModel: str
    models: list[str]
    catalog: list[OllamaCatalogEntry] = Field(default_factory=list)
    localAvailable: bool = False
    remoteAvailable: bool = False


class RegisterOllamaModelRequest(BaseModel):
    model_config = ConfigDict(extra="allow")

    name: Any = None
    source: Any = None


class DependencyStatusInfo(BaseModel):
    installed: bool
    version: str | None = None


class DependenciesSnapshot(BaseModel):
    python: DependencyStatusInfo
    whisper: DependencyStatusInfo
    ytdlp: DependencyStatusInfo
    ffmpeg: DependencyStatusInfo
    cuda: DependencyStatusInfo
    pytorch: DependencyStatusInfo
    ollama: DependencyStatusInfo


class InstallDependencyResult(BaseModel):
    model_config = ConfigDict(extra="allow")

    success: bool
    message: str
    output: str | None = None
    error: str | None = None
    failureCategory: str | None = None
    installer: str | None = None
    dependencies: DependenciesSnapshot | dict[str, Any] | None = None
    diagnostics: list[str] | None = None


class DependencyInstallSession(BaseModel):
    model_config = ConfigDict(extra="allow")

    sessionId: str
    operation: Literal["install", "uninstall"]
    dependencyName: str
    status: Literal["running", "success", "failed", "cancelled"]
    cancelRequested: bool = False
    startedAt: str
    endedAt: str | None = None
    logs: list[str] = Field(default_factory=list)
    result: dict[str, Any] | None = None
