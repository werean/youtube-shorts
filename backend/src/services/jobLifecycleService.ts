/**
 * Service boundary for job metadata lifecycle operations.
 *
 * This wraps the current JSON-backed metadata storage without changing
 * persistence behavior, status values, or timestamp semantics.
 */

import type { Job, JobStatus } from "../models/job";
import * as metadata from "../storage/metadata";

export function loadJob(jobId: string): Job {
  return metadata.loadJob(jobId);
}

export function listJobs(): Job[] {
  return metadata.listJobs();
}

export function saveJob(job: Job): string {
  return metadata.saveJob(job);
}

export function updateJobStatus(jobId: string, status: JobStatus): Job {
  return metadata.updateJobStatus(jobId, status);
}

export function invalidateJobCache(jobId?: string): void {
  metadata.invalidateJobCache(jobId);
}

export function updateJob(jobId: string, update: (job: Job) => void): Job {
  const job = loadJob(jobId);
  update(job);
  saveJob(job);
  return job;
}
