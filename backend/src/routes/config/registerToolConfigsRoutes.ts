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
} from "../../features/config/toolConfigs/toolConfigOperations";
import type {
  ToolConfigSectionParamsDto,
  ToolConfigsUpdateRequestDto,
} from "../contracts/configContracts";

export function registerToolConfigsRoutes(fastify: FastifyInstance) {
  fastify.get("/tool-configs", async (request, reply) => {
    try {
      return getToolConfigsPayload();
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post<{ Body: ToolConfigsUpdateRequestDto }>("/tool-configs", async (request, reply) => {
    try {
      return updateToolConfigsPayload(request.body);
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

  fastify.post<{ Params: ToolConfigSectionParamsDto }>(
    "/tool-configs/reset/:section",
    async (request, reply) => {
      try {
        const section = String(request.params.section || "");
        if (!section || !isResettableToolConfigSection(section)) {
          return reply.code(400).send({ detail: "Invalid section" });
        }
        return resetToolConfigSectionPayload(section);
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );

  fastify.post<{ Body: ToolConfigsUpdateRequestDto }>(
    "/tool-configs/import",
    async (request, reply) => {
      try {
        return importToolConfigsPayload(request.body);
      } catch (error: any) {
        reply.code(500).send({ detail: error.message });
      }
    },
  );
}
