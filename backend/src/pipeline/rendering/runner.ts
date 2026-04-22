import type { FFmpegToolConfig } from "../../core/toolConfigs";
import { Cut } from "../../models/cut";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import { runFfmpegAsync } from "../../video/ffmpeg";
import { buildRenderCommand } from "./commands";

export async function runWithConcurrency(
  tasks: Array<() => Promise<void>>,
  limit: number,
): Promise<void> {
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

export async function renderCut(params: {
  jobId: string;
  cut: Cut;
  index: number;
  videoPath: string;
  shortsDir: string;
  ffmpegConfig: FFmpegToolConfig;
  orderedOutputs: string[];
}): Promise<void> {
  if (operationRuntimeService.isRenderingCancelled(params.jobId)) {
    return;
  }

  console.log(
    `[rendering] Rendering cut ${params.cut.cut_id} (${params.cut.start.toFixed(2)}s-${params.cut.end.toFixed(2)}s)`,
  );
  operationRuntimeService.appendTaskLog(
    params.jobId,
    "render",
    `[rendering] Cut ${params.cut.cut_id} ${params.cut.start.toFixed(2)}-${params.cut.end.toFixed(2)}`,
  );

  const { command, filename } = buildRenderCommand({
    cut: params.cut,
    videoPath: params.videoPath,
    shortsDir: params.shortsDir,
    ffmpegConfig: params.ffmpegConfig,
  });

  operationRuntimeService.appendTaskLog(
    params.jobId,
    "render",
    `[rendering] Command: ${command.join(" ")}`,
  );

  try {
    await runFfmpegAsync(
      command,
      (lines) => {
        operationRuntimeService.appendTaskLogs(params.jobId, "render", lines);
      },
      (child) => {
        operationRuntimeService.trackChildProcess(params.jobId, child);
      },
    );
  } catch (error) {
    if (operationRuntimeService.isRenderingCancelled(params.jobId)) {
      return;
    }
    throw error;
  }

  params.orderedOutputs[params.index] = `/media/shorts/${params.jobId}/${filename}`;
  console.log(`[rendering] ✓ Completed cut ${params.cut.cut_id}`);
}
