import { JobStatus } from "../../models/job";
import { TopicSegment } from "../../models/topic_segment";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";

export function persistTopicSegments(jobId: string, topics: TopicSegment[]): void {
  const outputPath = artifactService.topicSegmentsPath(jobId);
  artifactService.writeJsonArtifact(outputPath, topics);

  console.log(`[topic_segmentation] ${topics.length} topic(s) detected and saved for job ${jobId}`);

  const job = jobLifecycleService.loadJob(jobId);
  job.status = JobStatus.ANALYZING;
  job.updated_at = new Date().toISOString();
  jobLifecycleService.saveJob(job);
}
