import { isVideoFileName } from "../../core/videoFiles";
import { Job, JobStatus } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import { IngestResult } from "./types";

function readInfo(infoPath: string): { title?: string; duration?: number } | null {
  if (!artifactService.artifactExists(infoPath)) {
    return null;
  }
  try {
    return JSON.parse(artifactService.readTextArtifact(infoPath)) as {
      title?: string;
      duration?: number;
    };
  } catch {
    return null;
  }
}

export function maybeUseExistingSource(job: Job, infoPath: string): IngestResult | null {
  if (
    !job.source_video_path ||
    !artifactService.artifactExists(job.source_video_path) ||
    !isVideoFileName(job.source_video_path)
  ) {
    return null;
  }

  console.log(`[ingest] ✓ Video já existe, pulando download...`);
  operationRuntimeService.appendTaskLog(
    job.job_id,
    "ingest",
    "[ingest] Video already exists. Skipping download.",
  );

  const updatedJob = jobLifecycleService.loadJob(job.job_id);
  updatedJob.updated_at = new Date().toISOString();
  updatedJob.status = JobStatus.DOWNLOADED;
  updatedJob.source_video_path = job.source_video_path;

  const info = readInfo(infoPath);
  if (info?.title && !updatedJob.video_name) {
    updatedJob.video_name = info.title;
  }
  if (typeof info?.duration === "number" && Number.isFinite(info.duration)) {
    updatedJob.video_duration_seconds = info.duration;
  }
  if (!updatedJob.video_name) {
    updatedJob.video_name = updatedJob.job_id;
  }

  jobLifecycleService.saveJob(updatedJob);
  return {
    video_path: job.source_video_path,
    metadata_path: infoPath,
  };
}
