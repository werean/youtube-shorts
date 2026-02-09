/**
 * Media streaming endpoints for local video and short files.
 */

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import * as fs from "fs";
import * as path from "path";
import { getShortsDir } from "../core/settings";
import * as metadata from "../storage/metadata";

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

async function sendVideoStream(
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

const mediaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get<{ Params: { job_id: string } }>("/media/videos/:job_id", async (request, reply) => {
    try {
      const { job_id } = request.params;
      const job = getCachedJob(job_id);
      const filePath = job.source_video_path;
      if (!filePath) {
        console.error(`[media] ✗ source_video_path undefined para job: ${job_id}`);
        return reply.code(404).send({ detail: "Video path not set" });
      }
      if (!fs.existsSync(filePath)) {
        console.error(`[media] ✗ Arquivo não encontrado: ${filePath}`);
        return reply.code(404).send({ detail: `Video file not found at ${filePath}` });
      }
      await sendVideoStream(request, reply, filePath);
    } catch (error: any) {
      console.error(`[media] ✗ Erro ao servir vídeo:`, error.message);
      return reply.code(500).send({ detail: error.message });
    }
  });

  fastify.get<{ Params: { job_id: string; file: string } }>(
    "/media/shorts/:job_id/:file",
    async (request, reply) => {
      try {
        const { job_id, file } = request.params;
        const safeFile = path.basename(file);
        let videoName = job_id;
        try {
          const job = getCachedJob(job_id);
          videoName = job.video_name || job_id;
        } catch (error) {
          // ignore
        }
        const shortsDir = getShortsDir(job_id, videoName);
        const filePath = path.join(shortsDir, safeFile);
        if (!fs.existsSync(filePath)) {
          return reply.code(404).send({ detail: "Short not found" });
        }
        await sendVideoStream(request, reply, filePath);
      } catch (error: any) {
        return reply.code(500).send({ detail: error.message });
      }
    },
  );
};

export default mediaRoutes;
