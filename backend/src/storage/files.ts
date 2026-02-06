/**
 * Filesystem storage helpers for media and artifacts.
 */

import * as fs from "fs";
import * as path from "path";
import { jobDir } from "../core/paths";

export function ensureJobDir(jobId: string): string {
  const dir = jobDir(jobId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function sourceVideoOutputTemplate(jobId: string): string {
  return path.join(ensureJobDir(jobId), "source.%(ext)s");
}

export function sourceVideoInfoPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "source.info.json");
}

export function findSourceVideo(jobId: string): string | null {
  console.log(`[files] 🔍 Procurando vídeo para job: ${jobId}`);

  // Primeiro tenta em data/jobs/jobId/ (lugar antigo)
  const jobDirPath = jobDir(jobId);
  console.log(`[files]   Verificando data/jobs: ${jobDirPath}`);

  if (fs.existsSync(jobDirPath)) {
    const files = fs.readdirSync(jobDirPath);
    console.log(`[files]   Arquivos em data/jobs: ${files.join(", ")}`);

    for (const file of files) {
      const filePath = path.join(jobDirPath, file);
      if (fs.statSync(filePath).isFile()) {
        const ext = path.extname(file);
        const stem = path.basename(file, ext);
        if (stem === "source" && ext !== ".json") {
          console.log(`[files]   ✓ Vídeo encontrado em data/jobs: ${file}`);
          return filePath;
        }
      }
    }
  } else {
    console.log(`[files]   ✗ Diretório data/jobs não existe`);
  }

  // Se não encontrou, tenta em upload/jobId/ (lugar novo)
  const { uploadJobDir } = require("../core/paths");
  const uploadDirPath = uploadJobDir(jobId);
  console.log(`[files]   Verificando upload: ${uploadDirPath}`);

  if (fs.existsSync(uploadDirPath)) {
    const files = fs.readdirSync(uploadDirPath);
    console.log(`[files]   Arquivos em upload: ${files.join(", ")}`);

    for (const file of files) {
      const filePath = path.join(uploadDirPath, file);
      if (fs.statSync(filePath).isFile()) {
        const ext = path.extname(file);
        const stem = path.basename(file, ext);
        if (stem === "source" && ext !== ".json") {
          console.log(`[files]   ✓ Vídeo encontrado em upload: ${file}`);
          return filePath;
        }
      }
    }
  } else {
    console.log(`[files]   ✗ Diretório upload não existe`);
  }

  console.log(`[files]   ✗ Vídeo não encontrado em nenhum local`);
  return null;
}

export function videoPathForFrontend(videoPath: string | null): string {
  if (!videoPath) return "";
  // Normalize to forward slashes and extract relative path from job dir
  const normalized = videoPath.replace(/\\/g, "/");
  // Extract from /jobs/jobId/source.ext
  const match = normalized.match(/\/jobs\/([^/]+)\/(.+)$/);
  if (match) {
    return `source.${match[2].split(".").pop()}`;
  }
  return normalized.split("/").pop() || "";
}

export function transcriptionPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "transcription.segments.json");
}

export function transcriptionTextPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "transcription.txt");
}

export function transcriptionVttPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "transcription.vtt");
}

export function semanticBlocksPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "semantic.blocks.json");
}

export function cutsPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "cuts.suggested.json");
}

export function rendersDir(jobId: string): string {
  const dir = path.join(ensureJobDir(jobId), "renders");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function renderOutputPath(jobId: string, cutId: string): string {
  return path.join(rendersDir(jobId), `${cutId}.mp4`);
}
