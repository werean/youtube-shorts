/**
 * Register rename routes.
 */

import type { FastifyInstance } from "fastify";
import * as files from "../../storage/files";
import * as metadata from "../../storage/metadata";

export function registerRenameRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string }; Body: { new_name: string } }>(
    "/:job_id/rename",
    async (request, reply) => {
      try {
        const { job_id } = request.params;
        const { new_name } = request.body;

        if (!new_name || typeof new_name !== "string" || !new_name.trim()) {
          return reply.code(400).send({ detail: "new_name is required" });
        }

        console.log(`[jobs] Renaming job ${job_id} to "${new_name}"`);
        const success = files.renameVideo(job_id, new_name.trim());

        if (!success) {
          return reply.code(500).send({ detail: "Failed to rename video" });
        }

        const job = metadata.loadJob(job_id);
        return job;
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );
}
