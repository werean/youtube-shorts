import { request } from "./client";

export async function renderJob(jobId: string): Promise<{ started: boolean }> {
  return request(`/jobs/${jobId}/render`, { method: "POST" });
}

export async function listRenderOutputs(jobId: string): Promise<string[]> {
  return request(`/jobs/${jobId}/renders`);
}

export async function deleteRenderOutput(
  jobId: string,
  filename: string,
): Promise<{ ok: boolean }> {
  return request(`/jobs/${jobId}/renders/${encodeURIComponent(filename)}`, { method: "DELETE" });
}

export async function openRenderFolder(jobId: string, filename: string): Promise<{ ok: boolean }> {
  return request(`/jobs/${jobId}/renders/${encodeURIComponent(filename)}/open-folder`, {
    method: "POST",
  });
}
