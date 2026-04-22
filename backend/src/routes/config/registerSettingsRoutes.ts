/**
 * Register settings routes.
 */

import type { FastifyInstance } from "fastify";
import { loadSettings } from "../../core/settings";
import type { AppSettings } from "../../core/settings";
import { updateAppSettings } from "../../features/config/settings/settingsUpdate";

export function registerSettingsRoutes(fastify: FastifyInstance) {
  fastify.get("/settings", async (request, reply) => {
    try {
      const settings = loadSettings();
      return settings;
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post("/settings", async (request: any, reply) => {
    try {
      const body = request.body as Partial<AppSettings>;
      return updateAppSettings(body);
    } catch (error: any) {
      console.error(`[config] ✗ Erro ao atualizar settings:`, error.message);
      reply.code(500).send({ detail: error.message });
    }
  });
}
