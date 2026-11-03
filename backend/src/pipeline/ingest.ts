/**
 * Pipeline step: ingest YouTube video and metadata.
 */

import { Job, JobStatus } from "../models/job";
import * as jobLifecycleService from "../services/jobLifecycleService";
import * as operationRuntimeService from "../services/operationRuntimeService";
import { buildDownloadArgs, formatDownloadCommand } from "./ingest/command";
import { handleDownloadedArtifacts } from "./ingest/downloaded";
import { maybeUseExistingSource } from "./ingest/existing";
import { runDownloadCommand } from "./ingest/process";
import { beginIngest } from "./ingest/startup";
import { IngestResult } from "./ingest/types";
export type { IngestResult } from "./ingest/types";

export async function ingestVideo(job: Job): Promise<IngestResult> {
  try {
    const { infoPath, outputPattern } = beginIngest(job);
    const existingResult = maybeUseExistingSource(job, infoPath);
    if (existingResult) {
      return existingResult;
    }

    const downloadArgs = buildDownloadArgs(job, outputPattern);
    const downloadCommand = formatDownloadCommand(downloadArgs);
    console.log(`[ingest] Baixando vídeo original (sem conversão)...`);
    console.log(`[ingest] Command: ${downloadCommand}`);
    operationRuntimeService.appendTaskLog(job.job_id, "ingest", `[ingest] Command: ${downloadCommand}`);

    await runDownloadCommand(job.job_id, downloadArgs, (lines) =>
      operationRuntimeService.appendTaskLogs(job.job_id, "ingest", lines),
    );
    console.log(`[ingest] ✓ Download completado`);
    operationRuntimeService.appendTaskLog(job.job_id, "ingest", "[ingest] Download completed");
    return handleDownloadedArtifacts(job, infoPath, outputPattern);
  } catch (error: any) {
    const message = error?.message || String(error);
    console.error(`[ingest] ✗ Erro crítico:`, message);
    operationRuntimeService.appendTaskLogs(job.job_id, "ingest", [
      "[ingest] ERROR executing yt-dlp",
      `[ingest] ${message}`,
      "[ingest] CRITICAL ERROR",
    ]);
    try {
      const failed = jobLifecycleService.loadJob(job.job_id);
      failed.status = JobStatus.ERROR;
      failed.last_error = message;
      failed.updated_at = new Date().toISOString();
      jobLifecycleService.saveJob(failed);
    } catch {
      try {
        jobLifecycleService.updateJobStatus(job.job_id, JobStatus.ERROR, message);
      } catch {
        // The original error is still reported to the caller.
      }
    }
    throw new Error(`Ingestion failed: ${message}`);
  }
}
