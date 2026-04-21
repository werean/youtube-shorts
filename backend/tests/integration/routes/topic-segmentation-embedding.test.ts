import * as fs from "fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTopicSegments } from "../../../src/pipeline/topic_segmentation";
import * as metadata from "../../../src/storage/metadata";
import * as files from "../../../src/storage/files";
import { jobDir } from "../../../src/core/paths";
import { JobStatus, type Job } from "../../../src/models/job";
import type { SemanticBlock } from "../../../src/models/semantic_block";

describe("Integration: topic segmentation with embeddings", () => {
  const createdJobIds: string[] = [];
  const originalFetch = global.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;

    for (const jobId of createdJobIds.splice(0, createdJobIds.length)) {
      const dir = jobDir(jobId);
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  function createJobWithBlocks(blocks: SemanticBlock[]): string {
    const jobId = `it-topic-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    createdJobIds.push(jobId);

    const job: Job = {
      job_id: jobId,
      youtube_url: "https://example.com/video",
      status: JobStatus.BUILDING_BLOCKS,
      created_at: new Date().toISOString(),
      video_duration_seconds: 1200,
    };

    metadata.saveJob(job);
    fs.writeFileSync(files.semanticBlocksPath(jobId), JSON.stringify(blocks, null, 2), "utf-8");

    return jobId;
  }

  it("adds embedding boundaries to heuristic segmentation when similarity drops", async () => {
    const blocks: SemanticBlock[] = [
      {
        block_id: "b1",
        start: 0,
        end: 100,
        text: "Introducao do primeiro tema.",
        segment_ids: ["s1"],
      },
      {
        block_id: "b2",
        start: 100.1,
        end: 210,
        text: "Continuacao do primeiro tema.",
        segment_ids: ["s2"],
      },
      {
        block_id: "b3",
        start: 210.2,
        end: 320,
        text: "Mudanca para outro assunto.",
        segment_ids: ["s3"],
      },
    ];

    const jobId = createJobWithBlocks(blocks);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [
          [1, 0],
          [0.9, 0.1],
          [-1, 0],
        ],
      }),
    });
    global.fetch = fetchMock as any;

    const topics = await buildTopicSegments(jobId, true, "nomic-embed-text", 0.75);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(topics).toHaveLength(2);
    expect(topics[0].block_ids).toEqual(["b1", "b2"]);
    expect(topics[1].block_ids).toEqual(["b3"]);
  });

  it("keeps heuristic boundaries even when embedding similarity stays high", async () => {
    const blocks: SemanticBlock[] = [
      {
        block_id: "b1",
        start: 0,
        end: 100,
        text: "Primeiro bloco com fechamento.",
        segment_ids: ["s1"],
      },
      {
        block_id: "b2",
        start: 104.5,
        end: 220,
        text: "Segundo bloco apos pausa longa.",
        segment_ids: ["s2"],
      },
    ];

    const jobId = createJobWithBlocks(blocks);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [
          [1, 0],
          [0.99, 0.01],
        ],
      }),
    });
    global.fetch = fetchMock as any;

    const topics = await buildTopicSegments(jobId, true, "nomic-embed-text", 0.75);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(topics).toHaveLength(2);
    expect(topics[0].block_ids).toEqual(["b1"]);
    expect(topics[1].block_ids).toEqual(["b2"]);
  });
});
