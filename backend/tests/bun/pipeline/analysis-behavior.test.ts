import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { JobStatus, type Job } from "../../../src/models/job";

type ChatMessage = {
  role: string;
  content: string;
};

let tempRoot = "";
const jobs = new Map<string, Job>();
const statusUpdates: Array<{ jobId: string; status: JobStatus }> = [];
const savedJobs: Job[] = [];
const chatCalls: ChatMessage[][] = [];
let chatResponses: string[] = [];

function jobDir(jobId: string): string {
  return path.join(tempRoot, jobId);
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

function writeSemanticBlocks(jobId: string): void {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(
    semanticBlocksPath(jobId),
    JSON.stringify([
      {
        block_id: "b1",
        start: 0,
        end: 40,
        text: "Strong complete thought.",
        segment_ids: ["s1"],
      },
      {
        block_id: "b2",
        start: 40,
        end: 80,
        text: "Another complete point.",
        segment_ids: ["s2"],
      },
      {
        block_id: "b3",
        start: 80,
        end: 120,
        text: "Third complete point.",
        segment_ids: ["s3"],
      },
      {
        block_id: "b4",
        start: 120,
        end: 160,
        text: "Fourth complete point.",
        segment_ids: ["s4"],
      },
      {
        block_id: "b5",
        start: 160,
        end: 200,
        text: "Fifth complete point.",
        segment_ids: ["s5"],
      },
      {
        block_id: "b6",
        start: 200,
        end: 240,
        text: "lowercase starts mid sentence.",
        segment_ids: ["s6"],
      },
      {
        block_id: "b7",
        start: 240,
        end: 280,
        text: "Ends without punctuation",
        segment_ids: ["s7"],
      },
      {
        block_id: "b8",
        start: 280,
        end: 320,
        text: "Eighth complete point.",
        segment_ids: ["s8"],
      },
    ]),
    "utf-8",
  );
}

function writeTopicSegments(jobId: string): void {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(
    topicSegmentsPath(jobId),
    JSON.stringify([
      {
        topic_id: "t1",
        start: 0,
        end: 80,
        block_ids: ["b1", "b2"],
        blockCount: 2,
        durationSeconds: 80,
      },
      {
        topic_id: "t2",
        start: 80,
        end: 160,
        block_ids: ["b3", "b4"],
        blockCount: 2,
        durationSeconds: 80,
      },
      {
        topic_id: "t3",
        start: 120,
        end: 200,
        block_ids: ["b4", "b5"],
        blockCount: 2,
        durationSeconds: 80,
      },
    ]),
    "utf-8",
  );
}

function readCuts(jobId: string) {
  return JSON.parse(fs.readFileSync(cutsPath(jobId), "utf-8"));
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
  cutsPath,
  semanticBlocksPath,
  topicSegmentsPath,
}));

mock.module("../../../src/core/toolConfigs", () => ({
  loadActiveToolConfigs: () => ({
    ffmpeg: {},
    llm: {
      model: "test-model",
      system_prompt: "custom system prompt",
    },
    whisper: {},
  }),
}));

mock.module("../../../src/llm/client", () => ({
  OllamaClient: class {
    constructor(_baseUrl?: string, public model?: string) {}

    async chat(messages: ChatMessage[]) {
      chatCalls.push(messages);
      if (chatResponses.length === 0) {
        throw new Error("No mocked chat response queued");
      }
      return chatResponses.shift()!;
    }
  },
}));

const { analyzeBlocks } = await import("../../../src/pipeline/analysis");

describe("analysis pipeline behavior", () => {
  beforeEach(() => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-analysis-"));
    jobs.clear();
    statusUpdates.length = 0;
    savedJobs.length = 0;
    chatCalls.length = 0;
    chatResponses = [];
  });

  afterEach(() => {
    if (tempRoot && fs.existsSync(tempRoot)) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("missing semantic blocks marks ANALYZING and throws before LLM or ERROR status", async () => {
    await expect(analyzeBlocks("job-missing-blocks", 60)).rejects.toThrow(
      "Semantic blocks JSON not found for job job-missing-blocks",
    );

    expect(statusUpdateValues("job-missing-blocks")).toEqual([JobStatus.ANALYZING]);
    expect(savedStatusValues("job-missing-blocks")).toEqual([]);
    expect(chatCalls).toEqual([]);
    expect(fs.existsSync(cutsPath("job-missing-blocks"))).toBe(false);
  });

  test("short analysis filters incoherent cuts, deduplicates overlaps, persists, and returns raw response", async () => {
    writeSemanticBlocks("job-short");
    chatResponses = [
      JSON.stringify([
        {
          blocks: ["b1", "b2"],
          start: 0,
          end: 80,
          score: 1,
          title: "Low score overlap",
        },
        {
          blocks: ["b2", "b3"],
          start: 40,
          end: 120,
          score: 9,
          title: "High score overlap",
        },
        {
          blocks: ["b4", "b5"],
          start: 120,
          end: 200,
          score: 2,
          hook_reason: "Hook fallback",
        },
        {
          blocks: ["b6"],
          start: 200,
          end: 240,
          score: 10,
          title: "Starts mid sentence",
        },
        {
          blocks: ["b7"],
          start: 240,
          end: 280,
          score: 10,
          title: "No punctuation",
        },
        {
          blocks: ["b1", "b3"],
          start: 0,
          end: 120,
          score: 10,
          title: "Gap in blocks",
        },
      ]),
    ];

    const result = await analyzeBlocks("job-short", 60);

    expect(result.cuts).toEqual([
      {
        cut_id: "c1",
        block_ids: ["b2", "b3"],
        start: 40,
        end: 120,
        title: "High score overlap",
        status: "pending",
      },
      {
        cut_id: "c2",
        block_ids: ["b4", "b5"],
        start: 120,
        end: 200,
        title: "Hook fallback",
        status: "pending",
      },
    ]);
    expect(JSON.parse(result.raw_response)).toHaveLength(6);
    expect(readCuts("job-short")).toEqual(result.cuts);
    expect(statusUpdateValues("job-short")).toEqual([JobStatus.ANALYZING]);
    expect(savedStatusValues("job-short")).toEqual([JobStatus.WAITING_APPROVAL]);

    expect(chatCalls).toHaveLength(1);
    expect(chatCalls[0].map((message) => message.role)).toEqual(["system", "system", "user"]);
    expect(chatCalls[0][0].content).toBe("custom system prompt");
    expect(chatCalls[0][1].content).toBe("You output JSON only.");
    expect(chatCalls[0][2].content).toContain("b1 [0.00-40.00]: Strong complete thought.");
    expect(chatCalls[0][2].content).toContain("b8 [280.00-320.00]: Eighth complete point.");
  });

  test("medium analysis loads topic segments and runs one full pass per topic without pass 1", async () => {
    writeSemanticBlocks("job-medium");
    writeTopicSegments("job-medium");
    chatResponses = [
      JSON.stringify([{ blocks: ["b1", "b2"], start: 0, end: 80, score: 1, title: "Topic one" }]),
      JSON.stringify([
        { blocks: ["b3", "b4"], start: 80, end: 160, score: 1, title: "Topic two" },
      ]),
      JSON.stringify([
        { blocks: ["b4", "b5"], start: 120, end: 200, score: 1, title: "Topic three" },
      ]),
    ];

    const result = await analyzeBlocks("job-medium", 1800);

    expect(result.cuts.map((cut) => cut.title)).toEqual(["Topic one", "Topic two"]);
    expect(JSON.parse(result.raw_response).map((cut: { title: string }) => cut.title)).toEqual([
      "Topic one",
      "Topic two",
      "Topic three",
    ]);
    expect(chatCalls).toHaveLength(3);
    expect(chatCalls.every((call) => call.length === 3)).toBe(true);
    expect(chatCalls[0][2].content).toContain("b1 [0.00-40.00]");
    expect(chatCalls[0][2].content).toContain("b2 [40.00-80.00]");
    expect(chatCalls[0][2].content).not.toContain("b3 [80.00-120.00]");
    expect(chatCalls[1][2].content).toContain("b3 [80.00-120.00]");
    expect(chatCalls[1][2].content).toContain("b4 [120.00-160.00]");
    expect(chatCalls[2][2].content).toContain("b4 [120.00-160.00]");
    expect(chatCalls[2][2].content).toContain("b5 [160.00-200.00]");
    expect(readCuts("job-medium")).toEqual(result.cuts);
    expect(savedStatusValues("job-medium")).toEqual([JobStatus.WAITING_APPROVAL]);
  });

  test("long analysis runs pass 1 candidacy and only fully analyzes accepted topics", async () => {
    writeSemanticBlocks("job-long");
    writeTopicSegments("job-long");
    chatResponses = [
      JSON.stringify({ is_candidate: false }),
      "not-json",
      JSON.stringify({ is_candidate: true }),
      JSON.stringify([
        { blocks: ["b4", "b5"], start: 120, end: 200, score: 7, title: "Accepted topic" },
      ]),
    ];

    const result = await analyzeBlocks("job-long", 4000);

    expect(result.cuts).toEqual([
      {
        cut_id: "c1",
        block_ids: ["b4", "b5"],
        start: 120,
        end: 200,
        title: "Accepted topic",
        status: "pending",
      },
    ]);
    expect(chatCalls).toHaveLength(4);
    expect(chatCalls[0].map((message) => message.role)).toEqual(["system", "user"]);
    expect(chatCalls[0][0].content).toBe("You output JSON only.");
    expect(chatCalls[0][1].content).toContain("Topic: t1");
    expect(chatCalls[1][1].content).toContain("Topic: t2");
    expect(chatCalls[2][1].content).toContain("Topic: t3");
    expect(chatCalls[3].map((message) => message.role)).toEqual(["system", "system", "user"]);
    expect(chatCalls[3][2].content).toContain("b4 [120.00-160.00]");
    expect(chatCalls[3][2].content).toContain("b5 [160.00-200.00]");
    expect(readCuts("job-long")).toEqual(result.cuts);
    expect(savedStatusValues("job-long")).toEqual([JobStatus.WAITING_APPROVAL]);
  });

  test("invalid full-pass JSON throws without persisting cuts or marking ERROR", async () => {
    writeSemanticBlocks("job-invalid-json");
    chatResponses = ["not-json"];

    await expect(analyzeBlocks("job-invalid-json", 60)).rejects.toThrow(
      "LLM response is not valid JSON. Raw: not-json",
    );

    expect(statusUpdateValues("job-invalid-json")).toEqual([JobStatus.ANALYZING]);
    expect(savedStatusValues("job-invalid-json")).toEqual([]);
    expect(fs.existsSync(cutsPath("job-invalid-json"))).toBe(false);
  });
});
