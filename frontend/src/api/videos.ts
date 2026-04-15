import type { VideoRecord } from "../types";
import { request, apiBaseUrl } from "./client";

export async function uploadVideoFile(file: File): Promise<{ job: any; video_path: string }> {
  console.log(`\n[uploadVideoFile] Fazendo upload do arquivo: ${file.name}`);
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch(`${apiBaseUrl}/jobs/upload`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(`[API] Error response: ${text}`);
      throw new Error(text || `Upload failed: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[API] Upload success`, data);
    return data;
  } catch (error: any) {
    console.error(`[API] Upload error:`, error.message);
    throw error;
  }
}

export async function listVideos(): Promise<VideoRecord[]> {
  return request<VideoRecord[]>("/videos");
}

export async function listArchivedVideos(): Promise<VideoRecord[]> {
  return request<VideoRecord[]>("/videos/archived");
}

export async function archiveVideo(jobId: string): Promise<{ ok: boolean; job_id: string }> {
  return request(`/videos/${jobId}/archive`, { method: "POST" });
}

export async function deleteVideo(jobId: string): Promise<{ ok: boolean; job_id: string }> {
  return request(`/videos/${jobId}`, { method: "DELETE" });
}

export async function openVideoFolder(jobId: string): Promise<{ ok: boolean }> {
  return request(`/videos/${jobId}/open-folder`, { method: "POST" });
}
