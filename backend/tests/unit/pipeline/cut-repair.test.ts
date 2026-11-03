import { describe, expect, it } from "vitest";
import { repairCutRange } from "../../../src/pipeline/analysis/cuts";
import type { SemanticBlock } from "../../../src/models/semantic_block";
import type { TopicSegment } from "../../../src/models/topic_segment";

function block(id: string, start: number, end: number, text: string): SemanticBlock {
  return {
    block_id: id,
    start,
    end,
    text,
    segment_ids: [id],
  };
}

const blocks: SemanticBlock[] = [
  block("b1", 0, 80, "This opens the point."),
  block("b2", 80, 160, "The middle develops it."),
  block("b3", 160, 320, "And the thought concludes."),
  block("b4", 320, 400, "and it keeps going"),
  block("b5", 400, 520, "until the sentence ends."),
];

describe("repairCutRange", () => {
  it("snaps model times to block edges and keeps a complete cut", () => {
    const repaired = repairCutRange(
      { blocks: ["b1", "b2", "b3"], start: 4.2, end: 300.4, title: "Hook" },
      blocks,
    );

    expect(repaired).toEqual({
      ok: true,
      note: "b1,b2,b3 @ 4.2-300.4 → b1,b2,b3 @ 0-320",
      cut: {
        blocks: ["b1", "b2", "b3"],
        start: 0,
        end: 320,
        title: "Hook",
      },
    });
  });

  it("pulls the previous sentence and the following conclusion", () => {
    const repaired = repairCutRange(
      { blocks: ["b4"], start: 320, end: 400 },
      blocks,
    );

    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      expect(repaired.cut.blocks).toEqual(["b3", "b4", "b5"]);
      expect(repaired.cut.start).toBe(160);
      expect(repaired.cut.end).toBe(520);
    }
  });

  it("rejects a gap, a missing block, a short range, and a cut with no conclusion", () => {
    expect(repairCutRange({ blocks: ["b1", "b3"], start: 0, end: 320 }, blocks).ok).toBe(false);
    expect(repairCutRange({ blocks: ["b9"], start: 0, end: 10 }, blocks)).toMatchObject({
      ok: false,
      reason: "missing-block",
    });
    expect(repairCutRange({ blocks: ["b1"], start: 0, end: 80 }, blocks)).toMatchObject({
      ok: false,
      reason: "too-short",
    });
    expect(
      repairCutRange(
        { blocks: ["b4"], start: 320, end: 400 },
        blocks.slice(0, 4),
      ),
    ).toMatchObject({ ok: false, reason: "no-conclusion" });
  });

  it("rejects a mid-topic start when the missing prefix is longer than 90 seconds", () => {
    const topicBlocks = [
      block("b1", 0, 120, "Long context before the hook."),
      block("b2", 120, 280, "The middle of the subject."),
      block("b3", 280, 460, "The subject concludes."),
    ];
    const topics: TopicSegment[] = [
      {
        topic_id: "t1",
        start: 0,
        end: 460,
        block_ids: ["b1", "b2", "b3"],
        blockCount: 3,
        durationSeconds: 460,
      },
    ];

    expect(
      repairCutRange({ blocks: ["b2", "b3"], start: 120, end: 460 }, topicBlocks, topics),
    ).toMatchObject({ ok: false, reason: "mid-topic" });
  });

  it("includes a short topic prefix so the cut does not start mid-subject", () => {
    const shortTopicBlocks = [
      block("b1", 0, 40, "Context for the hook."),
      block("b2", 40, 360, "The story itself concludes."),
    ];
    const topics: TopicSegment[] = [
      {
        topic_id: "t1",
        start: 0,
        end: 360,
        block_ids: ["b1", "b2"],
        blockCount: 2,
        durationSeconds: 360,
      },
    ];

    const repaired = repairCutRange(
      { blocks: ["b2"], start: 41, end: 350 },
      shortTopicBlocks,
      topics,
    );

    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      expect(repaired.cut.blocks).toEqual(["b1", "b2"]);
      expect(repaired.cut.start).toBe(0);
      expect(repaired.cut.end).toBe(360);
    }
  });
});
