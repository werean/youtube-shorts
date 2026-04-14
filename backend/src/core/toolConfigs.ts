/**
 * Persistent tool configurations for Whisper, FFmpeg, and LLM.
 */

import * as fs from "fs";
import * as path from "path";
import { dataDir } from "./paths";
import { config } from "./config";
import { SYSTEM_PROMPT_TEMPLATE } from "../llm/prompts";

export type WhisperToolConfig = {
  model?: string;
  device?: "cpu" | "cuda";
  output_format?: string[];
  verbose?: boolean;
  task?: "transcribe" | "translate";
  language?: string | null;
  temperature?: number;
  best_of?: number;
  beam_size?: number;
  patience?: number | null;
  length_penalty?: number | null;
  suppress_tokens?: string;
  initial_prompt?: string | null;
  carry_initial_prompt?: boolean;
  condition_on_previous_text?: boolean;
  fp16?: boolean;
  temperature_increment_on_fallback?: number;
  compression_ratio_threshold?: number;
  logprob_threshold?: number;
  no_speech_threshold?: number;
  word_timestamps?: boolean;
  prepend_punctuations?: string | null;
  append_punctuations?: string | null;
  highlight_words?: boolean;
  max_line_width?: number | null;
  max_line_count?: number | null;
  max_words_per_line?: number | null;
  threads?: number;
  clip_timestamps?: string;
  hallucination_silence_threshold?: number | null;
};

export type FFmpegToolConfig = {
  format?: string | null;
  video_codec?: string | null;
  audio_codec?: string | null;
  video_preset?: string | null;
  video_bitrate?: string | null;
  audio_bitrate?: string | null;
  framerate?: string | null;
  aspect_ratio?: string | null;
  audio_sample_rate?: string | null;
  audio_channels?: string | null;
  disable_video?: boolean;
  disable_audio?: boolean;
  disable_subtitle?: boolean;
  video_filter?: string | null;
  audio_filter?: string | null;
  metadata?: string | null;
};

export interface ToolConfigs {
  whisper: WhisperToolConfig;
  ffmpeg: FFmpegToolConfig;
  llm: {
    model: string;
    system_prompt: string;
  };
}

const DEFAULT_CONFIGS_FILE = path.join(dataDir(), "default_configs.json");
const CUSTOM_CONFIGS_FILE = path.join(dataDir(), "custom_settings.json");

type CacheEntry<T> = {
  value: T;
  expiresAt: number;
};

const TOOL_CONFIGS_CACHE_TTL_MS = resolveCacheTtl("TOOL_CONFIGS_CACHE_TTL_MS", 3000);
const ensuredDirs = new Set<string>();

let defaultConfigsCache: CacheEntry<ToolConfigs> | null = null;
let customConfigsCache: CacheEntry<ToolConfigs | null> | null = null;
let activeConfigsCache: CacheEntry<{ source: "default" | "custom"; configs: ToolConfigs }> | null =
  null;

function resolveCacheTtl(envName: string, fallbackMs: number): number {
  const raw = process.env[envName];
  if (!raw) return fallbackMs;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackMs;
  return parsed;
}

function isCacheValid<T>(entry: CacheEntry<T> | null): entry is CacheEntry<T> {
  return Boolean(entry && entry.expiresAt > Date.now());
}

function cloneToolConfigs(configs: ToolConfigs): ToolConfigs {
  return {
    whisper: {
      ...configs.whisper,
      output_format: Array.isArray(configs.whisper.output_format)
        ? [...configs.whisper.output_format]
        : configs.whisper.output_format,
    },
    ffmpeg: { ...configs.ffmpeg },
    llm: { ...configs.llm },
  };
}

function setDefaultConfigsCache(configs: ToolConfigs): void {
  defaultConfigsCache = {
    value: cloneToolConfigs(configs),
    expiresAt: Date.now() + TOOL_CONFIGS_CACHE_TTL_MS,
  };
}

function setCustomConfigsCache(configs: ToolConfigs | null): void {
  customConfigsCache = {
    value: configs ? cloneToolConfigs(configs) : null,
    expiresAt: Date.now() + TOOL_CONFIGS_CACHE_TTL_MS,
  };
}

function setActiveConfigsCache(source: "default" | "custom", configs: ToolConfigs): void {
  activeConfigsCache = {
    value: {
      source,
      configs: cloneToolConfigs(configs),
    },
    expiresAt: Date.now() + TOOL_CONFIGS_CACHE_TTL_MS,
  };
}

export function invalidateToolConfigsCache(): void {
  defaultConfigsCache = null;
  customConfigsCache = null;
  activeConfigsCache = null;
}

function ensureDir(dirPath: string): void {
  if (ensuredDirs.has(dirPath)) {
    return;
  }
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  ensuredDirs.add(dirPath);
}

function stableSort(value: any): any {
  if (Array.isArray(value)) {
    return value.map(stableSort);
  }
  if (value && typeof value === "object") {
    const sorted: Record<string, any> = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = stableSort(value[key]);
    }
    return sorted;
  }
  return value;
}

function stableStringify(value: any): string {
  return JSON.stringify(stableSort(value), null, 2);
}

function toNumberOrNull(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function toStringOrNull(value: any): string | null {
  if (value === null || value === undefined) return null;
  const stringValue = String(value).trim();
  return stringValue.length === 0 ? null : stringValue;
}

function normalizeWhisperConfig(whisperConfig: WhisperToolConfig): WhisperToolConfig {
  return {
    ...whisperConfig,
    model: whisperConfig.model || config.WHISPER_MODEL_NAME,
    device: whisperConfig.device === "cpu" ? "cpu" : "cuda",
    output_format:
      Array.isArray(whisperConfig.output_format) && whisperConfig.output_format.length > 0
        ? whisperConfig.output_format
        : ["json", "vtt", "txt"],
    language: toStringOrNull(whisperConfig.language),
    temperature: toNumberOrNull(whisperConfig.temperature) ?? 0,
    best_of: toNumberOrNull(whisperConfig.best_of) ?? 5,
    beam_size: toNumberOrNull(whisperConfig.beam_size) ?? 5,
    patience: toNumberOrNull(whisperConfig.patience),
    length_penalty: toNumberOrNull(whisperConfig.length_penalty),
    suppress_tokens: whisperConfig.suppress_tokens ?? "-1",
    initial_prompt: toStringOrNull(whisperConfig.initial_prompt),
    carry_initial_prompt: Boolean(whisperConfig.carry_initial_prompt),
    condition_on_previous_text:
      whisperConfig.condition_on_previous_text === undefined
        ? true
        : Boolean(whisperConfig.condition_on_previous_text),
    fp16: whisperConfig.fp16 === undefined ? true : Boolean(whisperConfig.fp16),
    temperature_increment_on_fallback:
      toNumberOrNull(whisperConfig.temperature_increment_on_fallback) ?? 0.2,
    compression_ratio_threshold: toNumberOrNull(whisperConfig.compression_ratio_threshold) ?? 2.4,
    logprob_threshold: toNumberOrNull(whisperConfig.logprob_threshold) ?? -1.0,
    no_speech_threshold: toNumberOrNull(whisperConfig.no_speech_threshold) ?? 0.6,
    word_timestamps: Boolean(whisperConfig.word_timestamps),
    prepend_punctuations: toStringOrNull(whisperConfig.prepend_punctuations),
    append_punctuations: toStringOrNull(whisperConfig.append_punctuations),
    highlight_words: Boolean(whisperConfig.highlight_words),
    max_line_width: toNumberOrNull(whisperConfig.max_line_width),
    max_line_count: toNumberOrNull(whisperConfig.max_line_count),
    max_words_per_line: toNumberOrNull(whisperConfig.max_words_per_line),
    threads: toNumberOrNull(whisperConfig.threads) ?? 0,
    clip_timestamps: whisperConfig.clip_timestamps ?? "0",
    hallucination_silence_threshold: toNumberOrNull(whisperConfig.hallucination_silence_threshold),
  };
}

function normalizeFfmpegConfig(ffmpegConfig: FFmpegToolConfig): FFmpegToolConfig {
  return {
    ...ffmpegConfig,
    format: toStringOrNull(ffmpegConfig.format) ?? "mp4",
    video_codec: toStringOrNull(ffmpegConfig.video_codec) ?? config.RENDER_VIDEO_CODEC,
    audio_codec: toStringOrNull(ffmpegConfig.audio_codec) ?? config.RENDER_AUDIO_CODEC,
    video_preset: toStringOrNull(ffmpegConfig.video_preset) ?? config.RENDER_VIDEO_PRESET,
    video_bitrate: toStringOrNull(ffmpegConfig.video_bitrate),
    audio_bitrate: toStringOrNull(ffmpegConfig.audio_bitrate),
    framerate: toStringOrNull(ffmpegConfig.framerate),
    aspect_ratio: toStringOrNull(ffmpegConfig.aspect_ratio) ?? "9:16",
    audio_sample_rate: toStringOrNull(ffmpegConfig.audio_sample_rate),
    audio_channels: toStringOrNull(ffmpegConfig.audio_channels),
    disable_video: Boolean(ffmpegConfig.disable_video),
    disable_audio: Boolean(ffmpegConfig.disable_audio),
    disable_subtitle: Boolean(ffmpegConfig.disable_subtitle),
    video_filter: toStringOrNull(ffmpegConfig.video_filter),
    audio_filter: toStringOrNull(ffmpegConfig.audio_filter),
    metadata: toStringOrNull(ffmpegConfig.metadata),
  };
}

function defaultToolConfigs(): ToolConfigs {
  return {
    whisper: {
      model: config.WHISPER_MODEL_NAME,
      device: "cuda",
      output_format: ["json", "vtt", "txt"],
      verbose: true,
      task: "transcribe",
      language: null,
      temperature: 0,
      best_of: 5,
      beam_size: 5,
      patience: null,
      length_penalty: null,
      suppress_tokens: "-1",
      initial_prompt: null,
      carry_initial_prompt: false,
      condition_on_previous_text: true,
      fp16: true,
      temperature_increment_on_fallback: 0.2,
      compression_ratio_threshold: 2.4,
      logprob_threshold: -1.0,
      no_speech_threshold: 0.6,
      word_timestamps: false,
      prepend_punctuations: null,
      append_punctuations: null,
      highlight_words: false,
      max_line_width: null,
      max_line_count: null,
      max_words_per_line: null,
      threads: 0,
      clip_timestamps: "0",
      hallucination_silence_threshold: null,
    },
    ffmpeg: {
      format: "mp4",
      video_codec: config.RENDER_VIDEO_CODEC,
      audio_codec: config.RENDER_AUDIO_CODEC,
      video_preset: config.RENDER_VIDEO_PRESET,
      video_bitrate: null,
      audio_bitrate: null,
      framerate: null,
      aspect_ratio: "9:16",
      audio_sample_rate: null,
      audio_channels: null,
      disable_video: false,
      disable_audio: false,
      disable_subtitle: false,
      video_filter: null,
      audio_filter: null,
      metadata: null,
    },
    llm: {
      model: config.OLLAMA_MODEL,
      system_prompt: SYSTEM_PROMPT_TEMPLATE,
    },
  };
}

function ensureDefaultConfigsFile(): void {
  ensureDir(path.dirname(DEFAULT_CONFIGS_FILE));
  if (!fs.existsSync(DEFAULT_CONFIGS_FILE)) {
    const defaults = defaultToolConfigs();
    fs.writeFileSync(DEFAULT_CONFIGS_FILE, JSON.stringify(defaults, null, 2), "utf-8");
    return;
  }

  const current = readJsonFile(DEFAULT_CONFIGS_FILE);
  const defaults = defaultToolConfigs();
  if (!current || !configsEqual(current, defaults)) {
    fs.writeFileSync(DEFAULT_CONFIGS_FILE, JSON.stringify(defaults, null, 2), "utf-8");
  }
}

function readJsonFile(filePath: string): ToolConfigs | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as ToolConfigs;
  } catch (error) {
    return null;
  }
}

export function loadDefaultToolConfigs(): ToolConfigs {
  if (isCacheValid(defaultConfigsCache)) {
    return cloneToolConfigs(defaultConfigsCache.value);
  }

  ensureDefaultConfigsFile();
  const parsed = readJsonFile(DEFAULT_CONFIGS_FILE);
  if (!parsed) {
    const defaults = defaultToolConfigs();
    fs.writeFileSync(DEFAULT_CONFIGS_FILE, JSON.stringify(defaults, null, 2), "utf-8");
    setDefaultConfigsCache(defaults);
    return cloneToolConfigs(defaults);
  }

  setDefaultConfigsCache(parsed);
  return cloneToolConfigs(parsed);
}

export function loadCustomToolConfigs(): ToolConfigs | null {
  if (isCacheValid(customConfigsCache)) {
    return customConfigsCache.value ? cloneToolConfigs(customConfigsCache.value) : null;
  }

  if (!fs.existsSync(CUSTOM_CONFIGS_FILE)) {
    setCustomConfigsCache(null);
    return null;
  }

  const parsed = readJsonFile(CUSTOM_CONFIGS_FILE);
  setCustomConfigsCache(parsed);
  return parsed ? cloneToolConfigs(parsed) : null;
}

export function toolConfigsSource(): "default" | "custom" {
  if (isCacheValid(activeConfigsCache)) {
    return activeConfigsCache.value.source;
  }

  const custom = loadCustomToolConfigs();
  return custom ? "custom" : "default";
}

export function loadActiveToolConfigs(): ToolConfigs {
  if (isCacheValid(activeConfigsCache)) {
    return cloneToolConfigs(activeConfigsCache.value.configs);
  }

  const custom = loadCustomToolConfigs();
  if (custom) {
    setActiveConfigsCache("custom", custom);
    return cloneToolConfigs(custom);
  }

  const defaults = loadDefaultToolConfigs();
  setActiveConfigsCache("default", defaults);
  return cloneToolConfigs(defaults);
}

function mergeWithDefaults(partial: Partial<ToolConfigs>): ToolConfigs {
  const defaults = loadDefaultToolConfigs();
  return {
    whisper: normalizeWhisperConfig({ ...defaults.whisper, ...(partial.whisper || {}) }),
    ffmpeg: normalizeFfmpegConfig({ ...defaults.ffmpeg, ...(partial.ffmpeg || {}) }),
    llm: { ...defaults.llm, ...(partial.llm || {}) },
  };
}

function configsEqual(a: ToolConfigs, b: ToolConfigs): boolean {
  return stableStringify(a) === stableStringify(b);
}

export function updateToolConfigs(partial: Partial<ToolConfigs>): ToolConfigs {
  const defaults = loadDefaultToolConfigs();
  const active = loadActiveToolConfigs();
  const next: ToolConfigs = mergeWithDefaults({
    whisper: { ...active.whisper, ...(partial.whisper || {}) },
    ffmpeg: { ...active.ffmpeg, ...(partial.ffmpeg || {}) },
    llm: { ...active.llm, ...(partial.llm || {}) },
  });

  const fullNext = next;

  if (configsEqual(fullNext, mergeWithDefaults(defaults))) {
    if (fs.existsSync(CUSTOM_CONFIGS_FILE)) {
      fs.unlinkSync(CUSTOM_CONFIGS_FILE);
    }
    invalidateToolConfigsCache();
    setDefaultConfigsCache(defaults);
    setCustomConfigsCache(null);
    setActiveConfigsCache("default", defaults);
    return cloneToolConfigs(defaults);
  }

  fs.writeFileSync(CUSTOM_CONFIGS_FILE, JSON.stringify(fullNext, null, 2), "utf-8");
  invalidateToolConfigsCache();
  setCustomConfigsCache(fullNext);
  setActiveConfigsCache("custom", fullNext);
  return cloneToolConfigs(fullNext);
}

export function resetAllToolConfigs(): ToolConfigs {
  const defaults = loadDefaultToolConfigs();
  if (fs.existsSync(CUSTOM_CONFIGS_FILE)) {
    fs.unlinkSync(CUSTOM_CONFIGS_FILE);
  }
  invalidateToolConfigsCache();
  setDefaultConfigsCache(defaults);
  setCustomConfigsCache(null);
  setActiveConfigsCache("default", defaults);
  return cloneToolConfigs(defaults);
}

export function resetToolConfigSection(section: "whisper" | "ffmpeg" | "llm"): ToolConfigs {
  const defaults = loadDefaultToolConfigs();
  const active = loadActiveToolConfigs();

  const next: ToolConfigs = {
    whisper: section === "whisper" ? defaults.whisper : active.whisper,
    ffmpeg: section === "ffmpeg" ? defaults.ffmpeg : active.ffmpeg,
    llm: section === "llm" ? defaults.llm : active.llm,
  };

  if (configsEqual(next, defaults)) {
    if (fs.existsSync(CUSTOM_CONFIGS_FILE)) {
      fs.unlinkSync(CUSTOM_CONFIGS_FILE);
    }
    invalidateToolConfigsCache();
    setDefaultConfigsCache(defaults);
    setCustomConfigsCache(null);
    setActiveConfigsCache("default", defaults);
    return cloneToolConfigs(defaults);
  }

  const fullNext = mergeWithDefaults(next);
  fs.writeFileSync(CUSTOM_CONFIGS_FILE, JSON.stringify(fullNext, null, 2), "utf-8");
  invalidateToolConfigsCache();
  setCustomConfigsCache(fullNext);
  setActiveConfigsCache("custom", fullNext);
  return cloneToolConfigs(fullNext);
}

export function importToolConfigs(input: Partial<ToolConfigs>): ToolConfigs {
  const normalized = mergeWithDefaults(input);
  fs.writeFileSync(CUSTOM_CONFIGS_FILE, JSON.stringify(normalized, null, 2), "utf-8");
  invalidateToolConfigsCache();
  setCustomConfigsCache(normalized);
  setActiveConfigsCache("custom", normalized);
  return cloneToolConfigs(normalized);
}
