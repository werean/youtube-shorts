/**
 * Register config info routes.
 */

import type { FastifyInstance } from "fastify";
import { loadActiveToolConfigs } from "../../core/toolConfigs";

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
}
