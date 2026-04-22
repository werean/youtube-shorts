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
        reply.code(500).send({ detail: error.message });
      }
    },
  );
}
