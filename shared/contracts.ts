export type JobStatus =
  | "CREATED"
  | "DOWNLOADING"
  | "DOWNLOADED"
  | "TRANSCRIBING"
  | "BUILDING_BLOCKS"
  | "BUILDING_TOPICS"
  | "ANALYZING"
  | "WAITING_APPROVAL"
  | "RENDERING"
  | "DONE"
  | "ERROR";

export interface Job {
  job_id: string;
  youtube_url: string;
  status: JobStatus;
  created_at: string;
  updated_at?: string | null;
  source_video_path?: string;
  source_file_name?: string;
  video_name?: string;
  video_duration_seconds?: number;
}

export interface NarrativeArc {
  hook: string;
  development: string;
  climax: string;
  resolution: string;
}

export interface Cut {
  cut_id: string;
  id?: string;
  block_ids: string[];
  start: number;
  end: number;
  duration?: number;
  title?: string | null;
  status: string;
  summary?: string;
  reasoning?: string;
  score?: number;
  approved?: boolean;
  rejected?: boolean;
  subtitle?: string;
  narrative_arc?: NarrativeArc;
  vertical_mode?: 'crop' | 'blur' | 'zoom' | 'split_podcast';
}

export interface VideoRecord {
  job: Job | null;
  job_id: string;
  video_path: string;
  archived: boolean;
  hasTranscription?: boolean;
  hasAnalysis?: boolean;
  attempts_count?: number;
}

export interface BatchPipelineOptions {
  transcription: boolean;
  analysis: boolean;
  render: boolean;
  preApprove: boolean;
}

export interface BatchPipelineRequest {
  job_ids: string[];
  options: BatchPipelineOptions;
}

export interface BatchPipelineProgress {
  current_job_index: number;
  current_job_id: string;
  current_step: string;
  completed_jobs: string[];
  failed_jobs: { job_id: string; error: string }[];
  is_running: boolean;
  waiting_for_approval?: boolean;
  pending_cuts?: any[];
}

export interface BatchRunResponse {
  batch_id: string;
  status: "started";
}

export interface BatchActionResponse {
  status: "cancelled" | "continued";
}

export interface AppSettings {
  media: {
    base_dir: string;
    download_resolution: "1080p" | "1440p" | "4k";
  };
  preferences: {
    ask_move_on_upload: boolean;
    move_uploads: boolean;
    ask_delete_cut_confirm: boolean;
  };
  whisper: {
    device: "cpu" | "cuda";
    formats: string[];
  };
  llm: {
    model: string;
  };
}

export interface InstallationGuide {
  name: string;
  manual: {
    title: string;
    description: string;
    steps: string[];
    links?: { text: string; url: string }[];
  };
  automatic?: {
    command: string;
    description: string;
  };
}

export interface DependencyStatusInfo {
  installed: boolean;
  version: string | null;
}

export interface DependenciesSnapshot {
  python: DependencyStatusInfo;
  whisper: DependencyStatusInfo;
  ytdlp: DependencyStatusInfo;
  ffmpeg: DependencyStatusInfo;
  cuda: DependencyStatusInfo;
  pytorch: DependencyStatusInfo;
  ollama: DependencyStatusInfo;
}

export interface InstallDependencyResult {
  success: boolean;
  message: string;
  output?: string;
  error?: string;
  failureCategory?: string;
  installer?: string;
  dependencies?: DependenciesSnapshot;
  diagnostics?: string[];
}

export type DependencyOperationMode = "install" | "uninstall";
export type PytorchGpuTier = "rtx_4000_or_lower" | "rtx_5000";

export interface DependencyInstallOptions {
  pytorchGpuTier?: PytorchGpuTier;
}

export type DependencyInstallSessionStatus = "running" | "success" | "failed" | "cancelled";

export interface DependencyInstallSession {
  sessionId: string;
  operation: DependencyOperationMode;
  dependencyName: string;
  status: DependencyInstallSessionStatus;
  cancelRequested?: boolean;
  startedAt: string;
  endedAt?: string;
  logs: string[];
  result?: InstallDependencyResult;
}

export interface StartDependencyInstallSessionResult {
  sessionId: string;
  operation: DependencyOperationMode;
  dependencyName: string;
  status: DependencyInstallSessionStatus;
  startedAt: string;
}

export interface CancelDependencyInstallSessionResponse {
  success: boolean;
  message: string;
  sessionId: string;
  status: DependencyInstallSessionStatus;
}

export interface OllamaCatalogEntry {
  name: string;
  model: string;
  source: "cloud" | "local";
  installed: boolean;
  running: boolean;
  needsDownload: boolean;
  size?: number;
}

export interface OllamaModelsResponse {
  catalog?: OllamaCatalogEntry[];
  models: string[];
  configuredModel: string;
  online: boolean;
  localAvailable?: boolean;
  remoteAvailable?: boolean;
}

export interface RegisterOllamaModelRequest {
  name: string;
  source: "cloud" | "local";
}

export interface RegisterOllamaModelResponse {
  success: boolean;
  message: string;
  model: {
    name: string;
    source: "cloud" | "local";
  };
  configuredModel: string;
}

export interface RemoveOllamaModelResponse {
  success: boolean;
  message: string;
  removedModel: string;
  removedFromLocal: boolean;
}

export interface SavedLLMPrompt {
  id: string;
  name: string;
  prompt: string;
  created_at: string;
  updated_at: string;
}

export interface WordTiming {
  word: string;
  start: number;
  end: number;
  probability?: number;
}

export interface AttemptSummary {
  attempt_id: string;
  job_id: string;
  label: string;
  created_at: string;
  archived_at: string;
  status: JobStatus | string;
  video_duration_seconds?: number | null;
  cuts_count: number;
  approved_count: number;
  rendered_count: number;
  rendered_files: string[];
  rendered_urls: string[];
  has_transcription: boolean;
}

export interface AttemptTranscriptionSegment {
  segment_id?: string;
  start: number;
  end: number;
  text: string;
}

export interface AttemptTranscription {
  text?: string | null;
  segments: AttemptTranscriptionSegment[];
  words?: WordTiming[];
  vtt?: string | null;
  available_formats?: {
    segments?: boolean;
    text?: boolean;
    vtt?: boolean;
  };
}

export interface AttemptDetail {
  attempt: AttemptSummary;
  cuts: Cut[];
  transcription: AttemptTranscription | null;
  renders: string[];
}

export interface ArchiveAttemptRequest {
  label?: string;
  reset_active?: boolean;
}

export interface ArchiveAttemptResponse {
  attempt: AttemptSummary;
  job: Job;
  attempts: AttemptSummary[];
}

export interface DeleteAttemptResponse {
  ok: boolean;
  attempt_id: string;
  attempts: AttemptSummary[];
}
