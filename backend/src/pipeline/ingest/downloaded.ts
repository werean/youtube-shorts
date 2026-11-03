import * as fs from "fs";
import * as path from "path";
import { getVideoDir } from "../../core/settings";
import { isVideoFileName } from "../../core/videoFiles";
import { Job, JobStatus } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import { IngestResult } from "./types";

function pickDownloadedVideo(fileNames: string[]): string | undefined {
  return fileNames
    .filter((name) => name.startsWith("video.") && isVideoFileName(name))
    .sort()[0];
}

function copyInfoJson(outputDir: string, fileNames: string[], videoFile: string, infoPath: string): void {
  const candidates = [
    `${videoFile}.info.json`,
    "video.info.json",
    ...fileNames.filter((name) => name.startsWith("video.") && name.endsWith(".info.json")),
  ];
  for (const name of candidates) {
    const source = path.join(outputDir, name);
    if (!fs.existsSync(source)) {
      continue;
    }
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    if (path.resolve(source) !== path.resolve(infoPath)) {
      fs.copyFileSync(source, infoPath);
    }
    return;
  }
}

function readInfo(infoPath: string): { title?: string; duration?: number } | null {
  if (!fs.existsSync(infoPath)) {
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(infoPath, "utf-8")) as { title?: string; duration?: number };
  } catch {
    return null;
  }
}

export function handleDownloadedArtifacts(
  job: Job,
  infoPath: string,
  outputPattern: string,
): IngestResult {
  const outputDir = path.dirname(outputPattern);
  const filesInDir = fs.readdirSync(outputDir);
  const downloadedFile = pickDownloadedVideo(filesInDir);

  if (!downloadedFile) {
    throw new Error("Arquivo baixado não encontrado");
  }

  let downloadedPath = path.join(outputDir, downloadedFile);
  console.log(`[ingest] ✓ Arquivo baixado: ${downloadedFile}`);
  operationRuntimeService.appendTaskLog(job.job_id, "ingest", `[ingest] File: ${downloadedFile}`);

  copyInfoJson(outputDir, filesInDir, downloadedFile, infoPath);
  const info = readInfo(infoPath);

  const updatedJob = jobLifecycleService.loadJob(job.job_id);
  updatedJob.updated_at = new Date().toISOString();
  updatedJob.status = JobStatus.DOWNLOADED;
  updatedJob.source_video_path = downloadedPath;
  if (info?.title && !updatedJob.video_name) {
    updatedJob.video_name = info.title;
  }
  if (typeof info?.duration === "number" && Number.isFinite(info.duration)) {
    updatedJob.video_duration_seconds = info.duration;
  }
  if (!updatedJob.video_name) {
    updatedJob.video_name = updatedJob.job_id;
  }

  if (updatedJob.video_name && updatedJob.video_name !== updatedJob.job_id) {
    const newVideoDir = getVideoDir(updatedJob.job_id, updatedJob.video_name);
    if (!fs.existsSync(newVideoDir)) {
      fs.mkdirSync(newVideoDir, { recursive: true });
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
