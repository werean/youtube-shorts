/**
 * Register rename routes.
 */

import type { FastifyInstance } from "fastify";
import { renameJobVideo } from "../../../features/jobs/rename";

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

        const job = renameJobVideo(job_id, new_name.trim());
        if (!job) {
          return reply.code(500).send({ detail: "Failed to rename video" });
        }

        return job;
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );
}
