import { SemanticBlock } from "../../models/semantic_block";
import * as artifactService from "../../services/artifactService";

export function loadSemanticBlocksForTopics(jobId: string): SemanticBlock[] {
  const blocksPath = artifactService.semanticBlocksPath(jobId);
  if (!artifactService.artifactExists(blocksPath)) {
    throw new Error(`Semantic blocks not found for job ${jobId}. Run buildSemanticBlocks first.`);
  }

  const blocks = artifactService.readJsonArtifact<SemanticBlock[]>(blocksPath);
  if (blocks.length === 0) {
    throw new Error(`No semantic blocks available for job ${jobId}`);
  }

  return blocks;
}
