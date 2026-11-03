import { loadActiveToolConfigs, type FFmpegToolConfig } from "../../core/toolConfigs";
import { loadSettings } from "../../core/settings";
import { Cut } from "../../models/cut";
import { JobStatus } from "../../models/job";
import type { Segment } from "../../models/segment";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import {
  defaultStyleLibrary,
  normalizeStyleLibrary,
  type ShortStylePreset,
} from "../../../../shared/stylePresets";

export type PreparedRenderInputs = {
  videoPath: string;
  cuts: Cut[];
  shortsDir: string;
  ffmpegConfig: FFmpegToolConfig;
  concurrency: number;
  preset: ShortStylePreset;
  segments: Segment[];
};

function resolveRenderConcurrency(totalCuts: number): number {
  const raw = process.env.RENDER_MAX_CONCURRENCY;
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  const configured = Number.isFinite(parsed) && parsed > 0 ? parsed : 2;
  return Math.max(1, Math.min(configured, totalCuts));
}

function loadCuts(jobId: string): Cut[] {
  const cutsFilePath = artifactService.cutsPath(jobId);
  if (!artifactService.artifactExists(cutsFilePath)) {
    return [];
  }
  return artifactService.readJsonArtifact<Cut[]>(cutsFilePath);
}

export function beginRenderJob(jobId: string): void {
  operationRuntimeService.clearTaskLogs(jobId, "transcription");
  operationRuntimeService.clearTaskLogs(jobId, "render");
  console.log(`[rendering] Rendering suggested cuts for job ${jobId}`);
  operationRuntimeService.appendTaskLog(jobId, "render", "[rendering] Starting render");
  jobLifecycleService.updateJobStatus(jobId, JobStatus.RENDERING);
}

export function loadActiveShortPreset(): ShortStylePreset {
  try {
    const library = normalizeStyleLibrary(loadSettings().style_library);
    return library.presets.find((preset) => preset.id === library.activeId) ?? library.presets[0];
  } catch (error) {
    console.warn("[rendering] Preset salvo indisponível. Usando o padrão.", error);
    const library = defaultStyleLibrary();
    return library.presets[0];
  }
}

function loadTranscript(jobId: string): Segment[] {
  try {
    const transcriptPath = artifactService.transcriptionPath(jobId);
    if (!transcriptPath || !artifactService.artifactExists(transcriptPath)) return [];
    const parsed = artifactService.readJsonArtifact<Segment[]>(transcriptPath);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn("[rendering] Transcrição indisponível para as legendas.", error);
    return [];
  }
}

export function prepareRenderInputs(jobId: string): PreparedRenderInputs {
  const videoPath = artifactService.findSourceVideo(jobId);
  if (!videoPath) {
    throw new Error("Source video not found for job");
  }
  operationRuntimeService.appendTaskLog(jobId, "render", `[rendering] Source: ${videoPath}`);

  const cuts = loadCuts(jobId);

  if (cuts.length === 0) {
    throw new Error("No cuts found to render");
  }

  const shortsDir = artifactService.ensureShortsJobDir(jobId);
  const ffmpegConfig = loadActiveToolConfigs().ffmpeg;
  const concurrency = resolveRenderConcurrency(cuts.length);

  operationRuntimeService.appendTaskLog(jobId, "render", `[rendering] Concurrency: ${concurrency}`);

  return {
    videoPath,
    cuts,
    shortsDir,
    ffmpegConfig,
    concurrency,
    preset: loadActiveShortPreset(),
    segments: loadTranscript(jobId),
  };
}
