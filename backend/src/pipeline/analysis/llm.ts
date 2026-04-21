import { loadActiveToolConfigs } from "../../core/toolConfigs";
import { OllamaClient } from "../../llm/client";
import { buildCutSelectionPrompt, buildTopicCandidacyPrompt } from "../../llm/prompts";
import { SemanticBlock } from "../../models/semantic_block";
import { TopicSegment } from "../../models/topic_segment";
import { parseRawCuts } from "./cuts";
import { RawLLMCut } from "./types";

export function buildClient(toolConfigs: ReturnType<typeof loadActiveToolConfigs>): OllamaClient {
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
export async function runPass1Candidacy(
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
export async function runFullPass(
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
