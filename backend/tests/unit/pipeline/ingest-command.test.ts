import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Job } from "../../../src/models/job";
import { buildDownloadArgs, denoRuntimeSpecFromPaths } from "../../../src/pipeline/ingest/command";

vi.mock("../../../src/core/settings", () => ({
  loadSettings: () => ({
    media: { download_resolution: "1080p" },
  }),
}));

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("yt-dlp Deno runtime spec", () => {
  it("returns the bare deno runtime when no binary is on the search path", () => {
    expect(denoRuntimeSpecFromPaths(["", " "])).toBe("deno");
  });

  it("points yt-dlp at a Deno binary when one is present", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "deno-runtime-"));
    tempDirs.push(dir);
    const binaryName = process.platform === "win32" ? "deno.exe" : "deno";
    const binary = path.join(dir, binaryName);
    writeFileSync(binary, "");

    expect(denoRuntimeSpecFromPaths([dir])).toBe(`deno:${binary}`);
  });

  it("adds Deno and Chrome cookies to the yt-dlp command", () => {
    const job = {
      job_id: "job",
      youtube_url: "https://example.com/watch?v=abc123",
      status: "CREATED",
      created_at: "2026-04-21T00:00:00.000Z",
    } as Job;

    const args = buildDownloadArgs(job, "video.%(ext)s");
    const runtimeIndex = args.indexOf("--js-runtimes");

    expect(args.slice(0, 4)).toEqual(["python", "-m", "yt_dlp", "--no-playlist"]);
    expect(runtimeIndex).toBeGreaterThan(3);
    expect(args[runtimeIndex + 1]).toMatch(/^deno(?::.+)?$/);
    expect(args).toContain("--cookies-from-browser");
    expect(args[args.indexOf("--cookies-from-browser") + 1]).toBe("chrome");
    expect(args).toContain("bv*[height<=1080]+ba/b[height<=1080]");
    expect(args).toContain(job.youtube_url);
  });
});
