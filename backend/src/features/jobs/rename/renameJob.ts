import * as files from "../../../storage/files";
import * as metadata from "../../../storage/metadata";

export function renameJobVideo(jobId: string, newName: string) {
  console.log(`[jobs] Renaming job ${jobId} to "${newName}"`);
  const success = files.renameVideo(jobId, newName);

  if (!success) {
    return null;
  }

  return metadata.loadJob(jobId);
}
