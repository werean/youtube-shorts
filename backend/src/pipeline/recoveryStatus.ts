import { JobStatus } from "../models/job";
import * as artifactService from "../services/artifactService";

/**
 * Status to restore when a running step is cancelled.
 * DOWNLOADED only when transcription has not been written yet.
 */
export function statusAfterInterruptedStep(jobId: string): JobStatus {
  if (artifactService.artifactExists(artifactService.cutsPath(jobId))) {
    return JobStatus.WAITING_APPROVAL;
  }
  if (artifactService.artifactExists(artifactService.semanticBlocksPath(jobId))) {
    return JobStatus.BUILDING_TOPICS;
  }
  if (artifactService.artifactExists(artifactService.transcriptionPath(jobId))) {
    return JobStatus.BUILDING_BLOCKS;
  }
  return JobStatus.DOWNLOADED;
}
