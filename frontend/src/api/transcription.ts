import { request } from "./client";

export async function transcribeJob(jobId: string): Promise<Record<string, unknown>[]> {
  return request(`/jobs/${jobId}/transcribe`, { method: "POST" });
}

export async function getTranscription(jobId: string): Promise<{
  transcription: string;
  segments: Record<string, unknown>[];
  available_formats?: { segments?: boolean; text?: boolean; vtt?: boolean };
}> {
  return request(`/jobs/${jobId}/transcription`);
}

export async function deleteTranscription(
  jobId: string,
  format: "all" | "text" | "vtt" | "segments",
): Promise<{
  ok: boolean;
  job_id: string;
  available_formats?: { segments?: boolean; text?: boolean; vtt?: boolean };
}> {
  const suffix = format === "all" ? "" : `/${format}`;
  return request(`/jobs/${jobId}/transcription${suffix}`, { method: "DELETE" });
}

export async function buildBlocks(jobId: string): Promise<Record<string, unknown>[]> {
  return request(`/jobs/${jobId}/blocks`, { method: "POST" });
}
