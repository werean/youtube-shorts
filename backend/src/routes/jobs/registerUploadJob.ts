/**
 * Register job upload routes.
 */

import type { FastifyInstance } from "fastify";
import { v4 as uuidv4 } from "uuid";
import * as fs from "fs";
import * as path from "path";
import { pipeline } from "stream/promises";
import { Job, JobStatus } from "../../models/job";
import * as metadata from "../../storage/metadata";
import { getVideoFilePath } from "../../core/settings";

export function registerUploadJobRoutes(fastify: FastifyInstance) {
  fastify.post("/upload", async (request, reply) => {
    try {
      console.log(`[POST /jobs/upload] Request recebido`);

      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ detail: "No file uploaded" });
      }

      console.log(`[POST /jobs/upload] Arquivo recebido: ${data.filename}`);
      console.log(`[POST /jobs/upload] Tipo: ${data.mimetype}`);

      const jobId = uuidv4().replace(/-/g, "");
      console.log(`[POST /jobs/upload] Job ID gerado: ${jobId}`);

      const videoName = path.basename(data.filename, path.extname(data.filename));

      const fileExtension = path.extname(data.filename) || ".mp4";
      const videoPath = getVideoFilePath(jobId, videoName, fileExtension);
      const videoDir = path.dirname(videoPath);
      fs.mkdirSync(videoDir, { recursive: true });

      console.log(`[POST /jobs/upload] Salvando em: ${videoPath}`);

      await pipeline(data.file, fs.createWriteStream(videoPath));
      console.log(`[POST /jobs/upload] ✓ Arquivo salvo`);

      const job: Job = {
        job_id: jobId,
        youtube_url: `[Local Upload] ${data.filename}`,
        status: JobStatus.DOWNLOADED,
        created_at: new Date().toISOString(),
        source_video_path: videoPath,
        source_file_name: data.filename,
        video_name: videoName,
      };

      console.log(`[POST /jobs/upload] Salvando job...`);
      metadata.saveJob(job);
      console.log(`[POST /jobs/upload] ✓ Job criado com sucesso: ${jobId}`);

      return {
        job: job,
        video_path: `/media/videos/${jobId}`,
      };
    } catch (error: any) {
      console.error(`[POST /jobs/upload] ✗ Erro:`, error.message);
      console.error(`[POST /jobs/upload] Stack:`, error.stack);
      reply.code(500).send({ detail: error.message || "Internal server error" });
    }
  });
}
