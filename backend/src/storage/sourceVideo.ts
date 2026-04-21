import * as fs from "fs";
import * as path from "path";
import { jobDir } from "../core/paths";
import { getVideoDir } from "../core/settings";
import * as metadata from "./metadata";
import { ensureVideosDir, resolveVideoName } from "./fileDirs";

type CachedSourceVideoEntry = {
  path: string;
  expiresAt: number;
};

const SOURCE_VIDEO_CACHE_TTL_MS = resolveCacheTtl("SOURCE_VIDEO_CACHE_TTL_MS", 5000);
const sourceVideoCache = new Map<string, CachedSourceVideoEntry>();

function resolveCacheTtl(envName: string, fallbackMs: number): number {
  const raw = process.env[envName];
  if (!raw) return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return parsed;
}

export function setCachedSourceVideo(jobId: string, filePath: string): void {
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
