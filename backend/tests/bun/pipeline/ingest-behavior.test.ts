import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "events";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JobStatus, type Job } from "../../../src/models/job";

type SpawnScenario = "success" | "failure";

let tempRoot = "";
let mediaRoot = "";
let spawnScenario: SpawnScenario = "success";
let spawnStdoutChunks: string[] = [];
let spawnStderrChunks: string[] = [];
let spawnCalls: Array<{ command: string; options: unknown }> = [];
let downloadResolution: "1080p" | "1440p" | "4k" = "1440p";
let failSave = false;

const jobs = new Map<string, Job>();
const statusUpdates: Array<{ jobId: string; status: JobStatus }> = [];
const savedJobs: Job[] = [];
const taskLogLines: Array<{ jobId: string; task: string; line: string }> = [];
const clearedTasks: Array<{ jobId: string; task: string }> = [];

function sanitizeVideoName(videoName: string): string {
  return videoName.replace(/[<>:"/\\|?*]/g, "_").substring(0, 200);
}

function jobDir(jobId: string): string {
  return path.join(tempRoot, "jobs", jobId);
}

function getVideoDirMock(_jobId: string, videoName?: string): string {
  return path.join(mediaRoot, videoName ? sanitizeVideoName(videoName) : _jobId);
}

function getVideoFilePathMock(jobId: string, videoName?: string, extension = ".mp4"): string {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return path.join(getVideoDirMock(jobId, videoName), `video${ext}`);
}

function sourceVideoInfoPath(jobId: string): string {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  return path.join(jobDir(jobId), "source.info.json");
}

function sourceVideoOutputTemplate(jobId: string): string {
  const job = loadJobMock(jobId);
  const dir = getVideoDirMock(jobId, job.video_name || jobId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, "video.%(ext)s");
}

function sourceVideoPathForJob(jobId: string, extension: string): string {
  const job = loadJobMock(jobId);
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  const filePath = getVideoFilePathMock(jobId, job.video_name || jobId, ext);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  return filePath;
}

function makeJob(jobId: string, partial: Partial<Job> = {}): Job {
  return {
    job_id: jobId,
    youtube_url: "https://example.com/watch?v=abc123",
    status: JobStatus.CREATED,
    created_at: "2026-04-21T00:00:00.000Z",
    ...partial,
  };
}

function putJob(job: Job): Job {
  jobs.set(job.job_id, { ...job });
  return { ...job };
}

function loadJobMock(jobId: string): Job {
  const job = jobs.get(jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  return { ...job };
}

function saveJobMock(job: Job): string {
  if (failSave) {
    throw new Error("save failed");
  }
  jobs.set(job.job_id, { ...job });
  savedJobs.push({ ...job });
  return path.join(jobDir(job.job_id), "job.json");
}

function updateJobStatusMock(jobId: string, status: JobStatus): Job {
  const job = { ...loadJobMock(jobId), status, updated_at: new Date().toISOString() };
  jobs.set(jobId, job);
  statusUpdates.push({ jobId, status });
  return { ...job };
}

function statusUpdateValues(jobId: string): JobStatus[] {
  return statusUpdates.filter((entry) => entry.jobId === jobId).map((entry) => entry.status);
}

function savedJobsFor(jobId: string): Job[] {
  return savedJobs.filter((job) => job.job_id === jobId);
}

function appendTaskLogMock(jobId: string, task: string, line: string): void {
  taskLogLines.push({ jobId, task, line });
}

function appendTaskLogsMock(jobId: string, task: string, lines: string[]): void {
  for (const line of lines) {
    appendTaskLogMock(jobId, task, line);
  }
}

function createMockProcess(): EventEmitter & { stdout: EventEmitter; stderr: EventEmitter } {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
  };
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  return child;
}

function spawnMock(command: string, options: unknown) {
  spawnCalls.push({ command, options });
  const child = createMockProcess();

  queueMicrotask(() => {
    for (const chunk of spawnStdoutChunks) {
      child.stdout.emit("data", Buffer.from(chunk));
    }
    for (const chunk of spawnStderrChunks) {
      child.stderr.emit("data", Buffer.from(chunk));
    }

    if (spawnScenario === "success") {
      child.emit("exit", 0);
      return;
    }

    child.emit("exit", 5);
  });

  return child;
}

mock.module("child_process", () => ({
  spawn: spawnMock,
}));

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
  saveJob: saveJobMock,
  updateJobStatus: updateJobStatusMock,
}));

mock.module("../../../src/storage/files", () => ({
  sourceVideoInfoPath,
  sourceVideoOutputTemplate,
  sourceVideoPathForJob,
}));

mock.module("../../../src/core/settings", () => ({
  getVideoDir: getVideoDirMock,
  getVideoFilePath: getVideoFilePathMock,
  loadSettings: () => ({
    media: {
      base_dir: mediaRoot,
      download_resolution: downloadResolution,
    },
    preferences: {
      ask_move_on_upload: true,
      move_uploads: true,
      ask_delete_cut_confirm: true,
    },
    whisper: {
      device: "cuda",
      formats: ["json", "vtt", "txt"],
    },
    llm: {
      model: "llama2",
    },
  }),
}));

mock.module("../../../src/core/taskLogs", () => ({
  appendTaskLog: appendTaskLogMock,
  appendTaskLogs: appendTaskLogsMock,
  clearTaskLogs: (jobId: string, task: string) => {
    clearedTasks.push({ jobId, task });
  },
}));

mock.module("../../../src/utils/mp4", () => ({
  createDummyMP4: () => Buffer.from("dummy-mp4"),
}));

const { ingestVideo } = await import("../../../src/pipeline/ingest");

describe("ingest pipeline behavior", () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-ingest-"));
    mediaRoot = path.join(tempRoot, "media");
    fs.mkdirSync(mediaRoot, { recursive: true });
    spawnScenario = "success";
    spawnStdoutChunks = [];
    spawnStderrChunks = [];
    spawnCalls = [];
    downloadResolution = "1440p";
    failSave = false;
    jobs.clear();
    statusUpdates.length = 0;
    savedJobs.length = 0;
    taskLogLines.length = 0;
    clearedTasks.length = 0;
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("existing source video and info skip yt-dlp, set DOWNLOADED, and backfill video_name from info", async () => {
    const existingVideoPath = path.join(mediaRoot, "Existing", "video.mp4");
    fs.mkdirSync(path.dirname(existingVideoPath), { recursive: true });
    fs.writeFileSync(existingVideoPath, "video", "utf-8");
    const infoPath = sourceVideoInfoPath("job-existing");
    fs.writeFileSync(infoPath, JSON.stringify({ title: "Existing Title" }), "utf-8");
    const job = putJob(
      makeJob("job-existing", {
        source_video_path: existingVideoPath,
      }),
    );

    const result = await ingestVideo(job);

    expect(result).toEqual({
      video_path: existingVideoPath,
      metadata_path: infoPath,
    });
    expect(spawnCalls).toEqual([]);
    expect(statusUpdateValues("job-existing")).toEqual([JobStatus.DOWNLOADING]);
    expect(savedJobsFor("job-existing")).toEqual([
      expect.objectContaining({
        job_id: "job-existing",
        status: JobStatus.DOWNLOADED,
        video_name: "Existing Title",
      }),
    ]);
    expect(clearedTasks.map((entry) => entry.task)).toEqual(["transcription", "render", "ingest"]);
  });

  test("successful download invokes yt-dlp with configured format, logs flushed output, renames by title, and persists downloaded job", async () => {
    const job = putJob(makeJob("job-download"));
    const outputDir = path.dirname(sourceVideoOutputTemplate(job.job_id));
    const infoPath = sourceVideoInfoPath(job.job_id);
    fs.writeFileSync(infoPath, JSON.stringify({ title: "Downloaded: Title?" }), "utf-8");
    fs.writeFileSync(path.join(outputDir, "video.webm"), "downloaded", "utf-8");
    spawnStdoutChunks = ["line one\npartial"];
    spawnStderrChunks = ["err one\r\n"];

    const result = await ingestVideo(job);

    const expectedVideoPath = path.join(mediaRoot, "Downloaded_ Title_", "video.webm");
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].options).toEqual({ shell: true, stdio: ["ignore", "pipe", "pipe"] });
    expect(spawnCalls[0].command).toContain("python -m yt_dlp --no-playlist --write-info-json");
    expect(spawnCalls[0].command).toContain('--format "bv*[height<=1440]+ba/b[height<=1440]"');
    expect(spawnCalls[0].command).toContain(`--output "${path.join(outputDir, "video.%(ext)s")}"`);
    expect(spawnCalls[0].command).toContain(`"${job.youtube_url}"`);
    expect(result).toEqual({
      video_path: expectedVideoPath,
      metadata_path: infoPath,
    });
    expect(fs.existsSync(expectedVideoPath)).toBe(true);
    expect(statusUpdateValues("job-download")).toEqual([JobStatus.DOWNLOADING]);
    expect(savedJobsFor("job-download")).toEqual([
      expect.objectContaining({
        job_id: "job-download",
        status: JobStatus.DOWNLOADED,
        source_video_path: expectedVideoPath,
        video_name: "Downloaded: Title?",
      }),
    ]);
    expect(taskLogLines.filter((entry) => entry.task === "ingest").map((entry) => entry.line)).toContain(
      "line one",
    );
    expect(taskLogLines.filter((entry) => entry.task === "ingest").map((entry) => entry.line)).toContain(
      "partial",
    );
    expect(taskLogLines.filter((entry) => entry.task === "ingest").map((entry) => entry.line)).toContain(
      "err one",
    );
  });

  test("yt-dlp failure creates dummy video and info, renames by dummy title, and still saves DOWNLOADED", async () => {
    const job = putJob(makeJob("job-dummy"));
    spawnScenario = "failure";
    spawnStderrChunks = ["download failed\n"];

    const result = await ingestVideo(job);

    const expectedVideoPath = path.join(mediaRoot, "Dummy Video for Testing", "video.mp4");
    const infoPath = sourceVideoInfoPath("job-dummy");
    expect(spawnCalls).toHaveLength(1);
    expect(result).toEqual({
      video_path: expectedVideoPath,
      metadata_path: infoPath,
    });
    expect(fs.readFileSync(expectedVideoPath, "utf-8")).toBe("dummy-mp4");
    expect(JSON.parse(fs.readFileSync(infoPath, "utf-8"))).toEqual({
      id: "dummy",
      title: "Dummy Video for Testing",
      ext: "mp4",
      url: job.youtube_url,
    });
    expect(statusUpdateValues("job-dummy")).toEqual([JobStatus.DOWNLOADING]);
    expect(savedJobsFor("job-dummy")).toEqual([
      expect.objectContaining({
        job_id: "job-dummy",
        status: JobStatus.DOWNLOADED,
        source_video_path: expectedVideoPath,
        video_name: "Dummy Video for Testing",
      }),
    ]);
    expect(taskLogLines.filter((entry) => entry.task === "ingest").map((entry) => entry.line)).toContain(
      "[ingest] ERROR executing yt-dlp",
    );
    expect(taskLogLines.filter((entry) => entry.task === "ingest").map((entry) => entry.line)).toContain(
      "[ingest] Dummy flow completed",
    );
  });

  test("critical persistence errors mark ERROR and rethrow with ingestion failed prefix", async () => {
    const job = putJob(makeJob("job-critical"));
    const outputDir = path.dirname(sourceVideoOutputTemplate(job.job_id));
    const infoPath = sourceVideoInfoPath(job.job_id);
    fs.writeFileSync(infoPath, JSON.stringify({ title: "Critical Title" }), "utf-8");
    fs.writeFileSync(path.join(outputDir, "video.mp4"), "downloaded", "utf-8");
    failSave = true;

    await expect(ingestVideo(job)).rejects.toThrow("Ingestion failed: save failed");

    expect(statusUpdateValues("job-critical")).toEqual([
      JobStatus.DOWNLOADING,
      JobStatus.ERROR,
    ]);
    expect(savedJobsFor("job-critical")).toEqual([]);
    expect(taskLogLines.filter((entry) => entry.task === "ingest").map((entry) => entry.line)).toContain(
      "[ingest] CRITICAL ERROR",
    );
  });
});
