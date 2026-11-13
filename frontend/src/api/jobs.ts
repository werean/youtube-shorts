import type {
  ArchiveAttemptRequest,
  ArchiveAttemptResponse,
  AttemptDetail,
  AttemptSummary,
  DeleteAttemptResponse,
  Job,
} from "../types";
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
  const result = await request<Job | { job: Job }>(`/jobs/${jobId}/rename`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ new_name: newName }),
  });
  if (result && typeof result === "object" && "job" in result && (result as { job: Job }).job) {
    return (result as { job: Job }).job;
  }
  return result as Job;
}

export async function runJobPipeline(
  jobId: string,
  options?: {
    language?: string;
    max_cuts?: number;
    vertical_mode?: "crop" | "blur" | "zoom" | "split_podcast";
    subtitle_style?: "word_highlight" | "sentence";
    include_render?: boolean;
  },
): Promise<{ started: boolean; job_id: string; status: string }> {
  return request<{ started: boolean; job_id: string; status: string }>(`/jobs/${jobId}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options || {}),
  });
}

export async function listJobAttempts(jobId: string): Promise<AttemptSummary[]> {
  return request<AttemptSummary[]>(`/jobs/${encodeURIComponent(jobId)}/attempts`);
}

export async function archiveJobAttempt(
  jobId: string,
  payload: ArchiveAttemptRequest = { reset_active: true },
): Promise<ArchiveAttemptResponse> {
  return request<ArchiveAttemptResponse>(
    `/jobs/${encodeURIComponent(jobId)}/attempts/archive`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
  );
}

export async function getJobAttempt(jobId: string, attemptId: string): Promise<AttemptDetail> {
  return request<AttemptDetail>(
    `/jobs/${encodeURIComponent(jobId)}/attempts/${encodeURIComponent(attemptId)}`,
  );
}

export async function deleteJobAttempt(
  jobId: string,
  attemptId: string,
): Promise<DeleteAttemptResponse> {
  return request<DeleteAttemptResponse>(
    `/jobs/${encodeURIComponent(jobId)}/attempts/${encodeURIComponent(attemptId)}`,
    { method: "DELETE" },
  );
}
