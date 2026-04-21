import { describe, expect, it } from "vitest";
import { selectStrategy, validateLLMPayload } from "../../../src/pipeline/strategy";
import type { SemanticBlock } from "../../../src/models/semantic_block";

function makeBlock(id: number, text: string): SemanticBlock {
  return {
    block_id: `b${id}`,
    start: id * 10,
    end: id * 10 + 9,
    text,
    segment_ids: [`s${id}`],
  };
}

describe("strategy selection", () => {
  it("disables embeddings for short videos", () => {
    const strategy = selectStrategy(899);

    expect(strategy.useTopicSegmentation).toBe(false);
    expect(strategy.useEmbeddings).toBe(false);
    expect(strategy.useTwoPass).toBe(false);
  });

  it("enables embeddings and keeps single pass for medium videos", () => {
    const strategy = selectStrategy(1200);

    expect(strategy.useTopicSegmentation).toBe(true);
    expect(strategy.useEmbeddings).toBe(true);
    expect(strategy.useTwoPass).toBe(false);
  });

  it("enables embeddings and two-pass for long videos", () => {
    const strategy = selectStrategy(7200);

    expect(strategy.useTopicSegmentation).toBe(true);
    expect(strategy.useEmbeddings).toBe(true);
    expect(strategy.useTwoPass).toBe(true);
  });
});

describe("validateLLMPayload", () => {
  it("accepts payloads within limits", () => {
    const strategy = selectStrategy(1200);
    const blocks = [makeBlock(1, "texto curto"), makeBlock(2, "mais texto curto")];

    const result = validateLLMPayload(blocks, strategy);

    expect(result.valid).toBe(true);
    expect(result.blockCount).toBe(2);
  });

  it("rejects payloads above max block count", () => {
    const strategy = selectStrategy(1200);
    const blocks = Array.from({ length: strategy.maxBlocksPerLLMRequest + 1 }, (_, index) =>
      makeBlock(index + 1, "ok"),
    );

    const result = validateLLMPayload(blocks, strategy);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("maxBlocksPerLLMRequest");
  });

  it("rejects payloads above max char count", () => {
    const strategy = selectStrategy(1200);
    const oversizedText = "x".repeat(strategy.maxCharsPerLLMRequest + 10);
    const blocks = [makeBlock(1, oversizedText)];

    const result = validateLLMPayload(blocks, strategy);

    expect(result.valid).toBe(false);
    expect(result.reason).toContain("maxCharsPerLLMRequest");
  });
});
