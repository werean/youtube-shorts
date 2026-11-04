/**
 * Check the local LM Studio catalog and download the configured chat model
 * when it is missing. The download runs on the user's machine at startup and
 * before analysis. Tests and explicit opt-out never spawn `lms`.
 */

import { spawn } from "child_process";
import { loadSettings, rewriteLlmModelIfUnusable } from "../core/settings";
import { loadActiveToolConfigs, updateToolConfigs } from "../core/toolConfigs";
import {
  LM_STUDIO_DEFAULT_MODEL,
  parseLmsListedModels,
  planLocalChatModelDownload,
  resolveLocalChatModel,
  type ListedLocalModel,
} from "../../../shared/localInference";

const LIST_TIMEOUT_MS = 30_000;
const DOWNLOAD_TIMEOUT_MS = 6 * 60 * 60 * 1000;

export type LocalChatModelStatus = {
  model: string;
  downloaded: boolean;
  skipped: boolean;
};

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  error?: string;
};

let inflight: Promise<LocalChatModelStatus> | null = null;

export function modelDownloadsEnabled(
  env: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv,
): boolean {
  if (env.YOUTUBE_SHORTS_SKIP_MODEL_DOWNLOAD === "1") return false;
  if (env.VITEST || env.NODE_ENV === "test" || env.BUN_TEST) return false;
  return !argv.some((arg) => {
    const value = arg.replace(/\\/g, "/");
    return value === "test" || value === "vitest" || /\/vitest(\.mjs|\.js)?$/.test(value);
  });
}

function execLms(args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn("lms", args, {
      windowsHide: true,
      shell: process.platform === "win32",
    });
    const finish = (result: CommandResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish({
        code: null,
        stdout,
        stderr,
        error: `lms ${args[0] || ""} timed out`.trim(),
      });
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) console.log(`[llm] ${line}`);
      }
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) console.log(`[llm] ${line}`);
      }
    });
    child.on("error", (error) => {
      finish({ code: null, stdout, stderr, error: error.message });
    });
    child.on("close", (code) => {
      finish({ code, stdout, stderr });
    });
  });
}

async function listDownloadedModels(): Promise<ListedLocalModel[]> {
  const listed = await execLms(["ls", "--llm", "--json"], LIST_TIMEOUT_MS);
  if (listed.code !== 0) {
    console.warn(
      `[llm] Could not list LM Studio models (${listed.error || listed.stderr || `exit ${listed.code}`}).`,
    );
    return [];
  }
  return parseLmsListedModels(listed.stdout);
}

function rememberResolvedModel(model: string): void {
  try {
    rewriteLlmModelIfUnusable();
  } catch (error) {
    console.warn(
      `[llm] Could not update settings.json: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  try {
    const active = loadActiveToolConfigs();
    if (active.llm.model !== model) {
      updateToolConfigs({ llm: { ...active.llm, model } });
    }
  } catch (error) {
    console.warn(
      `[llm] Could not update the saved chat model: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function runEnsure(): Promise<LocalChatModelStatus> {
  const settingsModel = loadSettings().llm.model;
  const configuredModel = loadActiveToolConfigs().llm.model || settingsModel;
  const downloadedModels = await listDownloadedModels();
  const plan = planLocalChatModelDownload({
    savedModel: configuredModel,
    downloadedModels,
  });
  rememberResolvedModel(plan.model);

  if (!plan.shouldDownload) {
    console.log(`[llm] Local model '${plan.model}' is already downloaded.`);
    return { model: plan.model, downloaded: false, skipped: false };
  }

  console.log(`[llm] Downloading '${plan.model}' with: lms ${plan.downloadArgs.join(" ")}`);
  const download = await execLms(plan.downloadArgs, DOWNLOAD_TIMEOUT_MS);
  if (download.code !== 0) {
    console.warn(
      `[llm] Download of '${plan.model}' failed (${download.error || download.stderr || `exit ${download.code}`}). Analysis will still request this local model.`,
    );
    return { model: plan.model, downloaded: false, skipped: false };
  }
  console.log(`[llm] Local model '${plan.model}' is ready.`);
  return { model: plan.model, downloaded: true, skipped: false };
}

/**
 * List and, when needed, download the chat model. No-ops during tests.
 * Concurrent callers share one in-flight check.
 */
export function ensureLocalChatModel(): Promise<LocalChatModelStatus> {
  if (!modelDownloadsEnabled()) {
    return Promise.resolve({
      model: LM_STUDIO_DEFAULT_MODEL,
      downloaded: false,
      skipped: true,
    });
  }
  if (!inflight) {
    inflight = runEnsure().finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

/** Analysis entry. Resolves llama2, cloud, and placeholder names even when download is skipped. */
export async function resolveChatModelForAnalysis(savedModel?: string | null): Promise<string> {
  const resolved = resolveLocalChatModel(savedModel);
  if (!modelDownloadsEnabled()) return resolved;
  try {
    const ensured = await ensureLocalChatModel();
    return ensured.model || resolved;
  } catch (error) {
    console.warn(
      `[llm] Local model check failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return resolved;
  }
}
