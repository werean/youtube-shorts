import { describe, expect, it } from "vitest";
import type { SemanticBlock } from "../../../src/models/semantic_block";
import { buildTopicsFromBoundaries } from "../../../src/pipeline/topic_segmentation/topics";

function block(id: string, start: number, end: number, text: string): SemanticBlock {
  return { block_id: id, start, end, text, segment_ids: [id] };
}

describe("topic duration merge", () => {
  it("keeps finished news items that are shorter than 90 seconds", () => {
    const blocks = Array.from({ length: 20 }, (_, index) =>
      block(`b${index + 1}`, index * 40, index * 40 + 36, `Story ${index + 1} is finished.`),
    );
    const boundaries = new Set(blocks.slice(1).map((item) => item.block_id));

    const topics = buildTopicsFromBoundaries(blocks, boundaries);

    expect(topics).toHaveLength(20);
    expect(topics[0].durationSeconds).toBe(36);
    expect(topics[19].topic_id).toBe("t20");
  });

  it("still folds a scrap that is too short to be its own item", () => {
    const blocks = [
      block("b1", 0, 40, "The first story is finished."),
      block("b2", 40, 44, "um"),
    ];

    const topics = buildTopicsFromBoundaries(blocks, new Set(["b2"]));

    expect(topics).toHaveLength(1);
    expect(topics[0].block_ids).toEqual(["b1", "b2"]);
  });
});
