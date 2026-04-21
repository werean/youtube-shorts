/**
 * Register analysis routes.
 */

import type { FastifyInstance } from "fastify";
import { analyzeJobDirectly } from "../../../features/jobs/analysis/directAnalysis";

export function registerAnalysisRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string } }>("/:job_id/analyze", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Analyzing job: ${job_id}`);
      return analyzeJobDirectly(job_id);
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });
}
