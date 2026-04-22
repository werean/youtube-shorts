import { config } from "../../core/config";
import { JobStatus } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";
import * as operationRuntimeService from "../../services/operationRuntimeService";

export type PreparedTranscriptionSource = {
  videoPath: string;
  tempDir: string;
};

export function ensureTranscriptionCanStart(jobId: string): void {
  const activeJobIds = operationRuntimeService.activeTranscriptionJobIds();
  if (activeJobIds.length > 0 && !activeJobIds.includes(jobId)) {
    const errorMsg = `Transcrição já em andamento para outro vídeo (${activeJobIds[0]}). Cancele a transcrição anterior para começar uma nova.`;
    console.error(`[transcription] ✗ ${errorMsg}`);
    operationRuntimeService.appendTaskLog(jobId, "transcription", `[transcription] ✗ ${errorMsg}`);
    throw new Error(errorMsg);
  }
}

export function prepareTranscriptionSource(jobId: string): PreparedTranscriptionSource {
  operationRuntimeService.clearTaskLogs(jobId, "render");
  operationRuntimeService.clearTaskLogs(jobId, "transcription");
  console.log(`\n[transcription] ============================================`);
  console.log(`[transcription] Starting transcription for job ${jobId}`);
  console.log(`[transcription] ============================================`);
  operationRuntimeService.appendTaskLog(jobId, "transcription", "[transcription] Starting transcription");
  jobLifecycleService.updateJobStatus(jobId, JobStatus.TRANSCRIBING);

  console.log(`[transcription] Procurando arquivo de vídeo...`);
  const videoPath = artifactService.findSourceVideo(jobId);
  console.log(
    `[transcription] Resultado da busca: ${videoPath ? "✓ Encontrado" : "✗ Não encontrado"}`,
  );

  if (!videoPath) {
    console.error(`[transcription] ✗ ERRO: Vídeo não encontrado para job ${jobId}`);
    throw new Error("Source video not found for job");
  }

  console.log(`[transcription] ✓ Usando arquivo: ${videoPath}`);
  operationRuntimeService.appendTaskLog(jobId, "transcription", `[transcription] Using file: ${videoPath}`);

  const clearedDir = artifactService.removeTranscriptionsJobDir(jobId);
  console.log(`[transcription] 🧹 Limpando pasta de transcrição: ${clearedDir}`);
  operationRuntimeService.appendTaskLog(jobId, "transcription", `[transcription] Cleared dir: ${clearedDir}`);

  const tempDir = artifactService.ensureTranscriptionsJobDir(jobId);

  console.log(`[transcription] 📁 Diretório de saída: ${tempDir}`);
  console.log(`[transcription] 🎤 Modelo Whisper: ${config.WHISPER_MODEL_NAME}`);
  console.log(`[transcription] 🎬 Vídeo de entrada: ${videoPath}`);
  console.log(`[transcription] 🎯 Iniciando transcrição com Whisper...`);
  operationRuntimeService.appendTaskLogs(jobId, "transcription", [
    `[transcription] Output dir: ${tempDir}`,
    `[transcription] Input: ${videoPath}`,
  ]);

  return { videoPath, tempDir };
}
