/**
 * Pipeline step: build semantic blocks from transcription.
 */

import { Segment } from "../models/segment";
import { SemanticBlock } from "../models/semantic_block";
import { JobStatus } from "../models/job";
import * as artifactService from "../services/artifactService";
import * as jobLifecycleService from "../services/jobLifecycleService";

const TARGET_MIN_SECONDS = 5.0;
const TARGET_MAX_SECONDS = 20.0;
const HARD_MAX_SECONDS = 30.0;
const PAUSE_THRESHOLD_SECONDS = 0.6;
const SENTENCE_BOUNDARIES = [".", "!", "?", "…"];

function loadSegments(jobId: string): Segment[] {
  const path = artifactService.transcriptionPath(jobId);
  if (!artifactService.artifactExists(path)) {
    throw new Error("Transcription segments JSON not found");
  }
  return artifactService.readJsonArtifact<Segment[]>(path);
}

function endsSentence(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return SENTENCE_BOUNDARIES.some((boundary) => trimmed.endsWith(boundary));
}

export function buildSemanticBlocks(jobId: string): SemanticBlock[] {
  console.log(`[semantic_blocks] Building semantic blocks for job ${jobId}`);
  jobLifecycleService.updateJobStatus(jobId, JobStatus.BUILDING_BLOCKS);

  const segments = loadSegments(jobId);
  if (segments.length === 0) {
    throw new Error("No transcription segments available");
  }

  const blocks: SemanticBlock[] = [];
  let currentSegments: Segment[] = [];
  let blockStart = segments[0].start;
  let blockEnd = segments[0].end;

  const finalizeBlock = () => {
    if (currentSegments.length === 0) return;

    const blockText = currentSegments
      .map((s) => s.text)
      .join(" ")
      .trim();
    const blockId = `b${blocks.length + 1}`;

    blocks.push({
      block_id: blockId,
      start: blockStart,
      end: blockEnd,
      text: blockText,
      segment_ids: currentSegments.map((s) => s.segment_id),
    });

    currentSegments = [];
    blockStart = blockEnd;
  };

  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];

    if (currentSegments.length === 0) {
      blockStart = segment.start;
      blockEnd = segment.end;
      currentSegments.push(segment);
      continue;
    }

    const previous = currentSegments[currentSegments.length - 1];
    const pause = Math.max(0, segment.start - previous.end);
    const projectedEnd = segment.end;
    const currentDuration = blockEnd - blockStart;
    const projectedDuration = projectedEnd - blockStart;
    const endSentence = endsSentence(previous.text);
    const isPause = pause >= PAUSE_THRESHOLD_SECONDS;

    let shouldClose = false;
    if (projectedDuration >= TARGET_MAX_SECONDS) {
      shouldClose = endSentence || isPause || projectedDuration >= HARD_MAX_SECONDS;
    } else if (currentDuration >= TARGET_MIN_SECONDS && (endSentence || isPause)) {
      shouldClose = true;
    }

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

  const outputPath = artifactService.semanticBlocksPath(jobId);
  artifactService.writeJsonArtifact(outputPath, blocks);
  console.log(`[semantic_blocks] Semantic blocks saved for job ${jobId}`);

  const job = jobLifecycleService.loadJob(jobId);
  job.status = JobStatus.ANALYZING;
  job.updated_at = new Date().toISOString();
  jobLifecycleService.saveJob(job);

  return blocks;
}
