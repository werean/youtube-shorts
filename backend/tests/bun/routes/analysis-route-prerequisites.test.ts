import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { AddressInfo } from "net";
import type { FastifyInstance } from "fastify";
import { createServer } from "../../../src/app/createServer";

let app: FastifyInstance;
let tempRoot = "";
const durationsByJobId = new Map<string, number>();

function semanticBlocksPath(jobId: string): string {
  return path.join(tempRoot, jobId, "semantic.blocks.json");
}

function cutsPath(jobId: string): string {
  return path.join(tempRoot, jobId, "cuts.suggested.json");
}

const loadJobMock = mock((jobId: string) => ({
  job_id: jobId,
  youtube_url: "https://example.com/video",
  status: "DOWNLOADED",
  created_at: "2026-04-21T00:00:00.000Z",
  video_duration_seconds: durationsByJobId.get(jobId) ?? 1800,
}));

const buildSemanticBlocksMock = mock((jobId: string) => {
  fs.mkdirSync(path.dirname(semanticBlocksPath(jobId)), { recursive: true });
  fs.writeFileSync(semanticBlocksPath(jobId), "[]", "utf-8");
  return [];
});

const buildTopicSegmentsMock = mock(async () => []);

const analyzeBlocksMock = mock(async () => ({
  cuts: [],
  raw_response: "[]",
}));

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
}));

mock.module("../../../src/storage/files", () => ({
  cutsPath,
  semanticBlocksPath,
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

mock.module("../../../src/core/toolConfigs", () => ({
  loadActiveToolConfigs: () => ({
    llm: {
      embedding_model: "test-embed-model",
    },
  }),
}));

const { registerAnalysisRoutes } = await import("../../../src/routes/jobs/registerAnalysisRoutes");

function baseUrl(): string {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fastify test server is not listening on a TCP port");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function postAnalyze(jobId: string): Promise<{ statusCode: number; body: unknown }> {
  const response = await fetch(`${baseUrl()}/${jobId}/analyze`, {
    method: "POST",
  });

  return {
    statusCode: response.status,
    body: await response.json(),
  };
}

describe("direct analysis route prerequisites", () => {
  beforeEach(async () => {
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "youtube-shorts-analysis-route-"));
    loadJobMock.mockClear();
    buildSemanticBlocksMock.mockClear();
    buildTopicSegmentsMock.mockClear();
    analyzeBlocksMock.mockClear();
    durationsByJobId.clear();

    app = createServer();
    registerAnalysisRoutes(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await app.close();
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  test("builds semantic blocks before analysis when the blocks artifact is missing", async () => {
    durationsByJobId.set("job-direct", 60);

    const response = await postAnalyze("job-direct");

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ cuts: [], raw_response: "[]" });
    expect(buildSemanticBlocksMock).toHaveBeenCalledWith("job-direct");
    expect(buildTopicSegmentsMock).not.toHaveBeenCalled();
    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-direct", 60);
  });

  test("does not rebuild semantic blocks when the blocks artifact already exists", async () => {
    fs.mkdirSync(path.dirname(semanticBlocksPath("job-existing")), { recursive: true });
    fs.writeFileSync(semanticBlocksPath("job-existing"), "[]", "utf-8");

    const response = await postAnalyze("job-existing");

    expect(response.statusCode).toBe(200);
    expect(buildSemanticBlocksMock).not.toHaveBeenCalled();
    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-existing", 1800);
  });

  test("does not prepare topic segments before direct analysis for short videos", async () => {
    durationsByJobId.set("job-short", 60);

    const response = await postAnalyze("job-short");

    expect(response.statusCode).toBe(200);
    expect(loadJobMock).toHaveBeenCalledWith("job-short");
    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-short", 60);
    expect(buildTopicSegmentsMock).not.toHaveBeenCalled();
  });

  test("prepares topic segments before direct analysis for medium videos", async () => {
    const response = await postAnalyze("job-medium");

    expect(response.statusCode).toBe(200);
    expect(loadJobMock).toHaveBeenCalledWith("job-medium");
    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-medium", 1800);
    expect(buildTopicSegmentsMock).toHaveBeenCalledWith(
      "job-medium",
      true,
      "test-embed-model",
    );
  });

  test("prepares topic segments before direct analysis for long videos", async () => {
    durationsByJobId.set("job-long", 4000);

    const response = await postAnalyze("job-long");

    expect(response.statusCode).toBe(200);
    expect(loadJobMock).toHaveBeenCalledWith("job-long");
    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-long", 4000);
    expect(buildTopicSegmentsMock).toHaveBeenCalledWith("job-long", true, "test-embed-model");
  });
});
