import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";

export function renameJobVideo(jobId: string, newName: string) {
  console.log(`[jobs] Renaming job ${jobId} to "${newName}"`);
  const success = artifactService.renameVideo(jobId, newName);

  if (!success) {
    return null;
  }

  return jobLifecycleService.loadJob(jobId);
}
