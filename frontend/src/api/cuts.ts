import type { Cut } from "../types";
import { request } from "./client";

export async function listCuts(jobId: string): Promise<Cut[]> {
  return request(`/jobs/${jobId}/cuts`);
}

export async function updateCuts(
  jobId: string,
  cuts: Cut[],
): Promise<{ ok: boolean; cuts: Cut[] }> {
  return request(`/jobs/${jobId}/cuts`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cuts }),
  });
}

export async function approveCut(jobId: string, cutId: string): Promise<Cut> {
  return request(`/jobs/${jobId}/cuts/${cutId}/approve`, { method: "POST" });
}

export async function rejectCut(jobId: string, cutId: string): Promise<Cut> {
  return request(`/jobs/${jobId}/cuts/${cutId}/reject`, { method: "POST" });
}

export async function analyzeJob(jobId: string): Promise<{ cuts: Cut[]; raw_response?: string }> {
  return request(`/jobs/${jobId}/analyze`, { method: "POST" });
}
