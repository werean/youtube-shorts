/**
 * Register LLM prompt routes.
 */

import type { FastifyInstance } from "fastify";
import { loadActiveToolConfigs } from "../../core/toolConfigs";
import { PROMPT_VERSION } from "../../llm/prompts";

export function registerPromptRoutes(fastify: FastifyInstance) {
  fastify.get("/llm-prompt", async () => {
    const configs = loadActiveToolConfigs();
    return {
      prompt: configs.llm.system_prompt,
      version: PROMPT_VERSION,
    };
  });
}
