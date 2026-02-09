import { request } from "./client";

export async function getJobLogs(
  jobId: string,
  task: "transcription" | "render" | "ingest",
): Promise<{ task: string; logs: string[] }> {
  return request(`/jobs/${jobId}/logs/${task}`);
}
