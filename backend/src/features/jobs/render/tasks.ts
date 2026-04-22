import { JobStatus } from "../../../models/job";
import * as jobLifecycleService from "../../../services/jobLifecycleService";
import * as rendering from "../../../pipeline/rendering";

export function startRenderInBackground(jobId: string): void {
  // Start rendering in background without blocking
  void rendering.renderSuggestedCuts(jobId).catch((error) => {
    console.error(`[jobs] Render failed for job ${jobId}:`, error);
    // Status should already be set to ERROR by rendering.ts, but ensure it
    try {
      const job = jobLifecycleService.loadJob(jobId);
      if (job.status !== JobStatus.ERROR) {
        job.status = JobStatus.ERROR;
        job.updated_at = new Date().toISOString();
        jobLifecycleService.saveJob(job);
      }
    } catch (err) {
      console.error(`[jobs] Failed to update job status to ERROR:`, err);
    }
  });
}
