/**
 * Data model for job metadata and state.
 */

export enum JobStatus {
  CREATED = "CREATED",
  DOWNLOADING = "DOWNLOADING",
  DOWNLOADED = "DOWNLOADED",
  TRANSCRIBING = "TRANSCRIBING",
  BUILDING_BLOCKS = "BUILDING_BLOCKS",
  BUILDING_TOPICS = "BUILDING_TOPICS",
  ANALYZING = "ANALYZING",
  WAITING_APPROVAL = "WAITING_APPROVAL",
  RENDERING = "RENDERING",
  DONE = "DONE",
  ERROR = "ERROR",
}

export interface Job {
  /** Explicit job identifier */
  job_id: string;
  /** Source YouTube URL */
  youtube_url: string;
  /** Current job status */
  status: JobStatus;
  /** Creation timestamp */
  created_at: string;
  /** Last update timestamp */
  updated_at?: string;
  /** Absolute path to source video on disk */
  source_video_path?: string;
  /** Original file name for local uploads */
  source_file_name?: string;
  /** Display name for the video (used in folder organization) */
  video_name?: string;
  /** Total video duration in seconds, set during ingest */
  video_duration_seconds?: number;
}
