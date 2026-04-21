import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cosineSimilarity,
  detectEmbeddingBoundaries,
  fetchEmbeddings,
} from "../../../src/pipeline/embedding";
import type { SemanticBlock } from "../../../src/models/semantic_block";

describe("embedding pipeline helpers", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns empty array without calling Ollama when input texts are empty", async () => {
    const fetchMock = vi.fn();
    global.fetch = fetchMock as any;

    const result = await fetchEmbeddings([], "nomic-embed-text");

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends a single batch request and returns embeddings in input order", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [
          [1, 0],
          [0.5, 0.5],
        ],
      }),
    });

    global.fetch = fetchMock as any;

    const result = await fetchEmbeddings(["primeiro", "segundo"], "nomic-embed-text");

    expect(result).toEqual([
      [1, 0],
      [0.5, 0.5],
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, request] = fetchMock.mock.calls[0];
    const body = JSON.parse(String(request.body));
    expect(body).toEqual({
      model: "nomic-embed-text",
      input: ["primeiro", "segundo"],
    });
  });

  it("throws descriptive error when Ollama embed endpoint returns non-200", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal failure",
    });

    global.fetch = fetchMock as any;

    await expect(fetchEmbeddings(["a"], "all-minilm")).rejects.toThrow(
      "status=500, model='all-minilm'",
    );
  });

  it("throws mismatch error when embedding count differs from input count", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        embeddings: [[1, 0]],
      }),
    });

    global.fetch = fetchMock as any;

    await expect(fetchEmbeddings(["a", "b"], "embeddinggemma")).rejects.toThrow(
      "expected 2, received 1",
    );
  });

  it("computes cosine similarity as dot product for normalized vectors", () => {
    const similarity = cosineSimilarity([1, 0, 0], [0.8, 0.6, 0]);
    expect(similarity).toBeCloseTo(0.8);
  });

  it("throws on cosine similarity with vectors of different lengths", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow("vectors with different sizes");
  });

  it("detects embedding boundaries where consecutive similarity falls below threshold", () => {
    const blocks: SemanticBlock[] = [
      {
        block_id: "b1",
        start: 0,
        end: 10,
        text: "primeiro",
        segment_ids: ["s1"],
      },
      {
        block_id: "b2",
        start: 10.1,
        end: 20,
        text: "segundo",
        segment_ids: ["s2"],
      },
      {
        block_id: "b3",
        start: 20.1,
        end: 30,
        text: "terceiro",
        segment_ids: ["s3"],
      },
    ];

    const boundaries = detectEmbeddingBoundaries(
      blocks,
      [
        [1, 0],
        [0.9, 0.1],
        [-1, 0],
      ],
      0.75,
    );

    expect(Array.from(boundaries)).toEqual(["b3"]);
  });

  it("throws if detectEmbeddingBoundaries receives mismatched blocks and embeddings", () => {
    const blocks: SemanticBlock[] = [
      {
        block_id: "b1",
        start: 0,
        end: 10,
        text: "primeiro",
        segment_ids: ["s1"],
      },
      {
        block_id: "b2",
        start: 10,
        end: 20,
        text: "segundo",
        segment_ids: ["s2"],
      },
    ];

    expect(() => detectEmbeddingBoundaries(blocks, [[1, 0]], 0.75)).toThrow(
      "must have the same length",
    );
  });
});
