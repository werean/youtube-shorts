/**
 * Register render routes.
 */

import type { FastifyInstance } from "fastify";
import * as rendering from "../../pipeline/rendering";
import { deleteRenderOutputFile, openRenderOutputFolder } from "./render/outputs";
import { startRenderInBackground } from "./render/tasks";

export function registerRenderRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string } }>("/:job_id/render", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Rendering suggested cuts for job: ${job_id}`);

      startRenderInBackground(job_id);

      return { started: true };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post<{ Params: { job_id: string } }>("/:job_id/render/cancel", async (request, reply) => {
    try {
      const { job_id } = request.params;
      const cancelled = rendering.cancelRendering(job_id);
      if (!cancelled) {
        return reply.code(404).send({ detail: "Rendering not running" });
      }
      return { ok: true, job_id };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.get<{ Params: { job_id: string } }>("/:job_id/renders", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Listing renders for job: ${job_id}`);
      return rendering.listRenderOutputs(job_id);
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.delete<{ Params: { job_id: string; file: string } }>(
    "/:job_id/renders/:file",
    async (request, reply) => {
      try {
        const { job_id, file } = request.params;
        const result = deleteRenderOutputFile(job_id, file);
        if (result.status === "not-found") {
          return reply.code(404).send({ detail: "Render file not found" });
        }

        return { ok: true, file: result.safeFile };
      } catch (error: any) {
        console.error(`[jobs] Error deleting render:`, error);
        reply.code(500).send({ detail: error.message });
      }
    },
  );

  fastify.post<{ Params: { job_id: string; file: string } }>(
    "/:job_id/renders/:file/open-folder",
    async (request, reply) => {
      try {
        const { job_id, file } = request.params;
        const result = openRenderOutputFolder(job_id, file);
        if (!result.ok) {
          return reply.code(result.statusCode).send({ detail: result.detail });
        }

        return { ok: true };
      } catch (error: any) {
        return reply.code(500).send({ detail: error.message });
      }
    },
  );
}
