import { Cut } from "../../models/cut";
import { SemanticBlock } from "../../models/semantic_block";
import { continuesSentence, endsConclusion, startsWithLowercase } from "../sentence";
import { RawLLMCut } from "./types";

/** Preferred window. A finished item outside it is kept. */
export const PREFERRED_MIN_CUT_SECONDS = 15;
export const PREFERRED_MAX_CUT_SECONDS = 90;
/** Hard floor and ceiling. Only scraps and runaway spans are rejected. */
export const HARD_MIN_CUT_SECONDS = 8;
export const HARD_MAX_CUT_SECONDS = 240;
const MAX_CONTINUATION_BLOCKS = 2;
const MAX_SENTENCE_FINISH_BLOCKS = 3;

export type DurationNote =
  | "within-preferred-window"
  | "shorter-than-preferred"
  | "longer-than-preferred";

export type CutRepairReason =
  | "missing-block"
  | "gap"
  | "mid-sentence-start"
  | "no-conclusion"
  | "too-short"
  | "too-long"
  | "too-few-blocks"
  | "invalid-duration"
  | "overlap";

export type CutRepairResult =
  | { ok: true; cut: RawLLMCut; note: string; duration_note: DurationNote }
  | { ok: false; reason: CutRepairReason };

export type CutRejection = {
  blocks: string[];
  start: number;
  end: number;
  reason: CutRepairReason;
  title?: string;
};

export type CutNormalization = {
  cuts: Cut[];
  rejections: CutRejection[];
  kept_notes: Array<{
    blocks: string[];
    start: number;
    end: number;
    duration_note: DurationNote;
    repair_note: string;
  }>;
};

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

function stillContinuesSentence(blocks: SemanticBlock[], startIdx: number): boolean {
  if (startIdx === 0) {
    return startsWithLowercase(blocks[0].text);
  }
  return continuesSentence(blocks[startIdx - 1].text, blocks[startIdx].text);
}

/**
 * Snap a model cut onto block edges.
 * The start may move back only a couple of blocks to leave a mid-sentence opening.
 * The end may move forward only far enough to finish the open sentence.
 * A question mark is not a conclusion. Topic boundaries are not rewritten here.
 */
export function repairCutRange(cut: RawLLMCut, blocks: SemanticBlock[]): CutRepairResult {
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
  let walkedBack = 0;
  while (
    startIdx > 0 &&
    walkedBack < MAX_CONTINUATION_BLOCKS &&
    continuesSentence(blocks[startIdx - 1].text, blocks[startIdx].text)
  ) {
    startIdx -= 1;
    walkedBack += 1;
  }
  if (stillContinuesSentence(blocks, startIdx)) {
    return rejectCut("mid-sentence-start");
  }

  let endIdx = Math.max(indices[indices.length - 1], startIdx);
  let walkedForward = 0;
  while (
    endIdx < blocks.length - 1 &&
    !endsConclusion(blocks[endIdx].text) &&
    walkedForward < MAX_SENTENCE_FINISH_BLOCKS
  ) {
    endIdx += 1;
    walkedForward += 1;
  }
  if (!endsConclusion(blocks[endIdx].text)) {
    return rejectCut("no-conclusion");
  }

  const selected = blocks.slice(startIdx, endIdx + 1);
  const start = selected[0]?.start;
  const end = selected[selected.length - 1]?.end;
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    return rejectCut("invalid-duration");
  }

  const duration = end - start;
  if (duration < HARD_MIN_CUT_SECONDS) {
    return rejectCut("too-short");
  }
  if (duration > HARD_MAX_CUT_SECONDS) {
    return rejectCut("too-long");
  }

  const durationNote = durationNoteFor(duration);
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
    duration_note: durationNote,
  };
}

function durationNoteFor(duration: number): DurationNote {
  if (duration < PREFERRED_MIN_CUT_SECONDS) {
    return "shorter-than-preferred";
  }
  if (duration > PREFERRED_MAX_CUT_SECONDS) {
    return "longer-than-preferred";
  }
  return "within-preferred-window";
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
export function deduplicateCuts(
  cuts: Cut[],
  rawCuts: RawLLMCut[],
): { kept: Cut[]; dropped: Cut[] } {
  const scoreOf = (cut: Cut): number => {
    const raw = rawCuts.find((r) => r.blocks.join() === cut.block_ids.join());
    return raw?.score ?? 0;
  };

  const result: Cut[] = [];
  const dropped: Cut[] = [];

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
        dropped.push(existing);
        result[overlappingIndex] = candidate;
      } else {
        dropped.push(candidate);
      }
    }
  }

  return { kept: result, dropped };
}

function rejectionFromCut(cut: Cut, reason: CutRepairReason): CutRejection {
  return {
    blocks: cut.block_ids,
    start: cut.start,
    end: cut.end,
    reason,
    title: cut.title ?? undefined,
  };
}

export function normalizeCuts(rawCuts: RawLLMCut[], allBlocks: SemanticBlock[]): CutNormalization {
  const repairedRaw: RawLLMCut[] = [];
  const rejections: CutRejection[] = [];
  const keptNotes: CutNormalization["kept_notes"] = [];

  for (const raw of rawCuts) {
    const repaired = repairCutRange(raw, allBlocks);
    if (!repaired.ok) {
      rejections.push({
        blocks: raw.blocks,
        start: raw.start,
        end: raw.end,
        reason: repaired.reason,
        title: raw.title,
      });
      console.warn(`[analysis] rejecting cut [${raw.blocks.join(",")}]: ${repaired.reason}`);
      continue;
    }
    console.log(`[analysis] cut repaired: ${repaired.note} (${repaired.duration_note})`);
    repairedRaw.push(repaired.cut);
    keptNotes.push({
      blocks: repaired.cut.blocks,
      start: repaired.cut.start,
      end: repaired.cut.end,
      duration_note: repaired.duration_note,
      repair_note: repaired.note,
    });
  }

  const preDedupCuts = toCuts(repairedRaw, 0);
  const deduped = deduplicateCuts(preDedupCuts, repairedRaw);
  for (const dropped of deduped.dropped) {
    rejections.push(rejectionFromCut(dropped, "overlap"));
    const noteIndex = keptNotes.findIndex(
      (note) => note.blocks.join() === dropped.block_ids.join() && note.start === dropped.start,
    );
    if (noteIndex >= 0) {
      keptNotes.splice(noteIndex, 1);
    }
    console.warn(
      `[analysis] rejecting cut [${dropped.block_ids.join(",")}]: overlap`,
    );
  }

  const cuts = deduped.kept.map((cut, index) => ({ ...cut, cut_id: `c${index + 1}` }));
  console.log(
    `[analysis] kept ${cuts.length} cut(s), rejected ${rejections.length} of ${rawCuts.length}`,
  );

  return { cuts, rejections, kept_notes: keptNotes };
}
