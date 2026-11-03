import * as fs from "fs";
import * as path from "path";
import type { FFmpegToolConfig } from "../../core/toolConfigs";
import { config } from "../../core/config";
import { Cut } from "../../models/cut";
import type { Segment } from "../../models/segment";
import * as artifactService from "../../services/artifactService";
import { buildCaptionAss, cuesForCut } from "../../video/captions";
import { buildVerticalNvencCommand } from "../../video/vertical";
import type { ShortStylePreset } from "../../../../shared/stylePresets";

export type RenderCommandDetails = {
  command: string[];
  filename: string;
  outputPath: string;
};

export function buildRenderCommand(params: {
  cut: Cut;
  videoPath: string;
  shortsDir: string;
  ffmpegConfig: FFmpegToolConfig;
  preset?: ShortStylePreset | null;
  segments?: Segment[];
}): RenderCommandDetails {
  const filename = artifactService.buildCutFilename(params.cut.start, params.cut.end);
  const outputPath = path.join(params.shortsDir, filename);
  const subtitlePath = writeCutCaptions({
    preset: params.preset,
    segments: params.segments,
    cut: params.cut,
    outputPath,
  });
  const command = buildVerticalNvencCommand({
    inputPath: params.videoPath,
    outputPath,
    start: params.cut.start,
    end: params.cut.end,
    ffmpegConfig: params.ffmpegConfig,
    preset: params.preset,
    subtitlePath,
  });

  return {
    command,
    filename,
    outputPath,
  };
}

function writeCutCaptions(params: {
  preset?: ShortStylePreset | null;
  segments?: Segment[];
  cut: Cut;
  outputPath: string;
}): string | null {
  if (!params.preset?.captions.enabled || !params.segments?.length) return null;
  const cues = cuesForCut(params.segments, params.cut.start, params.cut.end);
  if (cues.length === 0) return null;

  const subtitlePath = params.outputPath.replace(/\.mp4$/i, ".ass");
  fs.mkdirSync(path.dirname(subtitlePath), { recursive: true });
  fs.writeFileSync(
    subtitlePath,
    buildCaptionAss({
      cues,
      style: params.preset.captions,
      width: config.RENDER_WIDTH,
      height: config.RENDER_HEIGHT,
    }),
    "utf-8",
  );
  return subtitlePath;
}
