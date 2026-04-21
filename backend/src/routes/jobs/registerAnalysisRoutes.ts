/**
 * Register analysis routes.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "fs";
import * as analysis from "../../pipeline/analysis";
import * as semanticBlocks from "../../pipeline/semantic_blocks";
import * as files from "../../storage/files";
import * as metadata from "../../storage/metadata";

export function registerAnalysisRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string } }>("/:job_id/analyze", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Analyzing job: ${job_id}`);

      // Check if semantic blocks exist, if not, generate them first
      const blocksPath = files.semanticBlocksPath(job_id);
      if (!fs.existsSync(blocksPath)) {
        console.log(`[jobs] Semantic blocks not found, generating them first for job: ${job_id}`);
        semanticBlocks.buildSemanticBlocks(job_id);
      }

      const job = metadata.loadJob(job_id);
      const result = await analysis.analyzeBlocks(job_id, job.video_duration_seconds ?? 0);
      return result;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });
}
