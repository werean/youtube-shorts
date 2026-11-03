import * as fs from "fs";
import * as path from "path";
import { ensureShortsJobDir } from "./fileDirs";

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
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, "0")}_${String(secs).padStart(2, "0")}`;
}

export function buildCutFilename(start: number, end: number, _cutId?: string): string {
  return `${formatTimestampForFilename(start)}-${formatTimestampForFilename(end)}.mp4`;
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
