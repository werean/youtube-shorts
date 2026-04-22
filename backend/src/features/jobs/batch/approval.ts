import * as artifactService from "../../../services/artifactService";
import type { BatchPipelineProgress } from "./types";

export function loadPendingCutsForApproval(jobId: string): any[] | undefined {
  const cutsPath = artifactService.cutsPath(jobId);

  if (!artifactService.artifactExists(cutsPath)) {
    return undefined;
  }

  return artifactService.readJsonArtifact<any[]>(cutsPath);
}

export async function waitForApproval(progress: BatchPipelineProgress): Promise<boolean> {
  while (progress.waiting_for_approval && progress.is_running) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return progress.is_running;
}
