import { Cut } from "../../models/cut";
import { SemanticBlock } from "../../models/semantic_block";
import { TopicSegment } from "../../models/topic_segment";
import { continuesSentence, endsSentence, startsWithLowercase } from "../sentence";
import { TOPIC_MIN_DURATION_SECONDS } from "../topic_segmentation/topics";
import { RawLLMCut } from "./types";

export const MIN_CUT_SECONDS = 300;

export type CutRepairReason =
  | "missing-block"
  | "gap"
  | "mid-sentence-start"
  | "mid-topic"
  | "no-conclusion"
  | "too-short"
  | "invalid-duration";

export type CutRepairResult =
  | { ok: true; cut: RawLLMCut; note: string }
  | { ok: false; reason: CutRepairReason };

/**
 * Parse raw LLM JSON array into RawLLMCut objects.
 *
 * @param payload - Parsed JSON value from LLM response.
 * @returns Array of RawLLMCut.
 * @throws If payload is not an array or items are malformed.
 */
export function parseRawCuts(payload: unknown): RawLLMCut[] {
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

function rejectCut(reason: CutRepairReason): CutRepairResult {
  return { ok: false, reason };
}

/**
 * Snap a model cut to sentence and topic edges, or reject it.
 * The returned cut keeps the same JSON fields. Times come from the blocks.
 */
export function repairCutRange(
  cut: RawLLMCut,
  blocks: SemanticBlock[],
  topics?: TopicSegment[],
): CutRepairResult {
  const indexById = new Map(blocks.map((block, index) => [block.block_id, index]));
  const indices: number[] = [];
  for (const blockId of cut.blocks) {
    const index = indexById.get(blockId);
    if (index === undefined) {
      return rejectCut("missing-block");
    }
    indices.push(index);
  }

  if (indices.length === 0) {
    return rejectCut("missing-block");
  }

  indices.sort((left, right) => left - right);
  for (let index = 1; index < indices.length; index += 1) {
    if (indices[index] !== indices[index - 1] + 1) {
      return rejectCut("gap");
    }
  }

  let startIdx = indices[0];
  while (
    startIdx > 0 &&
    continuesSentence(blocks[startIdx - 1].text, blocks[startIdx].text)
  ) {
    startIdx -= 1;
  }
  if (startIdx === 0 && startsWithLowercase(blocks[0].text)) {
    return rejectCut("mid-sentence-start");
  }

  if (topics && topics.length > 0) {
    const topic = topics.find((candidate) => candidate.block_ids.includes(blocks[startIdx].block_id));
    const topicStartId = topic?.block_ids[0];
    const topicStartIdx = topicStartId ? indexById.get(topicStartId) : undefined;
    if (topic && topicStartIdx !== undefined && topicStartIdx < startIdx) {
      const prefixDuration = blocks[startIdx].start - blocks[topicStartIdx].start;
      if (prefixDuration > TOPIC_MIN_DURATION_SECONDS) {
        return rejectCut("mid-topic");
      }
      startIdx = topicStartIdx;
      while (
        startIdx > 0 &&
        continuesSentence(blocks[startIdx - 1].text, blocks[startIdx].text)
      ) {
        startIdx -= 1;
      }
      if (startIdx === 0 && startsWithLowercase(blocks[0].text)) {
        return rejectCut("mid-sentence-start");
      }
    }
  }

  let endIdx = Math.max(indices[indices.length - 1], startIdx);
  while (endIdx < blocks.length - 1 && !endsSentence(blocks[endIdx].text)) {
    endIdx += 1;
  }
  if (!endsSentence(blocks[endIdx].text)) {
    return rejectCut("no-conclusion");
  }

  const selected = blocks.slice(startIdx, endIdx + 1);
  const start = selected[0]?.start;
  const end = selected[selected.length - 1]?.end;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    return rejectCut("invalid-duration");
  }
  if (end - start < MIN_CUT_SECONDS) {
    return rejectCut("too-short");
  }

  const blockIds = selected.map((block) => block.block_id);
  const original = `${cut.blocks.join(",")} @ ${cut.start}-${cut.end}`;
  const repaired = `${blockIds.join(",")} @ ${start}-${end}`;
  return {
    ok: true,
    cut: {
      ...cut,
      blocks: blockIds,
      start,
      end,
    },
    note: `${original} → ${repaired}`,
  };
}

/**
 * Convert validated RawLLMCut items into Cut domain objects.
 *
 * @param raw - Validated raw cuts.
 * @param startIndex - Starting cut_id index (for merge across topics).
 * @returns Array of Cut.
 */
export function toCuts(raw: RawLLMCut[], startIndex: number): Cut[] {
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

/**
 * Remove overlapping cuts. When two cuts overlap by more than 30 seconds,
 * the one with the higher score (index order as tiebreaker) is kept.
 *
 * @param cuts - Cuts in any order.
 * @param rawCuts - Parallel array of raw cuts (for score access).
 * @returns Deduplicated cut list.
 */
export function deduplicateCuts(cuts: Cut[], rawCuts: RawLLMCut[]): Cut[] {
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

export function normalizeCuts(
  rawCuts: RawLLMCut[],
  allBlocks: SemanticBlock[],
  topics?: TopicSegment[],
): Cut[] {
  const repairedRaw: RawLLMCut[] = [];
  let rejected = 0;
  for (const raw of rawCuts) {
    const repaired = repairCutRange(raw, allBlocks, topics);
    if (!repaired.ok) {
      rejected += 1;
      console.warn(`[analysis] rejecting cut [${raw.blocks.join(",")}]: ${repaired.reason}`);
      continue;
    }
    console.log(`[analysis] cut repaired: ${repaired.note}`);
    repairedRaw.push(repaired.cut);
  }

  console.log(
    `[analysis] kept ${repairedRaw.length} cut(s), rejected ${rejected} of ${rawCuts.length}`,
  );

  const preDedupCuts = toCuts(repairedRaw, 0);
  const finalCuts = deduplicateCuts(preDedupCuts, repairedRaw);
  return finalCuts.map((cut, index) => ({ ...cut, cut_id: `c${index + 1}` }));
}
