/**
 * Batch Pipeline API
 */

import { apiBaseUrl } from "./client";

export interface BatchPipelineOptions {
  transcription: boolean;
  analysis: boolean;
  render: boolean;
}

export interface BatchPipelineProgress {
  current_job_index: number;
  current_job_id: string;
  current_step: string;
  completed_jobs: string[];
  failed_jobs: { job_id: string; error: string }[];
  is_running: boolean;
  waiting_for_approval?: boolean;
  pending_cuts?: any[];
}

export async function startBatchPipeline(
  jobIds: string[],
  options: BatchPipelineOptions,
): Promise<{ batch_id: string; status: string }> {
  const response = await fetch(`${apiBaseUrl}/jobs/batch/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_ids: jobIds,
      options,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to start batch pipeline");
  }

  return response.json();
}

export async function getBatchPipelineStatus(batchId: string): Promise<BatchPipelineProgress> {
  const response = await fetch(`${apiBaseUrl}/jobs/batch/${batchId}/status`);

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to get batch pipeline status");
  }

  return response.json();
}

export async function cancelBatchPipeline(batchId: string): Promise<{ status: string }> {
  const response = await fetch(`${apiBaseUrl}/jobs/batch/${batchId}/cancel`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to cancel batch pipeline");
  }

  return response.json();
}

export async function continueBatchPipeline(batchId: string): Promise<{ status: string }> {
  const response = await fetch(`${apiBaseUrl}/jobs/batch/${batchId}/continue`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to continue batch pipeline");
  }

  return response.json();
}
