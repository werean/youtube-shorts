import * as fs from "fs";
import * as path from "path";
import { getVideoDir } from "../../core/settings";
import { Job, JobStatus } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import { IngestResult } from "./types";

export function handleDownloadedArtifacts(
  job: Job,
  infoPath: string,
  outputPattern: string,
): IngestResult {
  const outputDir = path.dirname(outputPattern);
  const filesInDir = fs.readdirSync(outputDir);
  const downloadedFile = filesInDir.find((f) => f.startsWith("video."));

  if (!downloadedFile) {
    throw new Error("Arquivo baixado não encontrado");
  }

  let downloadedPath = path.join(outputDir, downloadedFile);
  console.log(`[ingest] ✓ Arquivo baixado: ${downloadedFile}`);
  operationRuntimeService.appendTaskLog(job.job_id, "ingest", `[ingest] File: ${downloadedFile}`);

  const updatedJob = jobLifecycleService.loadJob(job.job_id);
  updatedJob.updated_at = new Date().toISOString();
  updatedJob.status = JobStatus.DOWNLOADED;
  updatedJob.source_video_path = downloadedPath;

  // Try to get video title from info JSON
  try {
    const infoContent = artifactService.readTextArtifact(infoPath);
    const infoData = JSON.parse(infoContent);
    if (infoData.title && !updatedJob.video_name) {
      updatedJob.video_name = infoData.title;
    }
  } catch (e) {
    // If we can't read info, use job_id as fallback
    if (!updatedJob.video_name) {
      updatedJob.video_name = updatedJob.job_id;
    }
  }

  if (updatedJob.video_name && updatedJob.video_name !== updatedJob.job_id) {
    const newVideoDir = getVideoDir(updatedJob.job_id, updatedJob.video_name);
    if (!fs.existsSync(newVideoDir)) {
      fs.mkdirSync(path.dirname(newVideoDir), { recursive: true });
    }
    if (outputDir !== newVideoDir) {
      fs.renameSync(outputDir, newVideoDir);
      downloadedPath = path.join(newVideoDir, path.basename(downloadedPath));
    }
  }

  updatedJob.source_video_path = downloadedPath;
  jobLifecycleService.saveJob(updatedJob);

  console.log(`[ingest] ✓ Video pronto para reprodução: ${downloadedFile}`);
  console.log(`[ingest] ============================================\n`);
  operationRuntimeService.appendTaskLog(job.job_id, "ingest", "[ingest] Video ready for playback");

  return {
    video_path: downloadedPath,
    metadata_path: infoPath,
  };
}
