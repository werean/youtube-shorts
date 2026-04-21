import { loadActiveToolConfigs, type LlmRegisteredModel } from "../../core/toolConfigs";
import { normalizeModelName, normalizeRegisteredModels } from "./normalization";
import type { OllamaCatalogEntry } from "./types";

export function getConfigInfoSummary() {
  const configs = loadActiveToolConfigs();
  return {
    whisper: {
      device: configs.whisper.device,
      formats: Array.isArray(configs.whisper.output_format)
        ? configs.whisper.output_format.join(",")
        : "",
    },
    llm: {
      model: configs.llm.model,
    },
  };
}

export async function getOllamaModelsPayload() {
  const configs = loadActiveToolConfigs();
  const configuredModel = normalizeModelName(configs.llm.model);
  const registeredModels = normalizeRegisteredModels(configs.llm.registered_models);

  const extractModelEntries = <T extends Record<string, unknown>>(payload: unknown): T[] => {
    if (!payload || typeof payload !== "object") {
      return [];
    }
    const container = payload as { models?: unknown; tags?: unknown };
    if (Array.isArray(container.models)) {
      return container.models.filter(Boolean) as T[];
    }
    if (Array.isArray(container.tags)) {
      return container.tags.filter(Boolean) as T[];
    }
    return [];
  };

  const fetchLocalEndpoint = async (path: "/api/tags" | "/api/ps") => {
    const bases = ["http://127.0.0.1:11434", "http://localhost:11434"];
    let lastError: unknown;

    for (const base of bases) {
      try {
        const response = await fetch(`${base}${path}`, {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        });
        if (response.ok) {
          return response;
        }
        lastError = new Error(`HTTP ${response.status} from ${base}${path}`);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`Failed to fetch ${path}`);
  };

  const localTagsPromise = fetchLocalEndpoint("/api/tags");
  const runningPromise = fetchLocalEndpoint("/api/ps");

  const [localTagsResult, runningResult] = await Promise.allSettled([
    localTagsPromise,
    runningPromise,
  ]);

  const catalogMap = new Map<string, OllamaCatalogEntry>();
  const localInstalled = new Set<string>();
  const localRunning = new Set<string>();
  const registeredByName = new Map<string, LlmRegisteredModel>();

  for (const item of registeredModels) {
    registeredByName.set(item.name.toLowerCase(), item);
    catalogMap.set(item.name, {
      name: item.name,
      model: item.name,
      source: item.source,
      installed: false,
      running: false,
      needsDownload: item.source === "local",
    });
  }

  if (localTagsResult.status === "fulfilled" && localTagsResult.value.ok) {
    try {
      const payload = (await localTagsResult.value.json()) as unknown;
      const models = extractModelEntries<{ name?: string; model?: string; size?: number }>(
        payload,
      );

      for (const model of models) {
        const modelName = normalizeModelName(model?.name || model?.model);
        if (!modelName) {
          continue;
        }

        localInstalled.add(modelName);
        const normalized = modelName.toLowerCase();
        const registered = registeredByName.get(normalized);
        catalogMap.set(modelName, {
          name: modelName,
          model: modelName,
          source: registered?.source || "local",
          installed: true,
          running: false,
          needsDownload: false,
          size: typeof model?.size === "number" ? model.size : undefined,
        });
      }
    } catch {
      // ignore malformed local payload
    }
  }

  if (runningResult.status === "fulfilled" && runningResult.value.ok) {
    try {
      const payload = (await runningResult.value.json()) as unknown;
      const models = extractModelEntries<{ name?: string; model?: string }>(payload);

      for (const model of models) {
        const modelName = normalizeModelName(model?.name || model?.model);
        if (!modelName) {
          continue;
        }

        localRunning.add(modelName);
        const existing = catalogMap.get(modelName);
        if (existing) {
          existing.running = true;
          existing.source = "local";
          existing.installed = true;
          existing.needsDownload = false;
        } else {
          catalogMap.set(modelName, {
            name: modelName,
            model: modelName,
            source: "local",
            installed: true,
            running: true,
            needsDownload: false,
          });
        }
      }
    } catch {
      // ignore malformed running payload
    }
  }

  if (configuredModel && !catalogMap.has(configuredModel)) {
    const installed = localInstalled.has(configuredModel);
    const running = localRunning.has(configuredModel);

    catalogMap.set(configuredModel, {
      name: configuredModel,
      model: configuredModel,
      source: installed || running ? "local" : "cloud",
      installed,
      running,
      needsDownload: !(installed || running),
    });
  }

  const catalog = Array.from(catalogMap.values()).sort((a, b) => {
    if (a.name === configuredModel) return -1;
    if (b.name === configuredModel) return 1;
    if (a.running !== b.running) return a.running ? -1 : 1;
    if (a.installed !== b.installed) return a.installed ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const models = catalog.map((entry) => entry.name);

  return {
    online: models.length > 0,
    configuredModel,
    models,
    catalog,
    localAvailable: localTagsResult.status === "fulfilled" && localTagsResult.value.ok,
    remoteAvailable: false,
  };
}
