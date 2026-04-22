/**
 * Register job upload routes.
 */

import type { FastifyInstance } from "fastify";
import { saveUploadedVideoJob } from "../../../features/jobs/upload";

export function registerUploadJobRoutes(fastify: FastifyInstance) {
  fastify.post("/upload", async (request, reply) => {
    try {
      console.log(`[POST /jobs/upload] Request recebido`);

      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ detail: "No file uploaded" });
      }

      return saveUploadedVideoJob(data);
    } catch (error: any) {
      console.error(`[POST /jobs/upload] ✗ Erro:`, error.message);
      console.error(`[POST /jobs/upload] Stack:`, error.stack);
      reply.code(500).send({ detail: error.message || "Internal server error" });
    }
  });
}
