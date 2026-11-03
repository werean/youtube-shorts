import { describe, expect, it } from "vitest";
import { NoApprovedCutsError } from "../../../src/pipeline/errors";
import { selectCutsToRender } from "../../../src/pipeline/rendering/preconditions";
import { isFinishedShort } from "../../../src/pipeline/rendering/runner";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

describe("render cut selection", () => {
  it("returns approved cuts unchanged when the analysis file exists", () => {
    const approved = selectCutsToRender(
      [
        { cut_id: "c1", block_ids: ["b1"], start: 1, end: 2, status: "pending" },
        { cut_id: "c2", block_ids: ["b2"], start: 4, end: 9, status: "approved" },
      ],
      true,
    );

    expect(approved).toEqual([
      { cut_id: "c2", block_ids: ["b2"], start: 4, end: 9, status: "approved" },
    ]);
  });

  it("does not treat an empty analysis file as a pipeline error", () => {
    expect(() => selectCutsToRender([], true)).toThrow(NoApprovedCutsError);
    expect(() => selectCutsToRender([], true)).toThrow("Analysis produced no cuts to render");
  });

  it("still errors when the cuts file was never written", () => {
    expect(() => selectCutsToRender([], false)).toThrow("No cuts found to render");
  });
});

describe("isFinishedShort", () => {
  it("ignores a non-empty partial file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "render-partial-"));
    const partial = path.join(dir, "00_01-00_02.mp4.partial");
    fs.writeFileSync(partial, "not-finished");

    expect(isFinishedShort(partial)).toBe(false);
    expect(isFinishedShort(partial.replace(/\.partial$/, ""))).toBe(false);

    fs.rmSync(dir, { recursive: true, force: true });
  });
});
