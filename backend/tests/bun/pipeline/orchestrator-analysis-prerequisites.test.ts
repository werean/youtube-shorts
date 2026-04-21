import { beforeEach, describe, expect, mock, test } from "bun:test";
import { JobStatus, type Job } from "../../../src/models/job";

const callOrder: string[] = [];
let currentStatus = JobStatus.CREATED;

function makeJob(status: JobStatus): Job {
  return {
    job_id: "job-orchestrated",
    youtube_url: "https://example.com/video",
    created_at: "2026-04-21T00:00:00.000Z",
    video_duration_seconds: 1800,
    status,
  };
}

const loadJobMock = mock(() => makeJob(currentStatus));
const updateJobStatusMock = mock(() => undefined);
const ingestVideoMock = mock(async () => {
  callOrder.push("ingest");
  currentStatus = JobStatus.DOWNLOADING;
});
const transcribeJobMock = mock(async () => {
  callOrder.push("transcribe");
  currentStatus = JobStatus.TRANSCRIBING;
});
const buildSemanticBlocksMock = mock(async () => {
  callOrder.push("semantic_blocks");
  currentStatus = JobStatus.BUILDING_BLOCKS;
});
const buildTopicSegmentsMock = mock(async () => {
  callOrder.push("topic_segments");
  currentStatus = JobStatus.BUILDING_TOPICS;
});
const analyzeBlocksMock = mock(async () => {
  callOrder.push("analysis");
  currentStatus = JobStatus.WAITING_APPROVAL;
});
const renderSuggestedCutsMock = mock(async () => {
  callOrder.push("render");
  currentStatus = JobStatus.DONE;
});
const selectStrategyMock = mock(() => ({
  useTopicSegmentation: true,
  useEmbeddings: true,
  useTwoPass: false,
  maxBlocksPerLLMRequest: 150,
  maxCharsPerLLMRequest: 18000,
}));
const loadActiveToolConfigsMock = mock(() => ({
  llm: {
    embedding_model: "custom-embed-model",
  },
}));

mock.module("../../../src/storage/metadata", () => ({
  loadJob: loadJobMock,
  updateJobStatus: updateJobStatusMock,
}));

mock.module("../../../src/pipeline/ingest", () => ({
  ingestVideo: ingestVideoMock,
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

mock.module("../../../src/pipeline/strategy", () => ({
  selectStrategy: selectStrategyMock,
}));

mock.module("../../../src/core/toolConfigs", () => ({
  loadActiveToolConfigs: loadActiveToolConfigsMock,
}));

const { runPipeline } = await import("../../../src/pipeline/orchestrator");

describe("orchestrator analysis prerequisites", () => {
  beforeEach(() => {
    callOrder.length = 0;
    currentStatus = JobStatus.CREATED;

    loadJobMock.mockClear();
    updateJobStatusMock.mockClear();
    ingestVideoMock.mockClear();
    transcribeJobMock.mockClear();
    buildSemanticBlocksMock.mockClear();
    buildTopicSegmentsMock.mockClear();
    analyzeBlocksMock.mockClear();
    renderSuggestedCutsMock.mockClear();
    selectStrategyMock.mockClear();
    loadActiveToolConfigsMock.mockClear();
  });

  test("runs semantic blocks and strategy-driven topic segmentation before analysis", async () => {
    const result = await runPipeline("job-orchestrated", { includeRender: false });

    expect(callOrder).toEqual([
      "ingest",
      "transcribe",
      "semantic_blocks",
      "topic_segments",
      "analysis",
    ]);
    expect(selectStrategyMock).toHaveBeenCalledWith(1800);
    expect(loadActiveToolConfigsMock).toHaveBeenCalled();
    expect(buildTopicSegmentsMock).toHaveBeenCalledWith(
      "job-orchestrated",
      true,
      "custom-embed-model",
    );
    expect(analyzeBlocksMock).toHaveBeenCalledWith("job-orchestrated", 1800);
    expect(renderSuggestedCutsMock).not.toHaveBeenCalled();
    expect(result.status).toBe(JobStatus.WAITING_APPROVAL);
  });

  test("marks the job as ERROR when a pipeline step fails", async () => {
    loadJobMock.mockReturnValue(makeJob(JobStatus.CREATED));
    ingestVideoMock.mockRejectedValue(new Error("ingest failed"));

    await expect(runPipeline("job-orchestrated", { includeRender: false })).rejects.toThrow(
      "ingest failed",
    );

    expect(updateJobStatusMock).toHaveBeenCalledWith("job-orchestrated", JobStatus.ERROR);
  });
});
