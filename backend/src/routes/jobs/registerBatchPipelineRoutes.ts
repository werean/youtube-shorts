/**
 * Register batch pipeline routes.
 */

import type { FastifyInstance } from "fastify";
import * as metadata from "../../storage/metadata";
import { transcribeJob } from "../../pipeline/transcription";
import { buildSemanticBlocks } from "../../pipeline/semantic_blocks";
import { analyzeBlocks } from "../../pipeline/analysis";
import { renderSuggestedCuts } from "../../pipeline/rendering";
import { JobStatus } from "../../models/job";

interface BatchPipelineRequest {
  job_ids: string[];
  options: {
    transcription: boolean;
    analysis: boolean;
    render: boolean;
    preApprove: boolean;
  };
}

interface BatchPipelineProgress {
  current_job_index: number;
  current_job_id: string;
  current_step: string;
  completed_jobs: string[];
  failed_jobs: { job_id: string; error: string }[];
  is_running: boolean;
  waiting_for_approval?: boolean;
  pending_cuts?: any[];
}

// Store active batch processes
const activeBatchProcesses = new Map<string, BatchPipelineProgress>();

export function registerBatchPipelineRoutes(fastify: FastifyInstance) {
  // Start batch pipeline
  fastify.post<{ Body: BatchPipelineRequest }>("/batch/run", async (request, reply) => {
    try {
      const { job_ids, options } = request.body;

      if (!job_ids || job_ids.length === 0) {
        return reply.code(400).send({ detail: "No job IDs provided" });
      }

      console.log(`[batch] Starting batch pipeline for ${job_ids.length} jobs`);
      console.log(`[batch] Options:`, options);

      const batchId = `batch_${Date.now()}`;
      const progress: BatchPipelineProgress = {
        current_job_index: 0,
        current_job_id: job_ids[0],
        current_step: "starting",
        completed_jobs: [],
        failed_jobs: [],
        is_running: true,
      };

      activeBatchProcesses.set(batchId, progress);

      // Start processing in background
      processBatchPipeline(batchId, job_ids, options).catch((error) => {
        console.error(`[batch] Fatal error in batch ${batchId}:`, error);
        const prog = activeBatchProcesses.get(batchId);
        if (prog) {
          prog.is_running = false;
        }
      });

      return { batch_id: batchId, status: "started" };
    } catch (error: any) {
      console.error("[batch] Error starting batch pipeline:", error);
      return reply.code(500).send({ detail: error.message });
    }
  });

  // Get batch pipeline status
  fastify.get<{ Params: { batch_id: string } }>(
    "/batch/:batch_id/status",
    async (request, reply) => {
      const { batch_id } = request.params;
      const progress = activeBatchProcesses.get(batch_id);

      if (!progress) {
        return reply.code(404).send({ detail: "Batch process not found" });
      }

      return progress;
    },
  );

  // Cancel batch pipeline
  fastify.post<{ Params: { batch_id: string } }>(
    "/batch/:batch_id/cancel",
    async (request, reply) => {
      const { batch_id } = request.params;
      const progress = activeBatchProcesses.get(batch_id);

      if (!progress) {
        return reply.code(404).send({ detail: "Batch process not found" });
      }

      progress.is_running = false;
      console.log(`[batch] Cancellation requested for batch ${batch_id}`);

      return { status: "cancelled" };
    },
  );

  // Continue batch pipeline after approval
  fastify.post<{ Params: { batch_id: string } }>(
    "/batch/:batch_id/continue",
    async (request, reply) => {
      const { batch_id } = request.params;
      const progress = activeBatchProcesses.get(batch_id);

      if (!progress) {
        return reply.code(404).send({ detail: "Batch process not found" });
      }

      if (!progress.waiting_for_approval) {
        return reply.code(400).send({ detail: "Batch is not waiting for approval" });
      }

      // Resume processing
      progress.waiting_for_approval = false;
      console.log(`[batch] Continuing batch ${batch_id} after approval`);

      return { status: "continued" };
    },
  );
}

async function processBatchPipeline(
  batchId: string,
  jobIds: string[],
  options: { transcription: boolean; analysis: boolean; render: boolean; preApprove: boolean },
) {
  const progress = activeBatchProcesses.get(batchId);
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
      const job = metadata.loadJob(jobId);

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
        console.log(`[batch] [${jobId}] Building semantic blocks...`);

        await buildSemanticBlocks(jobId);
        console.log(`[batch] [${jobId}] Semantic blocks completed`);
      }

      // Step 3: Analysis
      if (options.analysis) {
        if (!progress.is_running) break;

        progress.current_step = "analysis";
        console.log(`[batch] [${jobId}] Starting analysis...`);

        const analysisResult = await analyzeBlocks(jobId);
        console.log(`[batch] [${jobId}] Analysis completed`);

        // If preApprove is enabled, wait for user approval
        if (options.preApprove) {
          progress.current_step = "waiting_approval";
          progress.waiting_for_approval = true;

          // Load cuts for approval
          const cutsPath = require("path").join(
            require("../../../core/paths").jobDir(jobId),
            "cuts.json",
          );

          if (require("fs").existsSync(cutsPath)) {
            const cuts = JSON.parse(require("fs").readFileSync(cutsPath, "utf-8"));
            progress.pending_cuts = cuts;
          }

          console.log(`[batch] [${jobId}] Waiting for user approval...`);

          // Wait until approval is given or cancelled
          while (progress.waiting_for_approval && progress.is_running) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }

          if (!progress.is_running) {
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
