/**
 * Vertical rendering strategy and layout helpers.
 */

import { config } from "../core/config";
import { loadActiveToolConfigs } from "../core/toolConfigs";

export function buildVerticalFilter(width: number, height: number): string {
  return (
    `[0:v]scale=${width}:${height}:force_original_aspect_ratio=increase,` +
    `crop=${width}:${height},boxblur=20:1,setsar=1[bg];` +
    `[0:v]scale=${width}:-2:force_original_aspect_ratio=decrease,setsar=1[fg];` +
    `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[v]`
  );
}

function buildVideoFilterGraph(
  baseGraph: string,
  extraFilter?: string | null,
): {
  graph: string;
  videoMap: string;
} {
  const filter = extraFilter ? extraFilter.trim() : "";
  if (!filter) {
    return { graph: baseGraph, videoMap: "[v]" };
  }
  return {
    graph: `${baseGraph};[v]${filter}[vout]`,
    videoMap: "[vout]",
  };
}

export function buildVerticalNvencCommand(params: {
  inputPath: string;
  outputPath: string;
  start: number;
  end: number;
}): string[] {
  const duration = Math.max(0, params.end - params.start);
  const filterGraph = buildVerticalFilter(config.RENDER_WIDTH, config.RENDER_HEIGHT);
  const toolConfigs = loadActiveToolConfigs();
  const ffmpeg = toolConfigs.ffmpeg;
  const videoCodec = ffmpeg.video_codec || config.RENDER_VIDEO_CODEC;
  const audioCodec = ffmpeg.audio_codec || config.RENDER_AUDIO_CODEC;
  const videoPreset = ffmpeg.video_preset || config.RENDER_VIDEO_PRESET;

  const hasVideo = !ffmpeg.disable_video;
  const hasAudio = !ffmpeg.disable_audio;
  const filterData = hasVideo ? buildVideoFilterGraph(filterGraph, ffmpeg.video_filter) : null;

  const command: string[] = [
    "ffmpeg",
    "-y",
    "-hwaccel",
    "cuda",
    "-ss",
    params.start.toFixed(3),
    "-i",
    params.inputPath,
    "-t",
    duration.toFixed(3),
  ];

  if (hasVideo && filterData) {
    command.push("-filter_complex", filterData.graph);
    command.push("-map", filterData.videoMap);
  }
  if (hasAudio) {
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

  if (hasAudio) {
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
    if (ffmpeg.audio_filter) {
      command.push("-af", ffmpeg.audio_filter);
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
