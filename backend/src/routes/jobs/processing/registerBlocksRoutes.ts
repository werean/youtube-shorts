/**
 * Register semantic blocks routes.
 */

import type { FastifyInstance } from "fastify";
import * as semanticBlocks from "../../../pipeline/semantic_blocks";

export function registerBlocksRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string } }>("/:job_id/blocks", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Building blocks for job: ${job_id}`);
      const blocks = semanticBlocks.buildSemanticBlocks(job_id);
      return blocks;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });
}
