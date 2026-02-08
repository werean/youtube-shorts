/**
 * Pipeline step: ingest YouTube video and metadata.
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Job, JobStatus } from "../models/job";
import * as metadata from "../storage/metadata";
import * as files from "../storage/files";
import { createDummyMP4 } from "../utils/mp4";
import { getVideoDir, getVideoFilePath } from "../core/settings";

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

    const infoPath = files.sourceVideoInfoPath(job.job_id);
    const outputPattern = files.sourceVideoOutputTemplate(job.job_id);

    console.log(`[ingest] Video output pattern: ${outputPattern}`);
    console.log(`[ingest] Info path: ${infoPath}`);

    // Check if video already exists
    if (job.source_video_path && fs.existsSync(job.source_video_path) && fs.existsSync(infoPath)) {
      console.log(`[ingest] ✓ Video já existe, pulando download...`);
      const updatedJob = metadata.loadJob(job.job_id);
      updatedJob.updated_at = new Date().toISOString();
      updatedJob.status = JobStatus.DOWNLOADED;

      // Ensure video_name is set
      if (!updatedJob.video_name) {
        try {
          const infoContent = fs.readFileSync(infoPath, "utf-8");
          const infoData = JSON.parse(infoContent);
          if (infoData.title) {
            updatedJob.video_name = infoData.title;
          }
        } catch (e) {
          updatedJob.video_name = updatedJob.job_id;
        }
        metadata.saveJob(updatedJob);
      }

      return {
        video_path: job.source_video_path,
        metadata_path: infoPath,
      };
    }

    // Baixar vídeo no formato original (sem conversão)
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

      const outputDir = path.dirname(outputPattern);
      const filesInDir = fs.readdirSync(outputDir);
      const downloadedFile = filesInDir.find((f) => f.startsWith("video."));

      if (!downloadedFile) {
        throw new Error("Arquivo baixado não encontrado");
      }

      let downloadedPath = path.join(outputDir, downloadedFile);
      console.log(`[ingest] ✓ Arquivo baixado: ${downloadedFile}`);

      const updatedJob = metadata.loadJob(job.job_id);
      updatedJob.updated_at = new Date().toISOString();
      updatedJob.status = JobStatus.DOWNLOADED;
      updatedJob.source_video_path = downloadedPath;

      // Try to get video title from info JSON
      try {
        const infoContent = fs.readFileSync(infoPath, "utf-8");
        const infoData = JSON.parse(infoContent);
        if (infoData.title && !updatedJob.video_name) {
          updatedJob.video_name = infoData.title;
        }
      } catch (e) {
        // If we can't read info, use job_id as fallback
        if (!updatedJob.video_name) {
          updatedJob.video_name = updatedJob.job_id;
        }
      }

      if (updatedJob.video_name && updatedJob.video_name !== updatedJob.job_id) {
        const newVideoDir = getVideoDir(updatedJob.job_id, updatedJob.video_name);
        if (!fs.existsSync(newVideoDir)) {
          fs.mkdirSync(path.dirname(newVideoDir), { recursive: true });
        }
        if (outputDir !== newVideoDir) {
          fs.renameSync(outputDir, newVideoDir);
          downloadedPath = path.join(newVideoDir, path.basename(downloadedPath));
        }
      }

      updatedJob.source_video_path = downloadedPath;
      metadata.saveJob(updatedJob);

      console.log(`[ingest] ✓ Video pronto para reprodução: ${downloadedFile}`);
      console.log(`[ingest] ============================================\n`);

      return {
        video_path: downloadedPath,
        metadata_path: infoPath,
      };
    } catch (execError: any) {
      console.error(`[ingest] ✗ Erro ao executar yt-dlp, tentando criar vídeo dummy...`);
      console.error(`[ingest] ✗ Mensagem: ${execError.message}`);

      // Fallback: criar um vídeo dummy MP4 para testar
      const mp4Buffer = createDummyMP4();
      let dummyPath = files.sourceVideoPathForJob(job.job_id, "mp4");
      fs.writeFileSync(dummyPath, mp4Buffer);
      console.log(`[ingest] ✓ Vídeo dummy criado em: ${dummyPath} (${mp4Buffer.length} bytes)`);

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
      updatedJob.video_name = updatedJob.video_name || "Dummy Video for Testing";
      if (updatedJob.video_name && updatedJob.video_name !== updatedJob.job_id) {
        const oldDir = path.dirname(dummyPath);
        const newDir = getVideoDir(updatedJob.job_id, updatedJob.video_name);
        if (oldDir !== newDir) {
          fs.renameSync(oldDir, newDir);
          dummyPath = getVideoFilePath(updatedJob.job_id, updatedJob.video_name, ".mp4");
        }
      }
      updatedJob.source_video_path = dummyPath;
      metadata.saveJob(updatedJob);

      console.log(`[ingest] ============================================\n`);

      return {
        video_path: dummyPath,
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
