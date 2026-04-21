import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JobStatus, type Job } from "../../../src/models/job";

type SpawnScenario = "success" | "failure";

type SpawnedChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid?: number;
  kill: (signal?: string) => boolean;
};

let tempRoot = "";
let sourceVideoPath: string | null = null;
let spawnScenario: SpawnScenario = "success";
let latestOutputDir = "";

const jobs = new Map<string, Job>();
const statusUpdates: Array<{ jobId: string; status: JobStatus }> = [];
const savedJobs: Job[] = [];
const clearedLogs: Array<{ jobId: string; task: string }> = [];
const taskLogLines: Array<{ jobId: string; task: string; line: string }> = [];
const spawnCalls: Array<{ command: string; options: any }> = [];

function jobDir(jobId: string): string {
  return path.join(tempRoot, jobId);
}

function transcriptionsDir(jobId: string): string {
  return path.join(jobDir(jobId), "transcriptions");
}

function makeJob(jobId: string, status: JobStatus = JobStatus.DOWNLOADED): Job {
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

function saveJobMock(job: Job): void {
  jobs.set(job.job_id, { ...job });
  savedJobs.push({ ...job });
}

function updateJobStatusMock(jobId: string, status: JobStatus): Job {
  const job = { ...loadJobMock(jobId), status, updated_at: new Date().toISOString() };
  jobs.set(jobId, job);
  statusUpdates.push({ jobId, status });
  return { ...job };
}

function transcriptionSegmentsPath(jobId: string): string {
  return path.join(transcriptionsDir(jobId), "transcription.segments.json");
}

function transcriptionTextPath(jobId: string): string {
  return path.join(transcriptionsDir(jobId), "transcription.txt");
}

function transcriptionVttPath(jobId: string): string {
  return path.join(transcriptionsDir(jobId), "transcription.vtt");
}

function writeWhisperJson(outputDir: string): void {
  if (!sourceVideoPath) {
    throw new Error("sourceVideoPath must be set before writing Whisper output");
  }

  fs.mkdirSync(outputDir, { recursive: true });
  const basename = path.basename(sourceVideoPath, path.extname(sourceVideoPath));
  fs.writeFileSync(
    path.join(outputDir, `${basename}.json`),
    JSON.stringify({
      segments: [
        { start: "0", end: "1.5", text: " Hello world " },
        { start: "1.5", end: "3.25", text: " Second line " },
      ],
    }),
    "utf-8",
  );
}

function parseOutputDir(command: string): string {
  const match = command.match(/--output_dir\s+"([^"]+)"/);
  if (!match) {
    throw new Error(`Could not parse output dir from command: ${command}`);
  }
  return match[1];
}

const spawnMock = mock((command: string, options: any = {}): SpawnedChild => {
  spawnCalls.push({ command, options });

  const child = new EventEmitter() as SpawnedChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.pid = 12345;
  child.kill = () => true;

  if (command.startsWith("taskkill")) {
    queueMicrotask(() => child.emit("exit", 0));
    return child;
  }

  queueMicrotask(() => {
    if (spawnScenario === "success") {
      latestOutputDir = parseOutputDir(command);
      writeWhisperJson(latestOutputDir);
      child.stdout.emit("data", Buffer.from("whisper line one\nwhisper line two\n"));
      child.stderr.emit("data", Buffer.from("warning without newline"));
      child.emit("exit", 0);
      return;
    }

    child.stderr.emit("data", Buffer.from("fatal whisper failure\n"));
    child.emit("exit", 7);
  });

  return child;
});

mock.module("child_process", () => ({
  spawn: spawnMock,
}));

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
  saveJob: saveJobMock,
  updateJobStatus: updateJobStatusMock,
}));

mock.module("../../../src/storage/files", () => ({
  ensureTranscriptionsJobDir: (jobId: string) => {
    const dir = transcriptionsDir(jobId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  },
  findSourceVideo: () => sourceVideoPath,
  removeTranscriptionsJobDir: (jobId: string) => {
    const dir = transcriptionsDir(jobId);
    fs.rmSync(dir, { recursive: true, force: true });
    return dir;
  },
  transcriptionPath: transcriptionSegmentsPath,
  transcriptionTextPath,
  transcriptionVttPath,
}));

mock.module("../../../src/core/toolConfigs", () => ({
  loadActiveToolConfigs: () => ({
    ffmpeg: {},
    llm: {
      model: "test-model",
      system_prompt: "JSON only",
    },
    whisper: {
      append_punctuations: ".",
      beam_size: 2,
      best_of: 3,
      carry_initial_prompt: true,
      condition_on_previous_text: false,
      device: "cpu",
      fp16: false,
      initial_prompt: "seed prompt",
      language: "pt",
      model: "tiny-test",
      output_format: ["txt", "vtt"],
      suppress_tokens: "-1",
      task: "translate",
      temperature: 0.1,
      verbose: false,
      word_timestamps: true,
    },
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

const { cancelTranscription, transcribeJob } = await import("../../../src/pipeline/transcription");

function statusUpdateValues(jobId: string): JobStatus[] {
  return statusUpdates.filter((entry) => entry.jobId === jobId).map((entry) => entry.status);
}

function savedStatusValues(jobId: string): JobStatus[] {
  return savedJobs.filter((entry) => entry.job_id === jobId).map((entry) => entry.status);
}

function logLines(jobId: string): string[] {
  return taskLogLines.filter((entry) => entry.jobId === jobId).map((entry) => entry.line);
}

describe("transcription flow behavior", () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-transcription-"));
    sourceVideoPath = null;
    spawnScenario = "success";
    latestOutputDir = "";
    jobs.clear();
    statusUpdates.length = 0;
    savedJobs.length = 0;
    clearedLogs.length = 0;
    taskLogLines.length = 0;
    spawnCalls.length = 0;
    spawnMock.mockClear();
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("missing source video updates TRANSCRIBING and throws before marking ERROR", async () => {
    await expect(transcribeJob("job-missing-source")).rejects.toThrow(
      "Source video not found for job",
    );

    expect(statusUpdateValues("job-missing-source")).toEqual([JobStatus.TRANSCRIBING]);
    expect(savedStatusValues("job-missing-source")).toEqual([]);
    expect(spawnCalls).toEqual([]);
    expect(clearedLogs).toEqual([
      { jobId: "job-missing-source", task: "render" },
      { jobId: "job-missing-source", task: "transcription" },
    ]);
    expect(logLines("job-missing-source")).toContain("[transcription] Starting transcription");
  });

  test("successful transcription builds the Whisper command and writes normalized artifacts", async () => {
    sourceVideoPath = path.join(tempRoot, "source video.mp4");
    fs.writeFileSync(sourceVideoPath, "fake video", "utf-8");

    const segments = await transcribeJob("job-success");

    expect(segments).toEqual([
      { segment_id: "s1", start: 0, end: 1.5, text: "Hello world" },
      { segment_id: "s2", start: 1.5, end: 3.25, text: "Second line" },
    ]);

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toContain(`whisper "${sourceVideoPath}"`);
    expect(spawnCalls[0].command).toContain("--model tiny-test");
    expect(spawnCalls[0].command).toContain("--output_format all");
    expect(spawnCalls[0].command).toContain(`--output_dir "${latestOutputDir}"`);
    expect(spawnCalls[0].command).toContain("--device cpu");
    expect(spawnCalls[0].command).toContain("--verbose False");
    expect(spawnCalls[0].command).toContain("--task translate");
    expect(spawnCalls[0].command).toContain("--language pt");
    expect(spawnCalls[0].command).toContain('--initial_prompt "seed prompt"');
    expect(spawnCalls[0].command).toContain("--condition_on_previous_text False");
    expect(spawnCalls[0].options).toMatchObject({
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(spawnCalls[0].options.env).toMatchObject({
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    });

    expect(JSON.parse(fs.readFileSync(transcriptionSegmentsPath("job-success"), "utf-8"))).toEqual(
      segments,
    );
    expect(fs.readFileSync(transcriptionTextPath("job-success"), "utf-8")).toBe(
      "Hello world Second line",
    );
    expect(fs.readFileSync(transcriptionVttPath("job-success"), "utf-8")).toBe(
      "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.500\nHello world\n\n2\n00:00:01.500 --> 00:00:03.250\nSecond line\n",
    );

    expect(statusUpdateValues("job-success")).toEqual([JobStatus.TRANSCRIBING]);
    expect(savedStatusValues("job-success")).toEqual([JobStatus.BUILDING_BLOCKS]);
    expect(logLines("job-success")).toEqual(
      expect.arrayContaining([
        "[transcription] Starting transcription",
        expect.stringContaining("[transcription] Command: whisper"),
        "whisper line one",
        "whisper line two",
        "warning without newline",
        "[transcription] Whisper completed successfully",
        "[transcription] Transcription saved",
      ]),
    );
    expect(cancelTranscription("job-success")).toBe(false);
  });

  test("Whisper process failure marks the job ERROR and preserves process output logs", async () => {
    sourceVideoPath = path.join(tempRoot, "source.mp4");
    fs.writeFileSync(sourceVideoPath, "fake video", "utf-8");
    spawnScenario = "failure";

    await expect(transcribeJob("job-failure")).rejects.toThrow("Whisper exited with code 7");

    expect(statusUpdateValues("job-failure")).toEqual([
      JobStatus.TRANSCRIBING,
      JobStatus.ERROR,
    ]);
    expect(savedStatusValues("job-failure")).toEqual([]);
    expect(fs.existsSync(transcriptionSegmentsPath("job-failure"))).toBe(false);
    expect(logLines("job-failure")).toEqual(
      expect.arrayContaining([
        "fatal whisper failure",
        "[transcription] ERROR executing Whisper",
        "[transcription] Whisper exited with code 7",
      ]),
    );
  });
});
