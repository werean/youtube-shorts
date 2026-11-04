import { describe, expect, test } from "bun:test";

import {
  ollamaLocalOptions,
  resolveAnalysisEndpoint,
  resolveWhisperDevice,
} from "../../../../shared/localInference";
import { createBuiltinPresets, normalizeStyleLibrary } from "../../../../shared/stylePresets";

describe("local model device", () => {
  test("keeps GPU as the default for local models", () => {
    expect(
      ollamaLocalOptions({ model: "llama3.2", forceCpu: false, gpuAvailable: true }),
    ).toBeUndefined();
    expect(resolveWhisperDevice({ savedDevice: "cuda", gpuAvailable: true })).toBe("cuda");
    expect(resolveWhisperDevice({ savedDevice: undefined, gpuAvailable: true })).toBe("cuda");
  });

  test("uses CPU only after an explicit opt-in or when no GPU exists", () => {
    expect(ollamaLocalOptions({ model: "llama3.2", forceCpu: true, gpuAvailable: true })).toEqual({
      num_gpu: 0,
    });
    expect(ollamaLocalOptions({ model: "llama3.2", forceCpu: false, gpuAvailable: false })).toEqual({
      num_gpu: 0,
    });
    expect(resolveWhisperDevice({ savedDevice: "cuda", gpuAvailable: false })).toBe("cpu");
    expect(resolveWhisperDevice({ savedDevice: "cpu", gpuAvailable: true })).toBe("cpu");
  });

  test("sends analysis to LM Studio when the saved model is an Ollama cloud model", () => {
    expect(
      resolveAnalysisEndpoint({
        model: "gpt-oss:120b-cloud",
        baseUrl: "http://localhost:11434",
      }),
    ).toEqual({
      model: "local-model",
      baseUrl: "http://localhost:1234/v1",
    });
    expect(
      resolveAnalysisEndpoint({
        model: "qwen2.5-7b-instruct",
        baseUrl: "http://127.0.0.1:1234/v1",
      }),
    ).toEqual({
      model: "qwen2.5-7b-instruct",
      baseUrl: "http://127.0.0.1:1234/v1",
    });
  });

  test("does not send a device flag for cloud models", () => {
    expect(
      ollamaLocalOptions({ model: "gpt-oss:120b-cloud", forceCpu: true, gpuAvailable: false }),
    ).toBeUndefined();
  });
});

describe("short style presets", () => {
  test("keeps built-in presets and treats a clone as a custom preset", () => {
    const library = normalizeStyleLibrary({
      activeId: "classic",
      presets: [
        {
          id: "classic",
          name: "Clássico",
          builtin: true,
          blur: { enabled: true, target: "top", strength: 12 },
          music: { enabled: true, trackName: "tema.mp3", volume: 40 },
          captions: {
            enabled: false,
            fontFamily: "Georgia",
            fontSize: 36,
            position: "top",
          },
        },
        {
          id: "custom-1",
          name: "Clássico (cópia)",
          builtin: false,
          ffmpegVideoFilter: "eq=contrast=1.04",
          ffmpegAudioFilter: "volume=0.8",
        },
      ],
    });

    expect(library.presets.map((preset) => preset.id)).toEqual([
      ...createBuiltinPresets().map((preset) => preset.id),
      "custom-1",
    ]);

    const classic = library.presets.find((preset) => preset.id === "classic");
    const copy = library.presets.find((preset) => preset.id === "custom-1");
    expect(classic?.blur.target).toBe("top");
    expect(classic?.music).toMatchObject({ enabled: true, trackName: "tema.mp3", volume: 40 });
    expect(classic?.captions).toMatchObject({
      enabled: false,
      fontFamily: "Georgia",
      fontSize: 36,
      position: "top",
    });
    expect(copy?.builtin).toBe(false);
    expect(copy?.ffmpegVideoFilter).toBe("eq=contrast=1.04");
    expect(copy?.ffmpegAudioFilter).toBe("volume=0.8");
  });
});
