import { describe, expect, it } from "vitest";
import {
  buildWhisperCommand,
  fasterWhisperComputeType,
  resolveWhisperEngine,
} from "../../../src/pipeline/transcription/command";
import type { ToolConfigs } from "../../../src/core/toolConfigs";

function configs(whisper: ToolConfigs["whisper"]): ToolConfigs {
  return {
    whisper,
    ffmpeg: {},
    llm: {
      model: "local-model",
      base_url: "http://localhost:1234/v1",
      system_prompt: "json",
    },
  };
}

describe("whisper engine selection", () => {
  it("defaults to faster-whisper and keeps float16 for GPU", () => {
    const command = buildWhisperCommand(
      "/tmp/video.mp4",
      "/tmp/out",
      configs({ model: "large-v3", device: "cpu" }),
    );

    expect(resolveWhisperEngine(configs({}))).toBe("faster-whisper");
    expect(command[0]).toBe("python");
    expect(command[1]).toContain("faster_whisper_runner.py");
    expect(command).toContain("--model");
    expect(command).toContain("large-v3");
    expect(command).toContain("--device");
    expect(command).toContain("cpu");
    expect(command).toContain("--compute_type");
    expect(command).toContain("int8");
    expect(fasterWhisperComputeType("cuda", true)).toBe("float16");
    expect(command[0]).not.toBe("whisper");
  });

  it("keeps the openai-whisper CLI when the user selects it", () => {
    const command = buildWhisperCommand(
      "/tmp/video.mp4",
      "/tmp/out",
      configs({ engine: "openai-whisper", model: "large-v3", device: "cpu" }),
    );

    expect(command[0]).toBe("whisper");
    expect(command).toContain("--output_format");
    expect(command).toContain("json");
    expect(command).toContain("--fp16");
    expect(command).toContain("False");
    expect(fasterWhisperComputeType("cpu", true)).toBe("int8");
    expect(fasterWhisperComputeType("cuda", false)).toBe("float32");
  });
});
