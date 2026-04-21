import { loadActiveToolConfigs, updateToolConfigs } from "../../core/toolConfigs";
import { runOllamaCommand } from "./commands";
import { normalizeModelName, normalizeRegisteredModels } from "./normalization";
import type { OllamaRouteResult } from "./types";
import { testOllamaModel } from "./verifier";

export async function registerOllamaModel(
  name: unknown,
  sourceValue: unknown,
): Promise<OllamaRouteResult> {
  const rawName = normalizeModelName(name);
  const sourceRaw = String(sourceValue || "").trim();

  if (!rawName) {
    return { statusCode: 400, payload: { detail: "O nome do modelo é obrigatório." } };
  }

  if (sourceRaw !== "cloud" && sourceRaw !== "local") {
    return { statusCode: 400, payload: { detail: "A origem do modelo deve ser cloud ou local." } };
  }

  const source: "cloud" | "local" = sourceRaw;

  let resolvedModelName = rawName;

  if (source === "local") {
    const pull = await runOllamaCommand(["pull", rawName]);
    if (!pull.ok) {
      return {
        statusCode: 400,
        payload: {
          detail:
            `Falha ao baixar o modelo '${rawName}'. ${pull.stderr || pull.stdout || pull.errorMessage || ""}`.trim(),
        },
      };
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
    return { statusCode: 400, payload: { detail: lastError } };
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
    statusCode: 200,
    payload: {
      success: true,
      message: "Modelo cadastrado e verificado com sucesso.",
      model: {
        name: resolvedModelName,
        source,
      },
      configuredModel: updated.llm.model,
    },
  };
}

export async function deleteOllamaModel(modelNameValue: unknown): Promise<OllamaRouteResult> {
  const modelName = normalizeModelName(decodeURIComponent(String(modelNameValue || "")));

  if (!modelName) {
    return { statusCode: 400, payload: { detail: "Nome do modelo inválido." } };
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
    statusCode: 200,
    payload: {
      success: true,
      message: rmMessage,
      removedModel: modelName,
      removedFromLocal: rmResult.ok,
    },
  };
}
