/**
 * Pipeline step: semantic analysis with LLM over semantic blocks or topic segments.
 *
 * Supports single-pass (short videos) and two-pass topic-aware (long videos) strategies.
 */

import { loadActiveToolConfigs } from "../core/toolConfigs";
import { Cut } from "../models/cut";
import { JobStatus } from "../models/job";
import * as metadata from "../storage/metadata";
import { normalizeCuts } from "./analysis/cuts";
import { buildClient } from "./analysis/llm";
import { persistAnalysisOutput } from "./analysis/persistence";
import { loadBlocks } from "./analysis/preconditions";
import { collectRawCutsForStrategy } from "./analysis/strategyFlow";

/**
 * Analyse semantic blocks with the LLM and produce suggested cuts.
 *
 * Strategy is selected based on `videoDurationSeconds`:
 * - Short  (<15 min): single pass over all blocks
 * - Medium (15-60 min): topic-aware, single pass per topic
 * - Long   (>60 min): topic-aware, two-pass (candidacy + full analysis)
 *
 * Cuts that fail structural coherence checks are discarded.
 * Overlapping cuts (>30s overlap) are deduplicated by score.
 *
 * @param jobId - Job identifier.
 * @param videoDurationSeconds - Total video duration used to select processing strategy.
 * @returns Object with final cuts array and the merged raw LLM response string.
 */
export async function analyzeBlocks(
  jobId: string,
  videoDurationSeconds: number,
): Promise<{ cuts: Cut[]; raw_response: string }> {
  console.log(`[analysis] Analyzing blocks for job ${jobId} (duration: ${videoDurationSeconds}s)`);
  metadata.updateJobStatus(jobId, JobStatus.ANALYZING);

  const allBlocks = loadBlocks(jobId);
  if (allBlocks.length === 0) {
    throw new Error(`No semantic blocks available for job ${jobId}`);
  }

  const toolConfigs = loadActiveToolConfigs();
  const systemPrompt = toolConfigs.llm.system_prompt || "You output JSON only.";
  const client = buildClient(toolConfigs);

  const allRawCuts = await collectRawCutsForStrategy(
    jobId,
    videoDurationSeconds,
    allBlocks,
    client,
    systemPrompt,
  );

  const numberedCuts = normalizeCuts(allRawCuts, allBlocks);

  persistAnalysisOutput(jobId, numberedCuts);

  const rawResponse = JSON.stringify(allRawCuts);
  return { cuts: numberedCuts, raw_response: rawResponse };
}
