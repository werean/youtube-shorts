/**
 * Pipeline step: render vertical shorts with FFmpeg (GPU).
 */

import { appendTaskLog } from "../core/taskLogs";
import { JobStatus } from "../models/job";
import * as jobLifecycleService from "../services/jobLifecycleService";
import { collectOrderedOutputs, listRenderOutputs as listStoredRenderOutputs } from "./rendering/outputs";
import { beginRenderJob, prepareRenderInputs } from "./rendering/preconditions";
import { renderCut, runWithConcurrency } from "./rendering/runner";
import {
  cancelActiveRendering,
  cleanupRenderingState,
  conflictingActiveRenderingJobId,
  isRenderingCancelled,
} from "./rendering/state";

export function cancelRendering(jobId: string): boolean {
  const cancelled = cancelActiveRendering(jobId, () =>
    appendTaskLog(jobId, "render", "[rendering] Cancel requested"),
  );
  if (!cancelled) {
    return false;
  }

  jobLifecycleService.updateJobStatus(jobId, JobStatus.DOWNLOADED);
  appendTaskLog(jobId, "render", "[rendering] Cancelled");
  return true;
}

export async function renderSuggestedCuts(jobId: string): Promise<string[]> {
  // Check if another rendering is already running
  const activeJobId = conflictingActiveRenderingJobId(jobId);
  if (activeJobId) {
    const errorMsg = `Renderização já em andamento para outro vídeo (${activeJobId}). Cancele a renderização anterior para começar uma nova.`;
    console.error(`[rendering] ✗ ${errorMsg}`);
    appendTaskLog(jobId, "render", `[rendering] ✗ ${errorMsg}`);
    throw new Error(errorMsg);
  }

  beginRenderJob(jobId);

  const outputs: string[] = [];

  try {
    const { videoPath, cuts, shortsDir, ffmpegConfig, concurrency } = prepareRenderInputs(jobId);
    const orderedOutputs = new Array<string>(cuts.length).fill("");

    const tasks = cuts.map((cut, index) => async () => {
      await renderCut({
        jobId,
        cut,
        index,
        videoPath,
        shortsDir,
        ffmpegConfig,
        orderedOutputs,
      });
    });

    await runWithConcurrency(tasks, concurrency);

    outputs.push(...collectOrderedOutputs(orderedOutputs));

    if (isRenderingCancelled(jobId)) {
      jobLifecycleService.updateJobStatus(jobId, JobStatus.DOWNLOADED);
      appendTaskLog(jobId, "render", "[rendering] Cancel acknowledged");
      return outputs;
    }

    console.log(`[rendering] ✓ All cuts rendered successfully`);
    jobLifecycleService.updateJobStatus(jobId, JobStatus.DONE);
    appendTaskLog(jobId, "render", "[rendering] ✓ Render complete");

    return outputs;
  } catch (error) {
    if (isRenderingCancelled(jobId)) {
      jobLifecycleService.updateJobStatus(jobId, JobStatus.DOWNLOADED);
      appendTaskLog(jobId, "render", "[rendering] Cancel acknowledged");
      return outputs;
    }

    console.error(`[rendering] ✗ Error during rendering:`, error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    appendTaskLog(jobId, "render", `[rendering] ✗ Error: ${errorMsg}`);

    jobLifecycleService.updateJobStatus(jobId, JobStatus.ERROR);

    throw error;
  } finally {
    // Always cleanup the active rendering entry
    cleanupRenderingState(jobId);
    console.log(`[rendering] Cleanup: Removed job ${jobId} from active renderings`);
  }
}

export function listRenderOutputs(jobId: string): string[] {
  return listStoredRenderOutputs(jobId);
}
