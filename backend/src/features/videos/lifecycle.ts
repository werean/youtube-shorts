import * as fs from "fs";
import * as path from "path";

import { jobDir } from "../../core/paths";
import {
  archivedVideosDir,
  getArchivedVideoDir,
  getVideoDir,
  loadSettings,
} from "../../core/settings";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import { openFolderInExplorerForFile } from "../../utils/openFolder";

export function archiveVideo(jobId: string): { ok: true; job_id: string } | { ok: false } {
  const job = jobLifecycleService.loadJob(jobId);

  const videoName = job.video_name || jobId;
  const videoDir = getVideoDir(jobId, videoName);

  if (!fs.existsSync(videoDir)) {
    return { ok: false };
  }

  const targetDir = getArchivedVideoDir(videoName);
  fs.renameSync(videoDir, targetDir);

  const filesInDir = fs.readdirSync(targetDir);
  const videoFile = filesInDir.find((file) => file.startsWith("video."));
  if (videoFile) {
    job.source_video_path = path.join(targetDir, videoFile);
  }
  job.updated_at = new Date().toISOString();
  jobLifecycleService.saveJob(job);

  return { ok: true, job_id: jobId };
}

export function deleteVideo(jobId: string): { ok: true; job_id: string } | { ok: false } {
  try {
    const job = jobLifecycleService.loadJob(jobId);
    const videoName = job.video_name || jobId;
    const activeDir = getVideoDir(jobId, videoName);
    const archivedDir = getArchivedVideoDir(videoName);

    if (job.source_video_path) {
      const videoDir = path.dirname(job.source_video_path);
      if (fs.existsSync(videoDir)) {
        fs.rmSync(videoDir, { recursive: true, force: true });
      }
    }

    if (fs.existsSync(activeDir)) {
      fs.rmSync(activeDir, { recursive: true, force: true });
    }

    if (fs.existsSync(archivedDir)) {
      fs.rmSync(archivedDir, { recursive: true, force: true });
    }
  } catch {
    return { ok: false };
  }

  artifactService.deleteRenderOutputs(jobId);

  const dataPath = jobDir(jobId);
  if (fs.existsSync(dataPath)) {
    fs.rmSync(dataPath, { recursive: true, force: true });
  }

  jobLifecycleService.invalidateJobCache(jobId);
  artifactService.invalidateSourceVideoCache(jobId);

  return { ok: true, job_id: jobId };
}

export function openVideoFolder(
  jobId: string,
): { ok: true } | { ok: false; detail: string; statusCode: number } {
  const job = jobLifecycleService.loadJob(jobId);
  const filePath = job.source_video_path;

  if (!filePath || typeof filePath !== "string") {
    return { ok: false, detail: "Video path not set", statusCode: 404 };
  }

  const settings = loadSettings();
  const allowedRoots = [settings.media.base_dir, archivedVideosDir()];
  const result = openFolderInExplorerForFile(filePath, allowedRoots);

  if (!result.ok) {
    const msg = result.detail || "Failed to open folder";
    const status = msg === "File not found" ? 404 : msg === "Invalid path" ? 400 : 500;
    return { ok: false, detail: msg, statusCode: status };
  }

  return { ok: true };
}
