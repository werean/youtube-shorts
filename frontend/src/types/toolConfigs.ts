import type { WhisperConfig } from "./whisper";
import type { FFmpegConfig } from "./ffmpeg";

export type ToolConfigSource = "default" | "custom";

export interface ToolConfigs {
  whisper: Partial<WhisperConfig>;
  ffmpeg: FFmpegConfig;
  llm: {
    model: string;
    system_prompt: string;
  };
}

export interface ToolConfigsPatch {
  whisper?: Partial<WhisperConfig>;
  ffmpeg?: FFmpegConfig;
  llm?: Partial<{ model: string; system_prompt: string }>;
}

export interface ToolConfigsResponse {
  source: ToolConfigSource;
  active: ToolConfigs;
  defaults?: ToolConfigs;
}
