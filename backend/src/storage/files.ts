/**
 * Filesystem storage helpers for media and artifacts.
 */

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

type CachedSourceVideoEntry = {
  path: string;
  expiresAt: number;
};

const SOURCE_VIDEO_CACHE_TTL_MS = resolveCacheTtl("SOURCE_VIDEO_CACHE_TTL_MS", 5000);
const sourceVideoCache = new Map<string, CachedSourceVideoEntry>();
const ensuredDirs = new Set<string>();

function resolveCacheTtl(envName: string, fallbackMs: number): number {
  const raw = process.env[envName];
  if (!raw) return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return parsed;
}

function ensureDir(dirPath: string): void {
  if (ensuredDirs.has(dirPath)) {
    return;
  }
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  ensuredDirs.add(dirPath);
}

function setCachedSourceVideo(jobId: string, filePath: string): void {
  sourceVideoCache.set(jobId, {
    path: filePath,
    expiresAt: Date.now() + SOURCE_VIDEO_CACHE_TTL_MS,
  });
}

export function invalidateSourceVideoCache(jobId?: string): void {
  if (jobId) {
    sourceVideoCache.delete(jobId);
    return;
  }
  sourceVideoCache.clear();
}

function resolveVideoName(jobId: string): string {
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

/**
 * Get the directory for shorts of a specific video by name
 * Structure: {base_dir}/{videoName}/shorts/
 */
export function ensureShortsVideoDir(videoName: string): string {
  const dir = path.join(getVideoDir(getVideoFolder(videoName), videoName), "shorts");
  ensureDir(dir);
  return dir;
}

/**
 * Legacy support: get shorts dir by jobId
 * This looks up the job to get its video_name
 */
export function ensureShortsJobDir(jobId: string): string {
  const videoName = resolveVideoName(jobId);
  return getShortsDir(jobId, videoName);
}

/**
 * Get transcriptions directory for a specific video by name
 * Structure: {base_dir}/{videoName}/transcrições/
 */
export function ensureTranscriptionsVideoDir(videoName: string): string {
  return getTranscriptionsDir(getVideoFolder(videoName), videoName);
}

/**
 * Legacy support: get transcriptions dir by jobId
 * This looks up the job to get its video_name
 */
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

export function findSourceVideo(jobId: string): string | null {
  const cached = sourceVideoCache.get(jobId);
  if (cached && cached.expiresAt > Date.now()) {
    if (fs.existsSync(cached.path)) {
      return cached.path;
    }
    sourceVideoCache.delete(jobId);
  }

  let videoName = jobId;

  try {
    const job = metadata.loadJob(jobId);
    videoName = job.video_name || jobId;

    if (job.source_video_path && fs.existsSync(job.source_video_path)) {
      setCachedSourceVideo(jobId, job.source_video_path);
      return job.source_video_path;
    }
  } catch {
    // Ignore missing metadata and continue with fallbacks.
  }

  const videoDir = getVideoDir(jobId, videoName);
  if (fs.existsSync(videoDir)) {
    const filesInDir = fs.readdirSync(videoDir, { withFileTypes: true });
    const videoFile = filesInDir.find((entry) => entry.isFile() && entry.name.startsWith("video."));
    if (videoFile) {
      const filePath = path.join(videoDir, videoFile.name);
      setCachedSourceVideo(jobId, filePath);
      return filePath;
    }
  }

  const baseDir = ensureVideosDir();
  if (fs.existsSync(baseDir)) {
    const filesInBase = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const file of filesInBase) {
      if (!file.isFile() || !file.name.startsWith(`${jobId}.`)) {
        continue;
      }
      const filePath = path.join(baseDir, file.name);
      setCachedSourceVideo(jobId, filePath);
      return filePath;
    }
  }

  // Compatibility with legacy structure.
  const legacyJobDir = jobDir(jobId);
  if (fs.existsSync(legacyJobDir)) {
    const files = fs.readdirSync(legacyJobDir, { withFileTypes: true });
    for (const file of files) {
      if (!file.isFile()) {
        continue;
      }

      const ext = path.extname(file.name);
      const stem = path.basename(file.name, ext);
      if (stem === "source" && ext !== ".json") {
        const filePath = path.join(legacyJobDir, file.name);
        setCachedSourceVideo(jobId, filePath);
        return filePath;
      }
    }
  }

  return null;
}

export function videoPathForFrontend(videoPath: string | null): string {
  if (!videoPath) return "";
  const normalized = videoPath.replace(/\\/g, "/");
  return normalized.split("/").pop() || "";
}

export function transcriptionPath(jobId: string): string {
  const transDir = ensureTranscriptionsJobDir(jobId);
  return path.join(transDir, "transcription.segments.json");
}

export function transcriptionTextPath(jobId: string): string {
  const transDir = ensureTranscriptionsJobDir(jobId);
  return path.join(transDir, "transcription.txt");
}

export function transcriptionVttPath(jobId: string): string {
  const transDir = ensureTranscriptionsJobDir(jobId);
  return path.join(transDir, "transcription.vtt");
}

export function semanticBlocksPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "semantic.blocks.json");
}

export function cutsPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "cuts.suggested.json");
}

export function hasTranscription(jobId: string): boolean {
  try {
    return fs.existsSync(transcriptionPath(jobId));
  } catch {
    return false;
  }
}

export function hasAnalysis(jobId: string): boolean {
  try {
    return fs.existsSync(cutsPath(jobId));
  } catch {
    return false;
  }
}

export function rendersDir(jobId: string): string {
  return ensureShortsJobDir(jobId);
}

export function renderOutputPath(jobId: string, cutId: string): string {
  return path.join(ensureShortsJobDir(jobId), `${cutId}.mp4`);
}

export function renderOutputUrl(jobId: string, cutId: string): string {
  return `/media/shorts/${jobId}/${cutId}.mp4`;
}

function formatTimestampForFilename(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}_${String(secs).padStart(2, "0")}`;
}

export function buildCutFilename(start: number, end: number): string {
  const startFormatted = formatTimestampForFilename(start);
  const endFormatted = formatTimestampForFilename(end);
  return `${startFormatted}-${endFormatted}.mp4`;
}

export function listRenderOutputUrls(jobId: string): string[] {
  const rendersPath = ensureShortsJobDir(jobId);
  if (!fs.existsSync(rendersPath)) {
    return [];
  }

  return fs
    .readdirSync(rendersPath)
    .filter((file) => file.toLowerCase().endsWith(".mp4"))
    .map((file) => `/media/shorts/${jobId}/${file}`);
}

export function deleteRenderOutput(jobId: string, fileName: string): boolean {
  const rendersPath = ensureShortsJobDir(jobId);
  const targetPath = path.join(rendersPath, fileName);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
    return true;
  }
  return false;
}

export function deleteRenderOutputs(jobId: string): void {
  const rendersPath = ensureShortsJobDir(jobId);
  if (fs.existsSync(rendersPath)) {
    fs.rmSync(rendersPath, { recursive: true, force: true });
  }
}

/**
 * Rename a video and all associated folders (shorts, transcriptions)
 * This maintains the association between the video and its outputs.
 */
export function renameVideo(jobId: string, newVideoName: string): boolean {
  try {
    const job = metadata.loadJob(jobId);
    const oldVideoName = job.video_name || jobId;

    // If name is the same, no-op.
    if (oldVideoName === newVideoName) {
      return true;
    }

    const oldVideoDir = getVideoDir(jobId, oldVideoName);
    const newVideoDir = getVideoDir(jobId, newVideoName);

    if (fs.existsSync(oldVideoDir)) {
      fs.renameSync(oldVideoDir, newVideoDir);
    }

    const oldVideoPath = job.source_video_path;
    if (oldVideoPath && fs.existsSync(oldVideoPath)) {
      const ext = path.extname(oldVideoPath) || ".mp4";
      job.source_video_path = getVideoFilePath(jobId, newVideoName, ext);
    }

    job.video_name = newVideoName;
    job.updated_at = new Date().toISOString();
    metadata.saveJob(job);

    if (job.source_video_path) {
      setCachedSourceVideo(jobId, job.source_video_path);
    } else {
      invalidateSourceVideoCache(jobId);
    }

    return true;
  } catch (error) {
    console.error(`[files] ✗ Erro ao renomear vídeo ${jobId}: ${error}`);
    return false;
  }
}
