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
  dubbing_status?: string | null;
  dubbed_languages?: string[] | null;
}

export type DubbingEngine = "qwen3_tts" | "chatterbox";
export type DubbingLanguage = "pt-BR" | "en" | "es";
export type DubbingVoiceMode = "auto" | "single";
export type DubbingSubtitlePreset = "mov_text" | "hardsub";

export interface DubbingSettings {
  engine: DubbingEngine;
  default_target_lang: "ask" | DubbingLanguage;
  default_voice_mode: DubbingVoiceMode;
  default_subtitles_enabled: boolean;
  default_subtitle_preset: DubbingSubtitlePreset;
}

export interface DubbingTrack {
  lang: DubbingLanguage | string;
  engine: DubbingEngine | string;
  voice_mode: DubbingVoiceMode | string;
  status: string;
  audio_url?: string | null;
  audio_path?: string | null;
  vtt_url?: string | null;
  srt_url?: string | null;
  duration_seconds?: number | null;
  speakers_count?: number | null;
  units_count?: number | null;
  warnings?: string[];
  error?: string | null;
  exported_mp4_url?: string | null;
  exported_mp4_path?: string | null;
  subtitle_preset?: DubbingSubtitlePreset | string | null;
  subtitles_enabled?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface DubbingPreview {
  lang: DubbingLanguage | string;
  engine: DubbingEngine | string;
  voice_mode: DubbingVoiceMode | string;
  status: string;
  preview_start: number;
  preview_end: number;
  duration: number;
  audio_url?: string | null;
  vtt_url?: string | null;
  audio_path?: string | null;
  vtt_path?: string | null;
  warnings?: string[];
  error?: string | null;
  updated_at?: string | null;
}

export interface DubbingCutTrack {
  cut_id: string;
  short_file?: string | null;
  lang: DubbingLanguage | string;
  engine: DubbingEngine | string;
  voice_mode: DubbingVoiceMode | string;
  status: string;
  audio_url?: string | null;
  vtt_url?: string | null;
  srt_url?: string | null;
  exported_mp4_url?: string | null;
  exported_mp4_path?: string | null;
  subtitle_preset?: DubbingSubtitlePreset | string | null;
  subtitles_enabled?: boolean | null;
  warnings?: string[];
  created_at?: string | null;
  updated_at?: string | null;
  error?: string | null;
}

export interface DubbingManifest {
  job_id: string;
  active_lang?: string | null;
  status: string;
  tracks: Record<string, DubbingTrack>;
  preview?: DubbingPreview | null;
  cut_dubs?: Record<string, Record<string, DubbingCutTrack>>;
  updated_at?: string | null;
}

export interface ModelStorageItem {
  model_id: string;
  label: string;
  size_bytes: number;
  path?: string | null;
  paths?: string[];
  installed: boolean;
  deletable: boolean;
  category?: string | null;
}

export interface LmStudioModelStorageItem {
  model_key: string;
  display_name: string;
  model_type: string;
  quantization?: string | null;
  size_bytes: number;
  paths?: string[];
  bundled: boolean;
  deletable: boolean;
}

export interface StorageUsageSummary {
  videos_bytes: number;
  dubs_bytes: number;
  stems_bytes: number;
  shorts_bytes: number;
  archives_bytes: number;
  total_media_bytes: number;
  total_models_bytes: number;
  total_app_bytes: number;
  lmstudio_models_bytes?: number;
  total_with_lmstudio_bytes?: number;
  models: ModelStorageItem[];
  lmstudio_models?: LmStudioModelStorageItem[];
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
  dubbing?: DubbingSettings;
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
