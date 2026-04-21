/**
 * Pipeline step: group semantic blocks into topic segments.
 * Heuristic boundary detection remains the primary mechanism and embeddings,
 * when enabled, only add extra boundaries.
 */

import { TopicSegment } from "../models/topic_segment";
import { JobStatus } from "../models/job";
import * as metadata from "../storage/metadata";
import { addEmbeddingBoundaries } from "./topic_segmentation/embeddings";
import { detectHeuristicBoundaries } from "./topic_segmentation/heuristics";
import { persistTopicSegments } from "./topic_segmentation/persistence";
import { loadSemanticBlocksForTopics } from "./topic_segmentation/preconditions";
import { buildTopicsFromBoundaries } from "./topic_segmentation/topics";

/**
 * Pipeline step wrapper: loads blocks from disk, builds topic segments, saves to disk.
 * Heuristic boundaries are always used; embedding boundaries are optionally added.
 *
 * @param jobId - The job identifier.
 * @param useEmbeddings - Whether to add embedding-based boundaries.
 * @param embeddingModel - Ollama embedding model name.
 * @param similarityThreshold - Similarity threshold where lower scores add a boundary.
 * @returns Array of TopicSegment saved to disk.
 */
export async function buildTopicSegments(
  jobId: string,
  useEmbeddings: boolean = false,
  embeddingModel: string = "nomic-embed-text",
  similarityThreshold: number = 0.75,
): Promise<TopicSegment[]> {
  console.log(
    `[topic_segmentation] Building topic segments for job ${jobId} (useEmbeddings=${useEmbeddings}, model=${embeddingModel}, threshold=${similarityThreshold})`,
  );
  metadata.updateJobStatus(jobId, JobStatus.BUILDING_TOPICS);

  const blocks = loadSemanticBlocksForTopics(jobId);
  const heuristicBoundaries = detectHeuristicBoundaries(blocks);
  let finalBoundaries = new Set<string>(heuristicBoundaries);

  if (useEmbeddings) {
    finalBoundaries = await addEmbeddingBoundaries(
      jobId,
      blocks,
      heuristicBoundaries,
      embeddingModel,
      similarityThreshold,
    );
  }

  const topics = buildTopicsFromBoundaries(blocks, finalBoundaries);

  persistTopicSegments(jobId, topics);

  return topics;
}

/**
 * Backward-compatible helper that runs topic segmentation with heuristics only.
 *
 * @param jobId - The job identifier.
 * @returns Array of TopicSegment saved to disk.
 */
export async function buildTopicSegmentsForJob(jobId: string): Promise<TopicSegment[]> {
  return buildTopicSegments(jobId, false);
}
