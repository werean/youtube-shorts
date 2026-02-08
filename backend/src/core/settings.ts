/**
 * Persistent user settings for local storage paths and preferences.
 * Default structure: ~/Downloads/uploads/
 *   - {video_name}/
 *       - video.mp4
 *       - transcrições/
 *       - shorts/
 */

import * as fs from "fs";
import * as path from "path";
import { homedir } from "os";
import { dataDir, jobsDir, projectRoot } from "./paths";

export interface AppSettings {
  media: {
    base_dir: string;
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

const SETTINGS_FILE = path.join(dataDir(), "settings.json");

function getDefaultBaseDir(): string {
  const downloads = path.join(homedir(), "Downloads");
  return path.join(downloads, "uploads");
}

function defaultSettings(): AppSettings {
  const baseDir = getDefaultBaseDir();
  return {
    media: {
      base_dir: baseDir,
    },
    preferences: {
      ask_move_on_upload: true,
      move_uploads: true,
    },
    whisper: {
      device: "cuda",
      formats: ["json", "vtt", "txt"],
    },
    llm: {
      model: "llama2",
    },
  };
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function ensureSettingsFile(): void {
  ensureDir(path.dirname(SETTINGS_FILE));
  if (!fs.existsSync(SETTINGS_FILE)) {
    const defaults = defaultSettings();
    ensureDir(defaults.media.base_dir);
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaults, null, 2), "utf-8");
  }
}

export function loadSettings(): AppSettings {
  ensureSettingsFile();
  const raw = fs.readFileSync(SETTINGS_FILE, "utf-8");
  try {
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const defaults = defaultSettings();

    const baseDir = parsed.media?.base_dir || defaults.media.base_dir;

    const settings: AppSettings = {
      media: {
        base_dir: baseDir,
      },
      preferences: {
        ask_move_on_upload:
          typeof parsed.preferences?.ask_move_on_upload === "boolean"
            ? parsed.preferences?.ask_move_on_upload
            : defaults.preferences.ask_move_on_upload,
        move_uploads:
          typeof parsed.preferences?.move_uploads === "boolean"
            ? parsed.preferences?.move_uploads
            : defaults.preferences.move_uploads,
      },
      whisper: {
        device: parsed.whisper?.device === "cpu" ? "cpu" : "cuda",
        formats: Array.isArray(parsed.whisper?.formats)
          ? parsed.whisper.formats
          : defaults.whisper.formats,
      },
      llm: {
        model: parsed.llm?.model || defaults.llm.model,
      },
    };
    ensureDir(settings.media.base_dir);
    return settings;
  } catch (error) {
    const defaults = defaultSettings();
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(defaults, null, 2), "utf-8");
    ensureDir(defaults.media.base_dir);
    return defaults;
  }
}

export function saveSettings(next: AppSettings): AppSettings {
  ensureDir(path.dirname(SETTINGS_FILE));
  ensureDir(next.media.base_dir);
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(next, null, 2), "utf-8");
  return next;
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = loadSettings();

  const baseDir = partial.media?.base_dir || current.media.base_dir;

  const next: AppSettings = {
    media: {
      base_dir: baseDir,
    },
    preferences: {
      ask_move_on_upload:
        partial.preferences?.ask_move_on_upload ?? current.preferences.ask_move_on_upload,
      move_uploads: partial.preferences?.move_uploads ?? current.preferences.move_uploads,
    },
    whisper: {
      device: partial.whisper?.device ?? current.whisper.device,
      formats: partial.whisper?.formats ?? current.whisper.formats,
    },
    llm: {
      model: partial.llm?.model ?? current.llm.model,
    },
  };
  return saveSettings(next);
}

/**
 * Get the folder name for a video based on its name
 * Used to organize folders for each video
 */
export function getVideoFolder(videoName: string): string {
  // Sanitize video name for use as folder name
  return videoName.replace(/[<>:"/\\|?*]/g, "_").substring(0, 200);
}

/**
 * Get the video directory for a specific job
 * Format: {baseDir}/{videoName}/
 */
export function getVideoDir(jobId: string, videoName?: string): string {
  const settings = loadSettings();
  const folderName = videoName ? getVideoFolder(videoName) : jobId;
  return path.join(settings.media.base_dir, folderName);
}

/**
 * Get the video file path for a specific job
 * Format: {baseDir}/{videoName}/video.mp4
 */
export function getVideoFilePath(jobId: string, videoName?: string, extension = ".mp4"): string {
  const videoDir = getVideoDir(jobId, videoName);
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return path.join(videoDir, `video${ext}`);
}

/**
 * Get the transcriptions directory for a specific job
 * Format: {baseDir}/{videoName}/transcrições/
 */
export function getTranscriptionsDir(jobId: string, videoName?: string): string {
  const videoDir = getVideoDir(jobId, videoName);
  const dir = path.join(videoDir, "transcrições");
  ensureDir(dir);
  return dir;
}

/**
 * Get the shorts directory for a specific job
 * Format: {baseDir}/{videoName}/shorts/
 */
export function getShortsDir(jobId: string, videoName?: string): string {
  const videoDir = getVideoDir(jobId, videoName);
  const dir = path.join(videoDir, "shorts");
  ensureDir(dir);
  return dir;
}

/**
 * Get the archived video directory
 * Format: {baseDir}/_archived/{videoName}/
 */
export function getArchivedVideoDir(videoName: string): string {
  const settings = loadSettings();
  const folderName = getVideoFolder(videoName);
  const dir = path.join(settings.media.base_dir, "_archived", folderName);
  ensureDir(dir);
  return dir;
}

export function archivedVideosDir(): string {
  const settings = loadSettings();
  const dir = path.join(settings.media.base_dir, "_archived");
  ensureDir(dir);
  return dir;
}
