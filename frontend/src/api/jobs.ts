import type { Job } from "../types";
import { request } from "./client";

export async function createJob(youtubeUrl: string): Promise<Job> {
  console.log(`\n[createJob] Criando job para URL: ${youtubeUrl}`);
  const result = await request<{ job: Job }>("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtube_url: youtubeUrl }),
  });
  return result.job;
}

export async function getJob(jobId: string): Promise<Job> {
  return request<Job>(`/jobs/${jobId}`);
}

export async function ingestJob(
  jobId: string,
): Promise<{ video_path: string; metadata_path: string }> {
  const result = await request<{ video_path: string; metadata_path: string }>(
    `/jobs/${jobId}/ingest`,
    { method: "POST" },
  );
  return result;
}

export async function renameVideo(jobId: string, newName: string): Promise<Job> {
  return request<Job>(`/jobs/${jobId}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: newName }),
  });
}
