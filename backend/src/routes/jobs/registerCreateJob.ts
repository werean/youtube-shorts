/**
 * Register job creation routes.
 */

import type { FastifyInstance } from "fastify";
import { createJobForYoutubeUrl } from "../../features/jobs/create/createJob";

interface CreateJobRequest {
  youtube_url: string;
}

export function registerCreateJobRoutes(fastify: FastifyInstance) {
  fastify.post("", async (request, reply) => {
    try {
      console.log(`[POST /jobs] Request recebido`);
      const body = request.body as CreateJobRequest;
      console.log(`[POST /jobs] Creating job for URL: ${body.youtube_url}`);
      const job = createJobForYoutubeUrl(body.youtube_url);
      return { job };
    } catch (error: any) {
      console.error(`[POST /jobs] ✗ Erro:`, error.message);
      console.error(`[POST /jobs] Stack:`, error.stack);
      reply.code(500).send({ detail: error.message || "Internal server error" });
    }
  });
}
