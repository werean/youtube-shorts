/**
 * Register pipeline routes.
 */

import type { FastifyInstance } from "fastify";
import * as orchestrator from "../../../pipeline/orchestrator";

interface RunPipelineRequest {
  include_render?: boolean;
}

export function registerPipelineRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string }; Body: RunPipelineRequest }>(
    "/:job_id/run",
    async (request, reply) => {
      try {
        const { job_id } = request.params;
        const body = request.body;
        const includeRender = body?.include_render ?? false;

        console.log(`[jobs] Running pipeline for job ${job_id} (include_render=${includeRender})`);
        const job = await orchestrator.runPipeline(job_id, { includeRender });
        return job;
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );
}
