import { loadActiveToolConfigs } from "../../core/toolConfigs";
import { LocalChatClient, type AnalysisChatClient } from "../../llm/client";
import { resolveAnalysisEndpoint } from "../../../../shared/localInference";
import { buildCutSelectionPrompt, buildTopicCandidacyPrompt } from "../../llm/prompts";
import { SemanticBlock } from "../../models/semantic_block";
import { TopicSegment } from "../../models/topic_segment";
import { parseRawCuts } from "./cuts";
import { parseJsonContent } from "./jsonText";
import { RawLLMCut } from "./types";

export function buildClient(toolConfigs: ReturnType<typeof loadActiveToolConfigs>): LocalChatClient {
  const resolved = resolveAnalysisEndpoint({
    model: toolConfigs.llm.model,
    baseUrl: toolConfigs.llm.base_url,
  });
  return new LocalChatClient(resolved.baseUrl, resolved.model);
}

/**
 * Run Pass 1: ask the LLM whether a topic is a good candidate for cutting.
 *
 * @param topic - Topic to evaluate.
 * @param allBlocks - Full semantic block list for the job.
 * @param client - Local chat client instance.
 * @returns true if the topic is a candidate, false if it should be skipped.
 */
export async function runPass1Candidacy(
  topic: TopicSegment,
  allBlocks: SemanticBlock[],
  client: AnalysisChatClient,
): Promise<boolean> {
  const prompt = buildTopicCandidacyPrompt(topic, allBlocks);
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const content = await client.chat([
        { role: "system", content: "You output JSON only." },
        { role: "user", content: prompt },
      ]);
      const parsed = parseJsonContent(content) as { is_candidate?: boolean };
      return parsed.is_candidate === true;
    } catch (err: unknown) {
      lastError = err;
      console.warn(
        `[analysis] Pass 1 attempt ${attempt + 1} failed for topic ${topic.topic_id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(`Pass 1 failed for topic ${topic.topic_id}: ${message}`);
}

/**
 * Run Pass 2 (or single-pass): send full block text for a set of blocks to the LLM
 * and return the raw cuts suggested.
 *
 * @param jobId - Job identifier (for logging).
 * @param blocks - Semantic blocks to analyse.
 * @param client - Local chat client instance.
 * @param systemPrompt - System prompt from tool config.
 * @returns Array of validated RawLLMCut (may be empty if LLM returned nothing useful).
 */
export async function runFullPass(
  jobId: string,
  blocks: SemanticBlock[],
  client: AnalysisChatClient,
  systemPrompt: string,
  topics?: TopicSegment[],
): Promise<RawLLMCut[]> {
  const prompt = buildCutSelectionPrompt(blocks, topics);

  let content: string;
  try {
    content = await client.chat([
      { role: "system", content: systemPrompt },
      { role: "system", content: "You output JSON only." },
      { role: "user", content: prompt },
    ]);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`LLM request failed for job ${jobId}: ${message}`);
  }

  let parsed: unknown;
  try {
    parsed = parseJsonContent(content);
  } catch {
    throw new Error(`LLM response is not valid JSON. Raw: ${content.slice(0, 200)}`);
  }

  return parseRawCuts(parsed);
}
