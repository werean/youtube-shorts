import { Cut } from "../../models/cut";
import { SemanticBlock } from "../../models/semantic_block";
import { RawLLMCut } from "./types";

const LOWERCASE_START_RE = /^[a-záéíóúãõâêôàèìòùäëïöüýçñ]/;
const FINAL_PUNCTUATION_RE = /[.!?…]$/;

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
export function isCutCoherent(cut: RawLLMCut, blocks: SemanticBlock[]): boolean {
  const cutBlocks = blocks.filter((b) => cut.blocks.includes(b.block_id));
  if (cutBlocks.length === 0) return false;

  const first = cutBlocks[0];
  const last = cutBlocks[cutBlocks.length - 1];

  // First block must not start mid-sentence (no lowercase first char)
  if (LOWERCASE_START_RE.test(first.text.trim())) return false;

  // Last block must end with final punctuation
  if (!FINAL_PUNCTUATION_RE.test(last.text.trim())) return false;

  // Blocks must be consecutive (no gaps in block_id sequence)
  const ids = cutBlocks.map((b) => parseInt(b.block_id.replace("b", ""), 10));
  for (let i = 1; i < ids.length; i++) {
    if (ids[i] !== ids[i - 1] + 1) return false;
  }

  return true;
}

export function cutCoherenceFailureReason(cut: RawLLMCut, blocks: SemanticBlock[]): string {
  const cutBlocks = blocks.filter((b) => cut.blocks.includes(b.block_id));
  if (cutBlocks.length === 0) return "no matching blocks found";
  const first = cutBlocks[0];
  const last = cutBlocks[cutBlocks.length - 1];
  if (LOWERCASE_START_RE.test(first.text.trim())) return "starts mid-sentence";
  if (!FINAL_PUNCTUATION_RE.test(last.text.trim())) return "ends without final punctuation";
  return "non-consecutive block ids";
}

export function filterCoherentRawCuts(rawCuts: RawLLMCut[], allBlocks: SemanticBlock[]): RawLLMCut[] {
  const coherentRaw: RawLLMCut[] = [];
  for (const raw of rawCuts) {
    if (isCutCoherent(raw, allBlocks)) {
      coherentRaw.push(raw);
    } else {
      const reason = cutCoherenceFailureReason(raw, allBlocks);
      console.warn(`[analysis] Discarding incoherent cut [${raw.blocks.join(",")}]: ${reason}`);
    }
  }
  return coherentRaw;
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

export function normalizeCuts(rawCuts: RawLLMCut[], allBlocks: SemanticBlock[]): Cut[] {
  const coherentRaw = filterCoherentRawCuts(rawCuts, allBlocks);
  const preDedupCuts = toCuts(coherentRaw, 0);
  const finalCuts = deduplicateCuts(preDedupCuts, coherentRaw);

  return finalCuts.map((cut, i) => ({ ...cut, cut_id: `c${i + 1}` }));
}
