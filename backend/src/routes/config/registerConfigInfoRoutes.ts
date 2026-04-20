/**
 * Register config info routes.
 */

import type { FastifyInstance } from "fastify";
import { spawn } from "child_process";
import { config } from "../../core/config";
import {
  loadActiveToolConfigs,
  updateToolConfigs,
  type LlmRegisteredModel,
} from "../../core/toolConfigs";

type OllamaCatalogEntry = {
  name: string;
  model: string;
  source: "cloud" | "local";
  installed: boolean;
  running: boolean;
  needsDownload: boolean;
  size?: number;
};

type OllamaCommandResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  errorMessage?: string;
};

function normalizeModelName(value: unknown): string {
  return String(value || "").trim();
}

function normalizeRegisteredModels(value: unknown): LlmRegisteredModel[] {
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

async function runOllamaCommand(
  args: string[],
  timeoutMs = 15 * 60 * 1000,
): Promise<OllamaCommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;

    const child = spawn("ollama", args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      child.kill();
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    });

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: false,
        code: null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        errorMessage: error.message,
      });
    });

    child.on("close", (code) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        ok: code === 0,
        code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function testOllamaModel(
  model: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const isCloudModel = model.endsWith("-cloud");

  try {
    const baseUrl = config.OLLAMA_BASE_URL.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.OLLAMA_API_KEY ? { Authorization: `Bearer ${config.OLLAMA_API_KEY}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Responda apenas com: ok" }],
        stream: false,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).trim();

      if (response.status === 401 || response.status === 403) {
        if (isCloudModel) {
          return {
            ok: false,
            error:
              "Autenticação necessária para usar modelo cloud. Faça login com 'ollama signin' ou configure OLLAMA_API_KEY.",
          };
        }

        return {
          ok: false,
          error: "Ollama rejeitou a autenticação da requisição. Verifique suas credenciais.",
        };
      }

      if (response.status === 404) {
        return {
          ok: false,
          error: `Modelo '${model}' não encontrado. Verifique o nome ou baixe localmente com 'ollama pull ${model}'.`,
        };
      }

      if (response.status === 429) {
        return {
          ok: false,
          error:
            "Limite de requisições no Ollama (429). Aguarde alguns instantes e tente novamente.",
        };
      }

      return {
        ok: false,
        error: `Teste do modelo falhou (${response.status}). ${detail || "Sem detalhes"}`,
      };
    }

    const payload = (await response.json()) as {
      message?: { content?: unknown };
      response?: unknown;
    };

    const content = String(payload.message?.content || payload.response || "").trim();
    if (!content) {
      return {
        ok: false,
        error: "O modelo respondeu sem conteúdo no teste.",
      };
    }

    return { ok: true, content };
  } catch (error: any) {
    const message = String(error?.message || "");

    if (/timed out|timeout/i.test(message)) {
      return {
        ok: false,
        error: "Tempo limite ao testar o modelo no Ollama. Tente novamente em alguns instantes.",
      };
    }

    if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
      return {
        ok: false,
        error:
          "Não foi possível conectar ao Ollama. Verifique se o serviço está em execução e acessível.",
      };
    }

    return {
      ok: false,
      error: message || "Falha ao testar o modelo.",
    };
  }
}

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
  });

  fastify.post("/ollama-models/register", async (request: any, reply) => {
    const body = (request.body || {}) as { name?: unknown; source?: unknown };
    const rawName = normalizeModelName(body.name);
    const sourceRaw = String(body.source || "").trim();

    if (!rawName) {
      return reply.code(400).send({ detail: "O nome do modelo é obrigatório." });
    }

    if (sourceRaw !== "cloud" && sourceRaw !== "local") {
      return reply.code(400).send({ detail: "A origem do modelo deve ser cloud ou local." });
    }

    const source: "cloud" | "local" = sourceRaw;

    let resolvedModelName = rawName;

    if (source === "local") {
      const pull = await runOllamaCommand(["pull", rawName]);
      if (!pull.ok) {
        return reply.code(400).send({
          detail:
            `Falha ao baixar o modelo '${rawName}'. ${pull.stderr || pull.stdout || pull.errorMessage || ""}`.trim(),
        });
      }
    }

    const candidates =
      source === "cloud" && !rawName.endsWith("-cloud") ? [rawName, `${rawName}-cloud`] : [rawName];

    let lastError = "Falha ao verificar o modelo.";
    let verified = false;

    for (const candidate of candidates) {
      const testResult = await testOllamaModel(candidate);
      if (testResult.ok) {
        verified = true;
        resolvedModelName = candidate;
        break;
      }
      lastError = testResult.error;
    }

    if (!verified) {
      return reply.code(400).send({ detail: lastError });
    }

    const active = loadActiveToolConfigs();
    const current = normalizeRegisteredModels(active.llm.registered_models);
    const filtered = current.filter(
      (item) => item.name.toLowerCase() !== resolvedModelName.toLowerCase(),
    );
    filtered.push({ name: resolvedModelName, source });

    const updated = updateToolConfigs({
      llm: {
        model: active.llm.model,
        system_prompt: active.llm.system_prompt,
        registered_models: filtered,
      },
    });

    return {
      success: true,
      message: "Modelo cadastrado e verificado com sucesso.",
      model: {
        name: resolvedModelName,
        source,
      },
      configuredModel: updated.llm.model,
    };
  });

  fastify.delete("/ollama-models/:modelName", async (request: any, reply) => {
    const modelName = normalizeModelName(
      decodeURIComponent(String(request.params?.modelName || "")),
    );

    if (!modelName) {
      return reply.code(400).send({ detail: "Nome do modelo inválido." });
    }

    const active = loadActiveToolConfigs();
    const current = normalizeRegisteredModels(active.llm.registered_models);
    const remaining = current.filter((item) => item.name.toLowerCase() !== modelName.toLowerCase());

    updateToolConfigs({
      llm: {
        model: active.llm.model,
        system_prompt: active.llm.system_prompt,
        registered_models: remaining,
      },
    });

    const rmResult = await runOllamaCommand(["rm", modelName], 180000);
    const rmMessage = rmResult.ok
      ? `Modelo '${modelName}' removido do Ollama local.`
      : `Cadastro removido. Não foi possível remover no Ollama local: ${rmResult.stderr || rmResult.stdout || rmResult.errorMessage || "sem detalhes"}`;

    return {
      success: true,
      message: rmMessage,
      removedModel: modelName,
      removedFromLocal: rmResult.ok,
    };
  });
}
