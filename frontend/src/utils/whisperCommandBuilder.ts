/**
 * Utilitários para geração de comando Whisper
 * Omite valores padrão do Whisper para manter comando limpo
 */

import type { WhisperConfig } from "../types/whisper";

// Helper para converter valor para número com fallback
function toNumber(value: unknown, fallback: number): number | null {
  if (typeof value === "string" && value === "") return null;
  if (typeof value === "string") {
    const num = parseFloat(value);
    return isNaN(num) ? fallback : num;
  }
  if (typeof value === "number") return value;
  return null;
}

export function generateWhisperCommand(
  config: Partial<WhisperConfig>,
  audioPath: string = ".\\source.webm",
): string {
  const parts: string[] = ["whisper"];

  // Arquivo de áudio é obrigatório
  parts.push(`"${audioPath}"`);

  // Model - sempre incluir se não for "base" (padrão)
  if (config.model && config.model !== "base") {
    parts.push(`--model ${config.model}`);
  }

  // Device - sempre incluir
  if (config.device) {
    parts.push(`--device ${config.device}`);
  }

  // Model dir
  if (config.model_dir) {
    parts.push(`--model_dir "${config.model_dir}"`);
  }

  // Output dir - importante para transcrições
  if (config.output_dir) {
    parts.push(`--output_dir "${config.output_dir}"`);
  }

  // Output format - só incluir se não for "all" (padrão)
  if (
    config.output_format &&
    config.output_format.length > 0 &&
    !config.output_format.includes("all")
  ) {
    const formats = config.output_format.join(",");
    parts.push(`--output_format ${formats}`);
  }

  // Verbose - só incluir se False (padrão é True)
  if (config.verbose === false) {
    parts.push(`--verbose False`);
  }

  // Task - só incluir se não for "transcribe" (padrão)
  if (config.task && config.task !== "transcribe") {
    parts.push(`--task ${config.task}`);
  }

  // Language - sempre incluir se especificado
  if (config.language) {
    parts.push(`--language ${config.language}`);
  }

  // Temperature - só incluir se diferente de 0 (padrão)
  const temperature = toNumber(config.temperature, 0);
  if (temperature !== null && temperature !== 0) {
    parts.push(`--temperature ${temperature}`);
  }

  // Best of - só incluir se diferente de 5 (padrão)
  const best_of = toNumber(config.best_of, 5);
  if (best_of !== null && best_of !== 5) {
    parts.push(`--best_of ${best_of}`);
  }

  // Beam size - só incluir se diferente de 5 (padrão)
  const beam_size = toNumber(config.beam_size, 5);
  if (beam_size !== null && beam_size !== 5) {
    parts.push(`--beam_size ${beam_size}`);
  }

  // Patience
  if (config.patience) {
    parts.push(`--patience ${config.patience}`);
  }

  // Length penalty
  if (config.length_penalty) {
    parts.push(`--length_penalty ${config.length_penalty}`);
  }

  // Suppress tokens - só incluir se não for "-1" (padrão)
  if (config.suppress_tokens && config.suppress_tokens !== "-1" && config.suppress_tokens !== "") {
    parts.push(`--suppress_tokens "${config.suppress_tokens}"`);
  }

  // Initial prompt
  if (config.initial_prompt) {
    parts.push(`--initial_prompt "${config.initial_prompt}"`);
  }

  // Carry initial prompt - só incluir se True (padrão é False)
  if (config.carry_initial_prompt === true) {
    parts.push(`--carry_initial_prompt True`);
  }

  // Condition on previous text - só incluir se False (padrão é True)
  if (config.condition_on_previous_text === false) {
    parts.push(`--condition_on_previous_text False`);
  }

  // FP16 - só incluir se False (padrão é True)
  if (config.fp16 === false) {
    parts.push(`--fp16 False`);
  }

  // Temperature increment on fallback - só incluir se diferente de 0.2 (padrão)
  const temperature_increment = toNumber(config.temperature_increment_on_fallback, 0.2);
  if (temperature_increment !== null && temperature_increment !== 0.2) {
    parts.push(`--temperature_increment_on_fallback ${temperature_increment}`);
  }

  // Compression ratio threshold - só incluir se diferente de 2.4 (padrão)
  const compression_ratio = toNumber(config.compression_ratio_threshold, 2.4);
  if (compression_ratio !== null && compression_ratio !== 2.4) {
    parts.push(`--compression_ratio_threshold ${compression_ratio}`);
  }

  // Logprob threshold - só incluir se diferente de -1.0 (padrão)
  const logprob = toNumber(config.logprob_threshold, -1.0);
  if (logprob !== null && logprob !== -1.0) {
    parts.push(`--logprob_threshold ${logprob}`);
  }

  // No speech threshold - só incluir se diferente de 0.6 (padrão)
  const no_speech = toNumber(config.no_speech_threshold, 0.6);
  if (no_speech !== null && no_speech !== 0.6) {
    parts.push(`--no_speech_threshold ${no_speech}`);
  }

  // Word timestamps
  if (config.word_timestamps === true) {
    parts.push(`--word_timestamps True`);
  }

  // Prepend punctuations
  if (config.prepend_punctuations) {
    parts.push(`--prepend_punctuations "${config.prepend_punctuations}"`);
  }

  // Append punctuations
  if (config.append_punctuations) {
    parts.push(`--append_punctuations "${config.append_punctuations}"`);
  }

  // Highlight words
  if (config.highlight_words === true) {
    parts.push(`--highlight_words True`);
  }

  // Max line width
  if (config.max_line_width) {
    parts.push(`--max_line_width ${config.max_line_width}`);
  }

  // Max line count
  if (config.max_line_count) {
    parts.push(`--max_line_count ${config.max_line_count}`);
  }

  // Max words per line
  if (config.max_words_per_line) {
    parts.push(`--max_words_per_line ${config.max_words_per_line}`);
  }

  // Threads - só incluir se diferente de 0 (padrão)
  const threads = toNumber(config.threads, 0);
  if (threads !== null && threads !== 0) {
    parts.push(`--threads ${threads}`);
  }

  // Clip timestamps - só incluir se diferente de "0" (padrão)
  if (config.clip_timestamps && config.clip_timestamps !== "0") {
    parts.push(`--clip_timestamps "${config.clip_timestamps}"`);
  }

  // Hallucination silence threshold
  if (config.hallucination_silence_threshold) {
    parts.push(`--hallucination_silence_threshold ${config.hallucination_silence_threshold}`);
  }

  return parts.join(" ");
}
