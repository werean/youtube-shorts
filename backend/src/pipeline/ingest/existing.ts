import { appendTaskLog } from "../../core/taskLogs";
import { Job, JobStatus } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import { IngestResult } from "./types";

export function maybeUseExistingSource(job: Job, infoPath: string): IngestResult | null {
  if (
    !(
      job.source_video_path &&
      artifactService.artifactExists(job.source_video_path) &&
      artifactService.artifactExists(infoPath)
    )
  ) {
    return null;
  }

  console.log(`[ingest] ✓ Video já existe, pulando download...`);
  appendTaskLog(job.job_id, "ingest", "[ingest] Video already exists. Skipping download.");
  const updatedJob = jobLifecycleService.loadJob(job.job_id);
  updatedJob.updated_at = new Date().toISOString();
  updatedJob.status = JobStatus.DOWNLOADED;

  // Ensure video_name is set
  if (!updatedJob.video_name) {
    try {
      const infoContent = artifactService.readTextArtifact(infoPath);
      const infoData = JSON.parse(infoContent);
      if (infoData.title) {
        updatedJob.video_name = infoData.title;
      }
    } catch (e) {
      updatedJob.video_name = updatedJob.job_id;
    }
    jobLifecycleService.saveJob(updatedJob);
  }

  return {
    video_path: job.source_video_path,
    metadata_path: infoPath,
  };
}
