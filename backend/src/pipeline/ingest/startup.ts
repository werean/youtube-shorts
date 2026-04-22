import { Job, JobStatus } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import { IngestPaths } from "./types";

export function beginIngest(job: Job): IngestPaths {
  operationRuntimeService.clearTaskLogs(job.job_id, "transcription");
  operationRuntimeService.clearTaskLogs(job.job_id, "render");
  operationRuntimeService.clearTaskLogs(job.job_id, "ingest");
  console.log(`\n[ingest] ============================================`);
  console.log(`[ingest] Starting ingestion for job ${job.job_id}`);
  console.log(`[ingest] URL: ${job.youtube_url}`);
  console.log(`[ingest] ============================================`);
  operationRuntimeService.appendTaskLogs(job.job_id, "ingest", [
    "[ingest] Starting ingestion",
    `[ingest] URL: ${job.youtube_url}`,
  ]);

  jobLifecycleService.updateJobStatus(job.job_id, JobStatus.DOWNLOADING);

  const infoPath = artifactService.sourceVideoInfoPath(job.job_id);
  const outputPattern = artifactService.sourceVideoOutputTemplate(job.job_id);

  console.log(`[ingest] Video output pattern: ${outputPattern}`);
  console.log(`[ingest] Info path: ${infoPath}`);
  operationRuntimeService.appendTaskLogs(job.job_id, "ingest", [
    `[ingest] Output: ${outputPattern}`,
    `[ingest] Info: ${infoPath}`,
  ]);

  return { infoPath, outputPattern };
}
