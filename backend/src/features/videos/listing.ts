import * as fs from "fs";
import * as path from "path";
import { archivedVideosDir, loadSettings } from "../../core/settings";
import { isVideoFileName } from "../../core/videoFiles";
import type { Job } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import type { VideoRecord } from "./types";

function isVideoFile(fileName: string): boolean {
  return isVideoFileName(fileName);
}

function collectVideoFiles(
  rootDir: string,
  archived: boolean,
): Array<{ fileName: string; filePath: string; videoName: string }> {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const entries = fs.readdirSync(rootDir);
  const results: Array<{ fileName: string; filePath: string; videoName: string }> = [];

  for (const entry of entries) {
    if (!archived && entry === "_archived") continue;

    const entryPath = path.join(rootDir, entry);
    const stat = fs.statSync(entryPath);

    if (!stat.isDirectory()) {
      continue;
    }

    const inner = fs.readdirSync(entryPath);
    const videoFile = inner.find((file) => file.startsWith("video.") && isVideoFile(file));
    if (videoFile) {
      results.push({
        fileName: videoFile,
        filePath: path.join(entryPath, videoFile),
        videoName: entry,
      });
    }
  }

  return results;
}

function mapJobsBySourcePath(): Map<string, Job> {
  const jobs = jobLifecycleService.listJobs();
  const map = new Map<string, Job>();
  for (const job of jobs) {
    if (job.source_video_path) {
      map.set(path.normalize(job.source_video_path), job);
    }
  }
  return map;
}

function listVideosFromDir(rootDir: string, archived: boolean): VideoRecord[] {
  console.log(`\n[videos] Listando vídeos:`);
  console.log(`[videos]   Root dir: ${rootDir}`);
  console.log(`[videos]   Archived: ${archived}`);

  const items = collectVideoFiles(rootDir, archived);
  const records: VideoRecord[] = [];

  const jobsByPath = mapJobsBySourcePath();

  for (const item of items) {
    const job = jobsByPath.get(path.normalize(item.filePath));
    if (!job) {
      continue;
    }
    records.push({
      job,
      job_id: job.job_id,
      video_path: `/media/videos/${job.job_id}`,
      archived,
      hasTranscription: artifactService.hasTranscription(job.job_id),
      hasAnalysis: artifactService.hasAnalysis(job.job_id),
    });
  }

  records.sort((a, b) => {
    const dateA = new Date(a.job?.created_at || 0).getTime();
    const dateB = new Date(b.job?.created_at || 0).getTime();
    return dateA - dateB;
  });

  console.log(`[videos]   Total de vídeos retornados: ${records.length}\n`);
  return records;
}

export function listActiveVideos(): VideoRecord[] {
  const settings = loadSettings();
  return listVideosFromDir(settings.media.base_dir, false);
}

export function listArchivedVideos(): VideoRecord[] {
  return listVideosFromDir(archivedVideosDir(), true);
}
