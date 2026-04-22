/**
 * Pipeline step: ingest YouTube video and metadata.
 */

import { appendTaskLog, appendTaskLogs } from "../core/taskLogs";
import { Job, JobStatus } from "../models/job";
import * as jobLifecycleService from "../services/jobLifecycleService";
import { buildDownloadCommand } from "./ingest/command";
import { handleDownloadedArtifacts } from "./ingest/downloaded";
import { createDummyFallback } from "./ingest/dummy";
import { maybeUseExistingSource } from "./ingest/existing";
import { runDownloadCommand } from "./ingest/process";
import { beginIngest } from "./ingest/startup";
import { IngestResult } from "./ingest/types";
export type { IngestResult } from "./ingest/types";

export async function ingestVideo(job: Job): Promise<IngestResult> {
  try {
    const { infoPath, outputPattern } = beginIngest(job);

    // Check if video already exists
    const existingResult = maybeUseExistingSource(job, infoPath);
    if (existingResult) {
      return existingResult;
    }

    // Baixar vídeo no formato original (sem conversão)
    const downloadCommand = buildDownloadCommand(job, outputPattern);
    console.log(`[ingest] Baixando vídeo original (sem conversão)...`);
    console.log(`[ingest] Command: ${downloadCommand}`);
    appendTaskLog(job.job_id, "ingest", `[ingest] Command: ${downloadCommand}`);

    try {
      await runDownloadCommand(downloadCommand, (lines) =>
        appendTaskLogs(job.job_id, "ingest", lines),
      );
      console.log(`[ingest] ✓ Download completado`);
      appendTaskLog(job.job_id, "ingest", "[ingest] Download completed");

      return handleDownloadedArtifacts(job, infoPath, outputPattern);
    } catch (execError: any) {
      console.error(`[ingest] ✗ Erro ao executar yt-dlp, tentando criar vídeo dummy...`);
      console.error(`[ingest] ✗ Mensagem: ${execError.message}`);
      appendTaskLogs(job.job_id, "ingest", [
        "[ingest] ERROR executing yt-dlp",
        `[ingest] ${execError.message}`,
      ]);

      return createDummyFallback(job, infoPath);
    }
  } catch (error: any) {
    console.error(`[ingest] ✗ Erro crítico:`, error.message);
    console.error(`[ingest] Stack:`, error.stack);
    appendTaskLogs(job.job_id, "ingest", ["[ingest] CRITICAL ERROR", `[ingest] ${error.message}`]);
    jobLifecycleService.updateJobStatus(job.job_id, JobStatus.ERROR);
    throw new Error(`Ingestion failed: ${error.message}`);
  }
}
