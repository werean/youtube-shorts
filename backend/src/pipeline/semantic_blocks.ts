/**
 * Pipeline step: build semantic blocks from transcription.
 */

import { Segment } from "../models/segment";
import { SemanticBlock } from "../models/semantic_block";
import { JobStatus } from "../models/job";
import * as artifactService from "../services/artifactService";
import * as jobLifecycleService from "../services/jobLifecycleService";
import { endsSentence } from "./sentence";

const TARGET_MIN_SECONDS = 5.0;
const TARGET_MAX_SECONDS = 20.0;
const HARD_MAX_SECONDS = 30.0;

function loadSegments(jobId: string): Segment[] {
  const path = artifactService.transcriptionPath(jobId);
  if (!artifactService.artifactExists(path)) {
    throw new Error("Transcription segments JSON not found");
  }
  return artifactService.readJsonArtifact<Segment[]>(path);
}

export function groupSegmentsIntoBlocks(segments: Segment[]): SemanticBlock[] {
  if (segments.length === 0) {
    return [];
  }

  const blocks: SemanticBlock[] = [];
  let currentSegments: Segment[] = [];
  let blockStart = segments[0].start;
  let blockEnd = segments[0].end;

  const finalizeBlock = () => {
    if (currentSegments.length === 0) return;

    const blockText = currentSegments
      .map((segment) => segment.text)
      .join(" ")
      .trim();
    blocks.push({
      block_id: `b${blocks.length + 1}`,
      start: blockStart,
      end: blockEnd,
      text: blockText,
      segment_ids: currentSegments.map((segment) => segment.segment_id),
    });

    currentSegments = [];
    blockStart = blockEnd;
  };

  for (const segment of segments) {
    if (currentSegments.length === 0) {
      blockStart = segment.start;
      blockEnd = segment.end;
      currentSegments.push(segment);
      continue;
    }

    const previous = currentSegments[currentSegments.length - 1];
    const projectedDuration = segment.end - blockStart;
    const currentDuration = blockEnd - blockStart;
    const sentenceEnded = endsSentence(previous.text);
    const shouldClose =
      projectedDuration >= HARD_MAX_SECONDS ||
      (sentenceEnded &&
        (projectedDuration >= TARGET_MAX_SECONDS || currentDuration >= TARGET_MIN_SECONDS));

    if (shouldClose) {
      finalizeBlock();
      blockStart = segment.start;
      blockEnd = segment.end;
      currentSegments.push(segment);
      continue;
    }

    currentSegments.push(segment);
    blockEnd = segment.end;
  }

  finalizeBlock();
  return blocks;
}

export function buildSemanticBlocks(jobId: string): SemanticBlock[] {
  console.log(`[semantic_blocks] Building semantic blocks for job ${jobId}`);
  jobLifecycleService.updateJobStatus(jobId, JobStatus.BUILDING_BLOCKS);

  const segments = loadSegments(jobId);
  if (segments.length === 0) {
    throw new Error("No transcription segments available");
  }

  const blocks = groupSegmentsIntoBlocks(segments);
  const outputPath = artifactService.semanticBlocksPath(jobId);
  artifactService.writeJsonArtifact(outputPath, blocks);
  console.log(`[semantic_blocks] Semantic blocks saved for job ${jobId}`);

  const job = jobLifecycleService.loadJob(jobId);
  job.status = JobStatus.BUILDING_TOPICS;
  job.updated_at = new Date().toISOString();
  jobLifecycleService.saveJob(job);

  return blocks;
}
