/**
 * Utility functions for formatting timestamps and building URLs
 */

import { apiBaseUrl } from "../api";

/**
 * Format seconds to VTT timestamp format (HH:MM:SS.mmm)
 */
export function formatVttTimestamp(seconds: number): string {
  const totalMs = Math.max(0, Math.floor(seconds * 1000));
  const ms = totalMs % 1000;
  const totalSeconds = Math.floor(totalMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
}

/**
 * Format seconds to readable timestamp (MM:SS or H:MM:SS)
 */
export function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Parse timestamp input (supports mm:ss, hh:mm:ss, or seconds)
 */
export function parseTimestampInput(input: string): number | null {
  const trimmed = input.trim();
  const colonParts = trimmed.split(":");

  if (colonParts.length === 1) {
    const seconds = Number(trimmed);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }

  if (colonParts.length === 2) {
    const minutes = Number(colonParts[0]);
    const seconds = Number(colonParts[1]);
    if (
      Number.isFinite(minutes) &&
      Number.isFinite(seconds) &&
      minutes >= 0 &&
      seconds >= 0 &&
      seconds < 60
    ) {
      return minutes * 60 + seconds;
    }
  }

  if (colonParts.length === 3) {
    const hours = Number(colonParts[0]);
    const minutes = Number(colonParts[1]);
    const seconds = Number(colonParts[2]);
    if (
      Number.isFinite(hours) &&
      Number.isFinite(minutes) &&
      Number.isFinite(seconds) &&
      hours >= 0 &&
      minutes >= 0 &&
      minutes < 60 &&
      seconds >= 0 &&
      seconds < 60
    ) {
      return hours * 3600 + minutes * 60 + seconds;
    }
  }

  return null;
}

/**
 * Build render URL with cache busting
 */
export function buildRenderUrl(renderPath: string, version: number): string {
  if (!renderPath) return "";
  if (renderPath.startsWith("http://") || renderPath.startsWith("https://")) {
    return renderPath;
  }
  const normalized = renderPath.startsWith("/") ? renderPath : `/${renderPath}`;
  const separator = normalized.includes("?") ? "&" : "?";
  return `${apiBaseUrl}${normalized}${separator}v=${version}`;
}
