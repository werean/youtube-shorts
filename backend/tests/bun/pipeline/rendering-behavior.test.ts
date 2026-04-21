import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JobStatus, type Job } from "../../../src/models/job";

type FfmpegScenario = "success" | "failure" | "pending";

type SpawnedChild = EventEmitter & {
  pid?: number;
  kill: (signal?: string) => boolean;
};

let tempRoot = "";
let sourceVideoPath: string | null = null;
let ffmpegScenario: FfmpegScenario = "success";
let pendingFfmpeg: { resolve: () => void; reject: (error: Error) => void } | null = null;

const jobs = new Map<string, Job>();
const statusUpdates: Array<{ jobId: string; status: JobStatus }> = [];
const clearedLogs: Array<{ jobId: string; task: string }> = [];
const taskLogLines: Array<{ jobId: string; task: string; line: string }> = [];
const commandParams: any[] = [];
const ffmpegCalls: Array<{ command: string[] }> = [];
const spawnCalls: Array<{ executable: string; args: string[] }> = [];

const originalRenderMaxConcurrency = process.env.RENDER_MAX_CONCURRENCY;

function jobDir(jobId: string): string {
  return path.join(tempRoot, jobId);
}

function cutsPath(jobId: string): string {
  return path.join(jobDir(jobId), "cuts.suggested.json");
}

function shortsDir(jobId: string): string {
  return path.join(jobDir(jobId), "shorts");
}

function makeJob(jobId: string, status: JobStatus = JobStatus.WAITING_APPROVAL): Job {
  return {
    job_id: jobId,
    youtube_url: "https://example.com/video",
    status,
    created_at: "2026-04-21T00:00:00.000Z",
    video_duration_seconds: 60,
    source_video_path: sourceVideoPath || undefined,
  };
}

function loadJobMock(jobId: string): Job {
  if (!jobs.has(jobId)) {
    jobs.set(jobId, makeJob(jobId));
  }

  return { ...jobs.get(jobId)! };
}

function updateJobStatusMock(jobId: string, status: JobStatus): Job {
  const job = { ...loadJobMock(jobId), status, updated_at: new Date().toISOString() };
  jobs.set(jobId, job);
  statusUpdates.push({ jobId, status });
  return { ...job };
}

function writeCuts(jobId: string): void {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(
    cutsPath(jobId),
    JSON.stringify([
      {
        cut_id: "c2",
        block_ids: ["b2"],
        start: 20,
        end: 32.5,
        title: "Second",
        status: "pending",
      },
      {
        cut_id: "c1",
        block_ids: ["b1"],
        start: 4,
        end: 9.25,
        title: "First",
        status: "approved",
      },
    ]),
    "utf-8",
  );
}

function statusUpdateValues(jobId: string): JobStatus[] {
  return statusUpdates.filter((entry) => entry.jobId === jobId).map((entry) => entry.status);
}

function logLines(jobId: string): string[] {
  return taskLogLines.filter((entry) => entry.jobId === jobId).map((entry) => entry.line);
}

const childProcessSpawnMock = mock((executable: string, args: string[] = []) => {
  spawnCalls.push({ executable, args });
  const child = new EventEmitter() as SpawnedChild;
  child.pid = 999;
  child.kill = () => true;
  return child;
});

mock.module("child_process", () => ({
  spawn: childProcessSpawnMock,
}));

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
  saveJob: (job: Job) => jobs.set(job.job_id, { ...job }),
  updateJobStatus: updateJobStatusMock,
}));

mock.module("../../../src/storage/files", () => ({
  buildCutFilename: (start: number, end: number) => `${start.toFixed(2)}-${end.toFixed(2)}.mp4`,
  cutsPath,
  ensureShortsJobDir: (jobId: string) => {
    const dir = shortsDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
  findSourceVideo: () => sourceVideoPath,
  listRenderOutputUrls: (jobId: string) => [`/media/shorts/${jobId}/existing.mp4`],
}));

mock.module("../../../src/core/toolConfigs", () => ({
  loadActiveToolConfigs: () => ({
    ffmpeg: {
      audio_codec: "aac-test",
      video_codec: "h264-test",
      video_preset: "p1-test",
    },
    llm: {
      model: "test-model",
      system_prompt: "JSON only",
    },
    whisper: {},
  }),
}));

mock.module("../../../src/core/taskLogs", () => ({
  appendTaskLog: (jobId: string, task: string, line: string) => {
    taskLogLines.push({ jobId, task, line });
  },
  appendTaskLogs: (jobId: string, task: string, lines: string[]) => {
    for (const line of lines) {
      taskLogLines.push({ jobId, task, line });
    }
  },
  clearTaskLogs: (jobId: string, task: string) => {
    clearedLogs.push({ jobId, task });
  },
}));

mock.module("../../../src/video/vertical", () => ({
  buildVerticalNvencCommand: (params: any) => {
    commandParams.push(params);
    return [
      "ffmpeg",
      "-i",
      params.inputPath,
      "-ss",
      String(params.start),
      "-to",
      String(params.end),
      params.outputPath,
    ];
  },
}));

mock.module("../../../src/video/ffmpeg", () => ({
  runFfmpegAsync: async (
    command: string[],
    onLog?: (lines: string[]) => void,
    onSpawn?: (child: SpawnedChild) => void,
  ) => {
    ffmpegCalls.push({ command });
    const child = new EventEmitter() as SpawnedChild;
    child.pid = 12345;
    child.kill = () => {
      child.emit("exit", 143);
      return true;
    };
    onSpawn?.(child);
    onLog?.([`ffmpeg started ${command.at(-1)}`]);

    if (ffmpegScenario === "pending") {
      await new Promise<void>((resolve, reject) => {
        pendingFfmpeg = { resolve, reject };
      });
      child.emit("exit", 0);
      return;
    }

    if (ffmpegScenario === "failure") {
      child.emit("exit", 1);
      throw new Error("FFmpeg failed with code 9");
    }

    fs.writeFileSync(command.at(-1)!, "rendered", "utf-8");
    child.emit("exit", 0);
  },
}));

const { cancelRendering, listRenderOutputs, renderSuggestedCuts } = await import(
  "../../../src/pipeline/rendering"
);

describe("rendering flow behavior", () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-rendering-"));
    sourceVideoPath = null;
    ffmpegScenario = "success";
    pendingFfmpeg = null;
    process.env.RENDER_MAX_CONCURRENCY = "1";
    jobs.clear();
    statusUpdates.length = 0;
    clearedLogs.length = 0;
    taskLogLines.length = 0;
    commandParams.length = 0;
    ffmpegCalls.length = 0;
    spawnCalls.length = 0;
    childProcessSpawnMock.mockClear();
  });

  afterEach(() => {
    process.env.RENDER_MAX_CONCURRENCY = originalRenderMaxConcurrency;
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("missing source video marks RENDERING then ERROR before loading cuts", async () => {
    await expect(renderSuggestedCuts("job-missing-source")).rejects.toThrow(
      "Source video not found for job",
    );

    expect(statusUpdateValues("job-missing-source")).toEqual([
      JobStatus.RENDERING,
      JobStatus.ERROR,
    ]);
    expect(clearedLogs).toEqual([
      { jobId: "job-missing-source", task: "transcription" },
      { jobId: "job-missing-source", task: "render" },
    ]);
    expect(commandParams).toEqual([]);
    expect(ffmpegCalls).toEqual([]);
    expect(logLines("job-missing-source")).toEqual(
      expect.arrayContaining([
        "[rendering] Starting render",
        "[rendering] ✗ Error: Source video not found for job",
      ]),
    );
  });

  test("missing cuts marks ERROR after source lookup without building FFmpeg commands", async () => {
    sourceVideoPath = path.join(tempRoot, "source.mp4");
    fs.writeFileSync(sourceVideoPath, "fake video", "utf-8");

    await expect(renderSuggestedCuts("job-no-cuts")).rejects.toThrow("No cuts found to render");

    expect(statusUpdateValues("job-no-cuts")).toEqual([JobStatus.RENDERING, JobStatus.ERROR]);
    expect(commandParams).toEqual([]);
    expect(ffmpegCalls).toEqual([]);
    expect(logLines("job-no-cuts")).toEqual(
      expect.arrayContaining([
        `[rendering] Source: ${sourceVideoPath}`,
        "[rendering] ✗ Error: No cuts found to render",
      ]),
    );
  });

  test("successful rendering uses canonical cuts, builds commands, and returns ordered output URLs", async () => {
    sourceVideoPath = path.join(tempRoot, "source.mp4");
    fs.writeFileSync(sourceVideoPath, "fake video", "utf-8");
    writeCuts("job-success");

    const outputs = await renderSuggestedCuts("job-success");

    expect(outputs).toEqual([
      "/media/shorts/job-success/20.00-32.50.mp4",
      "/media/shorts/job-success/4.00-9.25.mp4",
    ]);
    expect(statusUpdateValues("job-success")).toEqual([JobStatus.RENDERING, JobStatus.DONE]);
    expect(commandParams).toEqual([
      {
        inputPath: sourceVideoPath,
        outputPath: path.join(shortsDir("job-success"), "20.00-32.50.mp4"),
        start: 20,
        end: 32.5,
        ffmpegConfig: {
          audio_codec: "aac-test",
          video_codec: "h264-test",
          video_preset: "p1-test",
        },
      },
      {
        inputPath: sourceVideoPath,
        outputPath: path.join(shortsDir("job-success"), "4.00-9.25.mp4"),
        start: 4,
        end: 9.25,
        ffmpegConfig: {
          audio_codec: "aac-test",
          video_codec: "h264-test",
          video_preset: "p1-test",
        },
      },
    ]);
    expect(ffmpegCalls.map((call) => call.command.join(" "))).toEqual([
      `ffmpeg -i ${sourceVideoPath} -ss 20 -to 32.5 ${path.join(shortsDir("job-success"), "20.00-32.50.mp4")}`,
      `ffmpeg -i ${sourceVideoPath} -ss 4 -to 9.25 ${path.join(shortsDir("job-success"), "4.00-9.25.mp4")}`,
    ]);
    expect(fs.existsSync(path.join(shortsDir("job-success"), "20.00-32.50.mp4"))).toBe(true);
    expect(fs.existsSync(path.join(shortsDir("job-success"), "4.00-9.25.mp4"))).toBe(true);
    expect(logLines("job-success")).toEqual(
      expect.arrayContaining([
        "[rendering] Starting render",
        `[rendering] Source: ${sourceVideoPath}`,
        "[rendering] Concurrency: 1",
        "[rendering] Cut c2 20.00-32.50",
        expect.stringContaining("[rendering] Command: ffmpeg -i"),
        "ffmpeg started " + path.join(shortsDir("job-success"), "20.00-32.50.mp4"),
        "[rendering] ✓ Render complete",
      ]),
    );
  });

  test("FFmpeg failure marks ERROR and preserves the thrown error", async () => {
    sourceVideoPath = path.join(tempRoot, "source.mp4");
    fs.writeFileSync(sourceVideoPath, "fake video", "utf-8");
    writeCuts("job-failure");
    ffmpegScenario = "failure";

    await expect(renderSuggestedCuts("job-failure")).rejects.toThrow("FFmpeg failed with code 9");

    expect(statusUpdateValues("job-failure")).toEqual([JobStatus.RENDERING, JobStatus.ERROR]);
    expect(logLines("job-failure")).toEqual(
      expect.arrayContaining([
        "[rendering] Cut c2 20.00-32.50",
        "ffmpeg started " + path.join(shortsDir("job-failure"), "20.00-32.50.mp4"),
        "[rendering] ✗ Error: FFmpeg failed with code 9",
      ]),
    );
  });

  test("cancellation kills active render processes and returns already completed outputs", async () => {
    sourceVideoPath = path.join(tempRoot, "source.mp4");
    fs.writeFileSync(sourceVideoPath, "fake video", "utf-8");
    writeCuts("job-cancel");
    ffmpegScenario = "pending";

    const renderPromise = renderSuggestedCuts("job-cancel");
    await Bun.sleep(0);

    expect(cancelRendering("job-cancel")).toBe(true);
    expect(statusUpdateValues("job-cancel")).toEqual([
      JobStatus.RENDERING,
      JobStatus.DOWNLOADED,
    ]);
    expect(logLines("job-cancel")).toEqual(
      expect.arrayContaining([
        "[rendering] Cancel requested",
        "[rendering] Cancelled",
      ]),
    );

    pendingFfmpeg?.resolve();
    const outputs = await renderPromise;

    expect(outputs).toEqual(["/media/shorts/job-cancel/20.00-32.50.mp4"]);
    expect(statusUpdateValues("job-cancel")).toEqual([
      JobStatus.RENDERING,
      JobStatus.DOWNLOADED,
      JobStatus.DOWNLOADED,
    ]);
    expect(logLines("job-cancel")).toContain("[rendering] Cancel acknowledged");
    expect(cancelRendering("job-cancel")).toBe(false);
  });

  test("listRenderOutputs delegates to storage output URLs", () => {
    expect(listRenderOutputs("job-existing")).toEqual(["/media/shorts/job-existing/existing.mp4"]);
  });
});
