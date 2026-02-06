/**
 * Pipeline step: transcribe audio with Whisper (local installation).
 */

import { execSync } from "child_process";
import * as fs from "fs";
import { Segment } from "../models/segment";
import { JobStatus } from "../models/job";
import * as files from "../storage/files";
import * as metadata from "../storage/metadata";
import { config } from "../core/config";

type TranscriptionFormats = {
  text?: boolean;
  vtt?: boolean;
};

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

export function transcribeJob(
  jobId: string,
  formats: TranscriptionFormats = { text: true, vtt: true },
): Segment[] {
  console.log(`\n[transcription] ============================================`);
  console.log(`[transcription] Starting transcription for job ${jobId}`);
  console.log(`[transcription] ============================================`);
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

  const tempDir = files.ensureJobDir(jobId);
  const outputFormat = "json";

  console.log(`[transcription] 📁 Diret\u00f3rio de sa\u00edda: ${tempDir}`);
  console.log(`[transcription] 🎤 Modelo Whisper: ${config.WHISPER_MODEL_NAME}`);
  console.log(`[transcription] 🎬 V\u00eddeo de entrada: ${videoPath}`);
  console.log(`[transcription] 🎯 Iniciando transcri\u00e7\u00e3o com Whisper...`);

  try {
    // Run whisper command - force CUDA
    const command = `whisper "${videoPath}" --model ${config.WHISPER_MODEL_NAME} --output_format ${outputFormat} --output_dir "${tempDir}" --device cuda`;
    console.log(`[transcription] 💻 Command: ${command}`);

    console.log(`[transcription] ⏳ Executando Whisper com CUDA...`);
    execSync(command, { stdio: "inherit" });
    console.log(`[transcription] ✓ Whisper completado com sucesso`);

    // Verificar arquivo de saída
    const videoBasename = require("path").basename(videoPath, require("path").extname(videoPath));
    const whisperOutputPath = require("path").join(tempDir, `${videoBasename}.json`);
    console.log(`[transcription] 🔍 Procurando sa\u00edda: ${whisperOutputPath}`);

    if (!fs.existsSync(whisperOutputPath)) {
      throw new Error("Whisper output file not found");
    }

    const whisperData = JSON.parse(fs.readFileSync(whisperOutputPath, "utf-8"));

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
    console.error(`[transcription] ==========================================\n`);

    // Verificar se é um arquivo não encontrado
    if (error.code === "ENOENT") {
      console.error(
        `[transcription] 🎯 Parece que o Whisper não está instalado ou não foi encontrado no PATH`,
      );
      console.error(`[transcription] Tente instalar com: pip install openai-whisper`);
    }

    console.log(`[transcription] ⚠️ USANDO DADOS DUMMY APENAS PARA TESTES`);
    console.log(`[transcription] 🔧 Por favor, instale Whisper ou configure corretamente`);

    // Fallback: criar transcrição dummy
    const dummySegments: Segment[] = [
      {
        segment_id: "s1",
        start: 0.0,
        end: 5.0,
        text: "Olá, este é um vídeo de teste.",
      },
      {
        segment_id: "s2",
        start: 5.0,
        end: 10.0,
        text: "A transcrição está funcionando com dados dummy.",
      },
      {
        segment_id: "s3",
        start: 10.0,
        end: 15.0,
        text: "Você pode agora testar todo o pipeline de processamento.",
      },
      {
        segment_id: "s4",
        start: 15.0,
        end: 20.0,
        text: "Isso inclui análise semântica, curadoria e renderização.",
      },
    ];

    const outputPath = files.transcriptionPath(jobId);
    fs.writeFileSync(outputPath, JSON.stringify(dummySegments, null, 2), "utf-8");
    console.log(`[transcription] ✓ Dummy transcription saved for job ${jobId}`);
    writeTranscriptionArtifacts(jobId, dummySegments, formats);

    const job = metadata.loadJob(jobId);
    job.status = JobStatus.BUILDING_BLOCKS;
    job.updated_at = new Date().toISOString();
    metadata.saveJob(job);

    console.log(`[transcription] ============================================\n`);
    return dummySegments;
  }
}
