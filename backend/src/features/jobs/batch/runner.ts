import * as jobLifecycleService from "../../../services/jobLifecycleService";
import * as operationRuntimeService from "../../../services/operationRuntimeService";
import { transcribeJob } from "../../../pipeline/transcription";
import { prepareAnalysisPrerequisites } from "../../../pipeline/analysis_prerequisites";
import { analyzeBlocks } from "../../../pipeline/analysis";
import { renderSuggestedCuts } from "../../../pipeline/rendering";
import { loadPendingCutsForApproval, waitForApproval } from "./approval";
import type { BatchPipelineOptions } from "./types";

export async function processBatchPipeline(
  batchId: string,
  jobIds: string[],
  options: BatchPipelineOptions,
) {
  const progress = operationRuntimeService.getBatchProgress(batchId);
  if (!progress) return;

  for (let i = 0; i < jobIds.length; i++) {
    // Check if cancelled
    if (!progress.is_running) {
      console.log(`[batch] Batch ${batchId} was cancelled`);
      break;
    }

    const jobId = jobIds[i];
    progress.current_job_index = i;
    progress.current_job_id = jobId;

    console.log(`[batch] Processing job ${i + 1}/${jobIds.length}: ${jobId}`);

    try {
      const job = jobLifecycleService.loadJob(jobId);

      // Step 1: Transcription (always required)
      if (options.transcription) {
        if (!progress.is_running) break;

        progress.current_step = "transcription";
        console.log(`[batch] [${jobId}] Starting transcription...`);

        await transcribeJob(jobId);
        console.log(`[batch] [${jobId}] Transcription completed`);
      }

      // Step 2: Build semantic blocks (required for analysis)
      if (options.analysis) {
        if (!progress.is_running) break;

        progress.current_step = "semantic_blocks";
        console.log(`[batch] [${jobId}] Preparing analysis prerequisites...`);

        await prepareAnalysisPrerequisites(job, {
          semanticBlocks: "rebuild",
        });
        console.log(`[batch] [${jobId}] Analysis prerequisites completed`);
      }

      // Step 3: Analysis
      if (options.analysis) {
        if (!progress.is_running) break;

        progress.current_step = "analysis";
        console.log(`[batch] [${jobId}] Starting analysis...`);

        await analyzeBlocks(jobId, job.video_duration_seconds ?? 0);
        console.log(`[batch] [${jobId}] Analysis completed`);

        // If preApprove is enabled, wait for user approval
        if (options.preApprove) {
          progress.current_step = "waiting_approval";
          progress.waiting_for_approval = true;

          // Load cuts for approval
          const cuts = loadPendingCutsForApproval(jobId);
          if (cuts !== undefined) {
            progress.pending_cuts = cuts;
          }

          console.log(`[batch] [${jobId}] Waiting for user approval...`);

          // Wait until approval is given or cancelled
          const shouldContinue = await waitForApproval(progress);

          if (!shouldContinue) {
            console.log(`[batch] [${jobId}] Batch was cancelled during approval`);
            break;
          }

          console.log(`[batch] [${jobId}] Approval received, continuing...`);
          progress.pending_cuts = undefined;
        }
      }

      // Step 4: Rendering (only if analysis was done)
      if (options.render && options.analysis) {
        if (!progress.is_running) break;

        progress.current_step = "rendering";
        console.log(`[batch] [${jobId}] Starting rendering...`);

        await renderSuggestedCuts(jobId);
        console.log(`[batch] [${jobId}] Rendering completed`);
      }

      progress.completed_jobs.push(jobId);
      console.log(`[batch] [${jobId}] Job completed successfully`);
    } catch (error: any) {
      console.error(`[batch] [${jobId}] Error:`, error.message);
      progress.failed_jobs.push({ job_id: jobId, error: error.message });
    }
  }

  progress.is_running = false;
  progress.current_step = "completed";
  console.log(`[batch] Batch ${batchId} finished`);
  console.log(`[batch]   Completed: ${progress.completed_jobs.length}`);
  console.log(`[batch]   Failed: ${progress.failed_jobs.length}`);
}
