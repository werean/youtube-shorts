import { config } from "../../core/config";
import { appendTaskLog, appendTaskLogs, clearTaskLogs } from "../../core/taskLogs";
import { JobStatus } from "../../models/job";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as files from "../../storage/files";
import { activeTranscriptionJobIds } from "./process";

export type PreparedTranscriptionSource = {
  videoPath: string;
  tempDir: string;
};

export function ensureTranscriptionCanStart(jobId: string): void {
  const activeJobIds = activeTranscriptionJobIds();
  if (activeJobIds.length > 0 && !activeJobIds.includes(jobId)) {
    const errorMsg = `Transcrição já em andamento para outro vídeo (${activeJobIds[0]}). Cancele a transcrição anterior para começar uma nova.`;
    console.error(`[transcription] ✗ ${errorMsg}`);
    appendTaskLog(jobId, "transcription", `[transcription] ✗ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

export function prepareTranscriptionSource(jobId: string): PreparedTranscriptionSource {
  clearTaskLogs(jobId, "render");
  clearTaskLogs(jobId, "transcription");
  console.log(`\n[transcription] ============================================`);
  console.log(`[transcription] Starting transcription for job ${jobId}`);
  console.log(`[transcription] ============================================`);
  appendTaskLog(jobId, "transcription", "[transcription] Starting transcription");
  jobLifecycleService.updateJobStatus(jobId, JobStatus.TRANSCRIBING);

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

  console.log(`[transcription] 📁 Diretório de saída: ${tempDir}`);
  console.log(`[transcription] 🎤 Modelo Whisper: ${config.WHISPER_MODEL_NAME}`);
  console.log(`[transcription] 🎬 Vídeo de entrada: ${videoPath}`);
  console.log(`[transcription] 🎯 Iniciando transcrição com Whisper...`);
  appendTaskLogs(jobId, "transcription", [
    `[transcription] Output dir: ${tempDir}`,
    `[transcription] Input: ${videoPath}`,
  ]);

  return { videoPath, tempDir };
}
