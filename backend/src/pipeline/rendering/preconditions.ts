import * as fs from "fs";
import { appendTaskLog, clearTaskLogs } from "../../core/taskLogs";
import { loadActiveToolConfigs, type FFmpegToolConfig } from "../../core/toolConfigs";
import { Cut } from "../../models/cut";
import { JobStatus } from "../../models/job";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as files from "../../storage/files";

export type PreparedRenderInputs = {
  videoPath: string;
  cuts: Cut[];
  shortsDir: string;
  ffmpegConfig: FFmpegToolConfig;
  concurrency: number;
};

function resolveRenderConcurrency(totalCuts: number): number {
  const raw = process.env.RENDER_MAX_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const configured = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
  return Math.max(1, Math.min(configured, totalCuts));
}

function loadCuts(jobId: string): Cut[] {
  const cutsFilePath = files.cutsPath(jobId);
  if (!fs.existsSync(cutsFilePath)) {
    return [];
  }
  const content = fs.readFileSync(cutsFilePath, "utf-8");
  return JSON.parse(content);
}

export function beginRenderJob(jobId: string): void {
  clearTaskLogs(jobId, "transcription");
  clearTaskLogs(jobId, "render");
  console.log(`[rendering] Rendering suggested cuts for job ${jobId}`);
  appendTaskLog(jobId, "render", "[rendering] Starting render");
  jobLifecycleService.updateJobStatus(jobId, JobStatus.RENDERING);
}

export function prepareRenderInputs(jobId: string): PreparedRenderInputs {
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
  const concurrency = resolveRenderConcurrency(cuts.length);

  appendTaskLog(jobId, "render", `[rendering] Concurrency: ${concurrency}`);

  return {
    videoPath,
    cuts,
    shortsDir,
    ffmpegConfig,
    concurrency,
  };
}
