import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";

const { transcribeJobMock, cancelTranscriptionMock, existsSyncMock } = vi.hoisted(() => ({
  transcribeJobMock: vi.fn(),
  cancelTranscriptionMock: vi.fn(),
  existsSyncMock: vi.fn(),
}));

vi.mock("fs", () => ({
  existsSync: existsSyncMock,
}));

vi.mock("../../../src/pipeline/transcription", () => ({
  transcribeJob: transcribeJobMock,
  cancelTranscription: cancelTranscriptionMock,
}));

vi.mock("../../../src/storage/files", () => ({
  transcriptionTextPath: vi.fn(() => "/tmp/transcription.txt"),
  transcriptionVttPath: vi.fn(() => "/tmp/transcription.vtt"),
  transcriptionPath: vi.fn(() => "/tmp/transcription.json"),
}));

import { createServer } from "../../../src/app/createServer";
import { registerTranscriptionRoutes } from "../../../src/routes/jobs/registerTranscriptionRoutes";

describe("Integration: transcription routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = createServer();
    registerTranscriptionRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("transcribes and returns available formats", async () => {
    transcribeJobMock.mockResolvedValue([
      { start: 0, end: 1.2, text: "hello" },
      { start: 1.2, end: 2.4, text: "world" },
    ]);

    existsSyncMock.mockImplementation((pathLike: unknown) => {
      const path = String(pathLike);
      if (path.endsWith(".txt")) return true;
      if (path.endsWith(".vtt")) return false;
      return false;
    });

    const response = await app.inject({
      method: "POST",
      url: "/job-001/transcribe",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      transcription: "hello world",
      segments: [
        { start: 0, end: 1.2, text: "hello" },
        { start: 1.2, end: 2.4, text: "world" },
      ],
      available_formats: {
        segments: true,
        text: true,
        vtt: false,
      },
    });
    expect(transcribeJobMock).toHaveBeenCalledWith("job-001");
  });

  it("returns 404 when cancelling a non-running transcription", async () => {
    cancelTranscriptionMock.mockReturnValue(false);

    const response = await app.inject({
      method: "POST",
      url: "/job-001/transcribe/cancel",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ detail: "Transcription not running" });
  });

  it("returns success when cancellation is accepted", async () => {
    cancelTranscriptionMock.mockReturnValue(true);

    const response = await app.inject({
      method: "POST",
      url: "/job-001/transcribe/cancel",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, job_id: "job-001" });
  });
});
