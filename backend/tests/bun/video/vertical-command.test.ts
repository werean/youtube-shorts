import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { buildRenderCommand } from "../../../src/pipeline/rendering/commands";
import { buildCaptionAss, cuesForCut } from "../../../src/video/captions";
import { buildVerticalNvencCommand } from "../../../src/video/vertical";
import type { ShortStylePreset } from "../../../../shared/stylePresets";
import type { Segment } from "../../../src/models/segment";

const ffmpeg = {
  video_codec: "h264_nvenc",
  audio_codec: "aac",
  video_preset: "p5",
  disable_video: false,
  disable_audio: false,
  video_filter: null,
  audio_filter: null,
};

function preset(overrides: Partial<ShortStylePreset> = {}): ShortStylePreset {
  return {
    id: "custom",
    name: "Custom",
    builtin: false,
    blur: {
      enabled: true,
      target: "background",
      strength: 20,
      region: { x: 8, y: 70, width: 84, height: 18 },
    },
    music: { enabled: false, trackName: "", volume: 25 },
    captions: {
      enabled: false,
      fontFamily: "Segoe UI",
      fontSize: 48,
      position: "bottom",
    },
    extras: [],
    ffmpegVideoFilter: "",
    ffmpegAudioFilter: "",
    ...overrides,
  };
}

function graphOf(command: string[]): string {
  const index = command.indexOf("-filter_complex");
  return index >= 0 ? command[index + 1] : "";
}

describe("vertical render command", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test("keeps the fixed background blur when no preset is passed", () => {
    const command = buildVerticalNvencCommand({
      inputPath: "/videos/source.mp4",
      outputPath: "/shorts/out.mp4",
      start: 1,
      end: 3,
      ffmpegConfig: ffmpeg,
    });

    expect(command.slice(0, 8)).toEqual([
      "ffmpeg",
      "-y",
      "-hwaccel",
      "cuda",
      "-ss",
      "1.000",
      "-i",
      "/videos/source.mp4",
    ]);
    expect(graphOf(command)).toContain("boxblur=20:1");
    expect(graphOf(command)).toContain("force_original_aspect_ratio=increase");
    expect(command).not.toContain("-stream_loop");
    expect(graphOf(command)).not.toContain("subtitles=");
  });

  test("blur off pads the frame and does not force a background blur", () => {
    const command = buildVerticalNvencCommand({
      inputPath: "/videos/source.mp4",
      outputPath: "/shorts/out.mp4",
      start: 0,
      end: 5,
      ffmpegConfig: ffmpeg,
      preset: preset({
        blur: {
          enabled: false,
          target: "background",
          strength: 28,
          region: { x: 0, y: 0, width: 100, height: 22 },
        },
      }),
    });

    const graph = graphOf(command);
    expect(graph).not.toContain("boxblur");
    expect(graph).toContain("force_original_aspect_ratio=decrease");
    expect(graph).toContain("pad=1080:1920");
  });

  test("background blur uses the preset strength", () => {
    const command = buildVerticalNvencCommand({
      inputPath: "/videos/source.mp4",
      outputPath: "/shorts/out.mp4",
      start: 0,
      end: 5,
      ffmpegConfig: ffmpeg,
      preset: preset({
        blur: {
          enabled: true,
          target: "background",
          strength: 28,
          region: { x: 0, y: 0, width: 100, height: 22 },
        },
      }),
    });

    const graph = graphOf(command);
    expect(graph).toContain("boxblur=28:1");
    expect(graph).not.toContain("boxblur=20:1");
    expect(graph).toContain("force_original_aspect_ratio=increase");
  });

  test("top, bottom, and custom blur use that region instead of the full background", () => {
    const top = graphOf(
      buildVerticalNvencCommand({
        inputPath: "/videos/source.mp4",
        outputPath: "/shorts/out.mp4",
        start: 0,
        end: 2,
        ffmpegConfig: ffmpeg,
        preset: preset({
          blur: {
            enabled: true,
            target: "top",
            strength: 16,
            region: { x: 0, y: 0, width: 100, height: 22 },
          },
        }),
      }),
    );
    expect(top).toContain("boxblur=16:1");
    expect(top).toContain("crop=1080:422:0:0");
    expect(top).toContain("overlay=0:0");
    expect(top).not.toContain("force_original_aspect_ratio=increase");

    const bottom = graphOf(
      buildVerticalNvencCommand({
        inputPath: "/videos/source.mp4",
        outputPath: "/shorts/out.mp4",
        start: 0,
        end: 2,
        ffmpegConfig: ffmpeg,
        preset: preset({
          blur: {
            enabled: true,
            target: "bottom",
            strength: 12,
            region: { x: 0, y: 0, width: 100, height: 22 },
          },
        }),
      }),
    );
    expect(bottom).toContain("boxblur=12:1");
    expect(bottom).toContain("crop=1080:422:0:1496");
    expect(bottom).toContain("overlay=0:1496");

    const custom = graphOf(
      buildVerticalNvencCommand({
        inputPath: "/videos/source.mp4",
        outputPath: "/shorts/out.mp4",
        start: 0,
        end: 2,
        ffmpegConfig: ffmpeg,
        preset: preset({
          blur: {
            enabled: true,
            target: "custom",
            strength: 8,
            region: { x: 8, y: 70, width: 84, height: 18 },
          },
        }),
      }),
    );
    expect(custom).toContain("boxblur=8:1");
    expect(custom).toContain("crop=906:344:86:1344");
    expect(custom).toContain("overlay=86:1344");
  });

  test("music on mixes the preset path at the preset volume", () => {
    const command = buildVerticalNvencCommand({
      inputPath: "/videos/source.mp4",
      outputPath: "/shorts/out.mp4",
      start: 2,
      end: 8,
      ffmpegConfig: ffmpeg,
      preset: preset({
        music: { enabled: true, trackName: "/music/tema.mp3", volume: 40 },
      }),
    });

    expect(command).toContain("-stream_loop");
    expect(command).toContain("/music/tema.mp3");
    const graph = graphOf(command);
    expect(graph).toContain("[1:a]volume=0.40[bed]");
    expect(graph).toContain("amix=inputs=2:duration=first:dropout_transition=0:normalize=0");
    expect(command).toContain("[amixed]");
  });

  test("music on without a path does not add an input", () => {
    const command = buildVerticalNvencCommand({
      inputPath: "/videos/source.mp4",
      outputPath: "/shorts/out.mp4",
      start: 0,
      end: 2,
      ffmpegConfig: ffmpeg,
      preset: preset({
        music: { enabled: true, trackName: "   ", volume: 80 },
      }),
    });

    expect(command).not.toContain("-stream_loop");
    expect(graphOf(command)).not.toContain("amix=");
  });

  test("captions on burn the subtitle file with the preset font, size, and position", () => {
    const command = buildVerticalNvencCommand({
      inputPath: "/videos/source.mp4",
      outputPath: "/shorts/out.mp4",
      start: 4,
      end: 9,
      ffmpegConfig: ffmpeg,
      subtitlePath: "/shorts/out.ass",
      preset: preset({
        captions: {
          enabled: true,
          fontFamily: "Georgia",
          fontSize: 36,
          position: "top",
        },
      }),
    });

    const graph = graphOf(command);
    expect(graph).toContain("subtitles='/shorts/out.ass'");
    expect(graph).toContain("Fontname=Georgia");
    expect(graph).toContain("Fontsize=36");
    expect(graph).toContain("Alignment=8");
  });

  test("captions off omit the subtitle filter", () => {
    const command = buildVerticalNvencCommand({
      inputPath: "/videos/source.mp4",
      outputPath: "/shorts/out.mp4",
      start: 0,
      end: 2,
      ffmpegConfig: ffmpeg,
      subtitlePath: "/shorts/out.ass",
      preset: preset({
        captions: {
          enabled: false,
          fontFamily: "Georgia",
          fontSize: 36,
          position: "top",
        },
      }),
    });

    expect(graphOf(command)).not.toContain("subtitles=");
  });

  test("cue selection keeps only the transcript that overlaps the cut", () => {
    const segments: Segment[] = [
      { segment_id: "s1", start: 0, end: 3, text: "Antes" },
      { segment_id: "s2", start: 3.5, end: 7, text: "Trecho do corte" },
      { segment_id: "s3", start: 8, end: 12, text: "Depois" },
    ];

    expect(cuesForCut(segments, 4, 9)).toEqual([
      { start: 0, end: 3, text: "Trecho do corte" },
      { start: 4, end: 5, text: "Depois" },
    ]);

    const ass = buildCaptionAss({
      cues: cuesForCut(segments, 4, 9),
      style: { fontFamily: "Arial", fontSize: 52, position: "center" },
      width: 1080,
      height: 1920,
    });
    expect(ass).toContain("Style: Caption,Arial,52,");
    expect(ass).toContain(",5,40,40,0,1");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:03.00,Caption,,0,0,0,,Trecho do corte");
    expect(ass).not.toContain("Antes");
  });

  test("render command writes the cut transcript and points ffmpeg at it", () => {
    const shortsDir = fs.mkdtempSync(path.join(os.tmpdir(), "vertical-command-"));
    tempDirs.push(shortsDir);
    const details = buildRenderCommand({
      cut: {
        cut_id: "c1",
        block_ids: ["b1"],
        start: 4,
        end: 9,
        title: "Corte",
        status: "pending",
      },
      videoPath: "/videos/source.mp4",
      shortsDir,
      ffmpegConfig: ffmpeg,
      preset: preset({
        captions: {
          enabled: true,
          fontFamily: "Impact",
          fontSize: 60,
          position: "bottom",
        },
      }),
      segments: [
        { segment_id: "s1", start: 5, end: 8, text: "Fala do corte" },
        { segment_id: "s2", start: 20, end: 22, text: "Fora" },
      ],
    });

    const subtitlePath = details.outputPath.replace(/\.mp4$/, ".ass");
    expect(fs.existsSync(subtitlePath)).toBe(true);
    const ass = fs.readFileSync(subtitlePath, "utf-8");
    expect(ass).toContain("Fala do corte");
    expect(ass).not.toContain("Fora");
    expect(ass).toContain("Impact,60");
    expect(graphOf(details.command)).toContain(`subtitles='${subtitlePath}'`);
    expect(graphOf(details.command)).toContain("Fontname=Impact");
    expect(graphOf(details.command)).toContain("Fontsize=60");
    expect(graphOf(details.command)).toContain("Alignment=2");
    expect(details.command).toContain("-hwaccel");
    expect(details.command).toContain("cuda");
  });
});
