import { describe, expect, it } from "vitest";
import { buildCutFilename } from "../../../src/storage/renderOutputs";

describe("buildCutFilename", () => {
  it("matches the minute_second names the frontend already uses", () => {
    expect(buildCutFilename(65.9, 90.2)).toBe("01_05-01_30.mp4");
    expect(buildCutFilename(4, 9.25, "c1")).toBe("00_04-00_09.mp4");
  });
});
