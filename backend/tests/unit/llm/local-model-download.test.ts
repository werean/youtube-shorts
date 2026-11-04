import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import { ensureLocalChatModel, modelDownloadsEnabled } from "../../../src/llm/ensureLocalChatModel";
import { fasterWhisperWeightsCached } from "../../../src/pipeline/transcription/whisperWeights";
import {
  fasterWhisperCacheFolder,
  LM_STUDIO_DEFAULT_MODEL,
  parseLmsListedModels,
  planLocalChatModelDownload,
} from "../../../../shared/localInference";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("local model download decision", () => {
  it("parses lms ls json and treats a matching model key as already downloaded", () => {
    const listed = parseLmsListedModels(`
      noise before
      [{"type":"llm","modelKey":"qwen2.5-7b-instruct","path":"lmstudio-community/Qwen2.5-7B-Instruct-GGUF/Qwen2.5-7B-Instruct-Q4_K_M.gguf"}]
    `);
    const plan = planLocalChatModelDownload({
      savedModel: "gpt-oss:120b-cloud",
      downloadedModels: listed,
    });
    expect(plan.model).toBe(LM_STUDIO_DEFAULT_MODEL);
    expect(plan.shouldDownload).toBe(false);
    expect(plan.replacedSavedModel).toBe(true);
  });

  it("does not enable a real lms download from tests or an explicit skip", () => {
    expect(modelDownloadsEnabled({} as NodeJS.ProcessEnv, ["bun", "src/main.ts"])).toBe(true);
    expect(modelDownloadsEnabled({ VITEST: "true" }, ["bun", "src/main.ts"])).toBe(false);
    expect(modelDownloadsEnabled({ NODE_ENV: "test" }, ["node", "dist/main.js"])).toBe(false);
    expect(modelDownloadsEnabled({ BUN_TEST: "1" }, ["bun", "src/main.ts"])).toBe(false);
    expect(
      modelDownloadsEnabled({ YOUTUBE_SHORTS_SKIP_MODEL_DOWNLOAD: "1" }, ["node", "dist/main.js"]),
    ).toBe(false);
    expect(modelDownloadsEnabled({}, ["bun", "test", "local-model-download.test.ts"])).toBe(false);
    expect(modelDownloadsEnabled({}, ["node", "node_modules/vitest/vitest.mjs"])).toBe(false);
  });

  it("skips the lms process while the test runner is active", async () => {
    const status = await ensureLocalChatModel();
    expect(status).toEqual({
      model: LM_STUDIO_DEFAULT_MODEL,
      downloaded: false,
      skipped: true,
    });
  });

  it("sees large-v3 as missing until a snapshot exists, without downloading weights", () => {
    const root = mkdtempSync(join(tmpdir(), "faster-whisper-cache-"));
    tempDirs.push(root);
    expect(fasterWhisperWeightsCached("large-v3", [root])).toBe(false);
    const snapshot = join(root, fasterWhisperCacheFolder("large-v3"), "snapshots", "rev");
    mkdirSync(snapshot, { recursive: true });
    writeFileSync(join(snapshot, "model.bin"), "stub");
    expect(fasterWhisperWeightsCached("large-v3", [root])).toBe(true);
    expect(fasterWhisperCacheFolder("large-v3")).toBe("models--Systran--faster-whisper-large-v3");
  });
});
