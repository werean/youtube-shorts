import * as fs from "fs";
import * as path from "path";
import { ensureJobDir, ensureTranscriptionsJobDir } from "./fileDirs";

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

export function topicSegmentsPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "topic.segments.json");
}

export function cutsPath(jobId: string): string {
  return path.join(ensureJobDir(jobId), "cuts.suggested.json");
}

export function hasTranscription(jobId: string): boolean {
  try {
    return fs.existsSync(transcriptionPath(jobId));
  } catch {
    return false;
  }
}

export function hasAnalysis(jobId: string): boolean {
  try {
    return fs.existsSync(cutsPath(jobId));
  } catch {
    return false;
  }
}
