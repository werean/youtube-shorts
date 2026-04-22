import * as fs from "fs";
import * as path from "path";
import { Segment } from "../../models/segment";
import * as artifactService from "../../services/artifactService";

export type TranscriptionFormats = {
  text?: boolean;
  vtt?: boolean;
};

function readFileTextWithFallback(filePath: string): string {
  const buffer = fs.readFileSync(filePath);
  try {
    const decoder = new TextDecoder("utf-8", { fatal: true });
    return decoder.decode(buffer);
  } catch (error) {
    return buffer.toString("latin1");
  }
}

export function whisperOutputPath(videoPath: string, outputDir: string): string {
  const videoBasename = path.basename(videoPath, path.extname(videoPath));
  return path.join(outputDir, `${videoBasename}.json`);
}

export function readWhisperSegments(outputPath: string): Segment[] {
  if (!fs.existsSync(outputPath)) {
    throw new Error("Whisper output file not found");
  }

  const whisperRaw = readFileTextWithFallback(outputPath);
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

  return segments;
}

export function writeTranscriptionSegments(jobId: string, segments: Segment[]): void {
  const outputPath = artifactService.transcriptionPath(jobId);
  artifactService.writeJsonArtifact(outputPath, segments);
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

export function writeTranscriptionArtifacts(
  jobId: string,
  segments: Segment[],
  formats: TranscriptionFormats,
): void {
  const normalized = {
    text: Boolean(formats.text),
    vtt: Boolean(formats.vtt),
  };

  if (normalized.text) {
    const textPath = artifactService.transcriptionTextPath(jobId);
    artifactService.writeTextArtifact(textPath, buildPlainText(segments));
  }

  if (normalized.vtt) {
    const vttPath = artifactService.transcriptionVttPath(jobId);
    artifactService.writeTextArtifact(vttPath, buildVtt(segments));
  }

  if (normalized.text || normalized.vtt) {
    console.log(`[transcription] ✓ Arquivos adicionais gerados`);
  } else {
    console.log(`[transcription] ↪ Nenhum arquivo adicional solicitado`);
  }
}
