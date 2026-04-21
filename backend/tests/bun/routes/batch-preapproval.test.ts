import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../../src/app/createServer";

const pendingCuts = [
  {
    cut_id: "c1",
    block_ids: ["b1", "b2"],
    start: 12,
    end: 42,
    title: "First pending cut",
    status: "pending",
  },
];

let app: FastifyInstance;
let tempRoot = "";
let currentJobId = "";

function jobDir(jobId: string): string {
  return path.join(tempRoot, "jobs", jobId);
}

function canonicalCutsPath(jobId: string): string {
  return path.join(jobDir(jobId), "cuts.suggested.json");
}

const loadJobMock = mock((jobId: string) => ({
  job_id: jobId,
  youtube_url: "https://example.com/video",
  status: "DOWNLOADED",
  created_at: "2026-04-21T00:00:00.000Z",
  video_duration_seconds: 120,
}));

const transcribeJobMock = mock(async () => undefined);
const buildSemanticBlocksMock = mock(async () => []);
const analyzeBlocksMock = mock(async (jobId: string) => {
  fs.mkdirSync(jobDir(jobId), { recursive: true });
  fs.writeFileSync(canonicalCutsPath(jobId), JSON.stringify(pendingCuts, null, 2), "utf-8");
  return { cuts: pendingCuts, raw_response: "[]" };
});
const renderSuggestedCutsMock = mock(async () => []);

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
}));

mock.module("../../../src/storage/files", () => ({
  cutsPath: canonicalCutsPath,
  semanticBlocksPath: () => "unused-semantic-blocks-path.json",
}));

mock.module("../../../src/pipeline/transcription", () => ({
  transcribeJob: transcribeJobMock,
}));

mock.module("../../../src/pipeline/semantic_blocks", () => ({
  buildSemanticBlocks: buildSemanticBlocksMock,
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

async function startBatchWithPreApproval(): Promise<string> {
  const response = await request("POST", "/batch/run", {
    job_ids: [currentJobId],
    options: {
      transcription: false,
      analysis: true,
      render: false,
      preApprove: true,
    },
  });

  expect(response.statusCode).toBe(200);
  const body = response.body as { batch_id: string; status: string };
  expect(body).toEqual({ batch_id: expect.any(String), status: "started" });
  return body.batch_id;
}

async function request(
  method: "GET" | "POST",
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

function baseUrl(): string {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fastify test server is not listening on a TCP port");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function waitForApproval(batchId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await request("GET", `/batch/${batchId}/status`);

    expect(response.statusCode).toBe(200);
    const progress = response.body as Record<string, unknown>;
    if (progress.current_step === "waiting_approval") {
      return progress;
    }

    await Bun.sleep(20);
  }

  throw new Error("Batch did not reach waiting_approval");
}

async function continueBatch(batchId: string): Promise<void> {
  const continueResponse = await request("POST", `/batch/${batchId}/continue`);
  expect(continueResponse.statusCode).toBe(200);

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const statusResponse = await request("GET", `/batch/${batchId}/status`);
    expect(statusResponse.statusCode).toBe(200);

    const progress = statusResponse.body as Record<string, unknown>;
    if (progress.is_running === false) {
      return;
    }

    await Bun.sleep(25);
  }

  throw new Error("Batch did not stop after continue");
}

describe("batch pre-approval pending cuts", () => {
  beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-batch-"));
    currentJobId = `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    loadJobMock.mockClear();
    transcribeJobMock.mockClear();
    buildSemanticBlocksMock.mockClear();
    analyzeBlocksMock.mockClear();
    renderSuggestedCutsMock.mockClear();

    app = createServer();
    registerBatchPipelineRoutes(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await app.close();

    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("moves the batch into waiting approval after analysis with the existing response shape", async () => {
    const batchId = await startBatchWithPreApproval();
    let progress: Record<string, unknown>;

    try {
      progress = await waitForApproval(batchId);
    } finally {
      await continueBatch(batchId);
    }

    expect(progress).toMatchObject({
      current_job_index: 0,
      current_job_id: currentJobId,
      current_step: "waiting_approval",
      completed_jobs: [],
      failed_jobs: [],
      is_running: true,
      waiting_for_approval: true,
    });
    expect(buildSemanticBlocksMock).toHaveBeenCalledWith(currentJobId);
    expect(analyzeBlocksMock).toHaveBeenCalledWith(currentJobId, 120);
    expect(renderSuggestedCutsMock).not.toHaveBeenCalled();
  });

  test("loads pending cuts from the canonical cuts.suggested.json artifact", async () => {
    const batchId = await startBatchWithPreApproval();
    let progress: Record<string, unknown>;

    try {
      progress = await waitForApproval(batchId);
    } finally {
      await continueBatch(batchId);
    }

    expect(fs.existsSync(canonicalCutsPath(currentJobId))).toBe(true);
    expect(fs.existsSync(path.join(jobDir(currentJobId), "cuts.json"))).toBe(false);
    expect(progress.pending_cuts).toEqual(pendingCuts);
  });
});
