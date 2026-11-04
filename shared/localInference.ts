/**
 * Device choice for local models.
 * GPU is the default. CPU is used only when the user opted in, or no GPU is present.
 * Analysis never uses a cloud model name or an Ollama endpoint.
 */

export const LM_STUDIO_BASE_URL = "http://localhost:1234/v1";
export const LM_STUDIO_DEFAULT_MODEL = "local-model";

export function isCloudModelName(model: string): boolean {
  return model.toLowerCase().includes("cloud");
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
  const rawModel = String(input.model || "").trim();
  const rawUrl = String(input.baseUrl || "")
    .trim()
    .replace(/\/$/, "");
  const modelIsCloud = rawModel.length === 0 || isCloudModelName(rawModel);
  const urlIsOllama = rawUrl.length === 0 || isOllamaEndpoint(rawUrl);
  return {
    model: modelIsCloud ? LM_STUDIO_DEFAULT_MODEL : rawModel,
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
