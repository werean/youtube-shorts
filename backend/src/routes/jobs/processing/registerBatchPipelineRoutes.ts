/**
 * Register batch pipeline routes.
 */

import type { FastifyInstance } from "fastify";
import { processBatchPipeline } from "../../../features/jobs/batch/runner";
import * as operationRuntimeService from "../../../services/operationRuntimeService";
import {
  getBatchOptions,
  hasBatchJobIds,
  type BatchActionResponseDto,
  type BatchIdParamsDto,
  type BatchRunRequestDto,
  type BatchRunResponseDto,
  type BatchStatusResponseDto,
  type ErrorDetailResponseDto,
} from "../../contracts/jobContracts";

export function registerBatchPipelineRoutes(fastify: FastifyInstance) {
  // Start batch pipeline
  fastify.post<{ Body: BatchRunRequestDto; Reply: BatchRunResponseDto | ErrorDetailResponseDto }>(
    "/batch/run",
    async (request, reply) => {
      try {
        const { job_ids, options } = request.body;

        if (!hasBatchJobIds(job_ids)) {
          return reply.code(400).send({ detail: "No job IDs provided" });
        }

        console.log(`[batch] Starting batch pipeline for ${job_ids.length} jobs`);
        console.log(`[batch] Options:`, options);

        const batchId = `batch_${Date.now()}`;
        operationRuntimeService.createBatchProgress(batchId, job_ids);

        // Start processing in background
        processBatchPipeline(batchId, job_ids, getBatchOptions(options)).catch((error) => {
          console.error(`[batch] Fatal error in batch ${batchId}:`, error);
          operationRuntimeService.markBatchNotRunning(batchId);
        });

        return { batch_id: batchId, status: "started" };
      } catch (error: any) {
        console.error("[batch] Error starting batch pipeline:", error);
        return reply.code(500).send({ detail: error.message });
      }
    },
  );

  // Get batch pipeline status
  fastify.get<{ Params: BatchIdParamsDto; Reply: BatchStatusResponseDto | ErrorDetailResponseDto }>(
    "/batch/:batch_id/status",
    async (request, reply) => {
      const { batch_id } = request.params;
      const progress = operationRuntimeService.getBatchProgress(batch_id);

      if (!progress) {
        return reply.code(404).send({ detail: "Batch process not found" });
      }

      return progress;
    },
  );

  // Cancel batch pipeline
  fastify.post<{ Params: BatchIdParamsDto; Reply: BatchActionResponseDto | ErrorDetailResponseDto }>(
    "/batch/:batch_id/cancel",
    async (request, reply) => {
      const { batch_id } = request.params;
      const progress = operationRuntimeService.getBatchProgress(batch_id);

      if (!progress) {
        return reply.code(404).send({ detail: "Batch process not found" });
      }

      progress.is_running = false;
      console.log(`[batch] Cancellation requested for batch ${batch_id}`);

      return { status: "cancelled" };
    },
  );

  // Continue batch pipeline after approval
  fastify.post<{ Params: BatchIdParamsDto; Reply: BatchActionResponseDto | ErrorDetailResponseDto }>(
    "/batch/:batch_id/continue",
    async (request, reply) => {
      const { batch_id } = request.params;
      const progress = operationRuntimeService.getBatchProgress(batch_id);

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
