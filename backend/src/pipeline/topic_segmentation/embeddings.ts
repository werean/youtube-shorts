import { SemanticBlock } from "../../models/semantic_block";
import { detectEmbeddingBoundaries, fetchEmbeddings } from "../embedding";

export async function addEmbeddingBoundaries(
  jobId: string,
  blocks: SemanticBlock[],
  heuristicBoundaries: Set<string>,
  embeddingModel: string,
  similarityThreshold: number,
): Promise<Set<string>> {
  try {
    const embeddings = await fetchEmbeddings(
      blocks.map((block) => block.text),
      embeddingModel,
    );
    const embeddingBoundaries = detectEmbeddingBoundaries(
      blocks,
      embeddings,
      similarityThreshold,
    );

    const finalBoundaries = new Set([...heuristicBoundaries, ...embeddingBoundaries]);

    console.log(
      `[topic_segmentation] job=${jobId} heuristicBoundaries=${heuristicBoundaries.size} embeddingBoundaries=${embeddingBoundaries.size} finalBoundaries=${finalBoundaries.size}`,
    );

    return finalBoundaries;
  } catch (error: any) {
    const message = String(error?.message || error);
    console.warn(
      `[topic_segmentation] Embedding unavailable for job ${jobId} (model='${embeddingModel}', blocks=${blocks.length}): ${message}. Using heuristic boundaries only.`,
    );
    return new Set(heuristicBoundaries);
  }
}
