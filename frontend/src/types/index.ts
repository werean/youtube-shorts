export type {
  Job,
  JobStatus,
  VideoRecord,
  AppSettings,
  InstallationGuide,
  DependencyStatusInfo,
  DependenciesSnapshot,
  InstallDependencyResult,
  DependencyOperationMode,
  PytorchGpuTier,
  DependencyInstallOptions,
  DependencyInstallSessionStatus,
  DependencyInstallSession,
  StartDependencyInstallSessionResult,
  CancelDependencyInstallSessionResponse,
  OllamaCatalogEntry,
  OllamaModelsResponse,
  RegisterOllamaModelRequest,
  RegisterOllamaModelResponse,
  RemoveOllamaModelResponse,
  SavedLLMPrompt,
  BatchPipelineOptions,
  BatchPipelineRequest,
  BatchPipelineProgress,
  BatchRunResponse,
  BatchActionResponse,
  WordTiming,
  AttemptSummary,
  AttemptTranscriptionSegment,
  AttemptTranscription,
  AttemptDetail,
  ArchiveAttemptRequest,
  ArchiveAttemptResponse,
  DeleteAttemptResponse,
} from "@youtube-shorts/contracts";

export * from "./cut";
export * from "./app";
export * from "./ffmpeg";
export * from "./whisper";
export * from "./toolConfigs";

export interface Segment {
  segment_id: string;
  start: number;
  end: number;
  text: string;
}
