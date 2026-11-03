/**
 * Register pipeline routes.
 */

import type { FastifyInstance } from "fastify";
import * as orchestrator from "../../../pipeline/orchestrator";
import {
  getPipelineIncludeRender,
  type ErrorDetailResponseDto,
  type JobIdParamsDto,
  type RunPipelineRequestDto,
} from "../../contracts/jobContracts";
import type { Job } from "../../../models/job";
import { JobAlreadyRunningError } from "../../../services/operationRuntimeService";

export function registerPipelineRoutes(fastify: FastifyInstance) {
  fastify.post<{
    Params: JobIdParamsDto;
    Body: RunPipelineRequestDto;
    Reply: Job | ErrorDetailResponseDto;
  }>(
    "/:job_id/run",
    async (request, reply) => {
      try {
        const { job_id } = request.params;
        const includeRender = getPipelineIncludeRender(request.body);

        console.log(`[jobs] Running pipeline for job ${job_id} (include_render=${includeRender})`);
        const job = await orchestrator.runPipeline(job_id, { includeRender });
        return job;
      } catch (error: any) {
        const statusCode = error instanceof JobAlreadyRunningError ? 409 : 500;
        return reply.code(statusCode).send({ detail: error.message });
      }
    },
  );
}
