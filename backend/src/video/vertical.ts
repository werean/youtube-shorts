/**
 * Vertical rendering strategy and layout helpers.
 */

import { config } from "../core/config";

export function buildVerticalFilter(width: number, height: number): string {
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},boxblur=20:1,setsar=1[bg];` +
    `[0:v]scale=${width}:-2:force_original_aspect_ratio=decrease,setsar=1[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`
  );
}

export function buildVerticalNvencCommand(params: {
  inputPath: string;
  outputPath: string;
  start: number;
  end: number;
}): string[] {
  const filterGraph = buildVerticalFilter(config.RENDER_WIDTH, config.RENDER_HEIGHT);

  return [
    "ffmpeg",
    "-y",
    "-hwaccel",
    "cuda",
    "-i",
    params.inputPath,
    "-ss",
    params.start.toFixed(3),
    "-to",
    params.end.toFixed(3),
    "-filter_complex",
    filterGraph,
    "-map",
    "[v]",
    "-map",
    "0:a?",
    "-c:v",
    config.RENDER_VIDEO_CODEC,
    "-preset",
    config.RENDER_VIDEO_PRESET,
    "-c:a",
    config.RENDER_AUDIO_CODEC,
    "-movflags",
    "+faststart",
    params.outputPath,
  ];
}
