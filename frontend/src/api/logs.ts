import { request } from "./client";

export async function getJobLogs(
  jobId: string,
  task: "transcription" | "render" | "ingest" | "orchestrator" | "blocks" | "topics" | "analysis" | "batch" | "all",
): Promise<{ task: string; logs: string[] }> {
  return request(`/jobs/${jobId}/logs/${task}`);
}

/** Abre a pasta de logs do job no explorador do computador (rota somente local). */
export async function openJobLogsFolder(jobId: string): Promise<{ ok: boolean }> {
  return request(`/jobs/${encodeURIComponent(jobId)}/logs/open-folder`, { method: "POST" });
}
