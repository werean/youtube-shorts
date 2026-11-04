import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import type { SemanticBlock } from "../../../src/models/semantic_block";
import { normalizeCuts } from "../../../src/pipeline/analysis/cuts";
import { writeRunLog } from "../../../src/pipeline/runLog";

function block(id: string, start: number, end: number, text: string): SemanticBlock {
  return { block_id: id, start, end, text, segment_ids: [id] };
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("analysis run log", () => {
  it("records why a news bulletin keeps finished items outside 15 to 90 seconds", () => {
    const blocks = [
      block("b1", 0, 12, "A short bulletin closes."),
      block("b2", 20, 80, "A standard story opens."),
      block("b3", 80, 140, "The standard story ends."),
      block("b4", 140, 260, "A long package still concludes."),
      block("b5", 260, 266, "No."),
      block("b6", 270, 280, "Finished thought."),
      block("b7", 280, 290, "and this continues"),
      block("b8", 290, 300, "and this continues"),
      block("b9", 300, 310, "and this continues"),
      block("b10", 310, 320, "and this still continues."),
    ];
    const normalized = normalizeCuts(
      [
        { blocks: ["b1"], start: 0, end: 12, title: "Short bulletin" },
        { blocks: ["b2", "b3"], start: 20, end: 140, title: "Standard story" },
        { blocks: ["b4"], start: 140, end: 260, title: "Long package" },
        { blocks: ["b5"], start: 260, end: 266, title: "Scrap" },
        { blocks: ["b10"], start: 310, end: 320, title: "Mid sentence" },
      ],
      blocks,
    );

    expect(normalized.cuts.map((cut) => cut.title)).toEqual([
      "Short bulletin",
      "Standard story",
      "Long package",
    ]);
    expect(normalized.rejections.map((item) => item.reason)).toEqual([
      "too-short",
      "mid-sentence-start",
    ]);

    const dir = mkdtempSync(join(tmpdir(), "analysis-run-"));
    tempDirs.push(dir);
    const filePath = join(dir, "analysis.run.json");
    writeRunLog(filePath, {
      kind: "analysis",
      model: "local-model",
      endpoint: "http://localhost:1234/v1",
      api_key: "should-not-stick",
      topics: [{ topic_id: "t1", duration_seconds: 36, disposition: "analyzed" }],
      candidates: [{ blocks: ["b1"], start: 0, end: 12, title: "Short bulletin" }],
      rejections: normalized.rejections,
      kept: normalized.cuts.map((cut) => ({
        cut_id: cut.cut_id,
        block_ids: cut.block_ids,
        start: cut.start,
        end: cut.end,
        title: cut.title,
        duration_note: normalized.kept_notes.find((note) => note.start === cut.start)?.duration_note,
      })),
      note: "token=super-secret",
    });

    const saved = JSON.parse(readFileSync(filePath, "utf-8"));
    expect(saved.model).toBe("local-model");
    expect(saved.endpoint).toBe("http://localhost:1234/v1");
    expect(saved.api_key).toBeUndefined();
    expect(saved.note).toBe("token=[redacted]");
    expect(saved.topics).toEqual([
      { topic_id: "t1", duration_seconds: 36, disposition: "analyzed" },
    ]);
    expect(saved.rejections.map((item: { reason: string }) => item.reason)).toEqual([
      "too-short",
      "mid-sentence-start",
    ]);
    expect(saved.kept.map((item: { title: string; duration_note: string }) => item.duration_note)).toEqual([
      "shorter-than-preferred",
      "longer-than-preferred",
      "longer-than-preferred",
    ]);
  });
});
