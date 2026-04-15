/**
 * Register config info routes.
 */

import type { FastifyInstance } from "fastify";
import { loadActiveToolConfigs } from "../../core/toolConfigs";

type OllamaCatalogEntry = {
  name: string;
  model: string;
  source: "cloud" | "local";
  installed: boolean;
  running: boolean;
  needsDownload: boolean;
  size?: number;
};

export function registerConfigInfoRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () => {
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
  });

  fastify.get("/ollama-models", async () => {
    const configs = loadActiveToolConfigs();
    const configuredModel = String(configs.llm.model || "").trim();
    const normalizeName = (value: unknown) => String(value || "").trim();

    const localTagsPromise = fetch("http://localhost:11434/api/tags", {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    const runningPromise = fetch("http://localhost:11434/api/ps", {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    const remoteCatalogPromise = fetch("https://ollama.com/api/tags", {
      method: "GET",
      signal: AbortSignal.timeout(5000),
    });

    const [localTagsResult, runningResult, remoteCatalogResult] = await Promise.allSettled([
      localTagsPromise,
      runningPromise,
      remoteCatalogPromise,
    ]);

    const catalogMap = new Map<string, OllamaCatalogEntry>();
    const localInstalled = new Set<string>();
    const localRunning = new Set<string>();

    if (localTagsResult.status === "fulfilled" && localTagsResult.value.ok) {
      try {
        const payload = (await localTagsResult.value.json()) as {
          models?: Array<{ name?: string; model?: string; size?: number }>;
        };

        for (const model of payload.models || []) {
          const modelName = normalizeName(model?.name || model?.model);
          if (!modelName) {
            continue;
          }

          localInstalled.add(modelName);
          catalogMap.set(modelName, {
            name: modelName,
            model: modelName,
            source: "local",
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
        const payload = (await runningResult.value.json()) as {
          models?: Array<{ name?: string; model?: string }>;
        };

        for (const model of payload.models || []) {
          const modelName = normalizeName(model?.name || model?.model);
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

    if (remoteCatalogResult.status === "fulfilled" && remoteCatalogResult.value.ok) {
      try {
        const payload = (await remoteCatalogResult.value.json()) as {
          models?: Array<{ name?: string; model?: string; size?: number }>;
        };

        for (const model of payload.models || []) {
          const modelName = normalizeName(model?.name || model?.model);
          if (!modelName) {
            continue;
          }

          const installed = localInstalled.has(modelName);
          const running = localRunning.has(modelName);

          const existing = catalogMap.get(modelName);
          if (existing) {
            existing.size =
              existing.size ?? (typeof model?.size === "number" ? model.size : undefined);
            existing.running = existing.running || running;
            existing.installed = existing.installed || installed;
            existing.needsDownload = !existing.installed;
            existing.source = existing.installed || existing.running ? "local" : "cloud";
            continue;
          }

          catalogMap.set(modelName, {
            name: modelName,
            model: modelName,
            source: installed || running ? "local" : "cloud",
            installed,
            running,
            needsDownload: !(installed || running),
            size: typeof model?.size === "number" ? model.size : undefined,
          });
        }
      } catch {
        // ignore malformed remote payload
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
      remoteAvailable: remoteCatalogResult.status === "fulfilled" && remoteCatalogResult.value.ok,
    };
  });
}
