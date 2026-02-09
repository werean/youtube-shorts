/**
 * Register curation/cuts routes.
 */

import type { FastifyInstance } from "fastify";
import * as curation from "../../pipeline/curation";
import * as fs from "fs";
import * as files from "../../storage/files";
import { Cut } from "../../models/cut";

export function registerCutsRoutes(fastify: FastifyInstance) {
  fastify.get<{ Params: { job_id: string } }>("/:job_id/cuts", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Listing cuts for job: ${job_id}`);
      const cuts = curation.listSuggestions(job_id);
      return cuts;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.put<{ Params: { job_id: string }; Body: { cuts: Cut[] } }>(
    "/:job_id/cuts",
    async (request, reply) => {
      try {
        const { job_id } = request.params;
        const { cuts } = request.body;
        console.log(`[jobs] Updating cuts for job: ${job_id}`);
        console.log(`[jobs] Received cuts:`, cuts);
        console.log(`[jobs] Cuts type:`, typeof cuts);
        console.log(`[jobs] Is array:`, Array.isArray(cuts));

        if (!cuts || !Array.isArray(cuts)) {
          return reply.code(400).send({ detail: "cuts must be an array" });
        }

        const cutsPath = files.cutsPath(job_id);
        const cutsJson = JSON.stringify(cuts, null, 2);
        console.log(`[jobs] Writing to:`, cutsPath);
        console.log(`[jobs] JSON string length:`, cutsJson.length);
        fs.writeFileSync(cutsPath, cutsJson, "utf-8");

        return { ok: true, cuts };
      } catch (error: any) {
        console.error(`[jobs] Error updating cuts:`, error);
        reply.code(500).send({ detail: error.message });
      }
    },
  );

  fastify.post<{ Params: { job_id: string; cut_id: string } }>(
    "/:job_id/cuts/:cut_id/approve",
    async (request, reply) => {
      try {
        const { job_id, cut_id } = request.params;
        console.log(`[jobs] Approving cut ${cut_id} for job ${job_id}`);
        const cut = curation.approveCut(job_id, cut_id);
        return cut;
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );

  fastify.post<{ Params: { job_id: string; cut_id: string } }>(
    "/:job_id/cuts/:cut_id/reject",
    async (request, reply) => {
      try {
        const { job_id, cut_id } = request.params;
        console.log(`[jobs] Rejecting cut ${cut_id} for job ${job_id}`);
        const cut = curation.rejectCut(job_id, cut_id);
        return cut;
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );
}
