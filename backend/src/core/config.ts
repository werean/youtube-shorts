/**
 * Centralized configuration and environment settings.
 */

export const config = {
  WHISPER_MODEL_NAME: "large-v3",
  LM_STUDIO_BASE_URL: "http://localhost:1234/v1",
  LM_STUDIO_MODEL: "local-model",
  LLM_TIMEOUT_SECONDS: 120,
  /** Local embeddings only. Analysis does not call this server. */
  OLLAMA_BASE_URL: "http://localhost:11434",
  OLLAMA_TIMEOUT_SECONDS: 120,
  YTDLP_TIMEOUT_SECONDS: 1800,
  WHISPER_TIMEOUT_SECONDS: 6 * 60 * 60,
  FFMPEG_TIMEOUT_SECONDS: 30 * 60,
  HOOK_MAX_FORWARD_ADJUST_SECONDS: 1.0,
  HOOK_SILENCE_THRESHOLD_SECONDS: 0.5,
  RENDER_WIDTH: 1080,
  RENDER_HEIGHT: 1920,
  RENDER_VIDEO_CODEC: "h264_nvenc",
  RENDER_AUDIO_CODEC: "aac",
  RENDER_VIDEO_PRESET: "p5",
};
