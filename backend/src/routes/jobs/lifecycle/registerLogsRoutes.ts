/**
 * Register task logs routes.
 */

import type { FastifyInstance } from "fastify";
import { getTaskLogs } from "../../../core/taskLogs";

export function registerLogsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { job_id: string; task: string } }>(
    "/:job_id/logs/:task",
    async (request, reply) => {
      try {
        const { job_id, task } = request.params;
        if (task !== "transcription" && task !== "render" && task !== "ingest") {
          return reply.code(400).send({ detail: "Invalid task" });
        }
        const logs = getTaskLogs(job_id, task);
        return { task, logs };
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );
}
