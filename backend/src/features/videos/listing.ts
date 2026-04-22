import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";

import { archivedVideosDir, loadSettings } from "../../core/settings";
import type { Job } from "../../models/job";
import { JobStatus } from "../../models/job";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as files from "../../storage/files";
import type { VideoRecord } from "./types";

const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".flv"]);

function isVideoFile(fileName: string): boolean {
  return VIDEO_EXTENSIONS.has(path.extname(fileName).toLowerCase());
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

function ensureJobForVideo(
  filePath: string,
  fileName: string,
  videoName: string,
  jobsByPath: Map<string, Job>,
): Job {
  const normalizedPath = path.normalize(filePath);
  const existing = jobsByPath.get(normalizedPath);
  if (existing) {
    return existing;
  }

  const jobId = uuidv4().replace(/-/g, "");
  const job: Job = {
    job_id: jobId,
    youtube_url: `[Local Video] ${videoName}`,
    status: JobStatus.DOWNLOADED,
    created_at: new Date().toISOString(),
    source_video_path: filePath,
    source_file_name: fileName,
    video_name: videoName,
  };
  jobLifecycleService.saveJob(job);
  return job;
}

function listVideosFromDir(rootDir: string, archived: boolean): VideoRecord[] {
  console.log(`\n[videos] Listando vídeos:`);
  console.log(`[videos]   Root dir: ${rootDir}`);
  console.log(`[videos]   Archived: ${archived}`);

  const items = collectVideoFiles(rootDir, archived);
  const records: VideoRecord[] = [];

  const jobsByPath = mapJobsBySourcePath();

  for (const item of items) {
    const job = ensureJobForVideo(item.filePath, item.fileName, item.videoName, jobsByPath);
    records.push({
      job,
      job_id: job.job_id,
      video_path: `/media/videos/${job.job_id}`,
      archived,
      hasTranscription: files.hasTranscription(job.job_id),
      hasAnalysis: files.hasAnalysis(job.job_id),
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
