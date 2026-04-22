/**
 * Data model for job metadata and state.
 */

import type { Job as SharedJob, JobStatus as SharedJobStatus } from "@youtube-shorts/contracts";

export const JobStatus = {
  CREATED: "CREATED",
  DOWNLOADING: "DOWNLOADING",
  DOWNLOADED: "DOWNLOADED",
  TRANSCRIBING: "TRANSCRIBING",
  BUILDING_BLOCKS: "BUILDING_BLOCKS",
  BUILDING_TOPICS: "BUILDING_TOPICS",
  ANALYZING: "ANALYZING",
  WAITING_APPROVAL: "WAITING_APPROVAL",
  RENDERING: "RENDERING",
  DONE: "DONE",
  ERROR: "ERROR",
} as const satisfies Record<SharedJobStatus, SharedJobStatus>;

export type JobStatus = SharedJobStatus;

export interface Job extends SharedJob {}
