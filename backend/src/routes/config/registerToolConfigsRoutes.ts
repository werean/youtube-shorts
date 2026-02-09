/**
 * Register tool configuration routes (Whisper, FFmpeg, LLM).
 */

import type { FastifyInstance } from "fastify";
import {
  loadActiveToolConfigs,
  loadDefaultToolConfigs,
  resetAllToolConfigs,
  resetToolConfigSection,
  toolConfigsSource,
  updateToolConfigs,
  importToolConfigs,
} from "../../core/toolConfigs";
import type { ToolConfigs } from "../../core/toolConfigs";

export function registerToolConfigsRoutes(fastify: FastifyInstance) {
  fastify.get("/tool-configs", async (request, reply) => {
    try {
      const defaults = loadDefaultToolConfigs();
      const active = loadActiveToolConfigs();
      return { source: toolConfigsSource(), defaults, active };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post("/tool-configs", async (request: any, reply) => {
    try {
      const body = request.body as Partial<ToolConfigs>;
      const active = updateToolConfigs(body);
      return { source: toolConfigsSource(), active };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post("/tool-configs/reset", async (request, reply) => {
    try {
      const active = resetAllToolConfigs();
      return { source: toolConfigsSource(), active };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post("/tool-configs/reset/:section", async (request: any, reply) => {
    try {
      const section = String(request.params.section || "");
      if (!section || !["whisper", "ffmpeg", "llm"].includes(section)) {
        return reply.code(400).send({ detail: "Invalid section" });
      }
      const active = resetToolConfigSection(section as "whisper" | "ffmpeg" | "llm");
      return { source: toolConfigsSource(), active };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post("/tool-configs/import", async (request: any, reply) => {
    try {
      const body = request.body as Partial<ToolConfigs>;
      const active = importToolConfigs(body);
      return { source: toolConfigsSource(), active };
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });
}
