/**
 * Embedding helpers for topic segmentation.
 */

import { config } from "../core/config";
import { SemanticBlock } from "../models/semantic_block";

/**
 * Fetches embeddings for an array of texts from Ollama.
 * Sends all texts in a single batch request.
 *
 * @param texts - Array of strings to embed.
 * @param model - Ollama embedding model name (default: "nomic-embed-text").
 * @returns Array of embedding vectors, same order as input.
 */
export async function fetchEmbeddings(
  texts: string[],
  model: string = "nomic-embed-text",
): Promise<number[][]> {
  if (texts.length === 0) {
    return [];
  }

  const baseUrl = config.OLLAMA_BASE_URL.replace(/\/$/, "");
  const response = await fetch(`${baseUrl}/api/embed`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(config.OLLAMA_API_KEY ? { Authorization: `Bearer ${config.OLLAMA_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model,
      input: texts,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).trim();
    throw new Error(
      `[embedding] Ollama embed request failed (status=${response.status}, model='${model}', texts=${texts.length}). ${detail || "No response details."}`,
    );
  }

  let payload: { embeddings?: unknown };
  try {
    payload = (await response.json()) as { embeddings?: unknown };
  } catch {
    throw new Error(
      `[embedding] Ollama embed response is not valid JSON (model='${model}', texts=${texts.length}).`,
    );
  }

  if (!Array.isArray(payload.embeddings)) {
    throw new Error(
      `[embedding] Ollama embed response missing 'embeddings' array (model='${model}', texts=${texts.length}).`,
    );
  }

  if (payload.embeddings.length !== texts.length) {
    throw new Error(
      `[embedding] Embedding count mismatch for model '${model}': expected ${texts.length}, received ${payload.embeddings.length}.`,
    );
  }

  return payload.embeddings.map((vector, vectorIndex) => {
    if (!Array.isArray(vector)) {
      throw new Error(
        `[embedding] Invalid embedding vector at index ${vectorIndex} for model '${model}' (expected number[]).`,
      );
    }

    return vector.map((value, valueIndex) => {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) {
        throw new Error(
          `[embedding] Non-numeric embedding value at vector ${vectorIndex}, position ${valueIndex} for model '${model}'.`,
        );
      }
      return numeric;
    });
  });
}

/**
 * Computes cosine similarity between two L2-normalized vectors.
 * Since vectors are L2-normalized, this is equivalent to dot product.
 *
 * @param a - First vector.
 * @param b - Second vector.
 * @returns Similarity score between -1 and 1.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `[embedding] Cannot compute cosine similarity for vectors with different sizes (${a.length} vs ${b.length}).`,
    );
  }

  let sum = 0;
  for (let i = 0; i < a.length; i += 1) {
    sum += a[i] * b[i];
  }
  return sum;
}

/**
 * Detects topic boundaries using semantic similarity between consecutive blocks.
 * A boundary is detected when similarity drops below the threshold.
 *
 * @param blocks - SemanticBlock array in order.
 * @param embeddings - Embedding vectors in same order as blocks.
 * @param threshold - Similarity threshold (default: 0.75). Below this = boundary.
 * @returns Set of block_ids where a new topic starts.
 */
export function detectEmbeddingBoundaries(
  blocks: SemanticBlock[],
  embeddings: number[][],
  threshold: number = 0.75,
): Set<string> {
  if (blocks.length !== embeddings.length) {
    throw new Error(
      `[embedding] Cannot detect boundaries: blocks (${blocks.length}) and embeddings (${embeddings.length}) must have the same length.`,
    );
  }

  const boundaries = new Set<string>();

  for (let i = 1; i < blocks.length; i += 1) {
    const similarity = cosineSimilarity(embeddings[i - 1], embeddings[i]);
    if (similarity < threshold) {
      boundaries.add(blocks[i].block_id);
    }
  }

  return boundaries;
}
