/**
 * Register analysis routes.
 */

import type { FastifyInstance } from "fastify";
import * as analysis from "../../pipeline/analysis";
import { ensureSemanticBlocksForAnalysis } from "../../pipeline/analysis_prerequisites";
import * as metadata from "../../storage/metadata";

export function registerAnalysisRoutes(fastify: FastifyInstance) {
  fastify.post<{ Params: { job_id: string } }>("/:job_id/analyze", async (request, reply) => {
    try {
      const { job_id } = request.params;
      console.log(`[jobs] Analyzing job: ${job_id}`);

      ensureSemanticBlocksForAnalysis(job_id, () => {
        console.log(`[jobs] Semantic blocks not found, generating them first for job: ${job_id}`);
      });

      const job = metadata.loadJob(job_id);
      const result = await analysis.analyzeBlocks(job_id, job.video_duration_seconds ?? 0);
      return result;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });
}
