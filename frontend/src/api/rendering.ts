import { request } from "./client";

export async function renderJob(
  jobId: string,
  options?: { watermark?: boolean },
): Promise<{ started: boolean }> {
  // Sem escolha de marca d'água o pedido é idêntico ao de antes (sem corpo).
  if (options?.watermark === undefined) {
    return request(`/jobs/${jobId}/render`, { method: "POST" });
  }
  return request(`/jobs/${jobId}/render`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ watermark: options.watermark }),
  });
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
