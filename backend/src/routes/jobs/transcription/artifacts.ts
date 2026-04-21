import * as fs from "fs";
import { JobStatus } from "../../../models/job";
import * as files from "../../../storage/files";
import * as metadata from "../../../storage/metadata";

type AvailableTranscriptionFormats = {
  segments: boolean;
  text: boolean;
  vtt: boolean;
};

export type TranscriptionRouteResponse = {
  transcription: string;
  segments: { text: string }[];
  available_formats: AvailableTranscriptionFormats;
};

function transcriptionArtifactPaths(jobId: string) {
  return {
    transcriptionPath: files.transcriptionPath(jobId),
    textPath: files.transcriptionTextPath(jobId),
    vttPath: files.transcriptionVttPath(jobId),
  };
}

function availableFormats(jobId: string): AvailableTranscriptionFormats {
  const { transcriptionPath, textPath, vttPath } = transcriptionArtifactPaths(jobId);
  return {
    segments: fs.existsSync(transcriptionPath),
    text: fs.existsSync(textPath),
    vtt: fs.existsSync(vttPath),
  };
}

function resetJobToDownloaded(jobId: string): void {
  try {
    const job = metadata.loadJob(jobId);
    job.status = JobStatus.DOWNLOADED;
    job.updated_at = new Date().toISOString();
    metadata.saveJob(job);
  } catch (error) {
    console.warn(`[jobs] Failed to update job status after transcription delete:`, error);
  }
}

export function buildTranscriptionResponseFromSegments(
  jobId: string,
  segments: { text: string }[],
): TranscriptionRouteResponse {
  const formats = availableFormats(jobId);
  const transcriptionText = segments.map((s: any) => s.text).join(" ");

  return {
    transcription: transcriptionText,
    segments: segments,
    available_formats: {
      segments: true,
      text: Boolean(formats.text),
      vtt: Boolean(formats.vtt),
    },
  };
}

export function readTranscriptionResponse(jobId: string): TranscriptionRouteResponse | null {
  const { transcriptionPath, textPath, vttPath } = transcriptionArtifactPaths(jobId);
  const hasSegments = fs.existsSync(transcriptionPath);
  const hasText = fs.existsSync(textPath);
  const hasVtt = fs.existsSync(vttPath);

  if (!hasSegments && !hasText && !hasVtt) {
    return null;
  }

  let segments: { text: string }[] = [];
  let transcriptionText = "";

  if (hasSegments) {
    const raw = fs.readFileSync(transcriptionPath, "utf-8");
    segments = JSON.parse(raw) as { text: string }[];
    transcriptionText = segments
      .map((s) => s.text)
      .join(" ")
      .trim();
  } else if (hasText) {
    transcriptionText = fs.readFileSync(textPath, "utf-8").trim();
  }

  return {
    transcription: transcriptionText,
    segments,
    available_formats: {
      segments: hasSegments,
      text: hasText,
      vtt: hasVtt,
    },
  };
}

export function deleteAllTranscriptionArtifacts(jobId: string):
  | { deleted: false }
  | { deleted: true; response: { ok: true; job_id: string; available_formats: AvailableTranscriptionFormats } } {
  const { transcriptionPath, textPath, vttPath } = transcriptionArtifactPaths(jobId);

  let removed = false;
  if (fs.existsSync(transcriptionPath)) {
    fs.rmSync(transcriptionPath, { force: true });
    removed = true;
  }
  if (fs.existsSync(textPath)) {
    fs.rmSync(textPath, { force: true });
    removed = true;
  }
  if (fs.existsSync(vttPath)) {
    fs.rmSync(vttPath, { force: true });
    removed = true;
  }

  if (!removed) {
    return { deleted: false };
  }

  resetJobToDownloaded(jobId);

  return {
    deleted: true,
    response: {
      ok: true,
      job_id: jobId,
      available_formats: availableFormats(jobId),
    },
  };
}

export function deleteTranscriptionFormat(jobId: string, format: string):
  | { status: "invalid-format" }
  | { status: "not-found" }
  | { status: "deleted"; response: { ok: true; job_id: string; available_formats: AvailableTranscriptionFormats } } {
  const { transcriptionPath, textPath, vttPath } = transcriptionArtifactPaths(jobId);

  let removed = false;
  if (format === "segments") {
    if (fs.existsSync(transcriptionPath)) {
      fs.rmSync(transcriptionPath, { force: true });
      removed = true;
    }
  } else if (format === "text") {
    if (fs.existsSync(textPath)) {
      fs.rmSync(textPath, { force: true });
      removed = true;
    }
  } else if (format === "vtt") {
    if (fs.existsSync(vttPath)) {
      fs.rmSync(vttPath, { force: true });
      removed = true;
    }
  } else {
    return { status: "invalid-format" };
  }

  if (!removed) {
    return { status: "not-found" };
  }

  if (format === "segments") {
    resetJobToDownloaded(jobId);
  }

  return {
    status: "deleted",
    response: {
      ok: true,
      job_id: jobId,
      available_formats: availableFormats(jobId),
    },
  };
}
