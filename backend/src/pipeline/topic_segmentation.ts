/**
 * Pipeline step: group semantic blocks into topic segments.
 * Heuristic boundary detection remains the primary mechanism and embeddings,
 * when enabled, only add extra boundaries.
 */

import * as fs from "fs";
import { SemanticBlock } from "../models/semantic_block";
import { TopicSegment } from "../models/topic_segment";
import { JobStatus } from "../models/job";
import * as files from "../storage/files";
import * as metadata from "../storage/metadata";
import { detectEmbeddingBoundaries, fetchEmbeddings } from "./embedding";

/** Pause gap in seconds sufficient to signal a topic boundary. */
const TOPIC_PAUSE_THRESHOLD_SECONDS = 2.5;

/** Pause gap required when the previous block ends with ? or ! to trigger a boundary. */
const QUESTION_EXCLAMATION_PAUSE_SECONDS = 1.0;

/** Force-close a topic after it accumulates this many seconds regardless of other signals. */
const TOPIC_MAX_DURATION_SECONDS = 360; // 6 minutes

/** Topics shorter than this are merged into the previous topic. */
const TOPIC_MIN_DURATION_SECONDS = 90;

/**
 * Returns true if `text` ends with `?` or `!`.
 */
function endsWithQuestionOrExclamation(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith("?") || trimmed.endsWith("!");
}

/**
 * Returns true if `text` starts with a lowercase letter, indicating a sentence
 * continuation that should not open a new topic.
 */
function startsWithLowercase(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    /^[a-záéíóúãõâêîôûàèìòùäëïöüýçñ]/i.test(trimmed) &&
    trimmed[0] === trimmed[0].toLowerCase() &&
    trimmed[0] !== trimmed[0].toUpperCase()
  );
}

/**
 * Finalizes the current open topic accumulator and pushes to `topics`.
 *
 * @param currentBlocks - Accumulated blocks for the topic being finalized.
 * @param topics - Destination array of completed topics.
 * @returns Nothing.
 */
function finalizeTopic(currentBlocks: SemanticBlock[], topics: TopicSegment[]): void {
  if (currentBlocks.length === 0) return;

  const topicId = `t${topics.length + 1}`;
  const start = currentBlocks[0].start;
  const end = currentBlocks[currentBlocks.length - 1].end;

  topics.push({
    topic_id: topicId,
    start,
    end,
    block_ids: currentBlocks.map((b) => b.block_id),
    blockCount: currentBlocks.length,
    durationSeconds: end - start,
  });
}

/**
 * Detects topic boundaries using the existing deterministic heuristics.
 *
 * @param blocks - Ordered semantic blocks.
 * @returns Set of block IDs where a new topic should start.
 */
function detectHeuristicBoundaries(blocks: SemanticBlock[]): Set<string> {
  const boundaries = new Set<string>();

  if (blocks.length === 0) {
    return boundaries;
  }

  let currentBlocks: SemanticBlock[] = [blocks[0]];

  for (let i = 1; i < blocks.length; i += 1) {
    const prev = blocks[i - 1];
    const curr = blocks[i];

    const pause = Math.max(0, curr.start - prev.end);
    const accumulatedStart = currentBlocks[0].start;
    const accumulatedDuration = prev.end - accumulatedStart;

    // Rule: never open a new topic if next block is a sentence continuation
    if (startsWithLowercase(curr.text)) {
      currentBlocks.push(curr);
      continue;
    }

    let shouldSplit = false;

    // Rule 1: large gap between blocks
    if (pause >= TOPIC_PAUSE_THRESHOLD_SECONDS) {
      shouldSplit = true;
    }

    // Rule 2: force-close after max duration
    if (accumulatedDuration >= TOPIC_MAX_DURATION_SECONDS) {
      shouldSplit = true;
    }

    // Rule 3: question/exclamation + moderate pause
    if (
      !shouldSplit &&
      endsWithQuestionOrExclamation(prev.text) &&
      pause >= QUESTION_EXCLAMATION_PAUSE_SECONDS
    ) {
      shouldSplit = true;
    }

    if (shouldSplit) {
      boundaries.add(curr.block_id);
      currentBlocks = [curr];
    } else {
      currentBlocks.push(curr);
    }
  }

  return boundaries;
}

/**
 * Builds topic segments from an ordered block list and a set of boundary block IDs.
 *
 * @param blocks - Ordered semantic blocks.
 * @param boundaries - Set of block IDs where a new topic starts.
 * @returns Built and post-processed topic segments.
 */
function buildTopicsFromBoundaries(
  blocks: SemanticBlock[],
  boundaries: Set<string>,
): TopicSegment[] {
  if (blocks.length === 0) {
    return [];
  }

  const rawTopics: TopicSegment[] = [];
  let currentBlocks: SemanticBlock[] = [blocks[0]];

  for (let i = 1; i < blocks.length; i += 1) {
    const curr = blocks[i];
    if (boundaries.has(curr.block_id)) {
      finalizeTopic(currentBlocks, rawTopics);
      currentBlocks = [curr];
    } else {
      currentBlocks.push(curr);
    }
  }

  finalizeTopic(currentBlocks, rawTopics);

  // Post-processing: merge topics shorter than TOPIC_MIN_DURATION_SECONDS into the previous
  const merged: TopicSegment[] = [];
  for (const topic of rawTopics) {
    if (topic.durationSeconds < TOPIC_MIN_DURATION_SECONDS && merged.length > 0) {
      const prev = merged[merged.length - 1];
      const newEnd = topic.end;
      merged[merged.length - 1] = {
        ...prev,
        end: newEnd,
        block_ids: [...prev.block_ids, ...topic.block_ids],
        blockCount: prev.blockCount + topic.blockCount,
        durationSeconds: newEnd - prev.start,
      };
    } else {
      merged.push(topic);
    }
  }

  // Re-number topic IDs after merges
  const final: TopicSegment[] = merged.map((t, idx) => ({
    ...t,
    topic_id: `t${idx + 1}`,
  }));

  return final;
}

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

  const blocksPath = files.semanticBlocksPath(jobId);
  if (!fs.existsSync(blocksPath)) {
    throw new Error(`Semantic blocks not found for job ${jobId}. Run buildSemanticBlocks first.`);
  }

  const blocks: SemanticBlock[] = JSON.parse(fs.readFileSync(blocksPath, "utf-8"));
  if (blocks.length === 0) {
    throw new Error(`No semantic blocks available for job ${jobId}`);
  }

  const heuristicBoundaries = detectHeuristicBoundaries(blocks);
  let finalBoundaries = new Set<string>(heuristicBoundaries);

  if (useEmbeddings) {
    try {
      const embeddings = await fetchEmbeddings(
        blocks.map((block) => block.text),
        embeddingModel,
      );
      const embeddingBoundaries = detectEmbeddingBoundaries(
        blocks,
        embeddings,
        similarityThreshold,
      );

      finalBoundaries = new Set([...heuristicBoundaries, ...embeddingBoundaries]);

      console.log(
        `[topic_segmentation] job=${jobId} heuristicBoundaries=${heuristicBoundaries.size} embeddingBoundaries=${embeddingBoundaries.size} finalBoundaries=${finalBoundaries.size}`,
      );
    } catch (error: any) {
      throw new Error(
        `[topic_segmentation] Embedding boundary detection failed for job ${jobId} (model='${embeddingModel}', blocks=${blocks.length}): ${String(error?.message || error)}`,
      );
    }
  }

  const topics = buildTopicsFromBoundaries(blocks, finalBoundaries);

  const outputPath = files.topicSegmentsPath(jobId);
  fs.writeFileSync(outputPath, JSON.stringify(topics, null, 2), "utf-8");

  console.log(`[topic_segmentation] ${topics.length} topic(s) detected and saved for job ${jobId}`);

  const job = metadata.loadJob(jobId);
  job.status = JobStatus.ANALYZING;
  job.updated_at = new Date().toISOString();
  metadata.saveJob(job);

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
