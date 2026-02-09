/**
 * Pipeline step: transcribe audio with Whisper (local installation).
 */

import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import * as fs from "fs";
import { Segment } from "../models/segment";
import { JobStatus } from "../models/job";
import * as files from "../storage/files";
import * as metadata from "../storage/metadata";
import { config } from "../core/config";
import { loadActiveToolConfigs } from "../core/toolConfigs";
import { appendTaskLog, appendTaskLogs, clearTaskLogs } from "../core/taskLogs";

type TranscriptionFormats = {
  text?: boolean;
  vtt?: boolean;
};

const activeTranscriptions = new Map<string, ChildProcess>();

function readFileTextWithFallback(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(buffer);
  } catch (error) {
    return buffer.toString("latin1");
  }
}

function resolveTranscriptionFormats(): TranscriptionFormats {
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

function buildWhisperCommand(
  videoPath: string,
  outputDir: string,
  toolConfigs = loadActiveToolConfigs(),
): string {
  const whisper = toolConfigs.whisper;
  const outputFormats = Array.isArray(whisper.output_format) ? [...whisper.output_format] : [];
  if (!outputFormats.includes("json") && !outputFormats.includes("all")) {
    outputFormats.push("json");
  }
  const normalizedFormats = outputFormats.filter(Boolean);
  const outputFormatArg = normalizedFormats.includes("all")
    ? "all"
    : normalizedFormats.length > 1
      ? "all"
      : normalizedFormats[0] || "json";

  const args: string[] = [
    "whisper",
    `"${videoPath}"`,
    "--model",
    String(whisper.model || config.WHISPER_MODEL_NAME),
    "--output_format",
    outputFormatArg,
    "--output_dir",
    `"${outputDir}"`,
    "--device",
    whisper.device === "cpu" ? "cpu" : "cuda",
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
    args.push("--suppress_tokens", `"${whisper.suppress_tokens}"`);
  }
  if (whisper.initial_prompt) {
    args.push("--initial_prompt", `"${whisper.initial_prompt}"`);
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
  if (whisper.fp16 !== undefined) {
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
    args.push("--prepend_punctuations", `"${whisper.prepend_punctuations}"`);
  }
  if (whisper.append_punctuations) {
    args.push("--append_punctuations", `"${whisper.append_punctuations}"`);
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
    args.push("--clip_timestamps", `"${whisper.clip_timestamps}"`);
  }
  if (
    whisper.hallucination_silence_threshold !== undefined &&
    whisper.hallucination_silence_threshold !== null
  ) {
    args.push("--hallucination_silence_threshold", String(whisper.hallucination_silence_threshold));
  }

  return args.join(" ");
}

function formatVttTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.floor(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

function buildPlainText(segments: Segment[]): string {
  return segments
    .map((segment) => segment.text)
    .join(" ")
    .trim();
}

function buildVtt(segments: Segment[]): string {
  const cues = segments
    .map((segment, index) => {
      const start = formatVttTimestamp(segment.start);
      const end = formatVttTimestamp(segment.end);
      return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`;
    })
    .join("\n");
  return `WEBVTT\n\n${cues}`.trimEnd() + "\n";
}

function flushLines(buffer: { value: string }, onLines: (lines: string[]) => void): void {
  const parts = buffer.value.split(/[\r\n]+/);
  buffer.value = parts.pop() || "";
  const lines = parts.filter((line) => line.trim().length > 0);
  if (lines.length > 0) {
    onLines(lines);
  }
}

function runCommand(
  command: string,
  onLog: (lines: string[]) => void,
  onSpawn?: (child: ChildProcess) => void,
  onClose?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
      },
    });
    if (onSpawn) {
      onSpawn(child);
    }
    const stdoutBuffer = { value: "" };
    const stderrBuffer = { value: "" };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdoutBuffer.value += text;
      flushLines(stdoutBuffer, onLog);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      stderrBuffer.value += text;
      flushLines(stderrBuffer, onLog);
    });

    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (onClose) {
        onClose();
      }
      if (stdoutBuffer.value.trim().length > 0) {
        onLog([stdoutBuffer.value.trim()]);
      }
      if (stderrBuffer.value.trim().length > 0) {
        onLog([stderrBuffer.value.trim()]);
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Whisper exited with code ${code}`));
    });
  });
}

export function cancelTranscription(jobId: string): boolean {
  const child = activeTranscriptions.get(jobId);
  if (!child || !child.pid) {
    return false;
  }

  appendTaskLog(jobId, "transcription", "[transcription] Cancel requested");

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch (error) {
    console.error(`[transcription] Failed to cancel process for job ${jobId}:`, error);
  }

  activeTranscriptions.delete(jobId);
  metadata.updateJobStatus(jobId, JobStatus.DOWNLOADED);
  appendTaskLog(jobId, "transcription", "[transcription] Cancelled");
  return true;
}

function writeTranscriptionArtifacts(
  jobId: string,
  segments: Segment[],
  formats: TranscriptionFormats,
): void {
  const normalized = {
    text: Boolean(formats.text),
    vtt: Boolean(formats.vtt),
  };

  if (normalized.text) {
    const textPath = files.transcriptionTextPath(jobId);
    fs.writeFileSync(textPath, buildPlainText(segments), "utf-8");
  }

  if (normalized.vtt) {
    const vttPath = files.transcriptionVttPath(jobId);
    fs.writeFileSync(vttPath, buildVtt(segments), "utf-8");
  }

  if (normalized.text || normalized.vtt) {
    console.log(`[transcription] ✓ Arquivos adicionais gerados`);
  } else {
    console.log(`[transcription] ↪ Nenhum arquivo adicional solicitado`);
  }
}

export async function transcribeJob(
  jobId: string,
  formats: TranscriptionFormats = resolveTranscriptionFormats(),
): Promise<Segment[]> {
  // Check if another transcription is already running
  if (activeTranscriptions.size > 0) {
    const activeJobIds = Array.from(activeTranscriptions.keys());
    if (!activeJobIds.includes(jobId)) {
      const errorMsg = `Transcrição já em andamento para outro vídeo (${activeJobIds[0]}). Cancele a transcrição anterior para começar uma nova.`;
      console.error(`[transcription] ✗ ${errorMsg}`);
      appendTaskLog(jobId, "transcription", `[transcription] ✗ ${errorMsg}`);
      throw new Error(errorMsg);
    }
  }

  clearTaskLogs(jobId, "render");
  clearTaskLogs(jobId, "transcription");
  console.log(`\n[transcription] ============================================`);
  console.log(`[transcription] Starting transcription for job ${jobId}`);
  console.log(`[transcription] ============================================`);
  appendTaskLog(jobId, "transcription", "[transcription] Starting transcription");
  metadata.updateJobStatus(jobId, JobStatus.TRANSCRIBING);

  console.log(`[transcription] Procurando arquivo de vídeo...`);
  const videoPath = files.findSourceVideo(jobId);
  console.log(
    `[transcription] Resultado da busca: ${videoPath ? "✓ Encontrado" : "✗ Não encontrado"}`,
  );

  if (!videoPath) {
    console.error(`[transcription] ✗ ERRO: Vídeo não encontrado para job ${jobId}`);
    throw new Error("Source video not found for job");
  }

  console.log(`[transcription] ✓ Usando arquivo: ${videoPath}`);
  appendTaskLog(jobId, "transcription", `[transcription] Using file: ${videoPath}`);

  const clearedDir = files.removeTranscriptionsJobDir(jobId);
  console.log(`[transcription] 🧹 Limpando pasta de transcrição: ${clearedDir}`);
  appendTaskLog(jobId, "transcription", `[transcription] Cleared dir: ${clearedDir}`);

  const tempDir = files.ensureTranscriptionsJobDir(jobId);
  const outputFormat = "json";

  console.log(`[transcription] 📁 Diretório de saída: ${tempDir}`);
  console.log(`[transcription] 🎤 Modelo Whisper: ${config.WHISPER_MODEL_NAME}`);
  console.log(`[transcription] 🎬 Vídeo de entrada: ${videoPath}`);
  console.log(`[transcription] 🎯 Iniciando transcrição com Whisper...`);
  appendTaskLogs(jobId, "transcription", [
    `[transcription] Output dir: ${tempDir}`,
    `[transcription] Input: ${videoPath}`,
  ]);

  try {
    const toolConfigs = loadActiveToolConfigs();
    const device = toolConfigs.whisper.device === "cpu" ? "cpu" : "cuda";

    const command = buildWhisperCommand(videoPath, tempDir, toolConfigs);
    console.log(`[transcription] 💻 Command: ${command}`);
    appendTaskLog(jobId, "transcription", `[transcription] Command: ${command}`);

    console.log(`[transcription] ⏳ Executando Whisper com ${device.toUpperCase()}...`);
    await runCommand(
      command,
      (lines) => appendTaskLogs(jobId, "transcription", lines),
      (child) => activeTranscriptions.set(jobId, child),
      () => activeTranscriptions.delete(jobId),
    );
    console.log(`[transcription] ✓ Whisper completado com sucesso`);
    appendTaskLog(jobId, "transcription", "[transcription] Whisper completed successfully");

    // Verificar arquivo de saída
    const videoBasename = require("path").basename(videoPath, require("path").extname(videoPath));
    const whisperOutputPath = require("path").join(tempDir, `${videoBasename}.json`);
    console.log(`[transcription] 🔍 Procurando sa\u00edda: ${whisperOutputPath}`);

    if (!fs.existsSync(whisperOutputPath)) {
      throw new Error("Whisper output file not found");
    }

    const whisperRaw = readFileTextWithFallback(whisperOutputPath);
    const whisperData = JSON.parse(whisperRaw);

    const segments: Segment[] = [];
    const whisperSegments = whisperData.segments || [];

    for (let index = 0; index < whisperSegments.length; index++) {
      const item = whisperSegments[index];
      segments.push({
        segment_id: `s${index + 1}`,
        start: parseFloat(item.start || 0),
        end: parseFloat(item.end || 0),
        text: String(item.text || "").trim(),
      });
    }

    const outputPath = files.transcriptionPath(jobId);
    fs.writeFileSync(outputPath, JSON.stringify(segments, null, 2), "utf-8");
    console.log(`[transcription] ✓ Transcription saved for job ${jobId}`);
    appendTaskLog(jobId, "transcription", "[transcription] Transcription saved");
    writeTranscriptionArtifacts(jobId, segments, formats);

    const job = metadata.loadJob(jobId);
    job.status = JobStatus.BUILDING_BLOCKS;
    job.updated_at = new Date().toISOString();
    metadata.saveJob(job);

    console.log(`[transcription] ============================================\n`);
    return segments;
  } catch (error: any) {
    console.error(`\n[transcription] ==========================================`);
    console.error(`[transcription] ✗ ERRO ao executar Whisper`);
    console.error(`[transcription] ✗ Nome do erro: ${error.name}`);
    console.error(`[transcription] ✗ Mensagem: ${error.message}`);
    console.error(`[transcription] ✗ Código: ${error.code}`);
    console.error(`[transcription] ✗ Stack: ${error.stack}`);
    appendTaskLogs(jobId, "transcription", [
      "[transcription] ERROR executing Whisper",
      `[transcription] ${error.message}`,
    ]);
    console.error(`[transcription] ==========================================\n`);

    // Verificar se é um arquivo não encontrado
    if (error.code === "ENOENT") {
      console.error(
        `[transcription] 🎯 Parece que o Whisper não está instalado ou não foi encontrado no PATH`,
      );
      console.error(`[transcription] Tente instalar com: pip install openai-whisper`);
      appendTaskLog(
        jobId,
        "transcription",
        "[transcription] Whisper not found. Install with: pip install openai-whisper",
      );
    }

    metadata.updateJobStatus(jobId, JobStatus.ERROR);
    console.log(`[transcription] ============================================\n`);
    throw error;
  }
}
