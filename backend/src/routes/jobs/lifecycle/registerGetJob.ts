/**
 * Register job read routes.
 */

import type { FastifyInstance } from "fastify";
import * as jobLifecycleService from "../../../services/jobLifecycleService";

export function registerGetJobRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { job_id: string } }>("/:job_id", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[GET /jobs/:job_id] Request para job: ${job_id}`);
      const job = jobLifecycleService.loadJob(job_id);
      console.log(`[GET /jobs/:job_id] ✓ Job carregado - Status: ${job.status}`);
      return job;
    } catch (error: any) {
      console.error(`[GET /jobs/:job_id] ✗ Erro ao carregar job:`, error.message);
      reply.code(404).send({ detail: error.message });
    }
  });
}
