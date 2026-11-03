import { loadActiveToolConfigs, type FFmpegToolConfig } from "../../core/toolConfigs";
import { Cut } from "../../models/cut";
import { JobStatus } from "../../models/job";
import { SemanticBlock } from "../../models/semantic_block";
import { TopicSegment } from "../../models/topic_segment";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import { repairCutRange } from "../analysis/cuts";
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

function snapApprovedCuts(jobId: string, cuts: Cut[]): Cut[] {
  const blocksPath = artifactService.semanticBlocksPath(jobId);
  if (!artifactService.artifactExists(blocksPath)) {
    return cuts;
  }

  const blocks = artifactService.readJsonArtifact<SemanticBlock[]>(blocksPath);
  let topics: TopicSegment[] | undefined;
  const topicsPath = artifactService.topicSegmentsPath(jobId);
  if (artifactService.artifactExists(topicsPath)) {
    try {
      topics = artifactService.readJsonArtifact<TopicSegment[]>(topicsPath);
    } catch {
      topics = undefined;
    }
  }

  const ready: Cut[] = [];
  for (const cut of cuts) {
    const repaired = repairCutRange(
      {
        blocks: cut.block_ids,
        start: cut.start,
        end: cut.end,
        title: cut.title ?? undefined,
      },
      blocks,
      topics,
    );
    if (!repaired.ok) {
      operationRuntimeService.appendTaskLog(
        jobId,
        "render",
        `[rendering] skipping ${cut.cut_id}: ${repaired.reason}`,
      );
      continue;
    }
    ready.push({
      ...cut,
      block_ids: repaired.cut.blocks,
      start: repaired.cut.start,
      end: repaired.cut.end,
    });
  }
  return ready;
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

  const approved = cuts.filter((cut) => cut.status === "approved");
  if (approved.length === 0) {
    throw new NoApprovedCutsError();
  }

  const renderable = snapApprovedCuts(jobId, approved);
  if (renderable.length === 0) {
    throw new NoApprovedCutsError("No coherent approved cuts to render");
  }

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
