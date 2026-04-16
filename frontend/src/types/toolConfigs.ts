import type { WhisperConfig } from "./whisper";
import type { FFmpegConfig } from "./ffmpeg";

export type ToolConfigSource = "default" | "custom";

export interface ToolConfigs {
  whisper: Partial<WhisperConfig>;
  ffmpeg: FFmpegConfig;
  llm: {
    model: string;
    system_prompt: string;
    average_cut_minutes: number;
    max_extra_minutes: number;
    registered_models?: Array<{
      name: string;
      source: "cloud" | "local";
    }>;
  };
}

export interface ToolConfigsPatch {
  whisper?: Partial<WhisperConfig>;
  ffmpeg?: FFmpegConfig;
  llm?: Partial<{
    model: string;
    system_prompt: string;
    average_cut_minutes: number;
    max_extra_minutes: number;
    registered_models: Array<{
      name: string;
      source: "cloud" | "local";
    }>;
  }>;
}

export interface ToolConfigsResponse {
  source: ToolConfigSource;
  active: ToolConfigs;
  defaults?: ToolConfigs;
}
