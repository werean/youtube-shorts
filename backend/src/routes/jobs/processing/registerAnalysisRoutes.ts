/**
 * Register analysis routes.
 */

import type { FastifyInstance } from "fastify";
import { analyzeJobDirectly } from "../../../features/jobs/directAnalysis";
import { JobAlreadyRunningError } from "../../../services/operationRuntimeService";

export function registerAnalysisRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string } }>("/:job_id/analyze", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Analyzing job: ${job_id}`);
      return await analyzeJobDirectly(job_id);
    } catch (error: any) {
      const statusCode = error instanceof JobAlreadyRunningError ? 409 : 500;
      return reply.code(statusCode).send({ detail: error.message });
    }
  });
}
