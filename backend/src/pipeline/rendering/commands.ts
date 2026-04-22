import * as path from "path";
import type { FFmpegToolConfig } from "../../core/toolConfigs";
import { Cut } from "../../models/cut";
import * as artifactService from "../../services/artifactService";
import { buildVerticalNvencCommand } from "../../video/vertical";

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
}): RenderCommandDetails {
  const filename = artifactService.buildCutFilename(params.cut.start, params.cut.end);
  const outputPath = path.join(params.shortsDir, filename);
  const command = buildVerticalNvencCommand({
    inputPath: params.videoPath,
    outputPath,
    start: params.cut.start,
    end: params.cut.end,
    ffmpegConfig: params.ffmpegConfig,
  });

  return {
    command,
    filename,
    outputPath,
  };
}
