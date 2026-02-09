/**
 * Register render routes.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "fs";
import * as path from "path";
import { JobStatus } from "../../models/job";
import * as metadata from "../../storage/metadata";
import * as rendering from "../../pipeline/rendering";
import * as files from "../../storage/files";

export function registerRenderRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string } }>("/:job_id/render", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Rendering suggested cuts for job: ${job_id}`);

      // Start rendering in background without blocking
      void rendering.renderSuggestedCuts(job_id).catch((error) => {
        console.error(`[jobs] Render failed for job ${job_id}:`, error);
        // Status should already be set to ERROR by rendering.ts, but ensure it
        try {
          const job = metadata.loadJob(job_id);
          if (job.status !== JobStatus.ERROR) {
            job.status = JobStatus.ERROR;
            job.updated_at = new Date().toISOString();
            metadata.saveJob(job);
          }
        } catch (err) {
          console.error(`[jobs] Failed to update job status to ERROR:`, err);
        }
      });

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
        const safeFile = path.basename(file);
        console.log(`[jobs] Deleting render: ${job_id}/${safeFile}`);

        const shortsDir = files.ensureShortsJobDir(job_id);
        const filePath = path.join(shortsDir, safeFile);

        if (!fs.existsSync(filePath)) {
          return reply.code(404).send({ detail: "Render file not found" });
        }

        fs.unlinkSync(filePath);
        console.log(`[jobs] ✓ Render deleted: ${filePath}`);

        return { ok: true, file: safeFile };
      } catch (error: any) {
        console.error(`[jobs] Error deleting render:`, error);
        reply.code(500).send({ detail: error.message });
      }
    },
  );
}
