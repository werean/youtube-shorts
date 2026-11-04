import type { AnalysisChatClient } from "../../llm/client";
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
  client: AnalysisChatClient,
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

export type TopicDispositionName = "analyzed" | "pass-1-not-candidate";

export type TopicDisposition = {
  topic_id: string;
  start: number;
  end: number;
  duration_seconds: number;
  block_count: number;
  block_ids: string[];
  disposition: TopicDispositionName;
};

function describeTopic(topic: TopicSegment, disposition: TopicDispositionName): TopicDisposition {
  return {
    topic_id: topic.topic_id,
    start: topic.start,
    end: topic.end,
    duration_seconds: topic.durationSeconds,
    block_count: topic.blockCount,
    block_ids: topic.block_ids,
    disposition,
  };
}

export async function collectRawCutsForStrategy(
  jobId: string,
  videoDurationSeconds: number,
  allBlocks: SemanticBlock[],
  client: AnalysisChatClient,
  systemPrompt: string,
  topics?: TopicSegment[],
): Promise<{ rawCuts: RawLLMCut[]; topics: TopicDisposition[] }> {
  const strategy = selectStrategy(videoDurationSeconds);

  console.log(
    `[analysis] Strategy: useTopicSegmentation=${strategy.useTopicSegmentation} useTwoPass=${strategy.useTwoPass} duration=${videoDurationSeconds}`,
  );

  if (!strategy.useTopicSegmentation) {
    return {
      rawCuts: await collectFromBlocks(
        jobId,
        "short",
        allBlocks,
        client,
        systemPrompt,
        topics,
        strategy,
      ),
      topics: [],
    };
  }

  const resolvedTopics = topics && topics.length > 0 ? topics : loadTopics(jobId);
  console.log(`[analysis] Processing ${resolvedTopics.length} topic(s)`);
  const allRawCuts: RawLLMCut[] = [];
  const dispositions: TopicDisposition[] = [];

  for (const topic of resolvedTopics) {
    const topicBlocks = allBlocks.filter((block) => topic.block_ids.includes(block.block_id));
    if (strategy.useTwoPass) {
      const isCandidate = await runPass1Candidacy(topic, allBlocks, client);
      if (!isCandidate) {
        dispositions.push(describeTopic(topic, "pass-1-not-candidate"));
        console.log(`[analysis] topic=${topic.topic_id} rejected by Pass 1 — skipping`);
        continue;
      }
      console.log(`[analysis] topic=${topic.topic_id} accepted by Pass 1 — running full pass`);
    }

    dispositions.push(describeTopic(topic, "analyzed"));
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

  return { rawCuts: allRawCuts, topics: dispositions };
}
