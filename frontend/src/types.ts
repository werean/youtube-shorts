export type { Cut, Job, JobStatus, VideoRecord } from "@youtube-shorts/contracts";

export interface Segment {
  segment_id: string;
  start: number;
  end: number;
  text: string;
}
