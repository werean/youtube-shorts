/**
 * Pipeline step: render vertical shorts with FFmpeg (GPU).
 */

import { JobStatus } from "../models/job";
import * as jobLifecycleService from "../services/jobLifecycleService";
import * as operationRuntimeService from "../services/operationRuntimeService";
import { NoApprovedCutsError } from "./errors";
import { statusAfterInterruptedStep } from "./recoveryStatus";
import { collectOrderedOutputs, listRenderOutputs as listStoredRenderOutputs } from "./rendering/outputs";
import { beginRenderJob, prepareRenderInputs } from "./rendering/preconditions";
import { renderCut, runWithConcurrency } from "./rendering/runner";

export function cancelRendering(jobId: string): boolean {
  const cancelled = operationRuntimeService.cancelActiveRendering(jobId, () =>
    operationRuntimeService.appendTaskLog(jobId, "render", "[rendering] Cancel requested"),
  );
  if (!cancelled) {
    return false;
  }

  jobLifecycleService.updateJobStatus(jobId, statusAfterInterruptedStep(jobId));
  operationRuntimeService.appendTaskLog(jobId, "render", "[rendering] Cancelled");
  return true;
}

async function renderSuggestedCutsUnlocked(jobId: string): Promise<string[]> {
  // Check if another rendering is already running
  const activeJobId = operationRuntimeService.conflictingActiveRenderingJobId(jobId);
  if (activeJobId) {
    const errorMsg = `Renderização já em andamento para outro vídeo (${activeJobId}). Cancele a renderização anterior para começar uma nova.`;
    console.error(`[rendering] ✗ ${errorMsg}`);
    operationRuntimeService.appendTaskLog(jobId, "render", `[rendering] ✗ ${errorMsg}`);
    throw new Error(errorMsg);
  }

  beginRenderJob(jobId);

  const outputs: string[] = [];

  try {
    const { videoPath, cuts, shortsDir, ffmpegConfig, concurrency, preset, segments } =
      prepareRenderInputs(jobId);
    const orderedOutputs = new Array<string>(cuts.length).fill("");

    const hardware = { disabled: false };
    const tasks = cuts.map((cut, index) => async () => {
      await renderCut({
        jobId,
        cut,
        index,
        videoPath,
        shortsDir,
        ffmpegConfig,
        preset,
        segments,
        orderedOutputs,
        hardware,
      });
    });

    await runWithConcurrency(tasks, concurrency);

    outputs.push(...collectOrderedOutputs(orderedOutputs));

    if (operationRuntimeService.isRenderingCancelled(jobId)) {
      jobLifecycleService.updateJobStatus(jobId, statusAfterInterruptedStep(jobId));
      operationRuntimeService.appendTaskLog(jobId, "render", "[rendering] Cancel acknowledged");
      return outputs;
    }

    console.log(`[rendering] ✓ All cuts rendered successfully`);
    jobLifecycleService.updateJobStatus(jobId, JobStatus.DONE);
    operationRuntimeService.appendTaskLog(jobId, "render", "[rendering] ✓ Render complete");

    return outputs;
  } catch (error) {
    if (error instanceof NoApprovedCutsError) {
      jobLifecycleService.updateJobStatus(jobId, JobStatus.WAITING_APPROVAL);
      operationRuntimeService.appendTaskLog(jobId, "render", `[rendering] ${error.message}`);
      throw error;
    }

    if (operationRuntimeService.isRenderingCancelled(jobId)) {
      jobLifecycleService.updateJobStatus(jobId, statusAfterInterruptedStep(jobId));
      operationRuntimeService.appendTaskLog(jobId, "render", "[rendering] Cancel acknowledged");
      return outputs;
    }

    console.error(`[rendering] ✗ Error during rendering:`, error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    operationRuntimeService.appendTaskLog(jobId, "render", `[rendering] ✗ Error: ${errorMsg}`);

    jobLifecycleService.updateJobStatus(jobId, JobStatus.ERROR);

    throw error;
  } finally {
    // Always cleanup the active rendering entry
    operationRuntimeService.cleanupRenderingState(jobId);
    console.log(`[rendering] Cleanup: Removed job ${jobId} from active renderings`);
  }
}

export async function renderSuggestedCuts(jobId: string): Promise<string[]> {
  return operationRuntimeService.runWithJobLock(jobId, () => renderSuggestedCutsUnlocked(jobId));
}

export function listRenderOutputs(jobId: string): string[] {
  return listStoredRenderOutputs(jobId);
}
