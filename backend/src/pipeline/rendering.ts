/**
 * Pipeline step: render vertical shorts with FFmpeg (GPU).
 */

import * as fs from "fs";
import { Cut } from "../models/cut";
import { JobStatus } from "../models/job";
import * as files from "../storage/files";
import * as metadata from "../storage/metadata";
import { runFfmpeg } from "../video/ffmpeg";
import { buildVerticalNvencCommand } from "../video/vertical";

function loadCuts(jobId: string): Cut[] {
  const path = files.cutsPath(jobId);
  if (!fs.existsSync(path)) {
    return [];
  }
  const content = fs.readFileSync(path, "utf-8");
  return JSON.parse(content);
}

export function renderSuggestedCuts(jobId: string): string[] {
  console.log(`[rendering] Rendering approved cuts for job ${jobId}`);
  metadata.updateJobStatus(jobId, JobStatus.RENDERING);

  const videoPath = files.findSourceVideo(jobId);
  if (!videoPath) {
    throw new Error("Source video not found for job");
  }

  const cuts = loadCuts(jobId).filter((cut) => cut.status === "approved");
  const outputs: string[] = [];

  for (const cut of cuts) {
    console.log(
      `[rendering] Rendering cut ${cut.cut_id} (${cut.start.toFixed(2)}s-${cut.end.toFixed(2)}s)`,
    );
    const outputPath = files.renderOutputPath(jobId, cut.cut_id);

    const command = buildVerticalNvencCommand({
      inputPath: videoPath,
      outputPath,
      start: cut.start,
      end: cut.end,
    });

    runFfmpeg(command);
    outputs.push(outputPath);
  }

  const job = metadata.loadJob(jobId);
  job.status = JobStatus.DONE;
  job.updated_at = new Date().toISOString();
  metadata.saveJob(job);

  return outputs;
}
