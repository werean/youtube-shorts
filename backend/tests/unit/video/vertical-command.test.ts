import { describe, expect, it } from "vitest";
import { buildVerticalFilter, buildVerticalNvencCommand } from "../../../src/video/vertical";

const ffmpegConfig = {
  video_codec: "h264_nvenc",
  audio_codec: "aac",
  video_preset: "p5",
};

describe("vertical render command", () => {
  it("blurs a smaller background and keeps the 1080x1920 frame", () => {
    const filter = buildVerticalFilter(1080, 1920);
    expect(filter).toContain("scale=270:480");
    expect(filter).toContain("boxblur=20:1");
    expect(filter).toContain("scale=1080:1920");
    expect(filter).toContain("overlay=(W-w)/2:(H-h)/2");
  });

  it("uses CUDA only for nvenc and corrects the keyframe with a second seek", () => {
    const command = buildVerticalNvencCommand({
      inputPath: "source.mp4",
      outputPath: "out.mp4",
      start: 10,
      end: 40,
      ffmpegConfig,
    });

    expect(command.slice(0, 12)).toEqual([
      "ffmpeg",
      "-y",
      "-hwaccel",
      "cuda",
      "-ss",
      "8.000",
      "-i",
      "source.mp4",
      "-ss",
      "2.000",
      "-t",
      "30.000",
    ]);
    expect(command).toContain("h264_nvenc");
  });

  it("omits CUDA when the codec is not nvenc and when hardware is disabled", () => {
    const cpu = buildVerticalNvencCommand({
      inputPath: "source.mp4",
      outputPath: "out.mp4",
      start: 0,
      end: 5,
      ffmpegConfig: { ...ffmpegConfig, video_codec: "libx264" },
    });
    const fallback = buildVerticalNvencCommand({
      inputPath: "source.mp4",
      outputPath: "out.mp4",
      start: 3,
      end: 8,
      ffmpegConfig,
      disableHardware: true,
    });

    expect(cpu).not.toContain("cuda");
    expect(cpu).toContain("libx264");
    expect(fallback).not.toContain("cuda");
    expect(fallback).toContain("libx264");
    expect(fallback).toContain("veryfast");
  });
});
