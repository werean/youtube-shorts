/**
 * Service boundary for artifact paths and filesystem-backed job artifacts.
 *
 * This keeps storage/files as the low-level path implementation while giving
 * route, feature, and pipeline code a backend-facing artifact access surface.
 */

import * as fs from "fs";
import * as files from "../storage/files";

export function artifactExists(filePath: string): boolean {
  return fs.existsSync(filePath);
}

export function readTextArtifact(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

export function readJsonArtifact<T>(filePath: string): T {
  return JSON.parse(readTextArtifact(filePath)) as T;
}

export function writeTextArtifact(filePath: string, content: string): void {
  fs.writeFileSync(filePath, content, "utf-8");
}

export function writeJsonArtifact(filePath: string, value: unknown): void {
  writeTextArtifact(filePath, JSON.stringify(value, null, 2));
}

export function removeArtifact(filePath: string): void {
  fs.rmSync(filePath, { force: true });
}

export function unlinkArtifact(filePath: string): void {
  fs.unlinkSync(filePath);
}

export function transcriptionPath(jobId: string): string {
  return files.transcriptionPath(jobId);
}

export function transcriptionTextPath(jobId: string): string {
  return files.transcriptionTextPath(jobId);
}

export function transcriptionVttPath(jobId: string): string {
  return files.transcriptionVttPath(jobId);
}

export function semanticBlocksPath(jobId: string): string {
  return files.semanticBlocksPath(jobId);
}

export function topicSegmentsPath(jobId: string): string {
  return files.topicSegmentsPath(jobId);
}

export function cutsPath(jobId: string): string {
  return files.cutsPath(jobId);
}

export function hasTranscription(jobId: string): boolean {
  return files.hasTranscription(jobId);
}

export function hasAnalysis(jobId: string): boolean {
  return files.hasAnalysis(jobId);
}

export function sourceVideoOutputTemplate(jobId: string): string {
  return files.sourceVideoOutputTemplate(jobId);
}

export function sourceVideoInfoPath(jobId: string): string {
  return files.sourceVideoInfoPath(jobId);
}

export function sourceVideoPathForJob(jobId: string, extension: string): string {
  return files.sourceVideoPathForJob(jobId, extension);
}

export function findSourceVideo(jobId: string): string | null {
  return files.findSourceVideo(jobId);
}

export function invalidateSourceVideoCache(jobId?: string): void {
  files.invalidateSourceVideoCache(jobId);
}

export function ensureShortsJobDir(jobId: string): string {
  return files.ensureShortsJobDir(jobId);
}

export function ensureTranscriptionsJobDir(jobId: string): string {
  return files.ensureTranscriptionsJobDir(jobId);
}

export function removeTranscriptionsJobDir(jobId: string): string {
  return files.removeTranscriptionsJobDir(jobId);
}

export function buildCutFilename(start: number, end: number): string {
  return files.buildCutFilename(start, end);
}

export function listRenderOutputUrls(jobId: string): string[] {
  return files.listRenderOutputUrls(jobId);
}

export function deleteRenderOutputs(jobId: string): void {
  files.deleteRenderOutputs(jobId);
}

export function renameVideo(jobId: string, newVideoName: string): boolean {
  return files.renameVideo(jobId, newVideoName);
}
