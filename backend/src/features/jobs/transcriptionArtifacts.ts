import { JobStatus } from "../../models/job";
import * as artifactService from "../../services/artifactService";
import * as jobLifecycleService from "../../services/jobLifecycleService";

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
    transcriptionPath: artifactService.transcriptionPath(jobId),
    textPath: artifactService.transcriptionTextPath(jobId),
    vttPath: artifactService.transcriptionVttPath(jobId),
  };
}

function availableFormats(jobId: string): AvailableTranscriptionFormats {
  const { transcriptionPath, textPath, vttPath } = transcriptionArtifactPaths(jobId);
  return {
    segments: artifactService.artifactExists(transcriptionPath),
    text: artifactService.artifactExists(textPath),
    vtt: artifactService.artifactExists(vttPath),
  };
}

function resetJobToDownloaded(jobId: string): void {
  try {
    jobLifecycleService.updateJob(jobId, (job) => {
      job.status = JobStatus.DOWNLOADED;
      job.updated_at = new Date().toISOString();
    });
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
  const hasSegments = artifactService.artifactExists(transcriptionPath);
  const hasText = artifactService.artifactExists(textPath);
  const hasVtt = artifactService.artifactExists(vttPath);

  if (!hasSegments && !hasText && !hasVtt) {
    return null;
  }

  let segments: { text: string }[] = [];
  let transcriptionText = "";

  if (hasSegments) {
    segments = artifactService.readJsonArtifact<{ text: string }[]>(transcriptionPath);
    transcriptionText = segments
      .map((s) => s.text)
      .join(" ")
      .trim();
  } else if (hasText) {
    transcriptionText = artifactService.readTextArtifact(textPath).trim();
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
  if (artifactService.artifactExists(transcriptionPath)) {
    artifactService.removeArtifact(transcriptionPath);
    removed = true;
  }
  if (artifactService.artifactExists(textPath)) {
    artifactService.removeArtifact(textPath);
    removed = true;
  }
  if (artifactService.artifactExists(vttPath)) {
    artifactService.removeArtifact(vttPath);
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
    if (artifactService.artifactExists(transcriptionPath)) {
      artifactService.removeArtifact(transcriptionPath);
      removed = true;
    }
  } else if (format === "text") {
    if (artifactService.artifactExists(textPath)) {
      artifactService.removeArtifact(textPath);
      removed = true;
    }
  } else if (format === "vtt") {
    if (artifactService.artifactExists(vttPath)) {
      artifactService.removeArtifact(vttPath);
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
