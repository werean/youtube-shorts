/**
 * Analysis prerequisite helpers.
 *
 * These helpers align analysis entrypoints on strategy-dependent prerequisites:
 * short videos need semantic blocks only, while medium/long videos also need
 * topic segments before analysis.
 */

import type { Job } from "../models/job";
import { loadActiveToolConfigs } from "../core/toolConfigs";
import * as artifactService from "../services/artifactService";
import * as jobLifecycleService from "../services/jobLifecycleService";
import { buildSemanticBlocks } from "./semantic_blocks";
import { buildTopicSegments } from "./topic_segmentation";
import { selectStrategy } from "./strategy";
import { analyzeBlocks } from "./analysis";

type SemanticBlockPreparation = "ensure" | "rebuild";

type AnalysisPreparationOptions = {
  semanticBlocks: SemanticBlockPreparation;
  onMissingSemanticBlocks?: () => void;
};

export function ensureSemanticBlocksForAnalysis(
  jobId: string,
  onMissing?: () => void,
): boolean {
  const blocksPath = artifactService.semanticBlocksPath(jobId);
  if (artifactService.artifactExists(blocksPath)) {
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

export async function prepareAnalysisPrerequisites(
  job: Job,
  options: AnalysisPreparationOptions,
): Promise<void> {
  if (options.semanticBlocks === "rebuild") {
    await buildSemanticBlocksForAnalysis(job.job_id);
  } else {
    await ensureSemanticBlocksForAnalysis(job.job_id, options.onMissingSemanticBlocks);
  }

  const strategy = selectStrategy(job.video_duration_seconds ?? 0);
  if (strategy.useTopicSegmentation) {
    await buildTopicSegmentsForAnalysis(job);
  }
}

export async function analyzeWithPreparedPrerequisites(
  job: Job,
  options: AnalysisPreparationOptions,
) {
  await prepareAnalysisPrerequisites(job, options);
  return analyzeBlocks(job.job_id, job.video_duration_seconds ?? 0);
}

export async function analyzeJobWithPreparedPrerequisites(
  jobId: string,
  options: AnalysisPreparationOptions,
) {
  const job = jobLifecycleService.loadJob(jobId);
  return analyzeWithPreparedPrerequisites(job, options);
}
