import * as fs from "fs";
import { Cut } from "../../models/cut";
import { JobStatus } from "../../models/job";
import * as files from "../../storage/files";
import * as metadata from "../../storage/metadata";

export function persistAnalysisOutput(jobId: string, cuts: Cut[]): void {
  const outputPath = files.cutsPath(jobId);
  fs.writeFileSync(outputPath, JSON.stringify(cuts, null, 2), "utf-8");
  console.log(`[analysis] ${cuts.length} cut(s) saved for job ${jobId}`);

  const job = metadata.loadJob(jobId);
  job.status = JobStatus.WAITING_APPROVAL;
  job.updated_at = new Date().toISOString();
  metadata.saveJob(job);
}
