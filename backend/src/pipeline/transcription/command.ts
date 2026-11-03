import { config } from "../../core/config";
import { resolveModelDevice } from "../../core/gpu";
import { loadActiveToolConfigs, type ToolConfigs } from "../../core/toolConfigs";
import { cachedGpuAvailable } from "../../llm/localRuntime";
import { resolveWhisperDevice } from "../../../../shared/localInference";
import type { TranscriptionFormats } from "./artifacts";

export function resolveTranscriptionFormats(): TranscriptionFormats {
  const toolConfigs = loadActiveToolConfigs();
  const formats = Array.isArray(toolConfigs.whisper.output_format)
    ? toolConfigs.whisper.output_format
    : [];
  const useAll = formats.includes("all");
  return {
    text: useAll || formats.includes("txt"),
    vtt: useAll || formats.includes("vtt"),
  };
}

export function whisperRuntimeDevice(
  toolConfigs: ToolConfigs = loadActiveToolConfigs(),
): "cpu" | "cuda" {
  const requestedDevice = toolConfigs.whisper.device === "cpu" ? "cpu" : "cuda";
  if (requestedDevice === "cpu" || process.env.YOUTUBE_SHORTS_FORCE_CPU === "1") {
    return "cpu";
  }

  if (resolveModelDevice(requestedDevice) === "cuda") {
    return "cuda";
  }

  return resolveWhisperDevice({
    savedDevice: toolConfigs.whisper.device,
    gpuAvailable: cachedGpuAvailable(),
  });
}

export function buildWhisperCommand(
  videoPath: string,
  outputDir: string,
  toolConfigs: ToolConfigs = loadActiveToolConfigs(),
): string[] {
  const whisper = toolConfigs.whisper;
  const requestedDevice = whisper.device === "cpu" ? "cpu" : "cuda";
  const device = whisperRuntimeDevice(toolConfigs);
  if (requestedDevice === "cuda" && device === "cpu") {
    console.warn("[transcription] No local GPU detected. Whisper will use CPU.");
  }

  const args: string[] = [
    "whisper",
    videoPath,
    "--model",
    String(whisper.model || config.WHISPER_MODEL_NAME),
    "--output_format",
    "json",
    "--output_dir",
    outputDir,
    "--device",
    device,
  ];

  if (whisper.verbose !== undefined) {
    args.push("--verbose", whisper.verbose ? "True" : "False");
  }
  if (whisper.task) {
    args.push("--task", whisper.task);
  }
  if (whisper.language) {
    args.push("--language", whisper.language);
  }
  if (whisper.temperature !== undefined) {
    args.push("--temperature", String(whisper.temperature));
  }
  if (whisper.best_of !== undefined) {
    args.push("--best_of", String(whisper.best_of));
  }
  if (whisper.beam_size !== undefined) {
    args.push("--beam_size", String(whisper.beam_size));
  }
  if (whisper.patience !== undefined && whisper.patience !== null) {
    args.push("--patience", String(whisper.patience));
  }
  if (whisper.length_penalty !== undefined && whisper.length_penalty !== null) {
    args.push("--length_penalty", String(whisper.length_penalty));
  }
  if (whisper.suppress_tokens !== undefined) {
    args.push("--suppress_tokens", String(whisper.suppress_tokens));
  }
  if (whisper.initial_prompt) {
    args.push("--initial_prompt", whisper.initial_prompt);
  }
  if (whisper.carry_initial_prompt !== undefined) {
    args.push("--carry_initial_prompt", whisper.carry_initial_prompt ? "True" : "False");
  }
  if (whisper.condition_on_previous_text !== undefined) {
    args.push(
      "--condition_on_previous_text",
      whisper.condition_on_previous_text ? "True" : "False",
    );
  }
  if (device === "cpu") {
    args.push("--fp16", "False");
  } else if (whisper.fp16 !== undefined) {
    args.push("--fp16", whisper.fp16 ? "True" : "False");
  }
  if (whisper.temperature_increment_on_fallback !== undefined) {
    args.push(
      "--temperature_increment_on_fallback",
      String(whisper.temperature_increment_on_fallback),
    );
  }
  if (whisper.compression_ratio_threshold !== undefined) {
    args.push("--compression_ratio_threshold", String(whisper.compression_ratio_threshold));
  }
  if (whisper.logprob_threshold !== undefined) {
    args.push("--logprob_threshold", String(whisper.logprob_threshold));
  }
  if (whisper.no_speech_threshold !== undefined) {
    args.push("--no_speech_threshold", String(whisper.no_speech_threshold));
  }
  if (whisper.word_timestamps !== undefined) {
    args.push("--word_timestamps", whisper.word_timestamps ? "True" : "False");
  }
  if (whisper.prepend_punctuations) {
    args.push("--prepend_punctuations", whisper.prepend_punctuations);
  }
  if (whisper.append_punctuations) {
    args.push("--append_punctuations", whisper.append_punctuations);
  }
  if (whisper.highlight_words !== undefined) {
    args.push("--highlight_words", whisper.highlight_words ? "True" : "False");
  }
  if (whisper.max_line_width !== undefined && whisper.max_line_width !== null) {
    args.push("--max_line_width", String(whisper.max_line_width));
  }
  if (whisper.max_line_count !== undefined && whisper.max_line_count !== null) {
    args.push("--max_line_count", String(whisper.max_line_count));
  }
  if (whisper.max_words_per_line !== undefined && whisper.max_words_per_line !== null) {
    args.push("--max_words_per_line", String(whisper.max_words_per_line));
  }
  if (whisper.threads !== undefined) {
    args.push("--threads", String(whisper.threads));
  }
  if (whisper.clip_timestamps) {
    args.push("--clip_timestamps", whisper.clip_timestamps);
  }
  if (
    whisper.hallucination_silence_threshold !== undefined &&
    whisper.hallucination_silence_threshold !== null
  ) {
    args.push("--hallucination_silence_threshold", String(whisper.hallucination_silence_threshold));
  }

  return args;
}

export function formatWhisperCommand(args: string[]): string {
  return args.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(" ");
}
