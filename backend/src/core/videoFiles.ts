import * as path from "path";

export const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".flv"]);

export function isVideoFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".part") || lower.endsWith(".ytdl") || lower.endsWith(".info.json")) {
    return false;
  }
  return VIDEO_EXTENSIONS.has(path.extname(lower));
}
