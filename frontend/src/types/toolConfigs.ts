import type { WhisperConfig } from "./whisper";
import type { FFmpegConfig } from "./ffmpeg";

export type ToolConfigSource = "default" | "custom";

export interface ToolConfigs {
  whisper: Partial<WhisperConfig>;
  ffmpeg: FFmpegConfig;
  llm: {
    model: string;
    base_url?: string;
    system_prompt: string;
    embedding_model?: string;
    registered_embedding_models?: string[];
    registered_models?: Array<{
      name: string;
      source: "cloud" | "local";
    }>;
    force_cpu?: boolean;
  };
}

export interface ToolConfigsPatch {
  whisper?: Partial<WhisperConfig>;
  ffmpeg?: FFmpegConfig;
  llm?: Partial<{
    model: string;
    base_url: string;
    system_prompt: string;
    embedding_model: string;
    registered_embedding_models: string[];
    registered_models: Array<{
      name: string;
      source: "cloud" | "local";
    }>;
    force_cpu: boolean;
  }>;
}

export interface ToolConfigsResponse {
  source: ToolConfigSource;
  active: ToolConfigs;
  defaults?: ToolConfigs;
}
