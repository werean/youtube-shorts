/**
 * Pipeline step: semantic analysis with LLM over semantic blocks or topic segments.
 *
 * Supports single-pass (short videos) and two-pass topic-aware (long videos) strategies.
 */

import * as fs from "fs";
import { SemanticBlock } from "../models/semantic_block";
import { TopicSegment } from "../models/topic_segment";
import { Cut } from "../models/cut";
import { JobStatus } from "../models/job";
import * as files from "../storage/files";
import * as metadata from "../storage/metadata";
import { OllamaClient } from "../llm/client";
import { buildCutSelectionPrompt, buildTopicCandidacyPrompt } from "../llm/prompts";
import { loadActiveToolConfigs } from "../core/toolConfigs";
import { selectStrategy, validateLLMPayload } from "./strategy";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Raw cut item as returned by the LLM before validation. */
interface RawLLMCut {
  blocks: string[];
  start: number;
  end: number;
  score?: number;
  hook_reason?: string;
  content_reason?: string;
  title?: string;
}

// ---------------------------------------------------------------------------
// Loaders
// ---------------------------------------------------------------------------

function loadBlocks(jobId: string): SemanticBlock[] {
  const path = files.semanticBlocksPath(jobId);
  if (!fs.existsSync(path)) {
    throw new Error(`Semantic blocks JSON not found for job ${jobId}`);
  }
  return JSON.parse(fs.readFileSync(path, "utf-8"));
}

function loadTopics(jobId: string): TopicSegment[] {
  const path = files.topicSegmentsPath(jobId);
  if (!fs.existsSync(path)) {
    throw new Error(
      `Topic segments JSON not found for job ${jobId}. Ensure BUILDING_TOPICS step ran first.`,
    );
  }
  return JSON.parse(fs.readFileSync(path, "utf-8"));
}

// ---------------------------------------------------------------------------
// Cut coherence validation
// ---------------------------------------------------------------------------

/**
 * Checks whether a raw LLM-suggested cut meets structural coherence requirements:
 * - First block must not start mid-sentence (no lowercase first character)
 * - Last block must end with final punctuation
 * - Blocks must be consecutive (no gaps in the `bN` sequence)
 *
 * @param cut - The raw cut from the LLM response.
 * @param blocks - Full semantic block list for the job.
 * @returns true if the cut is structurally coherent, false otherwise.
 */
function isCutCoherent(cut: RawLLMCut, blocks: SemanticBlock[]): boolean {
  const cutBlocks = blocks.filter((b) => cut.blocks.includes(b.block_id));
  if (cutBlocks.length === 0) return false;

  const first = cutBlocks[0];
  const last = cutBlocks[cutBlocks.length - 1];

  // First block must not start mid-sentence (no lowercase first char)
  if (/^[a-záéíóúãõâêôàèìòùäëïöüýçñ]/.test(first.text.trim())) return false;

  // Last block must end with final punctuation
  if (!/[.!?…]$/.test(last.text.trim())) return false;

  // Blocks must be consecutive (no gaps in block_id sequence)
  const ids = cutBlocks.map((b) => parseInt(b.block_id.replace("b", ""), 10));
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] !== ids[i - 1] + 1) return false;
  }

  return true;
}

// ---------------------------------------------------------------------------
// Raw LLM cut parsing
// ---------------------------------------------------------------------------

/**
 * Parse raw LLM JSON array into RawLLMCut objects.
 *
 * @param payload - Parsed JSON value from LLM response.
 * @returns Array of RawLLMCut.
 * @throws If payload is not an array or items are malformed.
 */
function parseRawCuts(payload: unknown): RawLLMCut[] {
  if (!Array.isArray(payload)) {
    throw new Error("LLM response must be a JSON array");
  }

  return payload.map((item, index) => {
    if (typeof item !== "object" || item === null) {
      throw new Error(`LLM cut item at index ${index} must be a JSON object`);
    }

    const obj = item as Record<string, unknown>;
    const blocks = obj.blocks;
    const start = obj.start;
    const end = obj.end;

    if (!Array.isArray(blocks) || start === undefined || end === undefined) {
      throw new Error(
        `LLM cut item at index ${index} is missing required fields: blocks, start, end`,
      );
    }

    return {
      blocks: (blocks as unknown[]).map((b) => String(b)),
      start: parseFloat(String(start)),
      end: parseFloat(String(end)),
      score: typeof obj.score === "number" ? obj.score : undefined,
      hook_reason: typeof obj.hook_reason === "string" ? obj.hook_reason : undefined,
      content_reason: typeof obj.content_reason === "string" ? obj.content_reason : undefined,
      title: typeof obj.title === "string" ? obj.title : undefined,
    };
  });
}

/**
 * Convert validated RawLLMCut items into Cut domain objects.
 *
 * @param raw - Validated raw cuts.
 * @param startIndex - Starting cut_id index (for merge across topics).
 * @returns Array of Cut.
 */
function toCuts(raw: RawLLMCut[], startIndex: number): Cut[] {
  return raw.map((item, i) => ({
    cut_id: `c${startIndex + i + 1}`,
    block_ids: item.blocks,
    start: item.start,
    end: item.end,
    title:
      (item.title || item.hook_reason || item.content_reason || "").trim() ||
      `Corte ${startIndex + i + 1}`,
    status: "pending",
  }));
}

// ---------------------------------------------------------------------------
// Overlap deduplication
// ---------------------------------------------------------------------------

/**
 * Remove overlapping cuts. When two cuts overlap by more than 30 seconds,
 * the one with the higher score (index order as tiebreaker) is kept.
 *
 * @param cuts - Cuts in any order.
 * @param rawCuts - Parallel array of raw cuts (for score access).
 * @returns Deduplicated cut list.
 */
function deduplicateCuts(cuts: Cut[], rawCuts: RawLLMCut[]): Cut[] {
  const scoreOf = (cut: Cut): number => {
    const raw = rawCuts.find((r) => r.blocks.join() === cut.block_ids.join());
    return raw?.score ?? 0;
  };

  const result: Cut[] = [];

  for (const candidate of cuts) {
    const overlappingIndex = result.findIndex((existing) => {
      const overlapStart = Math.max(existing.start, candidate.start);
      const overlapEnd = Math.min(existing.end, candidate.end);
      return overlapEnd - overlapStart > 30;
    });

    if (overlappingIndex === -1) {
      result.push(candidate);
    } else {
      const existing = result[overlappingIndex];
      if (scoreOf(candidate) > scoreOf(existing)) {
        result[overlappingIndex] = candidate;
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// LLM helpers
// ---------------------------------------------------------------------------

function buildClient(toolConfigs: ReturnType<typeof loadActiveToolConfigs>): OllamaClient {
  const model = toolConfigs.llm.model || undefined;
  return new OllamaClient(undefined, model);
}

/**
 * Run Pass 1: ask the LLM whether a topic is a good candidate for cutting.
 *
 * @param topic - Topic to evaluate.
 * @param allBlocks - Full semantic block list for the job.
 * @param client - Ollama client instance.
 * @returns true if the topic is a candidate, false if it should be skipped.
 */
async function runPass1Candidacy(
  topic: TopicSegment,
  allBlocks: SemanticBlock[],
  client: OllamaClient,
): Promise<boolean> {
  const prompt = buildTopicCandidacyPrompt(topic, allBlocks);

  let content: string;
  try {
    content = await client.chat([
      { role: "system", content: "You output JSON only." },
      { role: "user", content: prompt },
    ]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[analysis] Pass 1 failed for topic ${topic.topic_id}: ${message} — skipping topic`,
    );
    return false;
  }

  try {
    const parsed = JSON.parse(content) as { is_candidate?: boolean };
    return parsed.is_candidate === true;
  } catch {
    console.warn(
      `[analysis] Pass 1 response for topic ${topic.topic_id} is not valid JSON — skipping topic. Raw: ${content.slice(0, 120)}`,
    );
    return false;
  }
}

/**
 * Run Pass 2 (or single-pass): send full block text for a set of blocks to the LLM
 * and return the raw cuts suggested.
 *
 * @param jobId - Job identifier (for logging).
 * @param blocks - Semantic blocks to analyse.
 * @param client - Ollama client instance.
 * @param systemPrompt - System prompt from tool config.
 * @returns Array of validated RawLLMCut (may be empty if LLM returned nothing useful).
 */
async function runFullPass(
  jobId: string,
  blocks: SemanticBlock[],
  client: OllamaClient,
  systemPrompt: string,
): Promise<RawLLMCut[]> {
  const prompt = buildCutSelectionPrompt(blocks);

  let content: string;
  try {
    content = await client.chat([
      { role: "system", content: systemPrompt },
      { role: "system", content: "You output JSON only." },
      { role: "user", content: prompt },
    ]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[analysis] Full pass failed for job ${jobId}: ${message}`);
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`LLM response is not valid JSON. Raw: ${content.slice(0, 200)}`);
  }

  return parseRawCuts(parsed);
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Analyse semantic blocks with the LLM and produce suggested cuts.
 *
 * Strategy is selected based on `videoDurationSeconds`:
 * - Short  (<15 min): single pass over all blocks
 * - Medium (15–60 min): topic-aware, single pass per topic
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
  const strategy = selectStrategy(videoDurationSeconds);
  const client = buildClient(toolConfigs);

  console.log(
    `[analysis] Strategy: useTopicSegmentation=${strategy.useTopicSegmentation} useTwoPass=${strategy.useTwoPass}`,
  );

  const allRawCuts: RawLLMCut[] = [];

  if (!strategy.useTopicSegmentation) {
    // ---- Single-pass: short videos ----
    const validation = validateLLMPayload(allBlocks, strategy);
    if (!validation.valid) {
      console.warn(
        `[analysis] job=${jobId} Payload exceeds limits: ${validation.reason}. blocks=${validation.blockCount} chars=${validation.charCount}`,
      );
      throw new Error(`LLM payload too large for job ${jobId}: ${validation.reason}`);
    }

    const raw = await runFullPass(jobId, allBlocks, client, systemPrompt);
    allRawCuts.push(...raw);
  } else {
    // ---- Topic-aware pass: medium and long videos ----
    const topics = loadTopics(jobId);
    console.log(`[analysis] Processing ${topics.length} topic(s)`);

    for (const topic of topics) {
      const topicBlocks = allBlocks.filter((b) => topic.block_ids.includes(b.block_id));

      const validation = validateLLMPayload(topicBlocks, strategy);
      if (!validation.valid) {
        console.warn(
          `[analysis] job=${jobId} topic=${topic.topic_id} skipped — payload exceeds limits: ${validation.reason}. blocks=${validation.blockCount} chars=${validation.charCount}`,
        );
        continue;
      }

      // Pass 1: candidacy check (only for two-pass strategy)
      if (strategy.useTwoPass) {
        const isCandidate = await runPass1Candidacy(topic, allBlocks, client);
        if (!isCandidate) {
          console.log(`[analysis] topic=${topic.topic_id} rejected by Pass 1 — skipping`);
          continue;
        }
        console.log(`[analysis] topic=${topic.topic_id} accepted by Pass 1 — running full pass`);
      }

      // Pass 2 (or single pass for medium): full analysis
      const raw = await runFullPass(jobId, topicBlocks, client, systemPrompt);
      allRawCuts.push(...raw);
    }
  }

  // ---- Coherence filtering ----
  const coherentRaw: RawLLMCut[] = [];
  for (const raw of allRawCuts) {
    if (isCutCoherent(raw, allBlocks)) {
      coherentRaw.push(raw);
    } else {
      const reason = (() => {
        const cutBlocks = allBlocks.filter((b) => raw.blocks.includes(b.block_id));
        if (cutBlocks.length === 0) return "no matching blocks found";
        const first = cutBlocks[0];
        const last = cutBlocks[cutBlocks.length - 1];
        if (/^[a-záéíóúãõâêôàèìòùäëïöüýçñ]/.test(first.text.trim())) return "starts mid-sentence";
        if (!/[.!?…]$/.test(last.text.trim())) return "ends without final punctuation";
        return "non-consecutive block ids";
      })();
      console.warn(`[analysis] Discarding incoherent cut [${raw.blocks.join(",")}]: ${reason}`);
    }
  }

  // ---- Intermediate conversion for dedup ----
  const preDedupCuts = toCuts(coherentRaw, 0);
  const finalCuts = deduplicateCuts(preDedupCuts, coherentRaw);

  // Re-number cut_ids after dedup
  const numberedCuts: Cut[] = finalCuts.map((cut, i) => ({ ...cut, cut_id: `c${i + 1}` }));

  // ---- Persist ----
  const outputPath = files.cutsPath(jobId);
  fs.writeFileSync(outputPath, JSON.stringify(numberedCuts, null, 2), "utf-8");
  console.log(`[analysis] ${numberedCuts.length} cut(s) saved for job ${jobId}`);

  const job = metadata.loadJob(jobId);
  job.status = JobStatus.WAITING_APPROVAL;
  job.updated_at = new Date().toISOString();
  metadata.saveJob(job);

  const rawResponse = JSON.stringify(allRawCuts);
  return { cuts: numberedCuts, raw_response: rawResponse };
}
