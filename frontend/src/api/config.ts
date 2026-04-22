import { apiBaseUrl, request } from "./client";
import type { ToolConfigs, ToolConfigsPatch, ToolConfigsResponse } from "../types/toolConfigs";
import type {
  AppSettings,
  CancelDependencyInstallSessionResponse,
  DependenciesSnapshot,
  DependencyInstallOptions,
  DependencyInstallSession,
  DependencyInstallSessionStatus,
  DependencyOperationMode,
  InstallationGuide,
  InstallDependencyResult,
  OllamaModelsResponse,
  PytorchGpuTier,
  RegisterOllamaModelRequest,
  RegisterOllamaModelResponse,
  RemoveOllamaModelResponse,
  SavedLLMPrompt,
  StartDependencyInstallSessionResult,
} from "@youtube-shorts/contracts";

export type {
  AppSettings,
  DependenciesSnapshot,
  DependencyInstallOptions,
  DependencyInstallSession,
  DependencyInstallSessionStatus,
  DependencyOperationMode,
  InstallationGuide,
  InstallDependencyResult,
  OllamaModelsResponse,
  PytorchGpuTier,
  RegisterOllamaModelRequest,
  RegisterOllamaModelResponse,
  RemoveOllamaModelResponse,
  SavedLLMPrompt,
  StartDependencyInstallSessionResult,
};

export async function getLLMPrompt(): Promise<{ prompt: string; version: string }> {
  return request("/config/llm-prompt");
}

export async function getDefaultLLMPrompt(): Promise<{ prompt: string; version: string }> {
  return request("/config/llm-prompt/default");
}

export async function getSavedLLMPrompts(): Promise<{ prompts: SavedLLMPrompt[] }> {
  return request("/config/llm-saved-prompts");
}

export async function saveLLMPrompt(payload: {
  name: string;
  prompt: string;
}): Promise<{ prompts: SavedLLMPrompt[] }> {
  return request("/config/llm-saved-prompts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getConfig(): Promise<{
  whisper: { device: string; formats: string };
  llm: { model: string };
}> {
  return request("/config");
}

export async function getOllamaModels(): Promise<OllamaModelsResponse> {
  return request("/config/ollama-models");
}

export async function registerOllamaModel(
  payload: RegisterOllamaModelRequest,
): Promise<RegisterOllamaModelResponse> {
  return request("/config/ollama-models/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function removeOllamaModel(modelName: string): Promise<RemoveOllamaModelResponse> {
  return request(`/config/ollama-models/${encodeURIComponent(modelName)}`, {
    method: "DELETE",
  });
}

export async function getDependencies(): Promise<{
  dependencies: DependenciesSnapshot;
  diagnostics?: string[];
}> {
  return request("/config/dependencies");
}

export async function getInstallationGuide(name: string): Promise<InstallationGuide> {
  return request(`/config/dependencies/${name}/instructions`);
}

export async function installDependency(name: string): Promise<InstallDependencyResult> {
  const response = await fetch(`${apiBaseUrl}/config/dependencies/${name}/install`, {
    method: "POST",
  });

  let payload: Partial<InstallDependencyResult> = {};
  try {
    payload = (await response.json()) as Partial<InstallDependencyResult>;
  } catch {
    payload = {};
  }

  if (!response.ok) {
    const fallbackError =
      payload.error || payload.output || payload.message
        ? undefined
        : `Request failed with status ${response.status}`;

    return {
      success: false,
      message: payload.message || `Falha ao instalar ${name}`,
      error: payload.error || fallbackError,
      failureCategory: payload.failureCategory,
      dependencies: payload.dependencies,
      diagnostics: payload.diagnostics,
      output: payload.output,
      installer: payload.installer,
    };
  }

  return {
    success: true,
    message: payload.message || `${name} instalado com sucesso`,
    output: payload.output,
    dependencies: payload.dependencies,
    diagnostics: payload.diagnostics,
    installer: payload.installer,
  };
}

export async function startDependencyInstallSession(
  name: string,
  options?: DependencyInstallOptions,
): Promise<StartDependencyInstallSessionResult> {
  const payload = options?.pytorchGpuTier ? { pytorchGpuTier: options.pytorchGpuTier } : null;
  return request(`/config/dependencies/${name}/install/start`, {
    method: "POST",
    headers: payload ? { "Content-Type": "application/json" } : undefined,
    body: payload ? JSON.stringify(payload) : undefined,
  });
}

export async function startDependencyUninstallSession(
  name: string,
): Promise<StartDependencyInstallSessionResult> {
  return request(`/config/dependencies/${name}/uninstall/start`, {
    method: "POST",
  });
}

export async function getDependencyInstallSession(
  sessionId: string,
): Promise<DependencyInstallSession> {
  return request(`/config/dependencies/install-sessions/${sessionId}`);
}

export async function cancelDependencyInstallSession(
  sessionId: string,
): Promise<CancelDependencyInstallSessionResponse> {
  return request(`/config/dependencies/install-sessions/${sessionId}/cancel`, {
    method: "POST",
  });
}

export async function openDependencyInstallTerminal(
  name: string,
  mode: DependencyOperationMode = "install",
  options?: DependencyInstallOptions,
): Promise<{
  success: boolean;
  message: string;
  command?: string;
}> {
  const payload = {
    mode,
    ...(options?.pytorchGpuTier ? { pytorchGpuTier: options.pytorchGpuTier } : {}),
  };

  return request(`/config/dependencies/${name}/open-terminal`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function getSettings(): Promise<AppSettings> {
  return request("/config/settings");
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return request("/config/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export async function getToolConfigs(): Promise<ToolConfigsResponse> {
  return request("/config/tool-configs");
}

export async function saveToolConfigs(
  configs: ToolConfigsPatch,
): Promise<{ source: "default" | "custom"; active: ToolConfigs }> {
  return request("/config/tool-configs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(configs),
  });
}

export async function resetAllToolConfigs(): Promise<{
  source: "default" | "custom";
  active: ToolConfigs;
}> {
  return request("/config/tool-configs/reset", { method: "POST" });
}

export async function resetToolConfigSection(section: "whisper" | "ffmpeg" | "llm"): Promise<{
  source: "default" | "custom";
  active: ToolConfigs;
}> {
  return request(`/config/tool-configs/reset/${section}`, { method: "POST" });
}

export async function importToolConfigs(configs: ToolConfigsPatch): Promise<{
  source: "default" | "custom";
  active: ToolConfigs;
}> {
  return request("/config/tool-configs/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(configs),
  });
}

export async function getCommonFolders(): Promise<{
  folders: { name: string; path: string; exists: boolean }[];
}> {
  return request("/config/common-folders");
}

export async function selectFolder(): Promise<{ selected: boolean; path: string | null }> {
  return request("/config/select-folder", { method: "POST" });
}
