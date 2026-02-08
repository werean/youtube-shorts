import type { Cut, Job, VideoRecord } from "./types";

const DEFAULT_BASE_URL = "http://localhost:8000";

export const apiBaseUrl = DEFAULT_BASE_URL;

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  console.log(`[API] ${init?.method || "GET"} ${apiBaseUrl}${path}`);
  console.log(`[API] Headers:`, init?.headers);
  console.log(`[API] Body:`, init?.body);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, init);
    console.log(`[API] Response status: ${response.status}`);
    console.log(`[API] Response headers:`, response.headers);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[API] ✗ Error response: ${text}`);
      throw new Error(text || `Request failed: ${response.status}`);
    }

    const data = (await response.json()) as T;
    console.log(`[API] ✓ Success`, data);
    return data;
  } catch (error: any) {
    console.error(`[API] ✗ Fetch error:`, error.message);
    console.error(`[API] ✗ Error type:`, error.name);
    console.error(`[API] ✗ Full error:`, error);
    throw error;
  }
}

export async function createJob(youtubeUrl: string): Promise<Job> {
  console.log(`\n[createJob] Criando job para URL: ${youtubeUrl}`);
  return request<Job>("/jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ youtube_url: youtubeUrl }),
  });
}

export async function uploadVideoFile(file: File): Promise<{ job: Job; video_path: string }> {
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
      console.error(`[API] ✗ Error response: ${text}`);
      throw new Error(text || `Upload failed: ${response.status}`);
    }

    const data = await response.json();
    console.log(`[API] ✓ Upload success`, data);
    return data;
  } catch (error: any) {
    console.error(`[API] ✗ Upload error:`, error.message);
    throw error;
  }
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

export async function transcribeJob(jobId: string): Promise<Record<string, unknown>[]> {
  return request(`/jobs/${jobId}/transcribe`, { method: "POST" });
}

export async function getTranscription(jobId: string): Promise<{
  transcription: string;
  segments: Record<string, unknown>[];
  available_formats?: { segments?: boolean; text?: boolean; vtt?: boolean };
}> {
  return request(`/jobs/${jobId}/transcription`);
}

export async function deleteTranscription(
  jobId: string,
  format: "all" | "text" | "vtt" | "segments",
): Promise<{
  ok: boolean;
  job_id: string;
  available_formats?: { segments?: boolean; text?: boolean; vtt?: boolean };
}> {
  const suffix = format === "all" ? "" : `/${format}`;
  return request(`/jobs/${jobId}/transcription${suffix}`, { method: "DELETE" });
}

export async function buildBlocks(jobId: string): Promise<Record<string, unknown>[]> {
  return request(`/jobs/${jobId}/blocks`, { method: "POST" });
}

export async function analyzeJob(jobId: string): Promise<{ cuts: Cut[]; raw_response?: string }> {
  return request(`/jobs/${jobId}/analyze`, { method: "POST" });
}

export async function listCuts(jobId: string): Promise<Cut[]> {
  return request(`/jobs/${jobId}/cuts`);
}

export async function approveCut(jobId: string, cutId: string): Promise<Cut> {
  return request(`/jobs/${jobId}/cuts/${cutId}/approve`, { method: "POST" });
}

export async function rejectCut(jobId: string, cutId: string): Promise<Cut> {
  return request(`/jobs/${jobId}/cuts/${cutId}/reject`, { method: "POST" });
}

export async function renderJob(jobId: string): Promise<{ started: boolean }> {
  return request(`/jobs/${jobId}/render`, { method: "POST" });
}

export async function listRenderOutputs(jobId: string): Promise<string[]> {
  return request(`/jobs/${jobId}/renders`);
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

export async function renameVideo(jobId: string, newName: string): Promise<Job> {
  return request(`/jobs/${jobId}/rename`, { method: "POST", body: { new_name: newName } });
}

export async function getLLMPrompt(): Promise<{ prompt: string; version: string }> {
  return request("/config/llm-prompt");
}

export async function getConfig(): Promise<{
  whisper: { device: string; formats: string };
  llm: { model: string };
}> {
  return request("/config");
}

export async function getDependencies(): Promise<{
  dependencies: {
    python: { installed: boolean; version: string | null };
    whisper: { installed: boolean; version: string | null };
    ffmpeg: { installed: boolean; version: string | null };
    cuda: { installed: boolean; version: string | null };
    pytorch: { installed: boolean; version: string | null };
    ollama: { installed: boolean; version: string | null };
  };
}> {
  return request("/config/dependencies");
}

export interface InstallationGuide {
  name: string;
  manual: {
    title: string;
    description: string;
    steps: string[];
    links?: { text: string; url: string }[];
  };
  automatic?: {
    command: string;
    description: string;
  };
}

export async function getInstallationGuide(name: string): Promise<InstallationGuide> {
  return request(`/config/dependencies/${name}/instructions`);
}

export async function installDependency(name: string): Promise<{
  success: boolean;
  message: string;
  output?: string;
  error?: string;
}> {
  return request(`/config/dependencies/${name}/install`, {
    method: "POST",
  });
}

export interface AppSettings {
  media: {
    base_dir: string;
  };
  preferences: {
    ask_move_on_upload: boolean;
    move_uploads: boolean;
  };
}

export async function getSettings(): Promise<AppSettings> {
  return request("/config/settings");
}

export async function saveSettings(settings: Partial<AppSettings>): Promise<AppSettings> {
  return request("/config/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export async function getCommonFolders(): Promise<{
  folders: { name: string; path: string; exists: boolean }[];
}> {
  return request("/config/common-folders");
}

export async function selectFolder(): Promise<{ selected: boolean; path: string | null }> {
  return request("/config/select-folder", { method: "POST" });
}
