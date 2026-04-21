/**
 * Analysis prerequisite helpers.
 *
 * These helpers preserve the current caller-specific behavior:
 * direct analysis ensures blocks exist, batch/orchestrator rebuild blocks,
 * and orchestrator runs topic segmentation as its own step.
 */

import * as fs from "fs";
import type { Job } from "../models/job";
import { loadActiveToolConfigs } from "../core/toolConfigs";
import * as files from "../storage/files";
import { buildSemanticBlocks } from "./semantic_blocks";
import { buildTopicSegments } from "./topic_segmentation";
import { selectStrategy } from "./strategy";

export function ensureSemanticBlocksForAnalysis(
  jobId: string,
  onMissing?: () => void,
): boolean {
  const blocksPath = files.semanticBlocksPath(jobId);
  if (fs.existsSync(blocksPath)) {
    return false;
  }

  onMissing?.();
  buildSemanticBlocks(jobId);
  return true;
}

export function buildSemanticBlocksForAnalysis(jobId: string) {
  return buildSemanticBlocks(jobId);
}

export function buildTopicSegmentsForAnalysis(job: Job) {
  const strategy = selectStrategy(job.video_duration_seconds ?? 0);
  const configs = loadActiveToolConfigs();
  const embeddingModel =
    String(configs.llm.embedding_model || "nomic-embed-text").trim() || "nomic-embed-text";

  return buildTopicSegments(job.job_id, strategy.useEmbeddings, embeddingModel);
}
