/**
 * Resolves Ollama options for the current machine and saved config.
 * The stored default stays on GPU. This only adds a CPU flag when the
 * user opted in, or when no GPU can be detected.
 */

import * as childProcess from "child_process";
import { loadActiveToolConfigs } from "../core/toolConfigs";
import { ollamaLocalOptions } from "../../../shared/localInference";

let gpuCache: boolean | null = null;

function probeGpu(): boolean {
  const spawnSync = childProcess.spawnSync;
  if (typeof spawnSync !== "function") return false;
  try {
    const result = spawnSync(
      "nvidia-smi",
      ["--query-gpu=driver_version", "--format=csv,noheader"],
      { encoding: "utf-8", timeout: 4000, windowsHide: true },
    );
    return !result.error && (result.status ?? 1) === 0;
  } catch {
    return false;
  }
}

export function cachedGpuAvailable(): boolean {
  if (gpuCache !== null) return gpuCache;
  gpuCache = probeGpu();
  return gpuCache;
}

export function optionsForModel(model: string): { num_gpu: 0 } | undefined {
  try {
    const forceCpu = loadActiveToolConfigs().llm.force_cpu === true;
    return ollamaLocalOptions({
      model,
      forceCpu,
      gpuAvailable: cachedGpuAvailable(),
    });
  } catch (error) {
    console.warn("[llm] Não foi possível resolver o dispositivo local:", error);
    return undefined;
  }
}
