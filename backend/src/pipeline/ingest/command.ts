import { loadSettings } from "../../core/settings";
import { Job } from "../../models/job";

function resolveMaxHeight(resolution: string): number {
  switch (resolution) {
    case "4k":
      return 2160;
    case "1440p":
      return 1440;
    case "1080p":
    default:
      return 1080;
  }
}

function buildYtDlpFormat(resolution: string): string {
  const maxHeight = resolveMaxHeight(resolution);
  return `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]`;
}

export function buildDownloadCommand(job: Job, outputPattern: string): string {
  const settings = loadSettings();
  const format = buildYtDlpFormat(settings.media.download_resolution || "1080p");
  return (
    `python -m yt_dlp --no-playlist --write-info-json --format "${format}" ` +
    `--output "${outputPattern}" "${job.youtube_url}"`
  );
}
