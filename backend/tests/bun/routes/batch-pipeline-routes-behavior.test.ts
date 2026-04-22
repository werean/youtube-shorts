import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../../src/app/createServer";

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

let app: FastifyInstance;
let tempRoot = "";
let callLog: string[] = [];
let analysisFailures = new Map<string, Error>();
let transcribeDeferred: Deferred<void> | null = null;

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function jobDir(jobId: string): string {
  return path.join(tempRoot, jobId);
}

function canonicalCutsPath(jobId: string): string {
  return path.join(jobDir(jobId), "cuts.suggested.json");
}

const loadJobMock = mock((jobId: string) => ({
  job_id: jobId,
  youtube_url: "https://example.com/video",
  status: "DOWNLOADED",
  created_at: "2026-04-21T00:00:00.000Z",
  video_duration_seconds: jobId === "job-no-duration" ? undefined : 321,
}));

const transcribeJobMock = mock(async (jobId: string) => {
  callLog.push(`transcribe:${jobId}`);
  if (transcribeDeferred) {
    await transcribeDeferred.promise;
  }
});

const buildSemanticBlocksForAnalysisMock = mock(async (jobId: string) => {
  callLog.push(`blocks:${jobId}`);
  return [];
});

const analyzeBlocksMock = mock(async (jobId: string, duration: number) => {
  callLog.push(`analysis:${jobId}:${duration}`);
  const failure = analysisFailures.get(jobId);
  if (failure) {
    throw failure;
  }

  fs.mkdirSync(jobDir(jobId), { recursive: true });
  const cuts = [
    {
      cut_id: "c1",
      block_ids: ["b1"],
      start: 1,
      end: 5,
      title: `Cut for ${jobId}`,
      status: "pending",
    },
  ];
  fs.writeFileSync(canonicalCutsPath(jobId), JSON.stringify(cuts, null, 2), "utf-8");
  return { cuts, raw_response: "[]" };
});

const renderSuggestedCutsMock = mock(async (jobId: string) => {
  callLog.push(`render:${jobId}`);
  return [];
});

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
}));

mock.module("../../../src/storage/files", () => ({
  cutsPath: canonicalCutsPath,
}));

mock.module("../../../src/pipeline/transcription", () => ({
  transcribeJob: transcribeJobMock,
}));

mock.module("../../../src/pipeline/analysis_prerequisites", () => ({
  buildSemanticBlocksForAnalysis: buildSemanticBlocksForAnalysisMock,
  prepareAnalysisPrerequisites: async (job: { job_id: string }) =>
    buildSemanticBlocksForAnalysisMock(job.job_id),
}));

mock.module("../../../src/pipeline/analysis", () => ({
  analyzeBlocks: analyzeBlocksMock,
}));

mock.module("../../../src/pipeline/rendering", () => ({
  renderSuggestedCuts: renderSuggestedCutsMock,
}));

const { registerBatchPipelineRoutes } = await import(
  "../../../src/routes/jobs/registerBatchPipelineRoutes"
);

function baseUrl(): string {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fastify test server is not listening on a TCP port");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function request(
  method: "GET" | "POST",
  routePath: string,
  payload?: unknown,
): Promise<{ statusCode: number; body: any }> {
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

async function startBatch(
  jobIds: string[],
  options: {
    transcription: boolean;
    analysis: boolean;
    render: boolean;
    preApprove: boolean;
  },
): Promise<string> {
  const response = await request("POST", "/batch/run", {
    job_ids: jobIds,
    options,
  });

  expect(response.statusCode).toBe(200);
  expect(response.body).toEqual({ batch_id: expect.any(String), status: "started" });
  return response.body.batch_id;
}

async function waitForStatus(
  batchId: string,
  predicate: (progress: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const response = await request("GET", `/batch/${batchId}/status`);
    expect(response.statusCode).toBe(200);

    const progress = response.body as Record<string, unknown>;
    if (predicate(progress)) {
      return progress;
    }

    await Bun.sleep(25);
  }

  throw new Error("Timed out waiting for batch status");
}

describe("batch pipeline route behavior", () => {
  beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-batch-routes-"));
    callLog = [];
    analysisFailures = new Map();
    transcribeDeferred = null;

    loadJobMock.mockClear();
    transcribeJobMock.mockClear();
    buildSemanticBlocksForAnalysisMock.mockClear();
    analyzeBlocksMock.mockClear();
    renderSuggestedCutsMock.mockClear();

    app = createServer();
    registerBatchPipelineRoutes(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    if (transcribeDeferred) {
      transcribeDeferred.resolve(undefined);
      transcribeDeferred = null;
    }

    await app.close();

    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("start rejects missing or empty job ids with the current 400 response shape", async () => {
    const missingResponse = await request("POST", "/batch/run", {
      options: {
        transcription: false,
        analysis: false,
        render: false,
        preApprove: false,
      },
    });
    const emptyResponse = await request("POST", "/batch/run", {
      job_ids: [],
      options: {
        transcription: false,
        analysis: false,
        render: false,
        preApprove: false,
      },
    });

    expect(missingResponse).toEqual({
      statusCode: 400,
      body: { detail: "No job IDs provided" },
    });
    expect(emptyResponse).toEqual({
      statusCode: 400,
      body: { detail: "No job IDs provided" },
    });
  });

  test("unknown batch ids return stable not-found responses for status, cancel, and continue", async () => {
    expect(await request("GET", "/batch/missing/status")).toEqual({
      statusCode: 404,
      body: { detail: "Batch process not found" },
    });
    expect(await request("POST", "/batch/missing/cancel")).toEqual({
      statusCode: 404,
      body: { detail: "Batch process not found" },
    });
    expect(await request("POST", "/batch/missing/continue")).toEqual({
      statusCode: 404,
      body: { detail: "Batch process not found" },
    });
  });

  test("continue rejects existing batches that are not waiting for approval", async () => {
    transcribeDeferred = createDeferred<void>();
    const batchId = await startBatch(["job-running"], {
      transcription: true,
      analysis: false,
      render: false,
      preApprove: false,
    });

    await waitForStatus(batchId, (progress) => progress.current_step === "transcription");

    const continueResponse = await request("POST", `/batch/${batchId}/continue`);

    expect(continueResponse).toEqual({
      statusCode: 400,
      body: { detail: "Batch is not waiting for approval" },
    });

    transcribeDeferred.resolve(undefined);
    transcribeDeferred = null;
    await waitForStatus(batchId, (progress) => progress.is_running === false);
  });

  test("runs transcription, blocks, analysis, and rendering in order and returns final progress shape", async () => {
    const batchId = await startBatch(["job-full"], {
      transcription: true,
      analysis: true,
      render: true,
      preApprove: false,
    });

    const finalProgress = await waitForStatus(batchId, (progress) => progress.is_running === false);

    expect(callLog).toEqual([
      "transcribe:job-full",
      "blocks:job-full",
      "analysis:job-full:321",
      "render:job-full",
    ]);
    expect(finalProgress).toMatchObject({
      current_job_index: 0,
      current_job_id: "job-full",
      current_step: "completed",
      completed_jobs: ["job-full"],
      failed_jobs: [],
      is_running: false,
    });
  });

  test("analysis uses duration fallback 0 when the loaded job has no duration", async () => {
    const batchId = await startBatch(["job-no-duration"], {
      transcription: false,
      analysis: true,
      render: false,
      preApprove: false,
    });

    await waitForStatus(batchId, (progress) => progress.is_running === false);

    expect(callLog).toEqual(["blocks:job-no-duration", "analysis:job-no-duration:0"]);
  });

  test("per-job failures are recorded and later jobs continue through completion accounting", async () => {
    analysisFailures.set("job-fails", new Error("analysis exploded"));

    const batchId = await startBatch(["job-fails", "job-ok"], {
      transcription: false,
      analysis: true,
      render: false,
      preApprove: false,
    });

    const finalProgress = await waitForStatus(batchId, (progress) => progress.is_running === false);

    expect(callLog).toEqual([
      "blocks:job-fails",
      "analysis:job-fails:321",
      "blocks:job-ok",
      "analysis:job-ok:321",
    ]);
    expect(finalProgress).toMatchObject({
      current_job_index: 1,
      current_job_id: "job-ok",
      current_step: "completed",
      completed_jobs: ["job-ok"],
      failed_jobs: [{ job_id: "job-fails", error: "analysis exploded" }],
      is_running: false,
    });
    expect(renderSuggestedCutsMock).not.toHaveBeenCalled();
  });

  test("cancel marks the active in-memory progress as not running with the current response shape", async () => {
    transcribeDeferred = createDeferred<void>();
    const batchId = await startBatch(["job-cancel"], {
      transcription: true,
      analysis: true,
      render: true,
      preApprove: false,
    });

    await waitForStatus(batchId, (progress) => progress.current_step === "transcription");

    const cancelResponse = await request("POST", `/batch/${batchId}/cancel`);
    const cancelledProgress = await request("GET", `/batch/${batchId}/status`);

    expect(cancelResponse).toEqual({
      statusCode: 200,
      body: { status: "cancelled" },
    });
    expect(cancelledProgress.statusCode).toBe(200);
    expect(cancelledProgress.body).toMatchObject({
      current_job_index: 0,
      current_job_id: "job-cancel",
      current_step: "transcription",
      completed_jobs: [],
      failed_jobs: [],
      is_running: false,
    });

    transcribeDeferred.resolve(undefined);
    transcribeDeferred = null;
    await waitForStatus(batchId, (progress) => progress.current_step === "completed");
  });
});
