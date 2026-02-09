/**
 * Video library endpoints for upload and archive management.
 */

import type { FastifyPluginAsync } from "fastify";
import * as fs from "fs";
import * as path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  archivedVideosDir,
  getArchivedVideoDir,
  getVideoDir,
  loadSettings,
} from "../core/settings";
import type { Job } from "../models/job";
import { JobStatus } from "../models/job";
import * as metadata from "../storage/metadata";
import * as files from "../storage/files";
import { jobDir } from "../core/paths";

interface VideoRecord {
  job: Job | null;
  job_id: string;
  video_path: string;
  archived: boolean;
  hasTranscription?: boolean;
  hasAnalysis?: boolean;
}

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
  const jobs = metadata.listJobs();
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
  metadata.saveJob(job);
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

  // Sort by created_at (oldest first - ascending order)
  records.sort((a, b) => {
    const dateA = new Date(a.job?.created_at || 0).getTime();
    const dateB = new Date(b.job?.created_at || 0).getTime();
    return dateA - dateB;
  });

  console.log(`[videos]   Total de vídeos retornados: ${records.length}\n`);
  return records;
}

const videosRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/videos", async () => {
    const settings = loadSettings();
    return listVideosFromDir(settings.media.base_dir, false);
  });

  fastify.get("/videos/archived", async () => {
    return listVideosFromDir(archivedVideosDir(), true);
  });

  fastify.post<{ Params: { job_id: string } }>(
    "/videos/:job_id/archive",
    async (request, reply) => {
      const { job_id } = request.params;
      const job = metadata.loadJob(job_id);

      const videoName = job.video_name || job_id;
      const videoDir = getVideoDir(job_id, videoName);

      if (!fs.existsSync(videoDir)) {
        return reply.code(404).send({ detail: "Video not found" });
      }

      const targetDir = getArchivedVideoDir(videoName);
      fs.renameSync(videoDir, targetDir);

      const filesInDir = fs.readdirSync(targetDir);
      const videoFile = filesInDir.find((file) => file.startsWith("video."));
      if (videoFile) {
        job.source_video_path = path.join(targetDir, videoFile);
      }
      job.updated_at = new Date().toISOString();
      metadata.saveJob(job);

      return { ok: true, job_id };
    },
  );

  fastify.delete<{ Params: { job_id: string } }>("/videos/:job_id", async (request, reply) => {
    const { job_id } = request.params;

    try {
      const job = metadata.loadJob(job_id);
      const videoName = job.video_name || job_id;
      const activeDir = getVideoDir(job_id, videoName);
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
    } catch (error) {
      return reply.code(404).send({ detail: "Video not found" });
    }

    files.deleteRenderOutputs(job_id);

    const dataPath = jobDir(job_id);
    if (fs.existsSync(dataPath)) {
      fs.rmSync(dataPath, { recursive: true, force: true });
    }

    return { ok: true, job_id };
  });
};

export default videosRoutes;
