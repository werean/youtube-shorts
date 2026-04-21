import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JobStatus, type Job } from "../../../src/models/job";

let tempRoot = "";
let sourceVideoPath: string | null = null;
const jobs = new Map<string, Job>();
const statusUpdates: Array<{ jobId: string; status: JobStatus }> = [];
const savedStatuses: Array<{ jobId: string; status: JobStatus }> = [];

function jobDir(jobId: string): string {
  return path.join(tempRoot, jobId);
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
  savedStatuses.push({ jobId: job.job_id, status: job.status });
}

function updateJobStatusMock(jobId: string, status: JobStatus): Job {
  const job = { ...loadJobMock(jobId), status, updated_at: new Date().toISOString() };
  jobs.set(jobId, job);
  statusUpdates.push({ jobId, status });
  return { ...job };
}

function transcriptionPath(jobId: string): string {
  return path.join(jobDir(jobId), "transcription.segments.json");
}

function semanticBlocksPath(jobId: string): string {
  return path.join(jobDir(jobId), "semantic.blocks.json");
}

function topicSegmentsPath(jobId: string): string {
  return path.join(jobDir(jobId), "topic.segments.json");
}

function cutsPath(jobId: string): string {
  return path.join(jobDir(jobId), "cuts.suggested.json");
}

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
  saveJob: saveJobMock,
  updateJobStatus: updateJobStatusMock,
}));

mock.module("../../../src/storage/files", () => ({
  buildCutFilename: (start: number, end: number) => `${start}-${end}.mp4`,
  cutsPath,
  ensureShortsJobDir: (jobId: string) => {
    const shortsDir = path.join(jobDir(jobId), "shorts");
    fs.mkdirSync(shortsDir, { recursive: true });
    return shortsDir;
  },
  ensureTranscriptionsJobDir: (jobId: string) => {
    const transcriptionsDir = path.join(jobDir(jobId), "transcriptions");
    fs.mkdirSync(transcriptionsDir, { recursive: true });
    return transcriptionsDir;
  },
  findSourceVideo: () => sourceVideoPath,
  listRenderOutputUrls: () => [],
  removeTranscriptionsJobDir: (jobId: string) => {
    const transcriptionsDir = path.join(jobDir(jobId), "transcriptions");
    fs.rmSync(transcriptionsDir, { recursive: true, force: true });
    return transcriptionsDir;
  },
  renderOutputUrl: (jobId: string, cutId: string) => `/media/shorts/${jobId}/${cutId}.mp4`,
  semanticBlocksPath,
  topicSegmentsPath,
  transcriptionPath,
  transcriptionTextPath: (jobId: string) => path.join(jobDir(jobId), "transcription.txt"),
  transcriptionVttPath: (jobId: string) => path.join(jobDir(jobId), "transcription.vtt"),
}));

mock.module("../../../src/core/toolConfigs", () => ({
  loadActiveToolConfigs: () => ({
    ffmpeg: {},
    llm: {
      model: "test-model",
      system_prompt: "You output JSON only.",
    },
    whisper: {
      device: "cpu",
      model: "tiny",
      output_format: ["json"],
    },
  }),
}));

mock.module("../../../src/core/taskLogs", () => ({
  appendTaskLog: () => undefined,
  appendTaskLogs: () => undefined,
  clearTaskLogs: () => undefined,
}));

mock.module("../../../src/llm/client", () => ({
  OllamaClient: class {
    async chat() {
      return JSON.stringify([
        {
          blocks: ["b1"],
          start: 0,
          end: 10,
          score: 1,
          title: "Valid cut",
        },
      ]);
    }
  },
}));

mock.module("../../../src/video/ffmpeg", () => ({
  runFfmpegAsync: async () => undefined,
}));

mock.module("../../../src/video/vertical", () => ({
  buildVerticalNvencCommand: () => ["ffmpeg", "-version"],
}));

const { transcribeJob } = await import("../../../src/pipeline/transcription");
const { buildSemanticBlocks } = await import("../../../src/pipeline/semantic_blocks");
const { buildTopicSegments } = await import("../../../src/pipeline/topic_segmentation");
const { analyzeBlocks } = await import("../../../src/pipeline/analysis");
const { renderSuggestedCuts } = await import("../../../src/pipeline/rendering");

function writeSegments(jobId: string): void {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(
    transcriptionPath(jobId),
    JSON.stringify([
      { segment_id: "s1", start: 0, end: 6, text: "Hello world." },
      { segment_id: "s2", start: 6.2, end: 12, text: "This is a second sentence." },
    ]),
    "utf-8",
  );
}

function writeSemanticBlocks(jobId: string): void {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(
    semanticBlocksPath(jobId),
    JSON.stringify([
      {
        block_id: "b1",
        start: 0,
        end: 10,
        text: "Hello world.",
        segment_ids: ["s1"],
      },
    ]),
    "utf-8",
  );
}

function writeCuts(jobId: string): void {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(
    cutsPath(jobId),
    JSON.stringify([
      {
        cut_id: "c1",
        block_ids: ["b1"],
        start: 0,
        end: 10,
        title: "Valid cut",
        status: "pending",
      },
    ]),
    "utf-8",
  );
}

function statusUpdateValues(jobId: string): JobStatus[] {
  return statusUpdates.filter((entry) => entry.jobId === jobId).map((entry) => entry.status);
}

function savedStatusValues(jobId: string): JobStatus[] {
  return savedStatuses.filter((entry) => entry.jobId === jobId).map((entry) => entry.status);
}

describe("pipeline job status transitions", () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-status-"));
    sourceVideoPath = null;
    jobs.clear();
    statusUpdates.length = 0;
    savedStatuses.length = 0;
  });

  test("transcription sets TRANSCRIBING before source video lookup", async () => {
    await expect(transcribeJob("job-transcription-missing")).rejects.toThrow(
      "Source video not found for job",
    );

    expect(statusUpdateValues("job-transcription-missing")).toEqual([JobStatus.TRANSCRIBING]);
    expect(savedStatusValues("job-transcription-missing")).toEqual([]);
  });

  test("semantic blocks move from BUILDING_BLOCKS to ANALYZING", () => {
    writeSegments("job-blocks");

    buildSemanticBlocks("job-blocks");

    expect(statusUpdateValues("job-blocks")).toEqual([JobStatus.BUILDING_BLOCKS]);
    expect(savedStatusValues("job-blocks")).toEqual([JobStatus.ANALYZING]);
  });

  test("topic segmentation moves from BUILDING_TOPICS to ANALYZING", async () => {
    writeSemanticBlocks("job-topics");

    await buildTopicSegments("job-topics", false);

    expect(statusUpdateValues("job-topics")).toEqual([JobStatus.BUILDING_TOPICS]);
    expect(savedStatusValues("job-topics")).toEqual([JobStatus.ANALYZING]);
  });

  test("analysis moves from ANALYZING to WAITING_APPROVAL", async () => {
    writeSemanticBlocks("job-analysis");

    await analyzeBlocks("job-analysis", 60);

    expect(statusUpdateValues("job-analysis")).toEqual([JobStatus.ANALYZING]);
    expect(savedStatusValues("job-analysis")).toEqual([JobStatus.WAITING_APPROVAL]);
  });

  test("rendering moves from RENDERING to DONE on success", async () => {
    sourceVideoPath = path.join(tempRoot, "source.mp4");
    fs.writeFileSync(sourceVideoPath, "not a real video", "utf-8");
    writeCuts("job-render");

    await renderSuggestedCuts("job-render");

    expect(statusUpdateValues("job-render")).toEqual([JobStatus.RENDERING, JobStatus.DONE]);
    expect(savedStatusValues("job-render")).toEqual([]);
  });
});
