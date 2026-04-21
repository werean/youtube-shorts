import type { FastifyReply, FastifyRequest } from "fastify";
import * as fs from "fs";
import * as path from "path";

import { getShortsDir } from "../../core/settings";
import * as metadata from "../../storage/metadata";

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp4":
      return "video/mp4";
    case ".webm":
      return "video/webm";
    case ".mkv":
      return "video/x-matroska";
    case ".mov":
      return "video/quicktime";
    case ".avi":
      return "video/x-msvideo";
    case ".m4v":
      return "video/x-m4v";
    default:
      return "application/octet-stream";
  }
}

export async function sendVideoStream(
  request: FastifyRequest,
  reply: FastifyReply,
  filePath: string,
): Promise<void> {
  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = request.headers.range;
  const contentType = getMimeType(filePath);

  reply
    .header("Accept-Ranges", "bytes")
    .header("Cache-Control", "no-cache")
    .header("Content-Type", contentType);

  if (range) {
    const match = /bytes=(\d+)-(\d+)?/.exec(range);
    if (!match) {
      reply.code(416);
      return;
    }

    const start = Number(match[1]);
    const end = match[2] ? Number(match[2]) : fileSize - 1;
    const safeEnd = Math.min(end, fileSize - 1);

    if (start >= fileSize || safeEnd < start) {
      reply.code(416);
      return;
    }

    const chunkSize = safeEnd - start + 1;
    const stream = fs.createReadStream(filePath, { start, end: safeEnd });

    reply
      .code(206)
      .header("Content-Range", `bytes ${start}-${safeEnd}/${fileSize}`)
      .header("Content-Length", chunkSize);

    await reply.send(stream);
    return;
  }

  reply.code(200).header("Content-Length", fileSize);

  await reply.send(fs.createReadStream(filePath));
}

const jobCache = new Map<string, { job: any; timestamp: number }>();
const CACHE_TTL = 60000;

function getCachedJob(jobId: string) {
  const cached = jobCache.get(jobId);
  const now = Date.now();
  if (cached && now - cached.timestamp < CACHE_TTL) {
    return cached.job;
  }
  const job = metadata.loadJob(jobId);
  jobCache.set(jobId, { job, timestamp: now });
  return job;
}

export function resolveSourceVideoPath(
  jobId: string,
): { ok: true; filePath: string } | { ok: false; detail: string } {
  const job = getCachedJob(jobId);
  const filePath = job.source_video_path;
  if (!filePath) {
    console.error(`[media] ✗ source_video_path undefined para job: ${jobId}`);
    return { ok: false, detail: "Video path not set" };
  }
  if (!fs.existsSync(filePath)) {
    console.error(`[media] ✗ Arquivo não encontrado: ${filePath}`);
    return { ok: false, detail: `Video file not found at ${filePath}` };
  }
  return { ok: true, filePath };
}

export function resolveShortVideoPath(
  jobId: string,
  file: string,
): { ok: true; filePath: string } | { ok: false; detail: string } {
  const safeFile = path.basename(file);
  let videoName = jobId;
  try {
    const job = getCachedJob(jobId);
    videoName = job.video_name || jobId;
  } catch {
    // ignore
  }
  const shortsDir = getShortsDir(jobId, videoName);
  const filePath = path.join(shortsDir, safeFile);
  if (!fs.existsSync(filePath)) {
    return { ok: false, detail: "Short not found" };
  }
  return { ok: true, filePath };
}
