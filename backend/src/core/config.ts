/**
 * Centralized configuration and environment settings.
 */

export const config = {
  WHISPER_MODEL_NAME: "large-v3",
  OLLAMA_BASE_URL: "http://localhost:11434",
  OLLAMA_MODEL: "gpt-oss:120b-cloud",
  OLLAMA_API_KEY: process.env.OLLAMA_API_KEY || "",
  OLLAMA_TIMEOUT_SECONDS: 120,
  HOOK_MAX_FORWARD_ADJUST_SECONDS: 1.0,
  HOOK_SILENCE_THRESHOLD_SECONDS: 0.5,
  RENDER_WIDTH: 1080,
  RENDER_HEIGHT: 1920,
  RENDER_VIDEO_CODEC: "h264_nvenc",
  RENDER_AUDIO_CODEC: "aac",
  RENDER_VIDEO_PRESET: "p5",
};
