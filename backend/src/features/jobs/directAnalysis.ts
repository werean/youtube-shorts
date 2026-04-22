import { analyzeJobWithPreparedPrerequisites } from "../../pipeline/analysis_prerequisites";

export async function analyzeJobDirectly(jobId: string) {
  return analyzeJobWithPreparedPrerequisites(jobId, {
    semanticBlocks: "ensure",
    onMissingSemanticBlocks: () => {
      console.log(`[jobs] Semantic blocks not found, generating them first for job: ${jobId}`);
    },
  });
}
