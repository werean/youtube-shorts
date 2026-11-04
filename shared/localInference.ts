/**
 * Device choice for local models.
 * GPU is the default. CPU is used only when the user opted in, or no GPU is present.
 * Analysis never uses a cloud model name or an Ollama endpoint.
 */

export const LM_STUDIO_BASE_URL = "http://localhost:1234/v1";
/**
 * LM Studio model key for Qwen2.5 7B Instruct Q4_K_M.
 * `lms get` downloads it from the public Hugging Face repo with no API key.
 * The same key is what the local chat API expects.
 */
export const LM_STUDIO_DEFAULT_MODEL = "qwen2.5-7b-instruct";
export const LM_STUDIO_DEFAULT_DOWNLOAD_SPEC =
  "https://huggingface.co/lmstudio-community/Qwen2.5-7B-Instruct-GGUF@Q4_K_M";
export const FASTER_WHISPER_DEFAULT_MODEL = "large-v3";

const KNOWN_OLLAMA_MODEL_ROOTS = new Set([
  "llama2",
  "llama2-uncensored",
  "llama3",
  "llama3.1",
  "llama3.2",
  "llama3.3",
  "codellama",
  "mistral",
  "mixtral",
  "phi",
  "phi3",
  "phi4",
  "gemma",
  "gemma2",
  "gemma3",
  "vicuna",
  "orca-mini",
  "neural-chat",
  "starling-lm",
  "tinyllama",
  "nomic-embed-text",
  "deepseek-coder",
  "deepseek-r1",
  "llava",
  "wizardlm",
  "openhermes",
  "command-r",
  "stablelm",
  "nous-hermes",
  "nous-hermes2",
  "dolphin-mixtral",
  "solar",
  "yi",
  "qwen",
  "qwen2",
  "qwen2.5",
]);

const PLACEHOLDER_CHAT_MODELS = new Set([
  "local-model",
  "local_model",
  "lmstudio",
  "lm-studio",
]);

const FASTER_WHISPER_REPOS: Record<string, string> = {
  "large-v3": "Systran/faster-whisper-large-v3",
  large: "Systran/faster-whisper-large-v3",
  turbo: "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
  "large-v3-turbo": "mobiuslabsgmbh/faster-whisper-large-v3-turbo",
};

export function isCloudModelName(model: string): boolean {
  return model.toLowerCase().includes("cloud");
}

/** Saved names that are not a concrete LM Studio model. */
export function isUnusableSavedChatModel(model: string): boolean {
  const raw = model.trim().toLowerCase();
  if (!raw) return true;
  if (isCloudModelName(raw) || PLACEHOLDER_CHAT_MODELS.has(raw)) return true;
  const root = raw.split(":")[0]?.trim() || raw;
  return KNOWN_OLLAMA_MODEL_ROOTS.has(root);
}

export function resolveLocalChatModel(model?: string | null): string {
  const raw = String(model ?? "").trim();
  if (isUnusableSavedChatModel(raw)) return LM_STUDIO_DEFAULT_MODEL;
  return raw;
}

export function isOllamaEndpoint(url: string): boolean {
  const value = url.trim().toLowerCase();
  return (
    value.includes(":11434") ||
    value.includes("ollama.com") ||
    value.includes("/api/chat") ||
    value.includes("/api/embed")
  );
}

/**
 * Analysis talks to a local OpenAI-compatible server.
 * A cloud model such as gpt-oss:120b-cloud, or an Ollama base URL, is replaced
 * with the LM Studio default. A local model name and a non-Ollama URL are kept.
 */
export function resolveAnalysisEndpoint(input: {
  model?: string | null;
  baseUrl?: string | null;
}): { model: string; baseUrl: string } {
  const rawUrl = String(input.baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  const urlIsOllama = rawUrl.length === 0 || isOllamaEndpoint(rawUrl);
  return {
    model: resolveLocalChatModel(input.model),
    baseUrl: urlIsOllama ? LM_STUDIO_BASE_URL : rawUrl,
  };
}

export function resolveWhisperDevice(input: {
  savedDevice?: string | null;
  gpuAvailable: boolean;
}): "cpu" | "cuda" {
  if (!input.gpuAvailable) return "cpu";
  return input.savedDevice === "cpu" ? "cpu" : "cuda";
}

/** Ollama options for one model. Undefined keeps Ollama's own GPU default. */
export function ollamaLocalOptions(input: {
  model: string;
  forceCpu: boolean;
  gpuAvailable: boolean;
}): { num_gpu: 0 } | undefined {
  if (isCloudModelName(input.model)) return undefined;
  if (input.forceCpu || !input.gpuAvailable) return { num_gpu: 0 };
  return undefined;
}

export type ListedLocalModel = {
  modelKey: string;
  path: string;
};

export function parseLmsListedModels(stdout: string): ListedLocalModel[] {
  const trimmed = stdout.trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const models: ListedLocalModel[] = [];
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    models.push({
      modelKey: String(record.modelKey || record.model_key || record.key || "").trim(),
      path: String(record.path || "").trim(),
    });
  }
  return models;
}

export function modelKeysMatch(requested: string, candidate: string): boolean {
  const want = requested.trim().toLowerCase();
  const have = candidate.trim().toLowerCase();
  if (!want || !have) return false;
  if (want === have) return true;
  const wantBase = want.split("@")[0];
  const haveBase = have.split("@")[0];
  if (wantBase === haveBase) return true;
  const parts = have.split(/[\\/]/);
  return parts.some((part) => {
    const file = part.split("@")[0];
    return (
      file === wantBase ||
      file.startsWith(`${wantBase}.`) ||
      file.startsWith(`${wantBase}-q`) ||
      file.startsWith(`${wantBase}@`)
    );
  });
}

/** Arguments after the `lms` executable. Non-interactive and GGUF-only. */
export function lmStudioGetArgs(model: string): string[] {
  const spec =
    model === LM_STUDIO_DEFAULT_MODEL
      ? LM_STUDIO_DEFAULT_DOWNLOAD_SPEC
      : model.includes("@") || model.startsWith("http://") || model.startsWith("https://")
        ? model
        : `${model}@q4_k_m`;
  return ["get", spec, "-y", "--gguf"];
}

export function planLocalChatModelDownload(input: {
  savedModel?: string | null;
  downloadedModels: readonly ListedLocalModel[];
}): {
  model: string;
  replacedSavedModel: boolean;
  shouldDownload: boolean;
  downloadArgs: string[];
} {
  const saved = String(input.savedModel ?? "").trim();
  const resolved = resolveLocalChatModel(saved);
  const match = input.downloadedModels.find(
    (item) =>
      modelKeysMatch(resolved, item.modelKey) || modelKeysMatch(resolved, item.path),
  );
  const model = match?.modelKey || resolved;
  const shouldDownload = !match;
  return {
    model,
    replacedSavedModel: resolved !== saved,
    shouldDownload,
    downloadArgs: shouldDownload ? lmStudioGetArgs(resolved) : [],
  };
}

export function fasterWhisperRepoId(model?: string | null): string {
  const name = String(model || "").trim() || FASTER_WHISPER_DEFAULT_MODEL;
  return FASTER_WHISPER_REPOS[name] || (name.includes("/") ? name : `Systran/faster-whisper-${name}`);
}

export function fasterWhisperCacheFolder(model?: string | null): string {
  return `models--${fasterWhisperRepoId(model).replace(/\//g, "--")}`;
}

/**
 * First faster-whisper run downloads the default weights when they are not cached.
 * GPU stays the device unless the user chose CPU or no GPU is present.
 */
export function planFasterWhisperWeights(input: {
  model?: string | null;
  savedDevice?: string | null;
  gpuAvailable: boolean;
  weightsCached: boolean;
}): { model: string; device: "cpu" | "cuda"; shouldDownload: boolean } {
  const model = String(input.model || "").trim() || FASTER_WHISPER_DEFAULT_MODEL;
  return {
    model,
    device: resolveWhisperDevice({
      savedDevice: input.savedDevice,
      gpuAvailable: input.gpuAvailable,
    }),
    shouldDownload: input.weightsCached !== true,
  };
}
