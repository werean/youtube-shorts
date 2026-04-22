import { SemanticBlock } from "../../models/semantic_block";
import { TopicSegment } from "../../models/topic_segment";
import * as artifactService from "../../services/artifactService";

export function loadBlocks(jobId: string): SemanticBlock[] {
  const path = artifactService.semanticBlocksPath(jobId);
  if (!artifactService.artifactExists(path)) {
    throw new Error(`Semantic blocks JSON not found for job ${jobId}`);
  }
  return artifactService.readJsonArtifact<SemanticBlock[]>(path);
}

export function loadTopics(jobId: string): TopicSegment[] {
  const path = artifactService.topicSegmentsPath(jobId);
  if (!artifactService.artifactExists(path)) {
    throw new Error(
      `Topic segments JSON not found for job ${jobId}. Ensure BUILDING_TOPICS step ran first.`,
    );
  }
  return artifactService.readJsonArtifact<TopicSegment[]>(path);
}
