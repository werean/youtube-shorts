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
import { loadActiveToolConfigs } from "../core/toolConfigs";
import { runFfmpegAsync } from "../video/ffmpeg";
import { buildVerticalNvencCommand } from "../video/vertical";
import { appendTaskLog, appendTaskLogs, clearTaskLogs } from "../core/taskLogs";

const activeRenderings = new Map<string, Set<ChildProcess>>();
const cancelledRenderings = new Set<string>();

function resolveRenderConcurrency(totalCuts: number): number {
  const raw = process.env.RENDER_MAX_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const configured = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
  return Math.max(1, Math.min(configured, totalCuts));
}

function trackChildProcess(jobId: string, child: ChildProcess): void {
  let children = activeRenderings.get(jobId);
  if (!children) {
    children = new Set<ChildProcess>();
    activeRenderings.set(jobId, children);
  }

  children.add(child);

  child.once("exit", () => {
    const running = activeRenderings.get(jobId);
    if (!running) {
      return;
    }
    running.delete(child);
    if (running.size === 0) {
      activeRenderings.delete(jobId);
    }
  });
}

function stopChildProcess(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
    return;
  }

  child.kill("SIGTERM");
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, limit: number): Promise<void> {
  if (tasks.length === 0) {
    return;
  }

  let index = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (true) {
      const current = index;
      index += 1;

      if (current >= tasks.length) {
        return;
      }

      await tasks[current]();
    }
  });

  await Promise.all(workers);
}

function loadCuts(jobId: string): Cut[] {
  const cutsFilePath = files.cutsPath(jobId);
  if (!fs.existsSync(cutsFilePath)) {
    return [];
  }
  const content = fs.readFileSync(cutsFilePath, "utf-8");
  return JSON.parse(content);
}

export function cancelRendering(jobId: string): boolean {
  const children = activeRenderings.get(jobId);
  if (!children || children.size === 0) {
    return false;
  }

  appendTaskLog(jobId, "render", "[rendering] Cancel requested");
  cancelledRenderings.add(jobId);

  try {
    for (const child of children) {
      stopChildProcess(child);
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
  if (activeRenderings.size > 0 && !activeRenderings.has(jobId)) {
    const activeJobIds = Array.from(activeRenderings.keys());
    const errorMsg = `Renderização já em andamento para outro vídeo (${activeJobIds[0]}). Cancele a renderização anterior para começar uma nova.`;
    console.error(`[rendering] ✗ ${errorMsg}`);
    appendTaskLog(jobId, "render", `[rendering] ✗ ${errorMsg}`);
    throw new Error(errorMsg);
  }

  clearTaskLogs(jobId, "transcription");
  clearTaskLogs(jobId, "render");
  console.log(`[rendering] Rendering suggested cuts for job ${jobId}`);
  appendTaskLog(jobId, "render", "[rendering] Starting render");
  metadata.updateJobStatus(jobId, JobStatus.RENDERING);

  const outputs: string[] = [];

  try {
    const videoPath = files.findSourceVideo(jobId);
    if (!videoPath) {
      throw new Error("Source video not found for job");
    }
    appendTaskLog(jobId, "render", `[rendering] Source: ${videoPath}`);

    const cuts = loadCuts(jobId);

    if (cuts.length === 0) {
      throw new Error("No cuts found to render");
    }

    const shortsDir = files.ensureShortsJobDir(jobId);
    const ffmpegConfig = loadActiveToolConfigs().ffmpeg;
    const orderedOutputs = new Array<string>(cuts.length).fill("");
    const concurrency = resolveRenderConcurrency(cuts.length);

    appendTaskLog(jobId, "render", `[rendering] Concurrency: ${concurrency}`);

    const tasks = cuts.map((cut, index) => async () => {
      if (cancelledRenderings.has(jobId)) {
        return;
      }

      console.log(
        `[rendering] Rendering cut ${cut.cut_id} (${cut.start.toFixed(2)}s-${cut.end.toFixed(2)}s)`,
      );
      appendTaskLog(
        jobId,
        "render",
        `[rendering] Cut ${cut.cut_id} ${cut.start.toFixed(2)}-${cut.end.toFixed(2)}`,
      );

      const filename = files.buildCutFilename(cut.start, cut.end);
      const outputPath = path.join(shortsDir, filename);
      const command = buildVerticalNvencCommand({
        inputPath: videoPath,
        outputPath,
        start: cut.start,
        end: cut.end,
        ffmpegConfig,
      });

      appendTaskLog(jobId, "render", `[rendering] Command: ${command.join(" ")}`);

      try {
        await runFfmpegAsync(
          command,
          (lines) => {
            appendTaskLogs(jobId, "render", lines);
          },
          (child) => {
            trackChildProcess(jobId, child);
          },
        );
      } catch (error) {
        if (cancelledRenderings.has(jobId)) {
          return;
        }
        throw error;
      }

      orderedOutputs[index] = `/media/shorts/${jobId}/${filename}`;
      console.log(`[rendering] ✓ Completed cut ${cut.cut_id}`);
    });

    await runWithConcurrency(tasks, concurrency);

    for (const output of orderedOutputs) {
      if (output) {
        outputs.push(output);
      }
    }

    if (cancelledRenderings.has(jobId)) {
      metadata.updateJobStatus(jobId, JobStatus.DOWNLOADED);
      appendTaskLog(jobId, "render", "[rendering] Cancel acknowledged");
      return outputs;
    }

    console.log(`[rendering] ✓ All cuts rendered successfully`);
    metadata.updateJobStatus(jobId, JobStatus.DONE);
    appendTaskLog(jobId, "render", "[rendering] ✓ Render complete");

    return outputs;
  } catch (error) {
    if (cancelledRenderings.has(jobId)) {
      metadata.updateJobStatus(jobId, JobStatus.DOWNLOADED);
      appendTaskLog(jobId, "render", "[rendering] Cancel acknowledged");
      return outputs;
    }

    console.error(`[rendering] ✗ Error during rendering:`, error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    appendTaskLog(jobId, "render", `[rendering] ✗ Error: ${errorMsg}`);

    metadata.updateJobStatus(jobId, JobStatus.ERROR);

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
