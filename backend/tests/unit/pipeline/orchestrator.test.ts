import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobStatus, type Job } from "../../../src/models/job";

const {
  loadJobMock,
  updateJobStatusMock,
  ingestVideoMock,
  transcribeJobMock,
  buildSemanticBlocksMock,
  analyzeBlocksMock,
  renderSuggestedCutsMock,
} = vi.hoisted(() => ({
  loadJobMock: vi.fn(),
  updateJobStatusMock: vi.fn(),
  ingestVideoMock: vi.fn(),
  transcribeJobMock: vi.fn(),
  buildSemanticBlocksMock: vi.fn(),
  analyzeBlocksMock: vi.fn(),
  renderSuggestedCutsMock: vi.fn(),
}));

vi.mock("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
  updateJobStatus: updateJobStatusMock,
}));

vi.mock("../../../src/pipeline/ingest", () => ({
  ingestVideo: ingestVideoMock,
}));

vi.mock("../../../src/pipeline/transcription", () => ({
  transcribeJob: transcribeJobMock,
}));

vi.mock("../../../src/pipeline/semantic_blocks", () => ({
  buildSemanticBlocks: buildSemanticBlocksMock,
}));

vi.mock("../../../src/pipeline/analysis", () => ({
  analyzeBlocks: analyzeBlocksMock,
}));

vi.mock("../../../src/pipeline/rendering", () => ({
  renderSuggestedCuts: renderSuggestedCutsMock,
}));

import { runPipeline } from "../../../src/pipeline/orchestrator";

function makeJob(status: JobStatus): Job {
  return {
    job_id: "job-1",
    youtube_url: "https://example.com/video",
    created_at: "2025-01-01T00:00:00.000Z",
    status,
  };
}

describe("runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs all core steps and render when includeRender is true", async () => {
    let currentStatus = JobStatus.CREATED;

    loadJobMock.mockImplementation(() => makeJob(currentStatus));

    ingestVideoMock.mockImplementation(async () => {
      currentStatus = JobStatus.DOWNLOADED;
    });
    transcribeJobMock.mockImplementation(async () => {
      currentStatus = JobStatus.TRANSCRIBING;
    });
    buildSemanticBlocksMock.mockImplementation(async () => {
      currentStatus = JobStatus.BUILDING_BLOCKS;
    });
    analyzeBlocksMock.mockImplementation(async () => {
      currentStatus = JobStatus.ANALYZING;
    });
    renderSuggestedCutsMock.mockImplementation(async () => {
      currentStatus = JobStatus.DONE;
    });

    const result = await runPipeline("job-1", { includeRender: true });

    expect(ingestVideoMock).toHaveBeenCalledTimes(1);
    expect(transcribeJobMock).toHaveBeenCalledTimes(1);
    expect(buildSemanticBlocksMock).toHaveBeenCalledTimes(1);
    expect(analyzeBlocksMock).toHaveBeenCalledTimes(1);
    expect(renderSuggestedCutsMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(JobStatus.DONE);
  });

  it("does not render when includeRender is false", async () => {
    let currentStatus = JobStatus.CREATED;

    loadJobMock.mockImplementation(() => makeJob(currentStatus));
    ingestVideoMock.mockImplementation(async () => {
      currentStatus = JobStatus.DOWNLOADED;
    });
    transcribeJobMock.mockResolvedValue(undefined);
    buildSemanticBlocksMock.mockResolvedValue(undefined);
    analyzeBlocksMock.mockResolvedValue(undefined);

    await runPipeline("job-1", { includeRender: false });

    expect(ingestVideoMock).toHaveBeenCalledTimes(1);
    expect(transcribeJobMock).toHaveBeenCalledTimes(1);
    expect(buildSemanticBlocksMock).toHaveBeenCalledTimes(1);
    expect(analyzeBlocksMock).toHaveBeenCalledTimes(1);
    expect(renderSuggestedCutsMock).not.toHaveBeenCalled();
  });

  it("marks job as ERROR and rethrows when a step fails", async () => {
    loadJobMock.mockReturnValue(makeJob(JobStatus.CREATED));
    ingestVideoMock.mockRejectedValue(new Error("ingest failed"));

    await expect(runPipeline("job-1", { includeRender: false })).rejects.toThrow("ingest failed");

    expect(updateJobStatusMock).toHaveBeenCalledWith("job-1", JobStatus.ERROR);
  });
});
