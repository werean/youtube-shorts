import * as fs from "fs";
import { SemanticBlock } from "../../models/semantic_block";
import { TopicSegment } from "../../models/topic_segment";
import * as files from "../../storage/files";

export function loadBlocks(jobId: string): SemanticBlock[] {
  const path = files.semanticBlocksPath(jobId);
  if (!fs.existsSync(path)) {
    throw new Error(`Semantic blocks JSON not found for job ${jobId}`);
  }
  return JSON.parse(fs.readFileSync(path, "utf-8"));
}

export function loadTopics(jobId: string): TopicSegment[] {
  const path = files.topicSegmentsPath(jobId);
  if (!fs.existsSync(path)) {
    throw new Error(
      `Topic segments JSON not found for job ${jobId}. Ensure BUILDING_TOPICS step ran first.`,
    );
  }
  return JSON.parse(fs.readFileSync(path, "utf-8"));
}
