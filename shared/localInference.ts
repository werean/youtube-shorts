/**
 * Device choice for local models.
 * GPU is the default. CPU is used only when the user opted in, or no GPU is present.
 * Cloud model names are left untouched so Ollama does not receive a local device flag.
 */

export function isCloudModelName(model: string): boolean {
  return model.toLowerCase().includes("cloud");
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
