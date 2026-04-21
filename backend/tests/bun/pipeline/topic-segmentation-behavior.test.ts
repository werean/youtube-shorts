import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JobStatus, type Job } from "../../../src/models/job";
import type { SemanticBlock } from "../../../src/models/semantic_block";

let tempRoot = "";
const jobs = new Map<string, Job>();
const statusUpdates: Array<{ jobId: string; status: JobStatus }> = [];
const savedJobs: Job[] = [];
const fetchEmbeddingCalls: Array<{ texts: string[]; model: string }> = [];
const detectEmbeddingCalls: Array<{
  blockIds: string[];
  embeddings: number[][];
  threshold: number;
}> = [];
let embeddingResponse: number[][] = [];
let embeddingBoundaryIds: string[] = [];
let embeddingError: Error | null = null;

function jobDir(jobId: string): string {
  return path.join(tempRoot, jobId);
}

function semanticBlocksPath(jobId: string): string {
  return path.join(jobDir(jobId), "semantic.blocks.json");
}

function topicSegmentsPath(jobId: string): string {
  return path.join(jobDir(jobId), "topic.segments.json");
}

function makeJob(jobId: string, status: JobStatus = JobStatus.ANALYZING): Job {
  return {
    job_id: jobId,
    youtube_url: "https://example.com/video",
    status,
    created_at: "2026-04-21T00:00:00.000Z",
    video_duration_seconds: 60,
  };
}

function loadJobMock(jobId: string): Job {
  if (!jobs.has(jobId)) {
    jobs.set(jobId, makeJob(jobId));
  }

  return { ...jobs.get(jobId)! };
}

function saveJobMock(job: Job): string {
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

function writeSemanticBlocks(jobId: string, blocks: SemanticBlock[]): void {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(semanticBlocksPath(jobId), JSON.stringify(blocks), "utf-8");
}

function readTopicSegments(jobId: string) {
  return JSON.parse(fs.readFileSync(topicSegmentsPath(jobId), "utf-8"));
}

function statusUpdateValues(jobId: string): JobStatus[] {
  return statusUpdates.filter((entry) => entry.jobId === jobId).map((entry) => entry.status);
}

function savedStatusValues(jobId: string): JobStatus[] {
  return savedJobs.filter((entry) => entry.job_id === jobId).map((entry) => entry.status);
}

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
  saveJob: saveJobMock,
  updateJobStatus: updateJobStatusMock,
}));

mock.module("../../../src/storage/files", () => ({
  semanticBlocksPath,
  topicSegmentsPath,
}));

mock.module("../../../src/pipeline/embedding", () => ({
  fetchEmbeddings: async (texts: string[], model: string) => {
    fetchEmbeddingCalls.push({ texts, model });
    if (embeddingError) {
      throw embeddingError;
    }
    return embeddingResponse;
  },
  detectEmbeddingBoundaries: (
    blocks: SemanticBlock[],
    embeddings: number[][],
    threshold: number,
  ) => {
    detectEmbeddingCalls.push({
      blockIds: blocks.map((block) => block.block_id),
      embeddings,
      threshold,
    });
    return new Set(embeddingBoundaryIds);
  },
}));

const { buildTopicSegments, buildTopicSegmentsForJob } = await import(
  "../../../src/pipeline/topic_segmentation"
);

describe("topic segmentation pipeline behavior", () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-topics-"));
    jobs.clear();
    statusUpdates.length = 0;
    savedJobs.length = 0;
    fetchEmbeddingCalls.length = 0;
    detectEmbeddingCalls.length = 0;
    embeddingResponse = [];
    embeddingBoundaryIds = [];
    embeddingError = null;
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("missing semantic blocks marks BUILDING_TOPICS and throws before persistence or embeddings", async () => {
    await expect(buildTopicSegments("job-missing-blocks", true)).rejects.toThrow(
      "Semantic blocks not found for job job-missing-blocks. Run buildSemanticBlocks first.",
    );

    expect(statusUpdateValues("job-missing-blocks")).toEqual([JobStatus.BUILDING_TOPICS]);
    expect(savedStatusValues("job-missing-blocks")).toEqual([]);
    expect(fetchEmbeddingCalls).toEqual([]);
    expect(detectEmbeddingCalls).toEqual([]);
    expect(fs.existsSync(topicSegmentsPath("job-missing-blocks"))).toBe(false);
  });

  test("empty semantic blocks throw after status update without writing output or marking ERROR", async () => {
    writeSemanticBlocks("job-empty-blocks", []);

    await expect(buildTopicSegments("job-empty-blocks", false)).rejects.toThrow(
      "No semantic blocks available for job job-empty-blocks",
    );

    expect(statusUpdateValues("job-empty-blocks")).toEqual([JobStatus.BUILDING_TOPICS]);
    expect(savedStatusValues("job-empty-blocks")).toEqual([]);
    expect(fs.existsSync(topicSegmentsPath("job-empty-blocks"))).toBe(false);
  });

  test("heuristic segmentation uses pause and question boundaries, preserves lowercase continuations, merges short topics, and persists output", async () => {
    writeSemanticBlocks("job-heuristic", [
      {
        block_id: "b1",
        start: 0,
        end: 100,
        text: "Intro complete.",
        segment_ids: ["s1"],
      },
      {
        block_id: "b2",
        start: 103,
        end: 200,
        text: "Can this split?",
        segment_ids: ["s2"],
      },
      {
        block_id: "b3",
        start: 201.2,
        end: 320,
        text: "Answer begins.",
        segment_ids: ["s3"],
      },
      {
        block_id: "b4",
        start: 323,
        end: 420,
        text: "lowercase continuation.",
        segment_ids: ["s4"],
      },
      {
        block_id: "b5",
        start: 430,
        end: 500,
        text: "Short ending topic.",
        segment_ids: ["s5"],
      },
    ]);

    const topics = await buildTopicSegmentsForJob("job-heuristic");

    expect(topics).toEqual([
      {
        topic_id: "t1",
        start: 0,
        end: 100,
        block_ids: ["b1"],
        blockCount: 1,
        durationSeconds: 100,
      },
      {
        topic_id: "t2",
        start: 103,
        end: 200,
        block_ids: ["b2"],
        blockCount: 1,
        durationSeconds: 97,
      },
      {
        topic_id: "t3",
        start: 201.2,
        end: 500,
        block_ids: ["b3", "b4", "b5"],
        blockCount: 3,
        durationSeconds: 298.8,
      },
    ]);
    expect(readTopicSegments("job-heuristic")).toEqual(topics);
    expect(statusUpdateValues("job-heuristic")).toEqual([JobStatus.BUILDING_TOPICS]);
    expect(savedStatusValues("job-heuristic")).toEqual([JobStatus.ANALYZING]);
    expect(fetchEmbeddingCalls).toEqual([]);
    expect(detectEmbeddingCalls).toEqual([]);
  });

  test("embedding-assisted segmentation adds embedding boundaries to heuristic boundaries", async () => {
    const blocks: SemanticBlock[] = [
      {
        block_id: "b1",
        start: 0,
        end: 120,
        text: "Opening topic.",
        segment_ids: ["s1"],
      },
      {
        block_id: "b2",
        start: 120.5,
        end: 240,
        text: "Different topic.",
        segment_ids: ["s2"],
      },
      {
        block_id: "b3",
        start: 241,
        end: 360,
        text: "Third topic.",
        segment_ids: ["s3"],
      },
    ];
    writeSemanticBlocks("job-embeddings", blocks);
    embeddingResponse = [[1, 0], [0, 1], [1, 0]];
    embeddingBoundaryIds = ["b2", "b3"];

    const topics = await buildTopicSegments("job-embeddings", true, "custom-embed", 0.42);

    expect(fetchEmbeddingCalls).toEqual([
      {
        texts: ["Opening topic.", "Different topic.", "Third topic."],
        model: "custom-embed",
      },
    ]);
    expect(detectEmbeddingCalls).toEqual([
      {
        blockIds: ["b1", "b2", "b3"],
        embeddings: embeddingResponse,
        threshold: 0.42,
      },
    ]);
    expect(topics.map((topic) => topic.block_ids)).toEqual([["b1"], ["b2"], ["b3"]]);
    expect(readTopicSegments("job-embeddings")).toEqual(topics);
    expect(statusUpdateValues("job-embeddings")).toEqual([JobStatus.BUILDING_TOPICS]);
    expect(savedStatusValues("job-embeddings")).toEqual([JobStatus.ANALYZING]);
  });

  test("embedding failures are wrapped and do not persist topics or mark the job ERROR", async () => {
    writeSemanticBlocks("job-embedding-failure", [
      {
        block_id: "b1",
        start: 0,
        end: 120,
        text: "Opening topic.",
        segment_ids: ["s1"],
      },
    ]);
    embeddingError = new Error("embed offline");

    await expect(
      buildTopicSegments("job-embedding-failure", true, "bad-model"),
    ).rejects.toThrow(
      "[topic_segmentation] Embedding boundary detection failed for job job-embedding-failure (model='bad-model', blocks=1): embed offline",
    );

    expect(statusUpdateValues("job-embedding-failure")).toEqual([JobStatus.BUILDING_TOPICS]);
    expect(savedStatusValues("job-embedding-failure")).toEqual([]);
    expect(fs.existsSync(topicSegmentsPath("job-embedding-failure"))).toBe(false);
  });
});
