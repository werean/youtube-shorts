/**
 * Burn-in captions for one vertical cut.
 * Times are relative to the cut because the render seeks the source first.
 */

import type { CaptionPosition } from "../../../shared/stylePresets";
import type { Segment } from "../models/segment";

export type CaptionCue = {
  start: number;
  end: number;
  text: string;
};

export type CaptionStyle = {
  fontFamily: string;
  fontSize: number;
  position: CaptionPosition;
};

const BAND_MARGIN_RATIO = 0.08;

export function cuesForCut(segments: Segment[], cutStart: number, cutEnd: number): CaptionCue[] {
  const duration = Math.max(0, cutEnd - cutStart);
  const cues: CaptionCue[] = [];

  for (const segment of segments) {
    const start = Number(segment.start);
    const end = Number(segment.end);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    const overlapStart = Math.max(start, cutStart);
    const overlapEnd = Math.min(end, cutEnd);
    if (overlapEnd - overlapStart <= 0.01) continue;

    const text = String(segment.text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;

    cues.push({
      start: Math.max(0, overlapStart - cutStart),
      end: Math.min(duration, overlapEnd - cutStart),
      text,
    });
  }

  return cues;
}

export function captionAlignment(position: CaptionPosition): number {
  if (position === "top") return 8;
  if (position === "center") return 5;
  return 2;
}

export function captionMargin(position: CaptionPosition, frameHeight: number): number {
  if (position === "center") return 0;
  return Math.round(frameHeight * BAND_MARGIN_RATIO);
}

export function captionForceStyle(style: CaptionStyle, frameHeight: number): string {
  const font = style.fontFamily.replace(/[,']/g, "").trim() || "Arial";
  const size = Math.max(12, Math.round(style.fontSize));
  const alignment = captionAlignment(style.position);
  const margin = captionMargin(style.position, frameHeight);
  return [
    `Fontname=${font}`,
    `Fontsize=${size}`,
    `Alignment=${alignment}`,
    `MarginV=${margin}`,
    "PrimaryColour=&H00FFFFFF",
    "OutlineColour=&H00000000",
    "BorderStyle=1",
    "Outline=2",
  ].join(",");
}

function assTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const whole = Math.floor(clamped);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  const centiseconds = Math.min(99, Math.round((clamped - whole) * 100));
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

function escapeAssText(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "\\{").replace(/\}/g, "\\}").replace(/\r?\n/g, "\\N");
}

export function buildCaptionAss(input: {
  cues: CaptionCue[];
  style: CaptionStyle;
  width: number;
  height: number;
}): string {
  const font = input.style.fontFamily.replace(/[,']/g, "").trim() || "Arial";
  const size = Math.max(12, Math.round(input.style.fontSize));
  const alignment = captionAlignment(input.style.position);
  const margin = captionMargin(input.style.position, input.height);
  const events = input.cues
    .map(
      (cue) =>
        `Dialogue: 0,${assTime(cue.start)},${assTime(cue.end)},Caption,,0,0,0,,${escapeAssText(cue.text)}`,
    )
    .join("\n");

  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${Math.round(input.width)}`,
    `PlayResY: ${Math.round(input.height)}`,
    "WrapStyle: 0",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Caption,${font},${size},&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,0,${alignment},40,40,${margin},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    events,
    "",
  ].join("\n");
}
