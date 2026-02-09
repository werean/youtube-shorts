/**
 * Register job creation routes.
 */

import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import { Job, JobStatus } from "../../models/job";
import * as metadata from "../../storage/metadata";

interface CreateJobRequest {
  youtube_url: string;
}

export function registerCreateJobRoutes(fastify: FastifyInstance) {
  fastify.post("", async (request, reply) => {
    try {
      console.log(`[POST /jobs] Request recebido`);
      const body = request.body as CreateJobRequest;
      console.log(`[POST /jobs] Creating job for URL: ${body.youtube_url}`);

      const jobId = uuidv4().replace(/-/g, "");
      console.log(`[POST /jobs] Job ID gerado: ${jobId}`);

      const job: Job = {
        job_id: jobId,
        youtube_url: body.youtube_url,
        status: JobStatus.CREATED,
        created_at: new Date().toISOString(),
      };

      console.log(`[POST /jobs] Salvando job...`);
      metadata.saveJob(job);
      return { job };
    } catch (error: any) {
      console.error(`[POST /jobs] ✗ Erro:`, error.message);
      console.error(`[POST /jobs] Stack:`, error.stack);
      reply.code(500).send({ detail: error.message || "Internal server error" });
    }
  });
}
