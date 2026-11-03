import { describe, expect, it } from "vitest";
import { groupSegmentsIntoBlocks } from "../../../src/pipeline/semantic_blocks";
import type { Segment } from "../../../src/models/segment";

function segment(id: string, start: number, end: number, text: string): Segment {
  return { segment_id: id, start, end, text };
}

describe("groupSegmentsIntoBlocks", () => {
  it("does not close a block on a pause while the sentence is still open", () => {
    const blocks = groupSegmentsIntoBlocks([
      segment("s1", 0, 6, "The point is"),
      segment("s2", 7, 12, "still unfinished."),
    ]);

    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("The point is still unfinished.");
  });

  it("moves the segment that would cross 30 seconds into the next block", () => {
    const blocks = groupSegmentsIntoBlocks([
      segment("s1", 0, 28, "A long unfinished clause"),
      segment("s2", 28, 34, "continues here."),
    ]);

    expect(blocks.map((block) => block.text)).toEqual([
      "A long unfinished clause",
      "continues here.",
    ]);
  });

  it("closes after a finished sentence once the block is at least five seconds", () => {
    const blocks = groupSegmentsIntoBlocks([
      segment("s1", 0, 6, "Finished thought."),
      segment("s2", 6.1, 9, "Next thought."),
    ]);

    expect(blocks.map((block) => block.text)).toEqual(["Finished thought.", "Next thought."]);
  });
});
