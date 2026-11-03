import * as fs from "fs";
import * as path from "path";
import { jobDir } from "../core/paths";
import { getVideoDir } from "../core/settings";
import { isVideoFileName } from "../core/videoFiles";
import * as metadata from "./metadata";
import { ensureVideosDir, resolveVideoName } from "./fileDirs";
import {
  invalidateSourceVideoCache,
  readCachedSourceVideo,
  setCachedSourceVideo,
} from "./sourceVideoCache";

export { invalidateSourceVideoCache, setCachedSourceVideo };

export function findSourceVideo(jobId: string): string | null {
  const cachedPath = readCachedSourceVideo(jobId);
  if (cachedPath) {
    if (fs.existsSync(cachedPath)) {
      return cachedPath;
    }
    invalidateSourceVideoCache(jobId);
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
    const videoFile = filesInDir.find(
      (entry) => entry.isFile() && entry.name.startsWith("video.") && isVideoFileName(entry.name),
    );
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
      if (!file.isFile() || !file.name.startsWith(`${jobId}.`) || !isVideoFileName(file.name)) {
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
