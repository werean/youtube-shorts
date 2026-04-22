/**
 * Register tool configuration routes (Whisper, FFmpeg, LLM).
 */

import type { FastifyInstance } from "fastify";
import {
  getToolConfigsPayload,
  importToolConfigsPayload,
  isResettableToolConfigSection,
  resetAllToolConfigsPayload,
  resetToolConfigSectionPayload,
  updateToolConfigsPayload,
  type ToolConfigs,
} from "../../features/config/toolConfigs/toolConfigOperations";

export function registerToolConfigsRoutes(fastify: FastifyInstance) {
  fastify.get("/tool-configs", async (request, reply) => {
    try {
      return getToolConfigsPayload();
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post("/tool-configs", async (request: any, reply) => {
    try {
      const body = request.body as Partial<ToolConfigs>;
      return updateToolConfigsPayload(body);
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post("/tool-configs/reset", async (request, reply) => {
    try {
      return resetAllToolConfigsPayload();
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post("/tool-configs/reset/:section", async (request: any, reply) => {
    try {
      const section = String(request.params.section || "");
      if (!section || !isResettableToolConfigSection(section)) {
        return reply.code(400).send({ detail: "Invalid section" });
      }
      return resetToolConfigSectionPayload(section);
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post("/tool-configs/import", async (request: any, reply) => {
    try {
      const body = request.body as Partial<ToolConfigs>;
      return importToolConfigsPayload(body);
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });
}
