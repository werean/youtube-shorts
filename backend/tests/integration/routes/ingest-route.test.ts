import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { JobStatus, type Job } from "../../../src/models/job";

const { ingestVideoMock, loadJobMock } = vi.hoisted(() => ({
  ingestVideoMock: vi.fn(),
  loadJobMock: vi.fn(),
}));

vi.mock("../../../src/pipeline/ingest", () => ({
  ingestVideo: ingestVideoMock,
}));

vi.mock("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
}));

import { createServer } from "../../../src/app/createServer";
import { registerIngestJobRoutes } from "../../../src/routes/jobs/registerIngestJob";

function makeJob(): Job {
  return {
    job_id: "job-123",
    youtube_url: "https://youtube.com/watch?v=abc",
    created_at: "2025-01-01T00:00:00.000Z",
    status: JobStatus.CREATED,
  };
}

describe("Integration: ingest route", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = createServer();
    registerIngestJobRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.clearAllMocks();
  });

  it("returns media paths after successful ingest", async () => {
    loadJobMock.mockReturnValue(makeJob());
    ingestVideoMock.mockResolvedValue({
      video_path: "/tmp/video.mp4",
      metadata_path: "/tmp/video.info.json",
    });

    const response = await app.inject({
      method: "POST",
      url: "/job-123/ingest",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      video_path: "/media/videos/job-123",
      metadata_path: "/tmp/video.info.json",
      full_path: "/tmp/video.mp4",
    });
    expect(loadJobMock).toHaveBeenCalledWith("job-123");
    expect(ingestVideoMock).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when ingest fails", async () => {
    loadJobMock.mockReturnValue(makeJob());
    ingestVideoMock.mockRejectedValue(new Error("download failed"));

    const response = await app.inject({
      method: "POST",
      url: "/job-123/ingest",
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({ detail: "download failed" });
  });
});
