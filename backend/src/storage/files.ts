/**
 * Filesystem storage helpers for media and artifacts.
 */

import * as fs from "fs";
import * as path from "path";
import { jobDir } from "../core/paths";
import {
  getShortsDir,
  getTranscriptionsDir,
  getVideoDir,
  getVideoFilePath,
  getVideoFolder,
  loadSettings,
} from "../core/settings";
import * as metadata from "./metadata";

export function ensureJobDir(jobId: string): string {
  const dir = jobDir(jobId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export function sourceVideoOutputTemplate(jobId: string): string {
  let videoName: string | undefined;
  try {
    const job = metadata.loadJob(jobId);
    videoName = job.video_name || jobId;
  } catch (error) {
    videoName = jobId;
  }
  const videoDir = getVideoDir(jobId, videoName);
  if (!fs.existsSync(videoDir)) {
    fs.mkdirSync(videoDir, { recursive: true });
  }
  return path.join(videoDir, "video.%(ext)s");
}

export function sourceVideoInfoPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "source.info.json");
}

export function ensureVideosDir(): string {
  const settings = loadSettings();
  const dir = settings.media.base_dir;
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Get the directory for shorts of a specific video by name
 * Structure: {base_dir}/{videoName}/shorts/
 */
export function ensureShortsVideoDir(videoName: string): string {
  const dir = path.join(getVideoDir(getVideoFolder(videoName), videoName), "shorts");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Legacy support: get shorts dir by jobId
 * This looks up the job to get its video_name
 */
export function ensureShortsJobDir(jobId: string): string {
  try {
    const job = metadata.loadJob(jobId);
    const videoName = job.video_name || jobId;
    return getShortsDir(jobId, videoName);
  } catch (error) {
    return getShortsDir(jobId, jobId);
  }
}

/**
 * Get transcriptions directory for a specific video by name
 * Structure: {base_dir}/{videoName}/transcrições/
 */
export function ensureTranscriptionsVideoDir(videoName: string): string {
  return getTranscriptionsDir(getVideoFolder(videoName), videoName);
}

/**
 * Legacy support: get transcriptions dir by jobId
 * This looks up the job to get its video_name
 */
export function ensureTranscriptionsJobDir(jobId: string): string {
  try {
    const job = metadata.loadJob(jobId);
    const videoName = job.video_name || jobId;
    return getTranscriptionsDir(jobId, videoName);
  } catch (error) {
    return getTranscriptionsDir(jobId, jobId);
  }
}

export function removeTranscriptionsJobDir(jobId: string): string {
  let dir: string;
  try {
    const job = metadata.loadJob(jobId);
    const videoName = job.video_name || jobId;
    dir = path.join(getVideoDir(jobId, videoName), "transcrições");
  } catch (error) {
    dir = path.join(getVideoDir(jobId), "transcrições");
  }

  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return dir;
}

export function sourceVideoPathForJob(jobId: string, extension: string): string {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  try {
    const job = metadata.loadJob(jobId);
    const filePath = getVideoFilePath(jobId, job.video_name || jobId, ext);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return filePath;
  } catch (error) {
    const filePath = getVideoFilePath(jobId, jobId, ext);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return filePath;
  }
}

export function findSourceVideo(jobId: string): string | null {
  console.log(`[files] 🔍 Procurando vídeo para job: ${jobId}`);

  try {
    const job = metadata.loadJob(jobId);
    if (job.source_video_path && fs.existsSync(job.source_video_path)) {
      console.log(`[files]   ✓ Vídeo encontrado via metadata: ${job.source_video_path}`);
      return job.source_video_path;
    }
  } catch (error) {
    console.log(`[files]   ⚠️ Metadata não encontrada para job ${jobId}`);
  }

  try {
    const job = metadata.loadJob(jobId);
    const videoDir = getVideoDir(jobId, job.video_name || jobId);
    if (fs.existsSync(videoDir)) {
      const filesInDir = fs.readdirSync(videoDir);
      const videoFile = filesInDir.find((file) => file.startsWith("video."));
      if (videoFile) {
        const filePath = path.join(videoDir, videoFile);
        console.log(`[files]   ✓ Vídeo encontrado na pasta do vídeo: ${filePath}`);
        return filePath;
      }
    }
  } catch (error) {
    // ignore
  }

  const baseDir = ensureVideosDir();
  const filesInBase = fs.existsSync(baseDir) ? fs.readdirSync(baseDir) : [];
  for (const file of filesInBase) {
    if (!file.startsWith(`${jobId}.`)) continue;
    const filePath = path.join(baseDir, file);
    if (fs.statSync(filePath).isFile()) {
      console.log(`[files]   ✓ Vídeo encontrado em pasta configurada: ${filePath}`);
      return filePath;
    }
  }

  // Compatibilidade com estrutura antiga
  const legacyJobDir = jobDir(jobId);
  if (fs.existsSync(legacyJobDir)) {
    const files = fs.readdirSync(legacyJobDir);
    for (const file of files) {
      const filePath = path.join(legacyJobDir, file);
      if (fs.statSync(filePath).isFile()) {
        const ext = path.extname(file);
        const stem = path.basename(file, ext);
        if (stem === "source" && ext !== ".json") {
          console.log(`[files]   ✓ Vídeo encontrado em data/jobs: ${filePath}`);
          return filePath;
        }
      }
    }
  }

  console.log(`[files]   ✗ Vídeo não encontrado em nenhum local`);
  return null;
}

export function videoPathForFrontend(videoPath: string | null): string {
  if (!videoPath) return "";
  const normalized = videoPath.replace(/\\/g, "/");
  return normalized.split("/").pop() || "";
}

export function transcriptionPath(jobId: string): string {
  const transDir = ensureTranscriptionsJobDir(jobId);
  return path.join(transDir, "transcription.segments.json");
}

export function transcriptionTextPath(jobId: string): string {
  const transDir = ensureTranscriptionsJobDir(jobId);
  return path.join(transDir, "transcription.txt");
}

export function transcriptionVttPath(jobId: string): string {
  const transDir = ensureTranscriptionsJobDir(jobId);
  return path.join(transDir, "transcription.vtt");
}

export function semanticBlocksPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "semantic.blocks.json");
}

export function cutsPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "cuts.suggested.json");
}

export function hasTranscription(jobId: string): boolean {
  try {
    const segmentsPath = transcriptionPath(jobId);
    return fs.existsSync(segmentsPath);
  } catch (error) {
    return false;
  }
}

export function hasAnalysis(jobId: string): boolean {
  try {
    const cutsFilePath = cutsPath(jobId);
    return fs.existsSync(cutsFilePath);
  } catch (error) {
    return false;
  }
}

export function rendersDir(jobId: string): string {
  return ensureShortsJobDir(jobId);
}

export function renderOutputPath(jobId: string, cutId: string): string {
  return path.join(ensureShortsJobDir(jobId), `${cutId}.mp4`);
}

export function renderOutputUrl(jobId: string, cutId: string): string {
  return `/media/shorts/${jobId}/${cutId}.mp4`;
}

function formatTimestampForFilename(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}_${String(secs).padStart(2, "0")}`;
}

export function buildCutFilename(start: number, end: number): string {
  const startFormatted = formatTimestampForFilename(start);
  const endFormatted = formatTimestampForFilename(end);
  return `${startFormatted}-${endFormatted}.mp4`;
}

export function listRenderOutputUrls(jobId: string): string[] {
  const rendersPath = ensureShortsJobDir(jobId);
  if (!fs.existsSync(rendersPath)) {
    return [];
  }

  return fs
    .readdirSync(rendersPath)
    .filter((file) => file.toLowerCase().endsWith(".mp4"))
    .map((file) => `/media/shorts/${jobId}/${file}`);
}

export function deleteRenderOutput(jobId: string, fileName: string): boolean {
  const rendersPath = ensureShortsJobDir(jobId);
  const targetPath = path.join(rendersPath, fileName);
  if (fs.existsSync(targetPath)) {
    fs.rmSync(targetPath, { force: true });
    return true;
  }
  return false;
}

export function deleteRenderOutputs(jobId: string): void {
  const rendersPath = ensureShortsJobDir(jobId);
  if (fs.existsSync(rendersPath)) {
    fs.rmSync(rendersPath, { recursive: true, force: true });
  }
}

/**
 * Rename a video and all associated folders (shorts, transcriptions)
 * This maintains the association between the video and its outputs
 */
export function renameVideo(jobId: string, newVideoName: string): boolean {
  try {
    const job = metadata.loadJob(jobId);
    const oldVideoName = job.video_name || jobId;

    // If name is the same, no-op
    if (oldVideoName === newVideoName) {
      return true;
    }

    const oldVideoDir = getVideoDir(jobId, oldVideoName);
    const newVideoDir = getVideoDir(jobId, newVideoName);

    if (fs.existsSync(oldVideoDir)) {
      fs.renameSync(oldVideoDir, newVideoDir);
    }

    const oldVideoPath = job.source_video_path;
    if (oldVideoPath && fs.existsSync(oldVideoPath)) {
      const ext = path.extname(oldVideoPath) || ".mp4";
      job.source_video_path = getVideoFilePath(jobId, newVideoName, ext);
    }

    // Update job metadata with new video name
    job.video_name = newVideoName;
    job.updated_at = new Date().toISOString();
    metadata.saveJob(job);

    return true;
  } catch (error) {
    console.error(`[files] ✗ Erro ao renomear vídeo ${jobId}: ${error}`);
    return false;
  }
}
