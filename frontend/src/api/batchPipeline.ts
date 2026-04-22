/**
 * Batch Pipeline API
 */

import { apiBaseUrl } from "./client";
import type {
  BatchActionResponse,
  BatchPipelineOptions,
  BatchPipelineProgress,
  BatchRunResponse,
} from "@youtube-shorts/contracts";

export type { BatchPipelineOptions, BatchPipelineProgress };

export async function startBatchPipeline(
  jobIds: string[],
  options: BatchPipelineOptions,
): Promise<BatchRunResponse> {
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

export async function cancelBatchPipeline(batchId: string): Promise<BatchActionResponse> {
  const response = await fetch(`${apiBaseUrl}/jobs/batch/${batchId}/cancel`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to cancel batch pipeline");
  }

  return response.json();
}

export async function continueBatchPipeline(batchId: string): Promise<BatchActionResponse> {
  const response = await fetch(`${apiBaseUrl}/jobs/batch/${batchId}/continue`, {
    method: "POST",
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.detail || "Failed to continue batch pipeline");
  }

  return response.json();
}
