import type { LlmRegisteredModel } from "../../core/toolConfigs";

export function normalizeModelName(value: unknown): string {
  return String(value || "").trim();
}

export function normalizeRegisteredModels(value: unknown): LlmRegisteredModel[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const models: LlmRegisteredModel[] = [];

  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue;
    }

    const candidate = item as { name?: unknown; source?: unknown };
    const name = normalizeModelName(candidate.name);
    if (!name) {
      continue;
    }

    const key = name.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    models.push({
      name,
      source: candidate.source === "local" ? "local" : "cloud",
    });
  }

  return models;
}
