import { request } from "./client";

export async function cancelTranscription(jobId: string): Promise<{ ok: boolean; job_id: string }> {
  return request(`/jobs/${jobId}/transcribe/cancel`, { method: "POST" });
}

export async function cancelRendering(jobId: string): Promise<{ ok: boolean; job_id: string }> {
  return request(`/jobs/${jobId}/render/cancel`, { method: "POST" });
}
