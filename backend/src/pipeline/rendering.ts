/**
 * Pipeline step: render vertical shorts with FFmpeg (GPU).
 */

import * as fs from "fs";
import * as path from "path";
import type { ChildProcess } from "child_process";
import { spawn } from "child_process";
import { Cut } from "../models/cut";
import { JobStatus } from "../models/job";
import * as files from "../storage/files";
import * as metadata from "../storage/metadata";
import { runFfmpegAsync } from "../video/ffmpeg";
import { buildVerticalNvencCommand } from "../video/vertical";
import { appendTaskLog, appendTaskLogs, clearTaskLogs } from "../core/taskLogs";

const activeRenderings = new Map<string, ChildProcess>();
const cancelledRenderings = new Set<string>();

function loadCuts(jobId: string): Cut[] {
  const cutsFilePath = files.cutsPath(jobId);
  if (!fs.existsSync(cutsFilePath)) {
    return [];
  }
  const content = fs.readFileSync(cutsFilePath, "utf-8");
  return JSON.parse(content);
}

export function cancelRendering(jobId: string): boolean {
  const child = activeRenderings.get(jobId);
  if (!child || !child.pid) {
    return false;
  }

  appendTaskLog(jobId, "render", "[rendering] Cancel requested");
  cancelledRenderings.add(jobId);

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch (error) {
    console.error(`[rendering] Failed to cancel process for job ${jobId}:`, error);
  }

  activeRenderings.delete(jobId);
  metadata.updateJobStatus(jobId, JobStatus.DOWNLOADED);
  appendTaskLog(jobId, "render", "[rendering] Cancelled");
  return true;
}

export async function renderSuggestedCuts(jobId: string): Promise<string[]> {
  // Check if another rendering is already running
  if (activeRenderings.size > 0) {
    const activeJobIds = Array.from(activeRenderings.keys());
    if (!activeJobIds.includes(jobId)) {
      const errorMsg = `Renderização já em andamento para outro vídeo (${activeJobIds[0]}). Cancele a renderização anterior para começar uma nova.`;
      console.error(`[rendering] ✗ ${errorMsg}`);
      appendTaskLog(jobId, "render", `[rendering] ✗ ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  clearTaskLogs(jobId, "transcription");
  clearTaskLogs(jobId, "render");
  console.log(`[rendering] Rendering suggested cuts for job ${jobId}`);
  appendTaskLog(jobId, "render", "[rendering] Starting render");
  metadata.updateJobStatus(jobId, JobStatus.RENDERING);

  try {
    const videoPath = files.findSourceVideo(jobId);
    if (!videoPath) {
      throw new Error("Source video not found for job");
    }
    appendTaskLog(jobId, "render", `[rendering] Source: ${videoPath}`);

    const cuts = loadCuts(jobId);
    const outputs: string[] = [];

    if (cuts.length === 0) {
      throw new Error("No cuts found to render");
    }

    for (const cut of cuts) {
      console.log(
        `[rendering] Rendering cut ${cut.cut_id} (${cut.start.toFixed(2)}s-${cut.end.toFixed(2)}s)`,
      );
      appendTaskLog(
        jobId,
        "render",
        `[rendering] Cut ${cut.cut_id} ${cut.start.toFixed(2)}-${cut.end.toFixed(2)}`,
      );
      const filename = files.buildCutFilename(cut.start, cut.end);
      const outputPath = path.join(files.ensureShortsJobDir(jobId), filename);

      const command = buildVerticalNvencCommand({
        inputPath: videoPath,
        outputPath,
        start: cut.start,
        end: cut.end,
      });
      appendTaskLog(jobId, "render", `[rendering] Command: ${command.join(" ")}`);

      try {
        await runFfmpegAsync(
          command,
          (lines) => {
            appendTaskLogs(jobId, "render", lines);
          },
          (child) => {
            // Track the actual FFmpeg process for cancellation
            activeRenderings.set(jobId, child);
          },
        );
      } catch (error) {
        if (cancelledRenderings.has(jobId)) {
          appendTaskLog(jobId, "render", "[rendering] Cancel acknowledged");
          const job = metadata.loadJob(jobId);
          job.status = JobStatus.DOWNLOADED;
          job.updated_at = new Date().toISOString();
          metadata.saveJob(job);
          return outputs;
        }
        throw error;
      }
      outputs.push(`/media/shorts/${jobId}/${filename}`);
      console.log(`[rendering] ✓ Completed cut ${cut.cut_id}`);
    }

    console.log(`[rendering] ✓ All cuts rendered successfully`);
    const job = metadata.loadJob(jobId);
    job.status = JobStatus.DONE;
    job.updated_at = new Date().toISOString();
    metadata.saveJob(job);
    appendTaskLog(jobId, "render", "[rendering] ✓ Render complete");

    return outputs;
  } catch (error) {
    console.error(`[rendering] ✗ Error during rendering:`, error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    appendTaskLog(jobId, "render", `[rendering] ✗ Error: ${errorMsg}`);

    const job = metadata.loadJob(jobId);
    job.status = JobStatus.ERROR;
    job.updated_at = new Date().toISOString();
    metadata.saveJob(job);

    throw error;
  } finally {
    // Always cleanup the active rendering entry
    activeRenderings.delete(jobId);
    cancelledRenderings.delete(jobId);
    console.log(`[rendering] Cleanup: Removed job ${jobId} from active renderings`);
  }
}

export function listRenderOutputs(jobId: string): string[] {
  return files.listRenderOutputUrls(jobId);
}
