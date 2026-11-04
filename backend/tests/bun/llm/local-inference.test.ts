import { describe, expect, test } from "bun:test";

import {
  LM_STUDIO_DEFAULT_DOWNLOAD_SPEC,
  LM_STUDIO_DEFAULT_MODEL,
  ollamaLocalOptions,
  planFasterWhisperWeights,
  planLocalChatModelDownload,
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
      model: "qwen2.5-7b-instruct",
      baseUrl: "http://localhost:1234/v1",
    });
    expect(
      resolveAnalysisEndpoint({
        model: "llama2",
        baseUrl: "http://localhost:11434",
      }),
    ).toEqual({
      model: "qwen2.5-7b-instruct",
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

  test("falls back when the saved model is llama2, empty, or a placeholder", () => {
    expect(resolveAnalysisEndpoint({ model: "", baseUrl: "" }).model).toBe(LM_STUDIO_DEFAULT_MODEL);
    expect(resolveAnalysisEndpoint({ model: "local-model", baseUrl: "" }).model).toBe(
      LM_STUDIO_DEFAULT_MODEL,
    );
    expect(resolveAnalysisEndpoint({ model: "llama2:latest", baseUrl: "" }).model).toBe(
      LM_STUDIO_DEFAULT_MODEL,
    );
  });

  test("downloads the default model only when LM Studio does not already have it", () => {
    const missing = planLocalChatModelDownload({
      savedModel: "llama2",
      downloadedModels: [],
    });
    expect(missing).toMatchObject({
      model: LM_STUDIO_DEFAULT_MODEL,
      replacedSavedModel: true,
      shouldDownload: true,
      downloadArgs: ["get", LM_STUDIO_DEFAULT_DOWNLOAD_SPEC, "-y", "--gguf"],
    });

    const present = planLocalChatModelDownload({
      savedModel: "llama2",
      downloadedModels: [
        {
          modelKey: LM_STUDIO_DEFAULT_MODEL,
          path: "lmstudio-community/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf",
        },
      ],
    });
    expect(present.shouldDownload).toBe(false);
    expect(present.model).toBe(LM_STUDIO_DEFAULT_MODEL);
    expect(present.downloadArgs).toEqual([]);
  });

  test("keeps a concrete local model and downloads that model when it is missing", () => {
    const plan = planLocalChatModelDownload({
      savedModel: "my-local-writer",
      downloadedModels: [{ modelKey: "other-model", path: "" }],
    });
    expect(plan).toMatchObject({
      model: "my-local-writer",
      replacedSavedModel: false,
      shouldDownload: true,
      downloadArgs: ["get", "my-local-writer@q4_k_m", "-y", "--gguf"],
    });
  });

  test("downloads large-v3 on GPU when the faster-whisper cache is empty", () => {
    expect(
      planFasterWhisperWeights({
        model: "",
        savedDevice: "cuda",
        gpuAvailable: true,
        weightsCached: false,
      }),
    ).toEqual({ model: "large-v3", device: "cuda", shouldDownload: true });
    expect(
      planFasterWhisperWeights({
        model: "large-v3",
        savedDevice: "cuda",
        gpuAvailable: true,
        weightsCached: true,
      }),
    ).toEqual({ model: "large-v3", device: "cuda", shouldDownload: false });
    expect(
      planFasterWhisperWeights({
        model: "large-v3",
        savedDevice: "cuda",
        gpuAvailable: false,
        weightsCached: false,
      }).device,
    ).toBe("cpu");
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
