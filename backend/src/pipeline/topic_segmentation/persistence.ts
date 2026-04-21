import * as fs from "fs";
import { JobStatus } from "../../models/job";
import { TopicSegment } from "../../models/topic_segment";
import * as files from "../../storage/files";
import * as metadata from "../../storage/metadata";

export function persistTopicSegments(jobId: string, topics: TopicSegment[]): void {
  const outputPath = files.topicSegmentsPath(jobId);
  fs.writeFileSync(outputPath, JSON.stringify(topics, null, 2), "utf-8");

  console.log(`[topic_segmentation] ${topics.length} topic(s) detected and saved for job ${jobId}`);

  const job = metadata.loadJob(jobId);
  job.status = JobStatus.ANALYZING;
  job.updated_at = new Date().toISOString();
  metadata.saveJob(job);
}
