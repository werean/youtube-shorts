import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { JobStatus } from "../../../src/models/job";

const { runPipelineMock } = vi.hoisted(() => ({
  runPipelineMock: vi.fn(),
}));

vi.mock("../../../src/pipeline/orchestrator", () => ({
  runPipeline: runPipelineMock,
}));

import { createServer } from "../../../src/app/createServer";
import { registerPipelineRoutes } from "../../../src/routes/jobs/registerPipelineRoutes";

describe("Integration: pipeline route", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = createServer();
    registerPipelineRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it("runs pipeline with default include_render=false", async () => {
    runPipelineMock.mockResolvedValue({
      job_id: "job-001",
      youtube_url: "https://example.com",
      created_at: "2025-01-01T00:00:00.000Z",
      status: JobStatus.DONE,
    });

    const response = await app.inject({
      method: "POST",
      url: "/job-001/run",
    });

    expect(response.statusCode).toBe(200);
    expect(runPipelineMock).toHaveBeenCalledWith("job-001", { includeRender: false });
    expect(response.json()).toMatchObject({ job_id: "job-001", status: JobStatus.DONE });
  });

  it("runs pipeline with include_render=true when requested", async () => {
    runPipelineMock.mockResolvedValue({
      job_id: "job-001",
      youtube_url: "https://example.com",
      created_at: "2025-01-01T00:00:00.000Z",
      status: JobStatus.DONE,
    });

    const response = await app.inject({
      method: "POST",
      url: "/job-001/run",
      payload: { include_render: true },
    });

    expect(response.statusCode).toBe(200);
    expect(runPipelineMock).toHaveBeenCalledWith("job-001", { includeRender: true });
  });

  it("returns 500 when orchestrator fails", async () => {
    runPipelineMock.mockRejectedValue(new Error("pipeline failed"));

    const response = await app.inject({
      method: "POST",
      url: "/job-001/run",
      payload: { include_render: true },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ detail: "pipeline failed" });
  });
});
