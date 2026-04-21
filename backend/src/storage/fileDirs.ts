import * as fs from "fs";
import * as path from "path";
import { jobDir } from "../core/paths";
import {
  getShortsDir,
  getTranscriptionsDir,
  getVideoDir,
  getVideoFilePath,
  getVideoFolder,
  loadSettings,
} from "../core/settings";
import * as metadata from "./metadata";

const ensuredDirs = new Set<string>();

export function ensureDir(dirPath: string): void {
  if (ensuredDirs.has(dirPath)) {
    return;
  }
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  ensuredDirs.add(dirPath);
}

export function resolveVideoName(jobId: string): string {
  try {
    const job = metadata.loadJob(jobId);
    return job.video_name || jobId;
  } catch {
    return jobId;
  }
}

export function ensureJobDir(jobId: string): string {
  const dir = jobDir(jobId);
  ensureDir(dir);
  return dir;
}

export function sourceVideoOutputTemplate(jobId: string): string {
  const videoName = resolveVideoName(jobId);
  const videoDir = getVideoDir(jobId, videoName);
  ensureDir(videoDir);
  return path.join(videoDir, "video.%(ext)s");
}

export function sourceVideoInfoPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "source.info.json");
}

export function ensureVideosDir(): string {
  const settings = loadSettings();
  const dir = settings.media.base_dir;
  ensureDir(dir);
  return dir;
}

export function ensureShortsVideoDir(videoName: string): string {
  const dir = path.join(getVideoDir(getVideoFolder(videoName), videoName), "shorts");
  ensureDir(dir);
  return dir;
}

export function ensureShortsJobDir(jobId: string): string {
  const videoName = resolveVideoName(jobId);
  return getShortsDir(jobId, videoName);
}

export function ensureTranscriptionsVideoDir(videoName: string): string {
  return getTranscriptionsDir(getVideoFolder(videoName), videoName);
}

export function ensureTranscriptionsJobDir(jobId: string): string {
  const videoName = resolveVideoName(jobId);
  return getTranscriptionsDir(jobId, videoName);
}

export function removeTranscriptionsJobDir(jobId: string): string {
  const videoName = resolveVideoName(jobId);
  const dir = path.join(getVideoDir(jobId, videoName), "transcrições");

  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return dir;
}

export function sourceVideoPathForJob(jobId: string, extension: string): string {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  const videoName = resolveVideoName(jobId);
  const filePath = getVideoFilePath(jobId, videoName, ext);
  ensureDir(path.dirname(filePath));
  return filePath;
}
