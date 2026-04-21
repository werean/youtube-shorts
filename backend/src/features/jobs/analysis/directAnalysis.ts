import * as analysis from "../../../pipeline/analysis";
import { ensureSemanticBlocksForAnalysis } from "../../../pipeline/analysis_prerequisites";
import * as metadata from "../../../storage/metadata";

export async function analyzeJobDirectly(jobId: string) {
  ensureSemanticBlocksForAnalysis(jobId, () => {
    console.log(`[jobs] Semantic blocks not found, generating them first for job: ${jobId}`);
  });

  const job = metadata.loadJob(jobId);
  return analysis.analyzeBlocks(jobId, job.video_duration_seconds ?? 0);
}
