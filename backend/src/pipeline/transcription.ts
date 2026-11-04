/**
 * Pipeline step: transcribe audio with Whisper (local installation).
 */

import { loadActiveToolConfigs } from "../core/toolConfigs";
import { JobStatus } from "../models/job";
import { Segment } from "../models/segment";
import * as jobLifecycleService from "../services/jobLifecycleService";
import * as operationRuntimeService from "../services/operationRuntimeService";
import { PipelineCancelledError } from "./errors";
import { statusAfterInterruptedStep } from "./recoveryStatus";
import {
  readWhisperSegments,
  type TranscriptionFormats,
  whisperOutputPath,
  writeTranscriptionArtifacts,
  writeTranscriptionSegments,
} from "./transcription/artifacts";
import {
  buildWhisperCommand,
  fasterWhisperComputeType,
  formatWhisperCommand,
  resolveTranscriptionFormats,
  resolveWhisperEngine,
  whisperRuntimeDevice,
} from "./transcription/command";
import { fasterWhisperWeightsCached } from "./transcription/whisperWeights";
import { planFasterWhisperWeights } from "../../../shared/localInference";
import { transcriptionRunLogPath, writeRunLog } from "./runLog";
import { runWhisperProcess } from "./transcription/process";
import {
  ensureTranscriptionCanStart,
  prepareTranscriptionSource,
} from "./transcription/preconditions";

export function cancelTranscription(jobId: string): boolean {
  const active = operationRuntimeService.activeTranscriptionJobIds().includes(jobId);
  if (!active) {
    return false;
  }

  operationRuntimeService.markTranscriptionCancelled(jobId);
  const cancelled = operationRuntimeService.cancelActiveTranscriptionProcess(jobId, () =>
    operationRuntimeService.appendTaskLog(
      jobId,
      "transcription",
      "[transcription] Cancel requested",
    ),
  );
  if (!cancelled) {
    operationRuntimeService.clearTranscriptionCancelled(jobId);
    return false;
  }

  jobLifecycleService.updateJobStatus(jobId, statusAfterInterruptedStep(jobId));
  operationRuntimeService.appendTaskLog(jobId, "transcription", "[transcription] Cancelled");
  return true;
}

async function transcribeJobUnlocked(
  jobId: string,
  formats: TranscriptionFormats = resolveTranscriptionFormats(),
): Promise<Segment[]> {
  operationRuntimeService.clearTranscriptionCancelled(jobId);
  ensureTranscriptionCanStart(jobId);

  const { videoPath, tempDir } = prepareTranscriptionSource(jobId);
  let engine = resolveWhisperEngine();
  let device = whisperRuntimeDevice();
  let model = "large-v3";
  let language: string | null = null;
  let fp16: boolean | undefined;

  try {
    const toolConfigs = loadActiveToolConfigs();
    const command = buildWhisperCommand(videoPath, tempDir, toolConfigs);
    engine = resolveWhisperEngine(toolConfigs);
    device = whisperRuntimeDevice(toolConfigs);
    model = String(toolConfigs.whisper.model || "large-v3");
    language = toolConfigs.whisper.language || null;
    fp16 = toolConfigs.whisper.fp16;
    if (engine === "faster-whisper") {
      const weightPlan = planFasterWhisperWeights({
        model,
        savedDevice: device,
        gpuAvailable: device === "cuda",
        weightsCached: fasterWhisperWeightsCached(model),
      });
      if (weightPlan.shouldDownload) {
        const line = `[transcription] faster-whisper model ${weightPlan.model} is not cached; downloading weights on ${weightPlan.device}`;
        console.log(line);
        operationRuntimeService.appendTaskLog(jobId, "transcription", line);
      }
    }

    const commandText = formatWhisperCommand(command);
    console.log(`[transcription] 💻 Command: ${commandText}`);
    operationRuntimeService.appendTaskLog(
      jobId,
      "transcription",
      `[transcription] Command: ${commandText}`,
    );

    console.log(`[transcription] ⏳ Executando Whisper com ${device.toUpperCase()}...`);
    await runWhisperProcess(jobId, command);
    if (operationRuntimeService.isTranscriptionCancelled(jobId)) {
      jobLifecycleService.updateJobStatus(jobId, statusAfterInterruptedStep(jobId));
      operationRuntimeService.appendTaskLog(
        jobId,
        "transcription",
        "[transcription] Cancel acknowledged",
      );
      throw new PipelineCancelledError("Transcription cancelled");
    }
    console.log(`[transcription] ✓ Whisper completado com sucesso`);
    operationRuntimeService.appendTaskLog(
      jobId,
      "transcription",
      "[transcription] Whisper completed successfully",
    );

    // Verificar arquivo de saída
    const outputPath = whisperOutputPath(videoPath, tempDir);
    console.log(`[transcription] 🔍 Procurando saída: ${outputPath}`);

    const segments = readWhisperSegments(outputPath);

    writeTranscriptionSegments(jobId, segments);
    console.log(`[transcription] ✓ Transcription saved for job ${jobId}`);
    operationRuntimeService.appendTaskLog(jobId, "transcription", "[transcription] Transcription saved");
    writeTranscriptionArtifacts(jobId, segments, formats);
    writeTranscriptionRunLog(jobId, {
      engine,
      model,
      device,
      computeType: engine === "faster-whisper" ? fasterWhisperComputeType(device, fp16) : null,
      language,
      segmentCount: segments.length,
      durationSeconds: segments.length > 0 ? segments[segments.length - 1].end : 0,
    });

    const job = jobLifecycleService.loadJob(jobId);
    job.status = JobStatus.BUILDING_BLOCKS;
    job.updated_at = new Date().toISOString();
    const lastEnd = segments.length > 0 ? segments[segments.length - 1].end : 0;
    if ((!job.video_duration_seconds || job.video_duration_seconds <= 0) && lastEnd > 0) {
      job.video_duration_seconds = lastEnd;
    }
    jobLifecycleService.saveJob(job);

    console.log(`[transcription] ============================================\n`);
    return segments;
  } catch (error: any) {
    console.error(`\n[transcription] ==========================================`);
    console.error(`[transcription] ✗ ERRO ao executar Whisper`);
    console.error(`[transcription] ✗ Nome do erro: ${error.name}`);
    console.error(`[transcription] ✗ Mensagem: ${error.message}`);
    console.error(`[transcription] ✗ Código: ${error.code}`);
    console.error(`[transcription] ✗ Stack: ${error.stack}`);
    operationRuntimeService.appendTaskLogs(jobId, "transcription", [
      "[transcription] ERROR executing Whisper",
      `[transcription] ${error.message}`,
    ]);
    console.error(`[transcription] ==========================================\n`);

    // Verificar se é um arquivo não encontrado
    if (error.code === "ENOENT") {
      const installHint =
        engine === "openai-whisper"
          ? "pip install openai-whisper"
          : "pip install faster-whisper";
      console.error(
        `[transcription] 🎯 Parece que o Whisper não está instalado ou não foi encontrado no PATH`,
      );
      console.error(`[transcription] Tente instalar com: ${installHint}`);
      operationRuntimeService.appendTaskLog(
        jobId,
        "transcription",
        `[transcription] Whisper not found. Install with: ${installHint}`,
      );
    }

    writeTranscriptionRunLog(jobId, {
      engine,
      model,
      device,
      computeType: engine === "faster-whisper" ? fasterWhisperComputeType(device, fp16) : null,
      language,
      segmentCount: 0,
      durationSeconds: 0,
      error: error?.message || String(error),
    });

    if (operationRuntimeService.isTranscriptionCancelled(jobId)) {
      jobLifecycleService.updateJobStatus(jobId, statusAfterInterruptedStep(jobId));
      operationRuntimeService.appendTaskLog(jobId, "transcription", "[transcription] Cancel acknowledged");
      throw new PipelineCancelledError("Transcription cancelled");
    }

    jobLifecycleService.updateJobStatus(jobId, JobStatus.ERROR, error?.message || String(error));
    console.log(`[transcription] ============================================\n`);
    throw error;
  }
}

function writeTranscriptionRunLog(
  jobId: string,
  input: {
    engine: string;
    model: string;
    device: string;
    computeType: string | null;
    language: string | null;
    segmentCount: number;
    durationSeconds: number;
    error?: string;
  },
): void {
  try {
    writeRunLog(transcriptionRunLogPath(jobId), {
      kind: "transcription",
      created_at: new Date().toISOString(),
      engine: input.engine,
      model: input.model,
      device: input.device,
      compute_type: input.computeType,
      endpoint: null,
      language: input.language,
      segment_count: input.segmentCount,
      duration_seconds: input.durationSeconds,
      ...(input.error ? { error: input.error } : {}),
    });
  } catch (error) {
    console.warn(
      `[transcription] Could not write run log for job ${jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function transcribeJob(
  jobId: string,
  formats: TranscriptionFormats = resolveTranscriptionFormats(),
): Promise<Segment[]> {
  return operationRuntimeService.runWithJobLock(jobId, () => transcribeJobUnlocked(jobId, formats));
}
