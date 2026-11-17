/**
 * Tipos e interfaces compartilhadas pela aplicação
 */

import type {
  DubbingEngine,
  DubbingLanguage,
  DubbingSubtitlePreset,
  DubbingVoiceMode,
  Job,
} from "@youtube-shorts/contracts";

export type DubbingDefaultLanguage = "ask" | DubbingLanguage;
export type DubbingAudioMode = "original" | "dubbed" | "preview";

export interface DubbingPreflightMissingItem {
  id: string;
  label: string;
  category: "venv" | "model" | string;
  estimated_gb: number;
  path: string;
}

export interface DubbingPreflightPaths {
  base_venv: string;
  engine_venv: string;
  hf_cache: string;
  sep_cache: string;
  sherpa_cache: string;
}

export interface DubbingPreflightResult {
  ready: boolean;
  engine: DubbingEngine | string;
  missing: DubbingPreflightMissingItem[];
  total_download_gb: number;
  free_disk_gb: number;
  disk_sufficient: boolean;
  paths?: DubbingPreflightPaths;
}

export interface DubbingStartOptions {
  target_lang?: DubbingLanguage | string;
  engine?: DubbingEngine | string;
  voice_mode?: DubbingVoiceMode | string;
  subtitles_enabled?: boolean;
  subtitle_preset?: DubbingSubtitlePreset | string;
  auto_install?: boolean;
}

export interface DubbingPreviewOptions extends DubbingStartOptions {
  start_time?: number;
  duration?: number;
}

export interface DubbingExportResult {
  ok: boolean;
  mp4_url: string;
  mp4_path?: string | null;
  srt_url?: string | null;
  vtt_url?: string | null;
  preset: DubbingSubtitlePreset | string;
  subtitles_enabled?: boolean;
  video_codec_used?: string | null;
  warnings?: string[];
}

export interface DubbingSendToCutsResult {
  ok: boolean;
  job: Job;
  job_id?: string;
  video_path: string;
  video_name?: string;
  hasTranscription?: boolean;
}

export interface DeleteModelResponse {
  ok: boolean;
  model_id: string;
  freed_bytes: number;
  deleted_paths: string[];
  cleared_dependents?: string[];
}

export interface Segment {
  segment_id: string;
  start: number;
  end: number;
  text: string;
}

export interface VideoItem {
  job: Job;
  videoPath?: string;
  hasTranscription?: boolean;
  hasAnalysis?: boolean;
  transcription?: string;
  transcriptionSegments?: Segment[];
  transcriptionFormats?: { segments?: boolean; text?: boolean; vtt?: boolean };
  isTranscribing?: boolean;
  transcriptionLogs?: string[];
  attemptsCount?: number;
}

export interface ActionState {
  busy: boolean;
  error?: string;
}

export const WHISPER_FORMATS = [
  { id: "json", label: "JSON", description: "Formato JSON com segmentos detalhados e timestamps" },
  { id: "vtt", label: "VTT", description: "WebVTT - formato de legendas para web players" },
  { id: "txt", label: "TXT", description: "Texto simples sem timestamps" },
  { id: "srt", label: "SRT", description: "SubRip - formato de legendas universal" },
] as const;
