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
    throw new Error(
      `[topic_segmentation] Embedding boundary detection failed for job ${jobId} (model='${embeddingModel}', blocks=${blocks.length}): ${String(error?.message || error)}`,
    );
  }
}
