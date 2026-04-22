import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { AddressInfo } from "net";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../../src/app/createServer";

let app: FastifyInstance;
const durationsByJobId = new Map<string, number>();

const loadJobMock = mock((jobId: string) => ({
  job_id: jobId,
  youtube_url: "https://example.com/video",
  status: "DOWNLOADED",
  created_at: "2026-04-21T00:00:00.000Z",
  video_duration_seconds: durationsByJobId.get(jobId) ?? 1800,
}));

const transcribeJobMock = mock(async () => undefined);
const buildSemanticBlocksMock = mock(async () => []);
const buildTopicSegmentsMock = mock(async () => []);
const analyzeBlocksMock = mock(async () => ({ cuts: [], raw_response: "[]" }));
const renderSuggestedCutsMock = mock(async () => []);

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
}));

mock.module("../../../src/storage/files", () => ({
  cutsPath: () => "unused-cuts-path.json",
  semanticBlocksPath: () => "unused-semantic-blocks-path.json",
}));

mock.module("../../../src/pipeline/transcription", () => ({
  transcribeJob: transcribeJobMock,
}));

mock.module("../../../src/pipeline/semantic_blocks", () => ({
  buildSemanticBlocks: buildSemanticBlocksMock,
}));

mock.module("../../../src/pipeline/topic_segmentation", () => ({
  buildTopicSegments: buildTopicSegmentsMock,
}));

mock.module("../../../src/pipeline/analysis", () => ({
  analyzeBlocks: analyzeBlocksMock,
}));

mock.module("../../../src/pipeline/rendering", () => ({
  renderSuggestedCuts: renderSuggestedCutsMock,
}));

mock.module("../../../src/core/toolConfigs", () => ({
  loadActiveToolConfigs: () => ({
    llm: {
      embedding_model: "test-embed-model",
    },
  }),
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
): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  const response = await fetch(`${baseUrl()}${routePath}`, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  return {
    statusCode: response.status,
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function waitForBatchDone(batchId: string): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await request("GET", `/batch/${batchId}/status`);
    expect(response.statusCode).toBe(200);

    if (response.body.is_running === false) {
      return response.body;
    }

    await Bun.sleep(20);
  }

  throw new Error("Batch did not complete");
}

describe("batch analysis prerequisites", () => {
  beforeEach(async () => {
    loadJobMock.mockClear();
    transcribeJobMock.mockClear();
    buildSemanticBlocksMock.mockClear();
    buildTopicSegmentsMock.mockClear();
    analyzeBlocksMock.mockClear();
    renderSuggestedCutsMock.mockClear();
    durationsByJobId.clear();

    app = createServer();
    registerBatchPipelineRoutes(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await app.close();
  });

  test("always builds semantic blocks before batch analysis when analysis is enabled", async () => {
    durationsByJobId.set("job-batch", 60);

    const startResponse = await request("POST", "/batch/run", {
      job_ids: ["job-batch"],
      options: {
        transcription: false,
        analysis: true,
        render: false,
        preApprove: false,
      },
    });

    expect(startResponse.statusCode).toBe(200);
    const finalProgress = await waitForBatchDone(String(startResponse.body.batch_id));

    expect(finalProgress).toMatchObject({
      current_job_id: "job-batch",
      current_step: "completed",
      completed_jobs: ["job-batch"],
      failed_jobs: [],
      is_running: false,
    });
    expect(transcribeJobMock).not.toHaveBeenCalled();
    expect(buildSemanticBlocksMock).toHaveBeenCalledWith("job-batch");
    expect(buildTopicSegmentsMock).not.toHaveBeenCalled();
    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-batch", 60);
  });

  test("does not prepare topic segments before batch analysis for short videos", async () => {
    durationsByJobId.set("job-batch-short", 60);

    const startResponse = await request("POST", "/batch/run", {
      job_ids: ["job-batch-short"],
      options: {
        transcription: false,
        analysis: true,
        render: false,
        preApprove: false,
      },
    });

    expect(startResponse.statusCode).toBe(200);
    await waitForBatchDone(String(startResponse.body.batch_id));

    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-batch-short", 60);
    expect(buildTopicSegmentsMock).not.toHaveBeenCalled();
  });

  test("prepares topic segments before batch analysis for medium videos", async () => {
    const startResponse = await request("POST", "/batch/run", {
      job_ids: ["job-batch-medium"],
      options: {
        transcription: false,
        analysis: true,
        render: false,
        preApprove: false,
      },
    });

    expect(startResponse.statusCode).toBe(200);
    await waitForBatchDone(String(startResponse.body.batch_id));

    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-batch-medium", 1800);
    expect(buildTopicSegmentsMock).toHaveBeenCalledWith(
      "job-batch-medium",
      true,
      "test-embed-model",
    );
  });

  test("prepares topic segments before batch analysis for long videos", async () => {
    durationsByJobId.set("job-batch-long", 4000);

    const startResponse = await request("POST", "/batch/run", {
      job_ids: ["job-batch-long"],
      options: {
        transcription: false,
        analysis: true,
        render: false,
        preApprove: false,
      },
    });

    expect(startResponse.statusCode).toBe(200);
    await waitForBatchDone(String(startResponse.body.batch_id));

    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-batch-long", 4000);
    expect(buildTopicSegmentsMock).toHaveBeenCalledWith(
      "job-batch-long",
      true,
      "test-embed-model",
    );
  });
});
