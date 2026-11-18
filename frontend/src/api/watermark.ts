import type { WatermarkPosition, WatermarkSettings } from "@youtube-shorts/contracts";
import { apiBaseUrl, request } from "./client";

export type { WatermarkSettings };

export type WatermarkPatch = Partial<
  Pick<WatermarkSettings, "mode" | "opacity" | "position" | "size_percent">
>;

/** Valores padrão de aparência (usados por "Restaurar padrões"). */
export const WATERMARK_DEFAULT_APPEARANCE: {
  opacity: number;
  position: WatermarkPosition;
  size_percent: number;
} = { opacity: 0.7, position: "top-right", size_percent: 18 };

const PROFILE = "active";

export async function getWatermark(): Promise<WatermarkSettings> {
  return request<WatermarkSettings>(`/profiles/${PROFILE}/watermark`);
}

export async function updateWatermark(patch: WatermarkPatch): Promise<WatermarkSettings> {
  return request<WatermarkSettings>(`/profiles/${PROFILE}/watermark`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
}

export async function uploadWatermarkImage(file: File): Promise<WatermarkSettings> {
  const form = new FormData();
  form.append("file", file);
  return request<WatermarkSettings>(`/profiles/${PROFILE}/watermark/image`, {
    method: "POST",
    body: form,
  });
}

export async function deleteWatermarkImage(): Promise<WatermarkSettings> {
  return request<WatermarkSettings>(`/profiles/${PROFILE}/watermark/image`, {
    method: "DELETE",
  });
}

export async function restoreWatermarkDefaults(): Promise<WatermarkSettings> {
  return updateWatermark({ ...WATERMARK_DEFAULT_APPEARANCE });
}

/** Converte o `image_url` relativo devolvido pela API em endereço absoluto. */
export function buildWatermarkImageUrl(imageUrl: string | null | undefined): string | null {
  if (!imageUrl) return null;
  return /^https?:\/\//i.test(imageUrl) ? imageUrl : `${apiBaseUrl}${imageUrl}`;
}
