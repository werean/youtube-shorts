import * as fs from "fs";
import * as path from "path";

import { dataDir } from "../../core/paths";

export type SavedLlmPrompt = {
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

export function loadSavedPrompts(): SavedLlmPrompt[] {
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

export function upsertSavedPrompt(name: string, prompt: string): { prompts: SavedLlmPrompt[] } {
  const now = new Date().toISOString();
  const prompts = loadSavedPrompts();
  const existingIndex = prompts.findIndex((item) => item.name.toLowerCase() === name.toLowerCase());

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
}
