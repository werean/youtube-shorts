import { loadActiveToolConfigs, type FFmpegToolConfig } from "../../core/toolConfigs";
import { Cut } from "../../models/cut";
import { JobStatus } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import { NoApprovedCutsError } from "../errors";

export type PreparedRenderInputs = {
  videoPath: string;
  cuts: Cut[];
  shortsDir: string;
  ffmpegConfig: FFmpegToolConfig;
  concurrency: number;
};

function resolveRenderConcurrency(totalCuts: number, videoCodec: string): number {
  const raw = process.env.RENDER_MAX_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.max(1, Math.min(parsed, totalCuts));
  }
  const fallback = /nvenc/i.test(videoCodec) ? 1 : 2;
  return Math.max(1, Math.min(fallback, totalCuts));
}

export function selectCutsToRender(cuts: Cut[], cutsFileExists: boolean): Cut[] {
  const approved = cuts.filter((cut) => cut.status === "approved");
  if (approved.length > 0) {
    return approved;
  }
  if (cutsFileExists) {
    throw new NoApprovedCutsError(
      cuts.length === 0
        ? "Analysis produced no cuts to render"
        : "No approved cuts to render",
    );
  }
  throw new Error("No cuts found to render");
}

function loadCuts(jobId: string): { cuts: Cut[]; exists: boolean } {
  const cutsFilePath = artifactService.cutsPath(jobId);
  if (!artifactService.artifactExists(cutsFilePath)) {
    return { cuts: [], exists: false };
  }
  return { cuts: artifactService.readJsonArtifact<Cut[]>(cutsFilePath), exists: true };
}

export function beginRenderJob(jobId: string): void {
  operationRuntimeService.clearTaskLogs(jobId, "transcription");
  operationRuntimeService.clearTaskLogs(jobId, "render");
  console.log(`[rendering] Rendering suggested cuts for job ${jobId}`);
  operationRuntimeService.appendTaskLog(jobId, "render", "[rendering] Starting render");
  jobLifecycleService.updateJobStatus(jobId, JobStatus.RENDERING);
}

export function prepareRenderInputs(jobId: string): PreparedRenderInputs {
  const videoPath = artifactService.findSourceVideo(jobId);
  if (!videoPath) {
    throw new Error("Source video not found for job");
  }
  operationRuntimeService.appendTaskLog(jobId, "render", `[rendering] Source: ${videoPath}`);

  const loaded = loadCuts(jobId);
  const renderable = selectCutsToRender(loaded.cuts, loaded.exists);

  const shortsDir = artifactService.ensureShortsJobDir(jobId);
  const ffmpegConfig = loadActiveToolConfigs().ffmpeg;
  const concurrency = resolveRenderConcurrency(
    renderable.length,
    ffmpegConfig.video_codec || "h264_nvenc",
  );

  operationRuntimeService.appendTaskLog(jobId, "render", `[rendering] Concurrency: ${concurrency}`);

  return {
    videoPath,
    cuts: renderable,
    shortsDir,
    ffmpegConfig,
    concurrency,
  };
}
