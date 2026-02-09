export type JobStatus =
  | "CREATED"
  | "DOWNLOADING"
  | "DOWNLOADED"
  | "TRANSCRIBING"
  | "BUILDING_BLOCKS"
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
}

export interface Cut {
  cut_id: string;
  block_ids: string[];
  start: number;
  end: number;
  score?: number | null;
  hook_reason?: string | null;
  content_reason?: string | null;
  status: string;
}

export interface Segment {
  segment_id: string;
  start: number;
  end: number;
  text: string;
}

export interface VideoRecord {
  job: Job | null;
  job_id: string;
  video_path: string;
  archived: boolean;
  hasTranscription?: boolean;
  hasAnalysis?: boolean;
}
