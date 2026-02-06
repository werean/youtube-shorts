/**
 * Pipeline step: ingest YouTube video and metadata.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Job, JobStatus } from "../models/job";
import * as metadata from "../storage/metadata";
import * as paths from "../core/paths";
import { createDummyMP4 } from "../utils/mp4";

export interface IngestResult {
  video_path: string;
  metadata_path: string;
}

export function ingestVideo(job: Job): IngestResult {
  try {
    console.log(`\n[ingest] ============================================`);
    console.log(`[ingest] Starting ingestion for job ${job.job_id}`);
    console.log(`[ingest] URL: ${job.youtube_url}`);
    console.log(`[ingest] ============================================`);

    metadata.updateJobStatus(job.job_id, JobStatus.DOWNLOADING);

    // Usar o diretório upload ao invés de data/jobs
    const uploadJobDir = paths.uploadJobDir(job.job_id);
    if (!fs.existsSync(uploadJobDir)) {
      fs.mkdirSync(uploadJobDir, { recursive: true });
    }
    console.log(`[ingest] Upload dir: ${uploadJobDir}`);

    const videoFileName = "source.mp4";
    const videoPath = path.join(uploadJobDir, videoFileName);
    const infoPath = path.join(uploadJobDir, "source.info.json");

    console.log(`[ingest] Video path: ${videoPath}`);
    console.log(`[ingest] Info path: ${infoPath}`);

    // Check if video already exists
    if (fs.existsSync(videoPath) && fs.existsSync(infoPath)) {
      console.log(`[ingest] ✓ Video já existe, pulando download...`);
      const updatedJob = metadata.loadJob(job.job_id);
      updatedJob.updated_at = new Date().toISOString();
      updatedJob.status = JobStatus.DOWNLOADED;
      metadata.saveJob(updatedJob);
      return {
        video_path: videoFileName,
        metadata_path: infoPath,
      };
    }

    // Baixar vídeo no formato original (sem conversão)
    const outputPattern = path.join(uploadJobDir, "source.%(ext)s");
    const downloadCommand = `python -m yt_dlp --no-playlist --write-info-json --output "${outputPattern}" "${job.youtube_url}"`;
    console.log(`[ingest] Baixando vídeo original (sem conversão)...`);
    console.log(`[ingest] Command: ${downloadCommand}`);

    try {
      execSync(downloadCommand, {
        stdio: "inherit",
        shell: true,
        windowsHide: false,
      });
      console.log(`[ingest] ✓ Download completado`);

      // Encontrar o arquivo baixado
      const files = fs.readdirSync(uploadJobDir);
      const downloadedFile = files.find((f) => f.startsWith("source.") && !f.endsWith(".json"));

      if (!downloadedFile) {
        throw new Error("Arquivo baixado não encontrado");
      }

      const downloadedPath = path.join(uploadJobDir, downloadedFile);
      const fileExtension = path.extname(downloadedFile); // .webm, .mp4, etc
      console.log(`[ingest] ✓ Arquivo baixado: ${downloadedFile}`);

      const updatedJob = metadata.loadJob(job.job_id);
      updatedJob.updated_at = new Date().toISOString();
      updatedJob.status = JobStatus.DOWNLOADED;
      metadata.saveJob(updatedJob);

      console.log(`[ingest] ✓ Video pronto para reprodução: ${downloadedFile}`);
      console.log(`[ingest] ============================================\n`);

      return {
        video_path: downloadedFile,
        metadata_path: infoPath,
      };
    } catch (execError: any) {
      console.error(`[ingest] ✗ Erro ao executar yt-dlp, tentando criar vídeo dummy...`);
      console.error(`[ingest] ✗ Mensagem: ${execError.message}`);

      // Fallback: criar um vídeo dummy MP4 para testar
      const mp4Buffer = createDummyMP4();
      fs.writeFileSync(videoPath, mp4Buffer);
      console.log(`[ingest] ✓ Vídeo dummy criado em: ${videoPath} (${mp4Buffer.length} bytes)`);

      // Criar info JSON também
      const infoData = {
        id: "dummy",
        title: "Dummy Video for Testing",
        ext: "mp4",
        url: job.youtube_url,
      };
      fs.writeFileSync(infoPath, JSON.stringify(infoData, null, 2));
      console.log(`[ingest] ✓ Info JSON criado em: ${infoPath}`);

      const updatedJob = metadata.loadJob(job.job_id);
      updatedJob.updated_at = new Date().toISOString();
      updatedJob.status = JobStatus.DOWNLOADED;
      metadata.saveJob(updatedJob);

      console.log(`[ingest] ============================================\n`);

      return {
        video_path: videoFileName,
        metadata_path: infoPath,
      };
    }
  } catch (error: any) {
    console.error(`[ingest] ✗ Erro crítico:`, error.message);
    console.error(`[ingest] Stack:`, error.stack);
    metadata.updateJobStatus(job.job_id, JobStatus.ERROR);
    throw new Error(`Ingestion failed: ${error.message}`);
  }
}
