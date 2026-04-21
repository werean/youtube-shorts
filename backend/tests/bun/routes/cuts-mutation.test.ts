import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../../src/app/createServer";
import { JobStatus, type Job } from "../../../src/models/job";
import type { Cut } from "../../../src/models/cut";

let app: FastifyInstance;
let tempRoot = "";
const jobs = new Map<string, Job>();
const savedJobs: Job[] = [];

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

function makeJob(jobId: string): Job {
  return {
    job_id: jobId,
    youtube_url: "https://example.com/video",
    status: JobStatus.DOWNLOADED,
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

function writeCuts(jobId: string, cuts: Cut[]): void {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(cutsPath(jobId), JSON.stringify(cuts, null, 2), "utf-8");
}

function readCuts(jobId: string): Cut[] {
  return JSON.parse(fs.readFileSync(cutsPath(jobId), "utf-8")) as Cut[];
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
        text: "This is a complete thought.",
        segment_ids: ["s1"],
      },
      {
        block_id: "b2",
        start: 10,
        end: 20,
        text: "Another complete thought.",
        segment_ids: ["s2"],
      },
    ]),
    "utf-8",
  );
}

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
  saveJob: saveJobMock,
  updateJobStatus: (jobId: string, status: JobStatus) => {
    const job = { ...loadJobMock(jobId), status, updated_at: new Date().toISOString() };
    saveJobMock(job);
    return job;
  },
}));

mock.module("../../../src/storage/files", () => ({
  cutsPath,
  semanticBlocksPath,
  topicSegmentsPath,
}));

mock.module("../../../src/core/toolConfigs", () => ({
  loadActiveToolConfigs: () => ({
    llm: {
      model: "test-model",
      system_prompt: "You output JSON only.",
    },
  }),
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
          title: "Generated cut",
        },
      ]);
    }
  },
}));

const { analyzeBlocks } = await import("../../../src/pipeline/analysis");
const { approveCut, rejectCut } = await import("../../../src/pipeline/curation");
const { registerCutsRoutes } = await import("../../../src/routes/jobs/registerCutsRoutes");

function baseUrl(): string {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fastify test server is not listening on a TCP port");
  }
  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function request(
  method: "GET" | "PUT" | "POST",
  routePath: string,
  payload?: unknown,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await fetch(`${baseUrl()}${routePath}`, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  return {
    statusCode: response.status,
    body: await response.json(),
  };
}

describe("cuts ownership and mutation behavior", () => {
  beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-cuts-"));
    jobs.clear();
    savedJobs.length = 0;

    app = createServer();
    registerCutsRoutes(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await app.close();
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("analysis overwrites the canonical cuts artifact with generated pending cuts", async () => {
    writeSemanticBlocks("job-analysis-cuts");
    writeCuts("job-analysis-cuts", [
      {
        cut_id: "old",
        block_ids: ["b2"],
        start: 10,
        end: 20,
        title: "Old cut",
        status: "approved",
      },
    ]);

    const result = await analyzeBlocks("job-analysis-cuts", 60);

    expect(result.cuts).toEqual([
      {
        cut_id: "c1",
        block_ids: ["b1"],
        start: 0,
        end: 10,
        title: "Generated cut",
        status: "pending",
      },
    ]);
    expect(readCuts("job-analysis-cuts")).toEqual(result.cuts);
    expect(savedJobs.at(-1)?.status).toBe(JobStatus.WAITING_APPROVAL);
  });

  test("approveCut mutates only the matching cut status and preserves ordering", () => {
    writeCuts("job-approve", [
      {
        cut_id: "c1",
        block_ids: ["b1"],
        start: 0,
        end: 10,
        title: "First",
        status: "pending",
      },
      {
        cut_id: "c2",
        block_ids: ["b2"],
        start: 10,
        end: 20,
        title: "Second",
        status: "pending",
      },
    ]);

    const approved = approveCut("job-approve", "c2");

    expect(approved).toEqual({
      cut_id: "c2",
      block_ids: ["b2"],
      start: 10,
      end: 20,
      title: "Second",
      status: "approved",
    });
    expect(readCuts("job-approve").map((cut) => [cut.cut_id, cut.status])).toEqual([
      ["c1", "pending"],
      ["c2", "approved"],
    ]);
    expect(savedJobs.at(-1)?.status).toBe(JobStatus.WAITING_APPROVAL);
  });

  test("rejectCut mutates only the matching cut status and errors without writing when missing", () => {
    const originalCuts: Cut[] = [
      {
        cut_id: "c1",
        block_ids: ["b1"],
        start: 0,
        end: 10,
        title: "First",
        status: "pending",
      },
    ];
    writeCuts("job-reject", originalCuts);

    const rejected = rejectCut("job-reject", "c1");
    expect(rejected.status).toBe("rejected");
    expect(readCuts("job-reject")[0].status).toBe("rejected");

    const afterReject = readCuts("job-reject");
    expect(() => rejectCut("job-reject", "missing")).toThrow("Cut id not found");
    expect(readCuts("job-reject")).toEqual(afterReject);
  });

  test("GET cuts returns the canonical cuts artifact as stored", async () => {
    const cuts: Cut[] = [
      {
        cut_id: "custom-2",
        block_ids: ["b2"],
        start: 20,
        end: 30,
        title: "Second in custom order",
        status: "approved",
      },
      {
        cut_id: "custom-1",
        block_ids: ["b1"],
        start: 0,
        end: 10,
        title: "First in custom order",
        status: "pending",
      },
    ];
    writeCuts("job-get", cuts);

    const response = await request("GET", "/job-get/cuts");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual(cuts);
  });

  test("PUT cuts replaces the entire canonical cuts artifact with the submitted array", async () => {
    writeCuts("job-put", [
      {
        cut_id: "c1",
        block_ids: ["b1"],
        start: 0,
        end: 10,
        title: "Original",
        status: "approved",
      },
    ]);
    const replacement: Cut[] = [
      {
        cut_id: "manual-b",
        block_ids: [],
        start: 30,
        end: 45,
        title: "Manual B",
        status: "pending",
      },
      {
        cut_id: "manual-a",
        block_ids: ["b7"],
        start: 5,
        end: 15,
        title: "Manual A",
        status: "rejected",
      },
    ];

    const response = await request("PUT", "/job-put/cuts", { cuts: replacement });

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ ok: true, cuts: replacement });
    expect(readCuts("job-put")).toEqual(replacement);
  });

  test("PUT cuts rejects non-array payloads without replacing the current artifact", async () => {
    const original: Cut[] = [
      {
        cut_id: "c1",
        block_ids: ["b1"],
        start: 0,
        end: 10,
        title: "Original",
        status: "approved",
      },
    ];
    writeCuts("job-bad-put", original);

    const response = await request("PUT", "/job-bad-put/cuts", { cuts: "not-array" });

    expect(response.statusCode).toBe(400);
    expect(response.body).toEqual({ detail: "cuts must be an array" });
    expect(readCuts("job-bad-put")).toEqual(original);
  });
});
