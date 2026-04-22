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
  job.updated_at = new Date().toISOString();
  jobLifecycleService.saveJob(job);
}
