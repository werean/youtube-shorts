import { OllamaClient } from "../../llm/client";
import { SemanticBlock } from "../../models/semantic_block";
import { TopicSegment } from "../../models/topic_segment";
import {
  selectStrategy,
  splitBlocksByCharLimit,
  validateLLMPayload,
  type ProcessingStrategy,
} from "../strategy";
import { runFullPass, runPass1Candidacy } from "./llm";
import { loadTopics } from "./preconditions";
import { RawLLMCut } from "./types";

async function collectFromBlocks(
  jobId: string,
  label: string,
  blocks: SemanticBlock[],
  client: OllamaClient,
  systemPrompt: string,
  topics: TopicSegment[] | undefined,
  strategy: ProcessingStrategy,
): Promise<RawLLMCut[]> {
  const chunks = splitBlocksByCharLimit(blocks, strategy.maxCharsPerLLMRequest);
  const rawCuts: RawLLMCut[] = [];

  for (const chunk of chunks) {
    const validation = validateLLMPayload(chunk, strategy);
    if (!validation.valid) {
      throw new Error(`LLM payload too large for job ${jobId} ${label}: ${validation.reason}`);
    }
    rawCuts.push(...(await runFullPass(jobId, chunk, client, systemPrompt, topics)));
  }

  return rawCuts;
}

export async function collectRawCutsForStrategy(
  jobId: string,
  videoDurationSeconds: number,
  allBlocks: SemanticBlock[],
  client: OllamaClient,
  systemPrompt: string,
  topics?: TopicSegment[],
): Promise<RawLLMCut[]> {
  const strategy = selectStrategy(videoDurationSeconds);

  console.log(
    `[analysis] Strategy: useTopicSegmentation=${strategy.useTopicSegmentation} useTwoPass=${strategy.useTwoPass} duration=${videoDurationSeconds}`,
  );

  if (!strategy.useTopicSegmentation) {
    return collectFromBlocks(jobId, "short", allBlocks, client, systemPrompt, topics, strategy);
  }

  const resolvedTopics = topics && topics.length > 0 ? topics : loadTopics(jobId);
  console.log(`[analysis] Processing ${resolvedTopics.length} topic(s)`);
  const allRawCuts: RawLLMCut[] = [];

  for (const topic of resolvedTopics) {
    const topicBlocks = allBlocks.filter((block) => topic.block_ids.includes(block.block_id));
    if (strategy.useTwoPass) {
      const isCandidate = await runPass1Candidacy(topic, allBlocks, client);
      if (!isCandidate) {
        console.log(`[analysis] topic=${topic.topic_id} rejected by Pass 1 — skipping`);
        continue;
      }
      console.log(`[analysis] topic=${topic.topic_id} accepted by Pass 1 — running full pass`);
    }

    const raw = await collectFromBlocks(
      jobId,
      `topic=${topic.topic_id}`,
      topicBlocks,
      client,
      systemPrompt,
      resolvedTopics,
      strategy,
    );
    allRawCuts.push(...raw);
  }

  return allRawCuts;
}
