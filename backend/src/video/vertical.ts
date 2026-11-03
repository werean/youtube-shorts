/**
 * Vertical rendering command.
 * A saved short preset changes the filter graph: blur placement and strength,
 * optional music mix, and burned-in captions. With no preset, the previous
 * fixed background blur stays in place.
 */

import { config } from "../core/config";
import { loadActiveToolConfigs } from "../core/toolConfigs";
import type { FFmpegToolConfig } from "../core/toolConfigs";
import type { ShortStylePreset } from "../../../shared/stylePresets";
import { captionForceStyle } from "./captions";

const REGION_BAND_PERCENT = 22;

export function buildVerticalFilter(width: number, height: number): string {
  return backgroundBlurGraph(width, height, 20);
}

function evenDown(value: number, minimum = 0): number {
  const even = Math.floor(value) - (Math.floor(value) % 2);
  return Math.max(minimum, even);
}

function blurRadius(strength: number): number {
  if (!Number.isFinite(strength)) return 1;
  return Math.max(0, Math.min(40, Math.round(strength)));
}

function sharpVerticalGraph(width: number, height: number): string {
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=decrease,` +
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v]`
  );
}

function backgroundBlurGraph(width: number, height: number, strength: number): string {
  const radius = blurRadius(strength);
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},boxblur=${radius}:1,setsar=1[bg];` +
    `[0:v]scale=${width}:-2:force_original_aspect_ratio=decrease,setsar=1[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`
  );
}

function blurRegion(
  preset: ShortStylePreset,
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  let xPercent = 0;
  let yPercent = 0;
  let widthPercent = 100;
  let heightPercent = REGION_BAND_PERCENT;

  if (preset.blur.target === "bottom") {
    yPercent = 100 - REGION_BAND_PERCENT;
  } else if (preset.blur.target === "custom") {
    xPercent = preset.blur.region.x;
    yPercent = preset.blur.region.y;
    widthPercent = preset.blur.region.width;
    heightPercent = preset.blur.region.height;
  }

  let x = evenDown((width * xPercent) / 100);
  let y = evenDown((height * yPercent) / 100);
  let w = evenDown((width * widthPercent) / 100, 2);
  let h = evenDown((height * heightPercent) / 100, 2);

  if (x >= width) x = evenDown(width - 2);
  if (y >= height) y = evenDown(height - 2);
  if (x + w > width) w = evenDown(width - x, 2);
  if (y + h > height) h = evenDown(height - y, 2);

  return { x, y, w, h };
}

function regionalBlurGraph(preset: ShortStylePreset, width: number, height: number): string {
  const radius = blurRadius(preset.blur.strength);
  const region = blurRegion(preset, width, height);
  return (
    `${sharpVerticalGraph(width, height).replace("[v]", "[base]")};` +
    `[base]split[main][region];` +
    `[region]crop=${region.w}:${region.h}:${region.x}:${region.y},boxblur=${radius}:1[blurred];` +
    `[main][blurred]overlay=${region.x}:${region.y}[v]`
  );
}

export function buildPresetVideoGraph(
  preset: ShortStylePreset | null | undefined,
  width: number,
  height: number,
): string {
  if (!preset || (preset.blur.enabled && preset.blur.target === "background")) {
    return backgroundBlurGraph(width, height, preset?.blur.strength ?? 20);
  }
  if (!preset.blur.enabled) {
    return sharpVerticalGraph(width, height);
  }
  return regionalBlurGraph(preset, width, height);
}

export function musicTrackPath(preset: ShortStylePreset | null | undefined): string | null {
  if (!preset?.music.enabled) return null;
  const track = preset.music.trackName.trim();
  return track || null;
}

export function musicVolumeFactor(preset: ShortStylePreset): string {
  const volume = Number.isFinite(preset.music.volume) ? preset.music.volume : 0;
  const clamped = Math.min(100, Math.max(0, volume));
  return (clamped / 100).toFixed(2);
}

export function escapeFfmpegFilterPath(filePath: string): string {
  return filePath
    .replace(/\\/g, "/")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,");
}

function escapeForceStyle(style: string): string {
  return style.replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'").replace(/,/g, "\\,");
}

function uniqueFilters(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const filters: string[] = [];
  for (const value of values) {
    const filter = value?.trim() ?? "";
    if (!filter || seen.has(filter)) continue;
    seen.add(filter);
    filters.push(filter);
  }
  return filters;
}

function buildVideoFilterGraph(
  baseGraph: string,
  extraFilters: string[],
  subtitlePath: string | null,
  preset: ShortStylePreset | null | undefined,
  frameHeight: number,
): { graph: string; videoMap: string } {
  const parts = [baseGraph];
  let videoMap = "[v]";
  let step = 0;

  const nextVideo = () => {
    step += 1;
    return `[v${step}]`;
  };

  for (const filter of extraFilters) {
    const next = nextVideo();
    parts.push(`${videoMap}${filter}${next}`);
    videoMap = next;
  }

  if (preset?.captions.enabled && subtitlePath) {
    const next = nextVideo();
    const escapedPath = escapeFfmpegFilterPath(subtitlePath);
    const forceStyle = escapeForceStyle(captionForceStyle(preset.captions, frameHeight));
    parts.push(`${videoMap}subtitles='${escapedPath}':force_style='${forceStyle}'${next}`);
    videoMap = next;
  }

  return { graph: parts.join(";"), videoMap };
}

export function buildVerticalNvencCommand(params: {
  inputPath: string;
  outputPath: string;
  start: number;
  end: number;
  ffmpegConfig?: FFmpegToolConfig;
  preset?: ShortStylePreset | null;
  subtitlePath?: string | null;
}): string[] {
  const duration = Math.max(0, params.end - params.start);
  const width = config.RENDER_WIDTH;
  const height = config.RENDER_HEIGHT;
  const preset = params.preset ?? null;
  const filterGraph = buildPresetVideoGraph(preset, width, height);
  const ffmpeg = params.ffmpegConfig || loadActiveToolConfigs().ffmpeg;
  const videoCodec = ffmpeg.video_codec || config.RENDER_VIDEO_CODEC;
  const audioCodec = ffmpeg.audio_codec || config.RENDER_AUDIO_CODEC;
  const videoPreset = ffmpeg.video_preset || config.RENDER_VIDEO_PRESET;
  const musicPath = musicTrackPath(preset);

  const hasVideo = !ffmpeg.disable_video;
  const hasSourceAudio = !ffmpeg.disable_audio;
  const videoFilters = uniqueFilters([ffmpeg.video_filter, preset?.ffmpegVideoFilter]);
  const audioFilters = uniqueFilters([ffmpeg.audio_filter, preset?.ffmpegAudioFilter]);
  const filterData = hasVideo
    ? buildVideoFilterGraph(filterGraph, videoFilters, params.subtitlePath ?? null, preset, height)
    : null;

  const audioParts: string[] = [];
  let audioMap: string | null = null;
  if (musicPath) {
    const volume = musicVolumeFactor(preset as ShortStylePreset);
    if (hasSourceAudio) {
      audioParts.push(`[1:a]volume=${volume}[bed]`);
      audioParts.push(
        `[0:a][bed]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed]`,
      );
      audioMap = "[amixed]";
    } else {
      audioParts.push(`[1:a]volume=${volume}[amixed]`);
      audioMap = "[amixed]";
    }
  }

  if (audioMap) {
    let step = 0;
    for (const filter of audioFilters) {
      step += 1;
      const next = `[a${step}]`;
      audioParts.push(`${audioMap}${filter}${next}`);
      audioMap = next;
    }
  }

  const graphParts = [...(filterData ? [filterData.graph] : []), ...audioParts].filter(Boolean);

  const command: string[] = [
    "ffmpeg",
    "-y",
    "-hwaccel",
    "cuda",
    "-ss",
    params.start.toFixed(3),
    "-i",
    params.inputPath,
  ];

  if (musicPath) {
    command.push("-stream_loop", "-1", "-i", musicPath);
  }

  command.push("-t", duration.toFixed(3));

  if (graphParts.length > 0 && (hasVideo || musicPath)) {
    command.push("-filter_complex", graphParts.join(";"));
  }
  if (hasVideo && filterData) {
    command.push("-map", filterData.videoMap);
  }
  if (musicPath && audioMap) {
    command.push("-map", audioMap);
  } else if (hasSourceAudio) {
    command.push("-map", "0:a?");
  }

  if (hasVideo) {
    command.push("-c:v", videoCodec);
    command.push("-preset", videoPreset);
    if (ffmpeg.video_bitrate) {
      command.push("-b:v", ffmpeg.video_bitrate);
    }
    if (ffmpeg.framerate) {
      command.push("-r", ffmpeg.framerate);
    }
    if (ffmpeg.aspect_ratio) {
      command.push("-aspect", ffmpeg.aspect_ratio);
    }
  } else {
    command.push("-vn");
  }

  if (musicPath || hasSourceAudio) {
    command.push("-c:a", audioCodec);
    if (ffmpeg.audio_bitrate) {
      command.push("-b:a", ffmpeg.audio_bitrate);
    }
    if (ffmpeg.audio_sample_rate) {
      command.push("-ar", ffmpeg.audio_sample_rate);
    }
    if (ffmpeg.audio_channels) {
      command.push("-ac", ffmpeg.audio_channels);
    }
    if (!musicPath && hasSourceAudio && audioFilters.length > 0) {
      command.push("-af", audioFilters.join(","));
    }
  } else {
    command.push("-an");
  }

  if (ffmpeg.disable_subtitle) {
    command.push("-sn");
  }

  if (ffmpeg.metadata) {
    command.push("-metadata", ffmpeg.metadata);
  }

  if (ffmpeg.format) {
    command.push("-f", ffmpeg.format);
  }

  command.push("-movflags", "+faststart", params.outputPath);

  return command;
}
