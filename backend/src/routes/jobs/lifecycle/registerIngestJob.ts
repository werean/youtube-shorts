/**
 * Register job ingest routes.
 */

import type { FastifyInstance } from "fastify";
import * as ingest from "../../../pipeline/ingest";
import * as metadata from "../../../storage/metadata";

export function registerIngestJobRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string } }>("/:job_id/ingest", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Ingesting job: ${job_id}`);
      const job = metadata.loadJob(job_id);
      const result = await ingest.ingestVideo(job);

      return {
        video_path: `/media/videos/${job_id}`,
        metadata_path: result.metadata_path,
        full_path: result.video_path,
      };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });
}
