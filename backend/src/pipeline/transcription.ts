/**
 * Pipeline step: transcribe audio with Whisper (local installation).
 */

import { appendTaskLog, appendTaskLogs } from "../core/taskLogs";
import { loadActiveToolConfigs } from "../core/toolConfigs";
import { JobStatus } from "../models/job";
import { Segment } from "../models/segment";
import * as metadata from "../storage/metadata";
import {
  readWhisperSegments,
  type TranscriptionFormats,
  whisperOutputPath,
  writeTranscriptionArtifacts,
  writeTranscriptionSegments,
} from "./transcription/artifacts";
import { buildWhisperCommand, resolveTranscriptionFormats } from "./transcription/command";
import {
  cancelActiveTranscriptionProcess,
  runWhisperProcess,
} from "./transcription/process";
import {
  ensureTranscriptionCanStart,
  prepareTranscriptionSource,
} from "./transcription/preconditions";

export function cancelTranscription(jobId: string): boolean {
  const cancelled = cancelActiveTranscriptionProcess(jobId, () =>
    appendTaskLog(jobId, "transcription", "[transcription] Cancel requested"),
  );
  if (!cancelled) {
    return false;
  }

  metadata.updateJobStatus(jobId, JobStatus.DOWNLOADED);
  appendTaskLog(jobId, "transcription", "[transcription] Cancelled");
  return true;
}

export async function transcribeJob(
  jobId: string,
  formats: TranscriptionFormats = resolveTranscriptionFormats(),
): Promise<Segment[]> {
  ensureTranscriptionCanStart(jobId);

  const { videoPath, tempDir } = prepareTranscriptionSource(jobId);

  try {
    const toolConfigs = loadActiveToolConfigs();
    const device = toolConfigs.whisper.device === "cpu" ? "cpu" : "cuda";

    const command = buildWhisperCommand(videoPath, tempDir, toolConfigs);
    console.log(`[transcription] 💻 Command: ${command}`);
    appendTaskLog(jobId, "transcription", `[transcription] Command: ${command}`);

    console.log(`[transcription] ⏳ Executando Whisper com ${device.toUpperCase()}...`);
    await runWhisperProcess(jobId, command);
    console.log(`[transcription] ✓ Whisper completado com sucesso`);
    appendTaskLog(jobId, "transcription", "[transcription] Whisper completed successfully");

    // Verificar arquivo de saída
    const outputPath = whisperOutputPath(videoPath, tempDir);
    console.log(`[transcription] 🔍 Procurando saída: ${outputPath}`);

    const segments = readWhisperSegments(outputPath);

    writeTranscriptionSegments(jobId, segments);
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
