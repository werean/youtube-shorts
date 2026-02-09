/**
 * Tipos e interfaces compartilhadas pela aplicação
 */

import type { Job, Segment } from "./types";

export interface VideoItem {
  job: Job;
  videoPath?: string;
  transcription?: string;
  transcriptionSegments?: Segment[];
  transcriptionFormats?: { segments?: boolean; text?: boolean; vtt?: boolean };
  isTranscribing?: boolean;
  transcriptionLogs?: string[];
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
