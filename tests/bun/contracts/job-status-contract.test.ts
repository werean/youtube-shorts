import { describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as path from "path";
import { JobStatus } from "../../../backend/src/models/job";

const repoRoot = path.resolve(import.meta.dir, "../../..");
const frontendTypesPath = path.join(repoRoot, "frontend", "src", "types.ts");

function readFrontendJobStatusLiterals(): string[] {
  const source = fs.readFileSync(frontendTypesPath, "utf-8");
  const match = source.match(/export\s+type\s+JobStatus\s*=\s*([\s\S]*?);/);

  if (!match) {
    throw new Error("Could not find frontend JobStatus type union");
  }

  return Array.from(match[1].matchAll(/"([^"]+)"/g), (literal) => literal[1]);
}

describe("frontend/backend job status contract", () => {
  test("frontend JobStatus union accepts every backend JobStatus value", () => {
    const backendStatuses = Object.values(JobStatus);
    const frontendStatuses = readFrontendJobStatusLiterals();

    expect(frontendStatuses).toEqual(backendStatuses);
  });

  test("frontend status handling includes the backend topic-building state", () => {
    const frontendStatuses = readFrontendJobStatusLiterals();

    expect(Object.values(JobStatus)).toContain("BUILDING_TOPICS");
    expect(frontendStatuses).toContain("BUILDING_TOPICS");
  });
});
