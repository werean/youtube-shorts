/**
 * Video library endpoints for upload and archive management.
 */

import type { FastifyPluginAsync } from "fastify";
import * as fs from "fs";
import * as path from "path";
import {
  archivedDir,
  archivedJobDir,
  jobDir,
  jobMetadataPath,
  uploadDir,
  uploadJobDir,
} from "../core/paths";
import type { Job } from "../models/job";

interface VideoRecord {
  job: Job | null;
  job_id: string;
  video_path: string;
  archived: boolean;
}

function readJob(jobId: string): Job | null {
  try {
    const metadataPath = jobMetadataPath(jobId);
    if (!fs.existsSync(metadataPath)) {
      return null;
    }
    const raw = fs.readFileSync(metadataPath, "utf-8");
    return JSON.parse(raw) as Job;
  } catch (error) {
    console.error(`[videos] Failed to read job metadata for ${jobId}:`, error);
    return null;
  }
}

function findSourceVideoFile(jobDir: string): string | null {
  if (!fs.existsSync(jobDir)) {
    console.log(`[videos]       Job dir não existe: ${jobDir}`);
    return null;
  }

  const entries = fs.readdirSync(jobDir);
  console.log(`[videos]       Arquivos no job dir: ${entries.join(", ")}`);

  for (const entry of entries) {
    const entryPath = path.join(jobDir, entry);
    if (fs.statSync(entryPath).isFile()) {
      // Aceitar qualquer arquivo que comece com "source" e não seja JSON
      // Isso inclui: source.mp4, source.mp4.webm, source.webm, etc
      console.log(`[videos]         Verificando: ${entry}`);
      if (entry.startsWith("source") && !entry.endsWith(".json")) {
        console.log(`[videos]         ✓ Match encontrado: ${entry}`);
        return entry;
      }
    }
  }

  console.log(`[videos]       ✗ Nenhum arquivo source.* encontrado (exceto .json)`);
  return null;
}

function listVideos(rootDir: string, prefix: string, archived: boolean): VideoRecord[] {
  console.log(`\n[videos] Listando vídeos:`);
  console.log(`[videos]   Root dir: ${rootDir}`);
  console.log(`[videos]   Prefix: ${prefix}`);
  console.log(`[videos]   Archived: ${archived}`);

  if (!fs.existsSync(rootDir)) {
    console.log(`[videos]   ⚠ Diretório não existe`);
    return [];
  }

  const entries = fs.readdirSync(rootDir);
  console.log(`[videos]   Entradas encontradas: ${entries.length}`);
  const records: VideoRecord[] = [];

  for (const entry of entries) {
    const entryPath = path.join(rootDir, entry);
    if (!fs.statSync(entryPath).isDirectory()) continue;

    console.log(`[videos]   Verificando job: ${entry}`);
    const fileName = findSourceVideoFile(entryPath);
    if (!fileName) {
      console.log(`[videos]     ⚠ Nenhum arquivo source encontrado`);
      continue;
    }

    console.log(`[videos]     ✓ Arquivo encontrado: ${fileName}`);
    const job = readJob(entry);
    const videoPath = `${prefix}/${entry}/${fileName}`;
    console.log(`[videos]     ✓ Video path: ${videoPath}`);

    records.push({
      job,
      job_id: entry,
      video_path: videoPath,
      archived,
    });
  }

  console.log(`[videos]   Total de vídeos retornados: ${records.length}\n`);
  return records;
}

const videosRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/videos", async () => {
    return listVideos(uploadDir(), "/upload", false);
  });

  fastify.get("/videos/archived", async () => {
    return listVideos(archivedDir(), "/arquivados", true);
  });

  fastify.post<{ Params: { job_id: string } }>(
    "/videos/:job_id/archive",
    async (request, reply) => {
      const { job_id } = request.params;
      const sourceDir = uploadJobDir(job_id);
      const targetDir = archivedJobDir(job_id);

      if (!fs.existsSync(sourceDir)) {
        return reply.code(404).send({ detail: "Video not found" });
      }

      fs.mkdirSync(path.dirname(targetDir), { recursive: true });
      fs.renameSync(sourceDir, targetDir);
      return { ok: true, job_id };
    },
  );

  fastify.delete<{ Params: { job_id: string } }>("/videos/:job_id", async (request, reply) => {
    const { job_id } = request.params;
    const uploadPath = uploadJobDir(job_id);
    const archivedPath = archivedJobDir(job_id);
    const dataPath = jobDir(job_id);

    let removed = false;
    if (fs.existsSync(uploadPath)) {
      fs.rmSync(uploadPath, { recursive: true, force: true });
      removed = true;
    }
    if (fs.existsSync(archivedPath)) {
      fs.rmSync(archivedPath, { recursive: true, force: true });
      removed = true;
    }
    if (fs.existsSync(dataPath)) {
      fs.rmSync(dataPath, { recursive: true, force: true });
      removed = true;
    }

    if (!removed) {
      return reply.code(404).send({ detail: "Video not found" });
    }

    return { ok: true, job_id };
  });
};

export default videosRoutes;
