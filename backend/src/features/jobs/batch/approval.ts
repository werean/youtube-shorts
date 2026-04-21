import * as fs from "fs";
import * as files from "../../../storage/files";
import type { BatchPipelineProgress } from "./types";

export function loadPendingCutsForApproval(jobId: string): any[] | undefined {
  const cutsPath = files.cutsPath(jobId);

  if (!fs.existsSync(cutsPath)) {
    return undefined;
  }

  return JSON.parse(fs.readFileSync(cutsPath, "utf-8"));
}

export async function waitForApproval(progress: BatchPipelineProgress): Promise<boolean> {
  while (progress.waiting_for_approval && progress.is_running) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  return progress.is_running;
}
