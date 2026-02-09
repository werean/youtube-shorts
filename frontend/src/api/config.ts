import { request } from "./client";
import type { ToolConfigs, ToolConfigsPatch, ToolConfigsResponse } from "../types/toolConfigs";

export interface InstallationGuide {
  name: string;
  manual: {
    title: string;
    description: string;
    steps: string[];
    links?: { text: string; url: string }[];
  };
  automatic?: {
    command: string;
    description: string;
  };
}

export interface AppSettings {
  media: {
    base_dir: string;
    download_resolution: "1080p" | "1440p" | "4k";
  };
  preferences: {
    ask_move_on_upload: boolean;
    move_uploads: boolean;
  };
  whisper: {
    device: "cpu" | "cuda";
    formats: string[];
  };
  llm: {
    model: string;
  };
}

export async function getLLMPrompt(): Promise<{ prompt: string; version: string }> {
  return request("/config/llm-prompt");
}

export async function getConfig(): Promise<{
  whisper: { device: string; formats: string };
  llm: { model: string };
}> {
  return request("/config");
}

export async function getDependencies(): Promise<{
  dependencies: {
    python: { installed: boolean; version: string | null };
    whisper: { installed: boolean; version: string | null };
    ffmpeg: { installed: boolean; version: string | null };
    cuda: { installed: boolean; version: string | null };
    pytorch: { installed: boolean; version: string | null };
    ollama: { installed: boolean; version: string | null };
  };
}> {
  return request("/config/dependencies");
}

export async function getInstallationGuide(name: string): Promise<InstallationGuide> {
  return request(`/config/dependencies/${name}/instructions`);
}

export async function installDependency(name: string): Promise<{
  success: boolean;
  message: string;
  output?: string;
  error?: string;
}> {
  return request(`/config/dependencies/${name}/install`, {
    method: "POST",
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
