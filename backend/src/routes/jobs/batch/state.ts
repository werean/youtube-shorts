import type { BatchPipelineProgress } from "./types";

const activeBatchProcesses = new Map<string, BatchPipelineProgress>();

export function createBatchProgress(batchId: string, jobIds: string[]): BatchPipelineProgress {
  const progress: BatchPipelineProgress = {
    current_job_index: 0,
    current_job_id: jobIds[0],
    current_step: "starting",
    completed_jobs: [],
    failed_jobs: [],
    is_running: true,
  };

  activeBatchProcesses.set(batchId, progress);
  return progress;
}

export function getBatchProgress(batchId: string): BatchPipelineProgress | undefined {
  return activeBatchProcesses.get(batchId);
}

export function markBatchNotRunning(batchId: string): void {
  const progress = activeBatchProcesses.get(batchId);
  if (progress) {
    progress.is_running = false;
  }
}
