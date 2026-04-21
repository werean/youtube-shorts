import { OllamaClient } from "../../llm/client";
import { SemanticBlock } from "../../models/semantic_block";
import { selectStrategy, validateLLMPayload } from "../strategy";
import { runFullPass, runPass1Candidacy } from "./llm";
import { loadTopics } from "./preconditions";
import { RawLLMCut } from "./types";

export async function collectRawCutsForStrategy(
  jobId: string,
  videoDurationSeconds: number,
  allBlocks: SemanticBlock[],
  client: OllamaClient,
  systemPrompt: string,
): Promise<RawLLMCut[]> {
  const strategy = selectStrategy(videoDurationSeconds);

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
    return allRawCuts;
  }

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

  return allRawCuts;
}
