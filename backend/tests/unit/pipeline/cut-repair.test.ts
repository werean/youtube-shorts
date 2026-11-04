import { describe, expect, it } from "vitest";
import { repairCutRange } from "../../../src/pipeline/analysis/cuts";
import type { SemanticBlock } from "../../../src/models/semantic_block";

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
  block("b1", 0, 20, "This opens the point."),
  block("b2", 20, 40, "The middle develops it."),
  block("b3", 40, 60, "And the thought concludes."),
  block("b4", 60, 75, "and it keeps going"),
  block("b5", 75, 90, "until the sentence ends."),
];

describe("repairCutRange", () => {
  it("snaps model times to block edges inside 15 to 90 seconds", () => {
    const repaired = repairCutRange(
      { blocks: ["b1", "b2", "b3"], start: 4.2, end: 58.4, title: "Hook" },
      blocks,
    );

    expect(repaired).toEqual({
      ok: true,
      note: "b1,b2,b3 @ 4.2-58.4 → b1,b2,b3 @ 0-60",
      duration_note: "within-preferred-window",
      cut: {
        blocks: ["b1", "b2", "b3"],
        start: 0,
        end: 60,
        title: "Hook",
      },
    });
  });

  it("does not treat a lowercase word after a finished sentence as a continuation", () => {
    const sentences = [
      block("b1", 0, 20, "The sentence is finished."),
      block("b2", 20, 40, "and this is a new sentence."),
      block("b3", 40, 60, "It has a middle."),
      block("b4", 60, 80, "It ends here."),
    ];

    const repaired = repairCutRange(
      { blocks: ["b2", "b3", "b4"], start: 20, end: 80 },
      sentences,
    );

    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      expect(repaired.cut.blocks).toEqual(["b2", "b3", "b4"]);
      expect(repaired.cut.start).toBe(20);
    }
  });

  it("continues only while the previous sentence is still open", () => {
    const open = [
      block("b1", 0, 20, "The point is"),
      block("b2", 20, 40, "still open"),
      block("b3", 40, 60, "and now it ends."),
    ];

    const repaired = repairCutRange({ blocks: ["b3"], start: 40, end: 60 }, open);

    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      expect(repaired.cut.blocks).toEqual(["b1", "b2", "b3"]);
      expect(repaired.cut.start).toBe(0);
      expect(repaired.cut.end).toBe(60);
    }
  });

  it("does not treat a question mark as a conclusion", () => {
    const questioned = [
      block("b1", 0, 20, "Here is the claim."),
      block("b2", 20, 40, "What happens next?"),
      block("b3", 40, 60, "The answer lands."),
    ];

    const repaired = repairCutRange({ blocks: ["b1", "b2"], start: 0, end: 40 }, questioned);

    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      expect(repaired.cut.blocks).toEqual(["b1", "b2", "b3"]);
    }
  });

  it("caps a lowercase continuation instead of swallowing the video", () => {
    const chain = [
      block("b1", 0, 15, "Finished thought."),
      block("b2", 15, 30, "and this continues"),
      block("b3", 30, 45, "and this continues"),
      block("b4", 45, 60, "and this continues"),
      block("b5", 60, 75, "and this still continues."),
    ];

    expect(repairCutRange({ blocks: ["b5"], start: 60, end: 75 }, chain)).toMatchObject({
      ok: false,
      reason: "mid-sentence-start",
    });
  });

  it("does not pull earlier blocks once the opening sentence is already closed", () => {
    const repaired = repairCutRange({ blocks: ["b1", "b2", "b3"], start: 1, end: 59 }, blocks);

    expect(repaired.ok).toBe(true);
    if (repaired.ok) {
      expect(repaired.cut.blocks).toEqual(["b1", "b2", "b3"]);
      expect(repaired.cut.start).toBe(0);
    }
  });

  it("keeps a finished item outside the 15 to 90 second preference", () => {
    const shortItem = repairCutRange(
      { blocks: ["s1", "s2", "s3"], start: 0, end: 12 },
      [
        block("s1", 0, 4, "One."),
        block("s2", 4, 8, "Two."),
        block("s3", 8, 12, "Three."),
      ],
    );
    expect(shortItem).toMatchObject({
      ok: true,
      duration_note: "shorter-than-preferred",
    });

    const longItem = repairCutRange(
      { blocks: ["l1", "l2", "l3"], start: 0, end: 120 },
      [
        block("l1", 0, 40, "One."),
        block("l2", 40, 80, "Two."),
        block("l3", 80, 120, "Three."),
      ],
    );
    expect(longItem).toMatchObject({
      ok: true,
      duration_note: "longer-than-preferred",
    });

    const twoBlocks = repairCutRange({ blocks: ["b1", "b2"], start: 0, end: 40 }, blocks);
    expect(twoBlocks).toMatchObject({ ok: true, duration_note: "within-preferred-window" });
  });

  it("rejects gaps, missing blocks, scraps, runaway spans, and missing conclusions", () => {
    expect(repairCutRange({ blocks: ["b1", "b3"], start: 0, end: 60 }, blocks)).toMatchObject({
      ok: false,
      reason: "gap",
    });
    expect(repairCutRange({ blocks: ["b9"], start: 0, end: 10 }, blocks)).toMatchObject({
      ok: false,
      reason: "missing-block",
    });
    expect(
      repairCutRange(
        { blocks: ["s1", "s2", "s3"], start: 0, end: 6 },
        [
          block("s1", 0, 2, "One."),
          block("s2", 2, 4, "Two."),
          block("s3", 4, 6, "Three."),
        ],
      ),
    ).toMatchObject({ ok: false, reason: "too-short" });
    expect(
      repairCutRange(
        { blocks: ["l1", "l2", "l3"], start: 0, end: 300 },
        [
          block("l1", 0, 100, "One."),
          block("l2", 100, 200, "Two."),
          block("l3", 200, 300, "Three."),
        ],
      ),
    ).toMatchObject({ ok: false, reason: "too-long" });
    expect(
      repairCutRange({ blocks: ["b4"], start: 60, end: 75 }, blocks.slice(0, 4)),
    ).toMatchObject({ ok: false, reason: "no-conclusion" });
  });
});
