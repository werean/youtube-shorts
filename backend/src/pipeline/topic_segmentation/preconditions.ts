import * as fs from "fs";
import { SemanticBlock } from "../../models/semantic_block";
import * as files from "../../storage/files";

export function loadSemanticBlocksForTopics(jobId: string): SemanticBlock[] {
  const blocksPath = files.semanticBlocksPath(jobId);
  if (!fs.existsSync(blocksPath)) {
    throw new Error(`Semantic blocks not found for job ${jobId}. Run buildSemanticBlocks first.`);
  }

  const blocks: SemanticBlock[] = JSON.parse(fs.readFileSync(blocksPath, "utf-8"));
  if (blocks.length === 0) {
    throw new Error(`No semantic blocks available for job ${jobId}`);
  }

  return blocks;
}
