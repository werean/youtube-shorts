import { useState, useCallback, useEffect } from "react";
import {
  getSettings,
  saveSettings,
  getToolConfigs,
  getDependencies,
  getCommonFolders,
  selectFolder,
  type AppSettings,
} from "../api";

export function useSettings() {
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [configBaseDir, setConfigBaseDir] = useState<string>("");
  const [llmSystemPrompt, setLlmSystemPrompt] = useState<string>("");
  const [whisperDevice, setWhisperDevice] = useState<"cpu" | "cuda">("cuda");
  const [whisperFormats, setWhisperFormats] = useState<string[]>(["json", "vtt", "txt"]);
  const [commonFolders, setCommonFolders] = useState<
    { name: string; path: string; exists: boolean }[]
  >([]);
  const [dependencies, setDependencies] = useState<{
    python: { installed: boolean; version: string | null };
    whisper: { installed: boolean; version: string | null };
    ffmpeg: { installed: boolean; version: string | null };
    cuda: { installed: boolean; version: string | null };
    pytorch: { installed: boolean; version: string | null };
    ollama: { installed: boolean; version: string | null };
  } | null>(null);

  const loadSettings = useCallback(async () => {
    try {
      const settings = await getSettings();
      setAppSettings(settings);
      setConfigBaseDir(settings.media.base_dir);
      if (settings.whisper) {
        setWhisperDevice(settings.whisper.device);
        setWhisperFormats(settings.whisper.formats);
      }
      if (settings.llm) {
        // LLM config loaded separately
      }
    } catch (error) {
      console.error("Failed to load settings:", error);
    }
  }, []);

  const loadToolConfigs = useCallback(async () => {
    try {
      const data = await getToolConfigs();
      setLlmSystemPrompt(data.active.llm.system_prompt || "");
      const whisperFormats = Array.isArray(data.active.whisper.output_format)
        ? data.active.whisper.output_format
        : ["json", "vtt", "txt"];
      setWhisperDevice(data.active.whisper.device === "cpu" ? "cpu" : "cuda");
      setWhisperFormats(whisperFormats);
    } catch (error) {
      console.error("Failed to load tool configs:", error);
    }
  }, []);

  const loadDependencies = useCallback(async () => {
    try {
      const data = await getDependencies();
      setDependencies(data.dependencies);
    } catch (error) {
      console.error("Failed to load dependencies:", error);
    }
  }, []);

  const loadCommonFolders = useCallback(async () => {
    try {
      const data = await getCommonFolders();
      setCommonFolders(data.folders);
    } catch (error) {
      console.error("Failed to load common folders:", error);
    }
  }, []);

  const saveAppSettings = useCallback(async (updates: Partial<AppSettings>) => {
    try {
      const updated = await saveSettings(updates);
      setAppSettings(updated);
      return updated;
    } catch (error) {
      console.error("Failed to save settings:", error);
      throw error;
    }
  }, []);

  const selectBaseFolder = useCallback(async () => {
    try {
      const result = await selectFolder();
      if (result.selected && result.path) {
        setConfigBaseDir(result.path);
        return result.path;
      }
      return null;
    } catch (error) {
      console.error("Failed to select folder:", error);
      return null;
    }
  }, []);

  useEffect(() => {
    loadSettings();
    loadToolConfigs();
    loadDependencies();
    loadCommonFolders();
  }, [loadSettings, loadToolConfigs, loadDependencies, loadCommonFolders]);

  return {
    appSettings,
    configBaseDir,
    llmSystemPrompt,
    whisperDevice,
    whisperFormats,
    commonFolders,
    dependencies,
    setConfigBaseDir,
    setWhisperDevice,
    setWhisperFormats,
    loadSettings,
    loadToolConfigs,
    loadDependencies,
    loadCommonFolders,
    saveAppSettings,
    selectBaseFolder,
  };
}
