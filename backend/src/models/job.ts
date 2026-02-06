/**
 * Data model for job metadata and state.
 */

export enum JobStatus {
  CREATED = "CREATED",
  DOWNLOADING = "DOWNLOADING",
  DOWNLOADED = "DOWNLOADED",
  TRANSCRIBING = "TRANSCRIBING",
  BUILDING_BLOCKS = "BUILDING_BLOCKS",
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
}
