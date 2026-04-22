/**
 * Register LLM prompt routes.
 */

import type { FastifyInstance } from "fastify";
import { loadActiveToolConfigs } from "../../core/toolConfigs";
import { loadSavedPrompts, upsertSavedPrompt } from "../../features/config/prompts/savedPrompts";
import { PROMPT_VERSION, SYSTEM_PROMPT_TEMPLATE } from "../../llm/prompts";
import {
  parseSavePromptRequest,
  type SavePromptRequestDto,
  type SavePromptResponseDto,
} from "../contracts/configContracts";
import type { ErrorDetailResponseDto } from "../contracts/jobContracts";

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

  fastify.post<{
    Body: SavePromptRequestDto;
    Reply: SavePromptResponseDto | ErrorDetailResponseDto;
  }>("/llm-saved-prompts", async (request, reply) => {
    try {
      const { name, prompt } = parseSavePromptRequest(request.body);

      if (!name) {
        return reply.code(400).send({ detail: "Nome do prompt é obrigatório." });
      }

      if (!prompt) {
        return reply.code(400).send({ detail: "Prompt não pode estar vazio." });
      }

      return upsertSavedPrompt(name, prompt);
    } catch (error: any) {
      return reply.code(500).send({ detail: String(error?.message || "Erro ao salvar prompt.") });
    }
  });
}
