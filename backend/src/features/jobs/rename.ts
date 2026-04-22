import * as files from "../../storage/files";
import * as jobLifecycleService from "../../services/jobLifecycleService";

export function renameJobVideo(jobId: string, newName: string) {
  console.log(`[jobs] Renaming job ${jobId} to "${newName}"`);
  const success = files.renameVideo(jobId, newName);

  if (!success) {
    return null;
  }

  return jobLifecycleService.loadJob(jobId);
}
