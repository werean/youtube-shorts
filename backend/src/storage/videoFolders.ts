import * as fs from "fs";
import * as path from "path";
import { getVideoDir, getVideoFilePath } from "../core/settings";
import * as metadata from "./metadata";
import { invalidateSourceVideoCache, setCachedSourceVideo } from "./sourceVideo";

export function renameVideo(jobId: string, newVideoName: string): boolean {
  try {
    const job = metadata.loadJob(jobId);
    const oldVideoName = job.video_name || jobId;

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
