/**
 * Register LLM prompt routes.
 */

import * as fs from "fs";
import * as path from "path";
import type { FastifyInstance } from "fastify";
import { dataDir } from "../../core/paths";
import { loadActiveToolConfigs } from "../../core/toolConfigs";
import { PROMPT_VERSION, SYSTEM_PROMPT_TEMPLATE } from "../../llm/prompts";

type SavedLlmPrompt = {
  id: string;
  name: string;
  prompt: string;
  created_at: string;
  updated_at: string;
};

const SAVED_LLM_PROMPTS_FILE = path.join(dataDir(), "saved_llm_prompts.json");

function ensureSavedPromptsFile(): void {
  const directory = path.dirname(SAVED_LLM_PROMPTS_FILE);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }

  if (!fs.existsSync(SAVED_LLM_PROMPTS_FILE)) {
    fs.writeFileSync(SAVED_LLM_PROMPTS_FILE, "[]\n", "utf-8");
  }
}

function loadSavedPrompts(): SavedLlmPrompt[] {
  ensureSavedPromptsFile();

  try {
    const raw = fs.readFileSync(SAVED_LLM_PROMPTS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item): SavedLlmPrompt | null => {
        if (!item || typeof item !== "object") {
          return null;
        }

        const candidate = item as Record<string, unknown>;
        const id = String(candidate.id || "").trim();
        const name = String(candidate.name || "").trim();
        const prompt = String(candidate.prompt || "");
        const createdAt = String(candidate.created_at || "").trim();
        const updatedAt = String(candidate.updated_at || "").trim();

        if (!id || !name || !prompt) {
          return null;
        }

        const now = new Date().toISOString();
        return {
          id,
          name,
          prompt,
          created_at: createdAt || now,
          updated_at: updatedAt || createdAt || now,
        };
      })
      .filter((item): item is SavedLlmPrompt => item !== null)
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  } catch {
    return [];
  }
}

function saveSavedPrompts(prompts: SavedLlmPrompt[]): void {
  ensureSavedPromptsFile();
  fs.writeFileSync(SAVED_LLM_PROMPTS_FILE, `${JSON.stringify(prompts, null, 2)}\n`, "utf-8");
}

function generatePromptId(): string {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function registerPromptRoutes(fastify: FastifyInstance) {
  fastify.get("/llm-prompt", async () => {
    const configs = loadActiveToolConfigs();
    return {
      prompt: configs.llm.system_prompt,
      version: PROMPT_VERSION,
    };
  });

  fastify.get("/llm-prompt/default", async () => {
    return {
      prompt: SYSTEM_PROMPT_TEMPLATE,
      version: PROMPT_VERSION,
    };
  });

  fastify.get("/llm-saved-prompts", async () => {
    const prompts = loadSavedPrompts().map((item) => ({
      id: item.id,
      name: item.name,
      prompt: item.prompt,
      created_at: item.created_at,
      updated_at: item.updated_at,
    }));

    return { prompts };
  });

  fastify.post("/llm-saved-prompts", async (request: any, reply) => {
    try {
      const body = (request.body || {}) as { name?: unknown; prompt?: unknown };
      const name = String(body.name || "").trim();
      const prompt = String(body.prompt || "").trim();

      if (!name) {
        return reply.code(400).send({ detail: "Nome do prompt é obrigatório." });
      }

      if (!prompt) {
        return reply.code(400).send({ detail: "Prompt não pode estar vazio." });
      }

      const now = new Date().toISOString();
      const prompts = loadSavedPrompts();
      const existingIndex = prompts.findIndex(
        (item) => item.name.toLowerCase() === name.toLowerCase(),
      );

      if (existingIndex >= 0) {
        prompts[existingIndex] = {
          ...prompts[existingIndex],
          name,
          prompt,
          updated_at: now,
        };
      } else {
        prompts.unshift({
          id: generatePromptId(),
          name,
          prompt,
          created_at: now,
          updated_at: now,
        });
      }

      saveSavedPrompts(prompts);
      return { prompts: loadSavedPrompts() };
    } catch (error: any) {
      return reply.code(500).send({ detail: String(error?.message || "Erro ao salvar prompt.") });
    }
  });
}
