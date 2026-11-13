import { request } from "./client";

export async function cancelJob(
  jobId: string,
): Promise<{ ok: boolean; job_id: string; status: string; new_status?: string }> {
  return request(`/jobs/${jobId}/cancel`, { method: "POST" });
}

export async function cancelTranscription(jobId: string): Promise<{ ok: boolean; job_id: string }> {
  return request(`/jobs/${jobId}/transcribe/cancel`, { method: "POST" });
}

export async function cancelRendering(jobId: string): Promise<{ ok: boolean; job_id: string }> {
  return request(`/jobs/${jobId}/render/cancel`, { method: "POST" });
}
