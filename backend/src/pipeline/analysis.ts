/**
 * Pipeline step: semantic analysis with LLM over semantic blocks or topic segments.
 *
 * Supports single-pass (short videos) and two-pass topic-aware (long videos) strategies.
 */

import { loadActiveToolConfigs } from "../core/toolConfigs";
import { Cut } from "../models/cut";
import { JobStatus } from "../models/job";
import { TopicSegment } from "../models/topic_segment";
import * as artifactService from "../services/artifactService";
import * as jobLifecycleService from "../services/jobLifecycleService";
import * as operationRuntimeService from "../services/operationRuntimeService";
import {
  HARD_MAX_CUT_SECONDS,
  HARD_MIN_CUT_SECONDS,
  PREFERRED_MAX_CUT_SECONDS,
  PREFERRED_MIN_CUT_SECONDS,
  normalizeCuts,
} from "./analysis/cuts";
import { buildClient } from "./analysis/llm";
import { persistAnalysisOutput } from "./analysis/persistence";
import { loadBlocks } from "./analysis/preconditions";
import { collectRawCutsForStrategy, type TopicDisposition } from "./analysis/strategyFlow";
import { PROMPT_VERSION } from "../llm/prompts";
import { RawLLMCut } from "./analysis/types";
import { analysisRunLogPath, writeRunLog } from "./runLog";
import { selectStrategy } from "./strategy";

/**
 * Analyse semantic blocks with the LLM and produce suggested cuts.
 *
 * Strategy is selected based on `videoDurationSeconds`:
 * - Short  (<20 min): single pass over all blocks
 * - Medium (20-60 min): topic-aware, single pass per topic
 * - Long   (>=60 min): topic-aware, two-pass (candidacy + full analysis)
 *
 * Cuts are snapped to block edges. A repair may only finish the open sentence.
 * Overlapping cuts (>30s overlap) are deduplicated by score.
 *
 * @param jobId - Job identifier.
 * @param videoDurationSeconds - Total video duration used to select processing strategy.
 * @returns Object with final cuts array and the merged raw LLM response string.
 */
function loadTopicsIfPresent(jobId: string): TopicSegment[] | undefined {
  const topicPath = artifactService.topicSegmentsPath(jobId);
  if (!artifactService.artifactExists(topicPath)) {
    return undefined;
  }
  try {
    return artifactService.readJsonArtifact<TopicSegment[]>(topicPath);
  } catch {
    return undefined;
  }
}

async function analyzeBlocksUnlocked(
  jobId: string,
  videoDurationSeconds: number,
): Promise<{ cuts: Cut[]; raw_response: string }> {
  console.log(`[analysis] Analyzing blocks for job ${jobId} (duration: ${videoDurationSeconds}s)`);
  jobLifecycleService.updateJobStatus(jobId, JobStatus.ANALYZING);

  const allBlocks = loadBlocks(jobId);
  if (allBlocks.length === 0) {
    throw new Error(`No semantic blocks available for job ${jobId}`);
  }

  const toolConfigs = loadActiveToolConfigs();
  const systemPrompt = toolConfigs.llm.system_prompt || "You output JSON only.";
  const client = buildClient(toolConfigs);
  const strategy = selectStrategy(videoDurationSeconds);
  const topics = strategy.useTopicSegmentation ? loadTopicsIfPresent(jobId) : undefined;
  let rawCuts: RawLLMCut[] = [];
  let topicDispositions: TopicDisposition[] = [];

  try {
    const collected = await collectRawCutsForStrategy(
      jobId,
      videoDurationSeconds,
      allBlocks,
      client,
      systemPrompt,
      topics,
    );
    rawCuts = collected.rawCuts;
    topicDispositions = collected.topics;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeAnalysisRunLog(jobId, {
      model: client.model,
      endpoint: client.baseUrl,
      videoDurationSeconds,
      strategy,
      topics: topicDispositions,
      candidates: rawCuts,
      rejections: [],
      kept: [],
      error: message,
    });
    jobLifecycleService.updateJobStatus(jobId, JobStatus.ERROR, message);
    throw error;
  }

  const normalized = normalizeCuts(rawCuts, allBlocks);
  persistAnalysisOutput(jobId, normalized.cuts);
  writeAnalysisRunLog(jobId, {
    model: client.model,
    endpoint: client.baseUrl,
    videoDurationSeconds,
    strategy,
    topics: topicDispositions,
    candidates: rawCuts,
    rejections: normalized.rejections,
    kept: normalized.cuts.map((cut) => {
      const note = normalized.kept_notes.find(
        (item) => item.blocks.join() === cut.block_ids.join() && item.start === cut.start,
      );
      return {
        cut_id: cut.cut_id,
        block_ids: cut.block_ids,
        start: cut.start,
        end: cut.end,
        title: cut.title ?? "",
        duration_seconds: cut.end - cut.start,
        duration_note: note?.duration_note ?? "within-preferred-window",
      };
    }),
  });

  const rawResponse = JSON.stringify(rawCuts);
  return { cuts: normalized.cuts, raw_response: rawResponse };
}

function writeAnalysisRunLog(
  jobId: string,
  input: {
    model: string;
    endpoint: string;
    videoDurationSeconds: number;
    strategy: ReturnType<typeof selectStrategy>;
    topics: TopicDisposition[];
    candidates: RawLLMCut[];
    rejections: Array<{
      blocks: string[];
      start: number;
      end: number;
      reason: string;
      title?: string;
    }>;
    kept: Array<{
      cut_id: string;
      block_ids: string[];
      start: number;
      end: number;
      title: string;
      duration_seconds: number;
      duration_note: string;
    }>;
    error?: string;
  },
): void {
  try {
    writeRunLog(analysisRunLogPath(jobId), {
      kind: "analysis",
      created_at: new Date().toISOString(),
      model: input.model,
      endpoint: input.endpoint,
      prompt_version: PROMPT_VERSION,
      preferred_duration_seconds: {
        min: PREFERRED_MIN_CUT_SECONDS,
        max: PREFERRED_MAX_CUT_SECONDS,
      },
      hard_duration_seconds: {
        min: HARD_MIN_CUT_SECONDS,
        max: HARD_MAX_CUT_SECONDS,
      },
      strategy: {
        duration_seconds: input.videoDurationSeconds,
        use_topic_segmentation: input.strategy.useTopicSegmentation,
        use_two_pass: input.strategy.useTwoPass,
      },
      topics: input.topics,
      candidates: input.candidates.map((cut) => ({
        blocks: cut.blocks,
        start: cut.start,
        end: cut.end,
        score: cut.score,
        title: cut.title,
        hook_reason: cut.hook_reason,
        content_reason: cut.content_reason,
      })),
      rejections: input.rejections,
      kept: input.kept,
      ...(input.error ? { error: input.error } : {}),
    });
  } catch (error) {
    console.warn(
      `[analysis] Could not write run log for job ${jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function analyzeBlocks(
  jobId: string,
  videoDurationSeconds: number,
): Promise<{ cuts: Cut[]; raw_response: string }> {
  return operationRuntimeService.runWithJobLock(jobId, () =>
    analyzeBlocksUnlocked(jobId, videoDurationSeconds),
  );
}
