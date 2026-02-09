/**
 * Utility functions for video transcription and VTT generation
 */

import type { Segment, VideoRecord, Job } from "../types";
import { formatVttTimestamp } from "./formatters";

export interface VideoItem {
  job: Job;
  videoPath?: string;
  transcription?: string;
  transcriptionSegments?: Segment[];
  transcriptionFormats?: { segments?: boolean; text?: boolean; vtt?: boolean };
  isTranscribing?: boolean;
  transcriptionLogs?: string[];
  hasTranscription?: boolean;
  hasAnalysis?: boolean;
}

/**
 * Convert VideoRecord to VideoItem
 */
export function recordToVideoItem(record: VideoRecord): VideoItem {
  const job =
    record.job ||
    ({
      job_id: record.job_id,
      youtube_url: "Video sem metadata",
      status: "CREATED",
      created_at: new Date().toISOString(),
    } as Job);

  return {
    job,
    videoPath: record.video_path,
    transcriptionLogs: [],
    hasTranscription: record.hasTranscription,
    hasAnalysis: record.hasAnalysis,
  };
}

/**
 * Build VTT subtitle file from segments
 */
export function buildVtt(segments: Segment[] = []): string {
  const cues = segments
    .map((segment, index) => {
      const start = formatVttTimestamp(segment.start);
      const end = formatVttTimestamp(segment.end);
      return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${cues}`.trimEnd() + "\n";
}

/**
 * Get transcription content by format
 */
export function getTranscriptionContent(
  video: VideoItem,
  format: "text" | "vtt" | "segments",
): { title: string; content: string } {
  if (format === "vtt") {
    return {
      title: "Transcrição (VTT)",
      content: buildVtt(video.transcriptionSegments || []),
    };
  }

  if (format === "segments") {
    return {
      title: "Transcrição (JSON Segments)",
      content: JSON.stringify(video.transcriptionSegments || [], null, 2),
    };
  }

  return {
    title: "Transcrição (Texto)",
    content: video.transcription || "Sem transcrição disponível",
  };
}
