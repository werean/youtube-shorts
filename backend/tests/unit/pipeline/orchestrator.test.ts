import { beforeEach, describe, expect, it, vi } from "vitest";
import { JobStatus, type Job } from "../../../src/models/job";

const {
  loadJobMock,
  updateJobStatusMock,
  ingestVideoMock,
  transcribeJobMock,
  buildSemanticBlocksMock,
  buildTopicSegmentsMock,
  analyzeBlocksMock,
  renderSuggestedCutsMock,
  selectStrategyMock,
  loadActiveToolConfigsMock,
} = vi.hoisted(() => ({
  loadJobMock: vi.fn(),
  updateJobStatusMock: vi.fn(),
  ingestVideoMock: vi.fn(),
  transcribeJobMock: vi.fn(),
  buildSemanticBlocksMock: vi.fn(),
  buildTopicSegmentsMock: vi.fn(),
  analyzeBlocksMock: vi.fn(),
  renderSuggestedCutsMock: vi.fn(),
  selectStrategyMock: vi.fn(),
  loadActiveToolConfigsMock: vi.fn(),
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

vi.mock("../../../src/pipeline/topic_segmentation", () => ({
  buildTopicSegments: buildTopicSegmentsMock,
}));

vi.mock("../../../src/pipeline/analysis", () => ({
  analyzeBlocks: analyzeBlocksMock,
}));

vi.mock("../../../src/pipeline/rendering", () => ({
  renderSuggestedCuts: renderSuggestedCutsMock,
}));

vi.mock("../../../src/pipeline/strategy", () => ({
  selectStrategy: selectStrategyMock,
}));

vi.mock("../../../src/core/toolConfigs", () => ({
  loadActiveToolConfigs: loadActiveToolConfigsMock,
}));

import { runPipeline } from "../../../src/pipeline/orchestrator";

function makeJob(status: JobStatus): Job {
  return {
    job_id: "job-1",
    youtube_url: "https://example.com/video",
    created_at: "2025-01-01T00:00:00.000Z",
    video_duration_seconds: 1200,
    status,
  };
}

describe("runPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    selectStrategyMock.mockReturnValue({
      useTopicSegmentation: true,
      useEmbeddings: true,
      useTwoPass: false,
      maxBlocksPerLLMRequest: 80,
      maxCharsPerLLMRequest: 12000,
    });
    loadActiveToolConfigsMock.mockReturnValue({
      llm: {
        embedding_model: "nomic-embed-text",
      },
    });
  });

  it("runs all core steps and render when includeRender is true", async () => {
    let currentStatus = JobStatus.CREATED;

    loadJobMock.mockImplementation(() => makeJob(currentStatus));

    ingestVideoMock.mockImplementation(async () => {
      currentStatus = JobStatus.DOWNLOADING;
    });
    transcribeJobMock.mockImplementation(async () => {
      currentStatus = JobStatus.TRANSCRIBING;
    });
    buildSemanticBlocksMock.mockImplementation(async () => {
      currentStatus = JobStatus.BUILDING_BLOCKS;
    });
    buildTopicSegmentsMock.mockImplementation(async () => {
      currentStatus = JobStatus.BUILDING_TOPICS;
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
    expect(selectStrategyMock).toHaveBeenCalledWith(1200);
    expect(loadActiveToolConfigsMock).toHaveBeenCalledTimes(1);
    expect(buildTopicSegmentsMock).toHaveBeenCalledWith("job-1", true, "nomic-embed-text");
    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-1", 1200);
    expect(analyzeBlocksMock).toHaveBeenCalledTimes(1);
    expect(renderSuggestedCutsMock).toHaveBeenCalledTimes(1);
    expect(result.status).toBe(JobStatus.DONE);
  });

  it("does not render when includeRender is false", async () => {
    let currentStatus = JobStatus.CREATED;

    loadJobMock.mockImplementation(() => makeJob(currentStatus));
    ingestVideoMock.mockImplementation(async () => {
      currentStatus = JobStatus.DOWNLOADING;
    });
    transcribeJobMock.mockImplementation(async () => {
      currentStatus = JobStatus.TRANSCRIBING;
    });
    buildSemanticBlocksMock.mockImplementation(async () => {
      currentStatus = JobStatus.BUILDING_BLOCKS;
    });
    buildTopicSegmentsMock.mockImplementation(async () => {
      currentStatus = JobStatus.BUILDING_TOPICS;
    });
    analyzeBlocksMock.mockImplementation(async () => {
      currentStatus = JobStatus.ANALYZING;
    });

    await runPipeline("job-1", { includeRender: false });

    expect(ingestVideoMock).toHaveBeenCalledTimes(1);
    expect(transcribeJobMock).toHaveBeenCalledTimes(1);
    expect(buildSemanticBlocksMock).toHaveBeenCalledTimes(1);
    expect(buildTopicSegmentsMock).toHaveBeenCalledWith("job-1", true, "nomic-embed-text");
    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-1", 1200);
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
