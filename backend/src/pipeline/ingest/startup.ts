import { Job, JobStatus } from "../../models/job";
import { appendTaskLogs, clearTaskLogs } from "../../core/taskLogs";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as files from "../../storage/files";
import { IngestPaths } from "./types";

export function beginIngest(job: Job): IngestPaths {
  clearTaskLogs(job.job_id, "transcription");
  clearTaskLogs(job.job_id, "render");
  clearTaskLogs(job.job_id, "ingest");
  console.log(`\n[ingest] ============================================`);
  console.log(`[ingest] Starting ingestion for job ${job.job_id}`);
  console.log(`[ingest] URL: ${job.youtube_url}`);
  console.log(`[ingest] ============================================`);
  appendTaskLogs(job.job_id, "ingest", [
    "[ingest] Starting ingestion",
    `[ingest] URL: ${job.youtube_url}`,
  ]);

  jobLifecycleService.updateJobStatus(job.job_id, JobStatus.DOWNLOADING);

  const infoPath = files.sourceVideoInfoPath(job.job_id);
  const outputPattern = files.sourceVideoOutputTemplate(job.job_id);

  console.log(`[ingest] Video output pattern: ${outputPattern}`);
  console.log(`[ingest] Info path: ${infoPath}`);
  appendTaskLogs(job.job_id, "ingest", [
    `[ingest] Output: ${outputPattern}`,
    `[ingest] Info: ${infoPath}`,
  ]);

  return { infoPath, outputPattern };
}
