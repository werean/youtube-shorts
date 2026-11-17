import type {
  DubbingEngine,
  DubbingExportResult,
  DubbingManifest,
  DubbingPreflightResult,
  DubbingPreviewOptions,
  DubbingStartOptions,
  DubbingSendToCutsResult,
  DubbingSubtitlePreset,
} from "../types";
import { apiBaseUrl, request } from "./client";

export interface DubbingStartResponse {
  started: boolean;
  job_id?: string;
  cut_id?: string;
  short_file?: string;
  lang?: string;
  target_lang?: string;
  engine?: string;
  status?: string;
  deps_missing?: boolean;
  preflight?: DubbingPreflightResult;
}

export interface DeleteDubbingTrackResponse {
  ok: boolean;
  job_id?: string;
  lang?: string;
  manifest?: DubbingManifest;
}

export class DubbingApiError extends Error {
  status: number;
  code?: string;
  preflight?: DubbingPreflightResult;
  detail?: unknown;

  constructor(
    message: string,
    options: {
      status: number;
      code?: string;
      preflight?: DubbingPreflightResult;
      detail?: unknown;
    },
  ) {
    super(message);
    this.name = "DubbingApiError";
    this.status = options.status;
    this.code = options.code;
    this.preflight = options.preflight;
    this.detail = options.detail;
  }
}

export function resolveDubbingMediaUrl(url?: string | null): string | null {
  const trimmed = String(url || "").trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("/")) return `${apiBaseUrl}${trimmed}`;
  return `${apiBaseUrl}/${trimmed}`;
}

async function parseJsonSafe(response: Response): Promise<Record<string, unknown> | null> {
  const text = await response.text();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return { detail: text.trim() };
  }
}

function extractDepsMissingPayload(
  status: number,
  parsed: Record<string, unknown> | null,
): { code?: string; preflight?: DubbingPreflightResult; message: string } {
  const detailObj =
    parsed?.detail && typeof parsed.detail === "object"
      ? (parsed.detail as Record<string, unknown>)
      : null;

  const code = String(parsed?.code ?? detailObj?.code ?? "").trim() || undefined;
  const preflight = (parsed?.preflight ?? detailObj?.preflight) as
    | DubbingPreflightResult
    | undefined;

  const message =
    String(
      parsed?.message ??
        detailObj?.message ??
        (typeof parsed?.detail === "string" ? parsed.detail : "") ??
        parsed?.error ??
        "",
    ).trim() || `Request failed: ${status}`;

  return { code, preflight, message };
}

async function postDubbingStart(
  path: string,
  payload: Record<string, unknown>,
): Promise<DubbingStartResponse> {
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (/Failed to fetch|fetch failed|NetworkError|network/i.test(message)) {
      throw new Error(
        "Não foi possível conectar ao backend da aplicação. Verifique se o servidor está em execução.",
      );
    }
    throw error;
  }

  const parsed = await parseJsonSafe(response);
  const { code, preflight, message } = extractDepsMissingPayload(response.status, parsed);

  if (response.status === 424 || code === "DUBBING_DEPS_MISSING") {
    return {
      started: false,
      deps_missing: true,
      preflight,
    };
  }

  if (!response.ok) {
    throw new DubbingApiError(message, {
      status: response.status,
      code,
      preflight,
      detail: parsed?.detail ?? parsed,
    });
  }

  return {
    started: Boolean(parsed?.started ?? true),
    job_id: typeof parsed?.job_id === "string" ? parsed.job_id : undefined,
    cut_id: typeof parsed?.cut_id === "string" ? parsed.cut_id : undefined,
    short_file: typeof parsed?.short_file === "string" ? parsed.short_file : undefined,
    lang: typeof parsed?.lang === "string" ? parsed.lang : undefined,
    target_lang: typeof parsed?.target_lang === "string" ? parsed.target_lang : undefined,
    engine: typeof parsed?.engine === "string" ? parsed.engine : undefined,
    status: typeof parsed?.status === "string" ? parsed.status : undefined,
    deps_missing: Boolean(parsed?.deps_missing ?? false),
    preflight,
  };
}

export async function getDubbingManifest(jobId: string): Promise<DubbingManifest> {
  return request<DubbingManifest>(`/jobs/${encodeURIComponent(jobId)}/dub`);
}

export async function getDubbingPreflight(
  jobId: string,
  engine?: DubbingEngine | string,
): Promise<DubbingPreflightResult> {
  const qs = engine ? `?engine=${encodeURIComponent(engine)}` : "";
  return request<DubbingPreflightResult>(`/jobs/${encodeURIComponent(jobId)}/dub/preflight${qs}`);
}

export async function startDubbing(
  jobId: string,
  options: DubbingStartOptions = {},
): Promise<DubbingStartResponse> {
  return postDubbingStart(`/jobs/${encodeURIComponent(jobId)}/dub`, { ...options });
}

export async function startCutDubbing(
  jobId: string,
  cutId: string,
  options: DubbingStartOptions = {},
): Promise<DubbingStartResponse> {
  return postDubbingStart(
    `/jobs/${encodeURIComponent(jobId)}/cuts/${encodeURIComponent(cutId)}/dub`,
    { ...options },
  );
}

export async function startDubbingPreview(
  jobId: string,
  options: DubbingPreviewOptions = {},
): Promise<DubbingStartResponse> {
  return postDubbingStart(`/jobs/${encodeURIComponent(jobId)}/dub/preview`, { ...options });
}

export async function cancelDubbing(
  jobId: string,
): Promise<{ ok: boolean; job_id: string; cancelled?: boolean }> {
  return request<{ ok: boolean; job_id: string; cancelled?: boolean }>(
    `/jobs/${encodeURIComponent(jobId)}/dub/cancel`,
    { method: "POST" },
  );
}

export async function exportDubbedVideo(
  jobId: string,
  lang: string,
  options: {
    preset?: DubbingSubtitlePreset | string;
    subtitles_enabled?: boolean;
  } = {},
): Promise<DubbingExportResult> {
  return request<DubbingExportResult>(
    `/jobs/${encodeURIComponent(jobId)}/dub/${encodeURIComponent(lang)}/export`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    },
  );
}

export async function sendDubbedToCuts(
  jobId: string,
  lang: string,
): Promise<DubbingSendToCutsResult> {
  return request<DubbingSendToCutsResult>(
    `/jobs/${encodeURIComponent(jobId)}/dub/${encodeURIComponent(lang)}/send-to-cuts`,
    { method: "POST" },
  );
}

export async function deleteDubbingTrack(
  jobId: string,
  lang: string,
): Promise<DeleteDubbingTrackResponse> {
  const raw = await request<DeleteDubbingTrackResponse | DubbingManifest>(
    `/jobs/${encodeURIComponent(jobId)}/dub/${encodeURIComponent(lang)}`,
    { method: "DELETE" },
  );
  if (raw && typeof raw === "object" && "tracks" in raw) {
    return { ok: true, manifest: raw as DubbingManifest };
  }
  return raw as DeleteDubbingTrackResponse;
}
