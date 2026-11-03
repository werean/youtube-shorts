import { Cut } from "../../models/cut";
import { JobStatus } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";

export function persistAnalysisOutput(jobId: string, cuts: Cut[]): void {
  const outputPath = artifactService.cutsPath(jobId);
  artifactService.writeJsonArtifact(outputPath, cuts);
  console.log(`[analysis] ${cuts.length} cut(s) saved for job ${jobId}`);

  const job = jobLifecycleService.loadJob(jobId);
  job.status = JobStatus.WAITING_APPROVAL;
  job.last_error = null;
  job.updated_at = new Date().toISOString();
  jobLifecycleService.saveJob(job);
  if (cuts.length === 0) {
    console.log(
      `[analysis] Analysis completed with no cuts for job ${jobId}. Coherence rejections are in the log; this was not an LLM failure.`,
    );
  }
}
