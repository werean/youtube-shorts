/**
 * Vertical-short style presets.
 * Stored with app settings and applied by the vertical render command.
 */

export type BlurTarget = "background" | "top" | "bottom" | "custom";
export type CaptionPosition = "top" | "center" | "bottom";
export type ExtraKind = "toggle" | "text" | "number";

export interface BlurRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StyleExtra {
  id: string;
  label: string;
  kind: ExtraKind;
  enabled: boolean;
  value: string;
}

export interface ShortStylePreset {
  id: string;
  name: string;
  builtin: boolean;
  blur: {
    enabled: boolean;
    target: BlurTarget;
    strength: number;
    region: BlurRegion;
  };
  music: {
    enabled: boolean;
    trackName: string;
    volume: number;
  };
  captions: {
    enabled: boolean;
    fontFamily: string;
    fontSize: number;
    position: CaptionPosition;
  };
  extras: StyleExtra[];
  ffmpegVideoFilter: string;
  ffmpegAudioFilter: string;
}

export interface StyleLibrary {
  activeId: string;
  presets: ShortStylePreset[];
}

export const CAPTION_FONTS = [
  "Segoe UI",
  "Arial",
  "Georgia",
  "Impact",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
] as const;

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function region(partial?: Partial<BlurRegion>): BlurRegion {
  return {
    x: clamp(partial?.x ?? 8, 0, 100),
    y: clamp(partial?.y ?? 70, 0, 100),
    width: clamp(partial?.width ?? 84, 1, 100),
    height: clamp(partial?.height ?? 18, 1, 100),
  };
}

function extra(id: string, label: string, kind: ExtraKind, enabled: boolean, value: string): StyleExtra {
  return { id, label, kind, enabled, value };
}

function preset(
  input: Omit<ShortStylePreset, "blur" | "music" | "captions" | "extras"> & {
    blur?: Partial<ShortStylePreset["blur"]>;
    music?: Partial<ShortStylePreset["music"]>;
    captions?: Partial<ShortStylePreset["captions"]>;
    extras?: StyleExtra[];
  },
): ShortStylePreset {
  return {
    id: input.id,
    name: input.name,
    builtin: input.builtin,
    blur: {
      enabled: input.blur?.enabled ?? true,
      target: input.blur?.target ?? "background",
      strength: clamp(input.blur?.strength ?? 20, 0, 40),
      region: region(input.blur?.region),
    },
    music: {
      enabled: input.music?.enabled ?? false,
      trackName: input.music?.trackName ?? "",
      volume: clamp(input.music?.volume ?? 25, 0, 100),
    },
    captions: {
      enabled: input.captions?.enabled ?? true,
      fontFamily: input.captions?.fontFamily || "Segoe UI",
      fontSize: clamp(input.captions?.fontSize ?? 48, 12, 120),
      position: input.captions?.position ?? "bottom",
    },
    extras: input.extras ?? [],
    ffmpegVideoFilter: input.ffmpegVideoFilter ?? "",
    ffmpegAudioFilter: input.ffmpegAudioFilter ?? "",
  };
}

export function createBuiltinPresets(): ShortStylePreset[] {
  const margin = extra("safe-margin", "Margem de segurança", "number", true, "48");
  const hook = extra("hook-text", "Texto de gancho", "text", false, "");
  return [
    preset({
      id: "classic",
      name: "Clássico",
      builtin: true,
      blur: { enabled: true, target: "background", strength: 20 },
      captions: { enabled: true, fontFamily: "Segoe UI", fontSize: 48, position: "bottom" },
      extras: [margin, hook],
      ffmpegVideoFilter: "",
      ffmpegAudioFilter: "",
    }),
    preset({
      id: "caption-top",
      name: "Legenda no topo",
      builtin: true,
      blur: { enabled: true, target: "top", strength: 16 },
      captions: { enabled: true, fontFamily: "Arial", fontSize: 44, position: "top" },
      extras: [extra("safe-margin", "Margem de segurança", "number", true, "64"), hook],
      ffmpegVideoFilter: "",
      ffmpegAudioFilter: "",
    }),
    preset({
      id: "no-caption",
      name: "Sem legenda",
      builtin: true,
      blur: { enabled: true, target: "background", strength: 18 },
      captions: { enabled: false, fontFamily: "Segoe UI", fontSize: 42, position: "bottom" },
      music: { enabled: false, trackName: "", volume: 20 },
      extras: [margin],
      ffmpegVideoFilter: "",
      ffmpegAudioFilter: "",
    }),
    preset({
      id: "cinematic",
      name: "Cinemático",
      builtin: true,
      blur: { enabled: true, target: "background", strength: 28 },
      music: { enabled: true, trackName: "", volume: 18 },
      captions: { enabled: true, fontFamily: "Georgia", fontSize: 36, position: "bottom" },
      extras: [
        extra("safe-margin", "Margem de segurança", "number", true, "72"),
        extra("letterbox", "Faixa superior e inferior", "toggle", true, ""),
        hook,
      ],
      ffmpegVideoFilter: "",
      ffmpegAudioFilter: "",
    }),
    preset({
      id: "clean",
      name: "Limpo",
      builtin: true,
      blur: { enabled: false, target: "background", strength: 0 },
      music: { enabled: false, trackName: "", volume: 0 },
      captions: { enabled: false, fontFamily: "Segoe UI", fontSize: 40, position: "center" },
      extras: [],
      ffmpegVideoFilter: "",
      ffmpegAudioFilter: "",
    }),
  ];
}

export function defaultStyleLibrary(): StyleLibrary {
  const presets = createBuiltinPresets();
  return { activeId: presets[0]?.id ?? "classic", presets };
}

export function blankStylePreset(name = "Novo preset"): ShortStylePreset {
  return preset({
    id: `custom-${Date.now()}`,
    name,
    builtin: false,
    blur: { enabled: false, target: "background", strength: 12 },
    music: { enabled: false, trackName: "", volume: 30 },
    captions: { enabled: true, fontFamily: "Segoe UI", fontSize: 42, position: "bottom" },
    extras: [],
    ffmpegVideoFilter: "",
    ffmpegAudioFilter: "",
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function normalizeExtra(value: unknown, index: number): StyleExtra | null {
  const record = asRecord(value);
  if (!record) return null;
  const kind: ExtraKind =
    record.kind === "text" || record.kind === "number" || record.kind === "toggle"
      ? record.kind
      : "text";
  const label = String(record.label ?? "").trim() || `Opção ${index + 1}`;
  const id = String(record.id ?? "").trim() || `extra-${index + 1}`;
  return {
    id,
    label,
    kind,
    enabled: Boolean(record.enabled),
    value: String(record.value ?? ""),
  };
}

function normalizePreset(value: unknown, index: number): ShortStylePreset | null {
  const record = asRecord(value);
  if (!record) return null;
  const blur = asRecord(record.blur);
  const music = asRecord(record.music);
  const captions = asRecord(record.captions);
  const target: BlurTarget =
    blur?.target === "top" || blur?.target === "bottom" || blur?.target === "custom"
      ? blur.target
      : "background";
  const position: CaptionPosition =
    captions?.position === "top" || captions?.position === "center" || captions?.position === "bottom"
      ? captions.position
      : "bottom";
  const extras = Array.isArray(record.extras)
    ? record.extras
        .map((item, extraIndex) => normalizeExtra(item, extraIndex))
        .filter((item): item is StyleExtra => Boolean(item))
    : [];
  const id = String(record.id ?? "").trim() || `preset-${index + 1}`;
  return preset({
    id,
    name: String(record.name ?? "").trim() || `Preset ${index + 1}`,
    builtin: Boolean(record.builtin),
    blur: {
      enabled: blur ? Boolean(blur.enabled) : true,
      target,
      strength: clamp(Number(blur?.strength ?? 20), 0, 40),
      region: region(asRecord(blur?.region) as Partial<BlurRegion> | undefined),
    },
    music: {
      enabled: Boolean(music?.enabled),
      trackName: String(music?.trackName ?? ""),
      volume: clamp(Number(music?.volume ?? 25), 0, 100),
    },
    captions: {
      enabled: captions ? Boolean(captions.enabled) : true,
      fontFamily: String(captions?.fontFamily ?? "Segoe UI") || "Segoe UI",
      fontSize: clamp(Number(captions?.fontSize ?? 48), 12, 120),
      position,
    },
    extras,
    ffmpegVideoFilter: String(record.ffmpegVideoFilter ?? ""),
    ffmpegAudioFilter: String(record.ffmpegAudioFilter ?? ""),
  });
}

export function normalizeStyleLibrary(value: unknown): StyleLibrary {
  const record = asRecord(value);
  const incoming = Array.isArray(record?.presets) ? record.presets : [];
  const normalized = incoming
    .map((item, index) => normalizePreset(item, index))
    .filter((item): item is ShortStylePreset => Boolean(item));

  const byId = new Map<string, ShortStylePreset>();
  for (const item of normalized) {
    if (!byId.has(item.id)) byId.set(item.id, item);
  }

  const merged: ShortStylePreset[] = [];
  for (const builtin of createBuiltinPresets()) {
    merged.push(byId.get(builtin.id) ?? builtin);
    byId.delete(builtin.id);
  }
  for (const custom of byId.values()) {
    if (!custom.builtin) merged.push(custom);
  }

  const requested = String(record?.activeId ?? "");
  const activeId = merged.some((item) => item.id === requested)
    ? requested
    : (merged[0]?.id ?? "classic");

  return { activeId, presets: merged };
}
