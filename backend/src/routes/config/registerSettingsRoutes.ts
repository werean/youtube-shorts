/**
 * Register settings routes.
 */

import type { FastifyInstance } from "fastify";
import {
  getAppSettings,
  updateAppSettings,
} from "../../features/config/settings/settingsOperations";
import type { SettingsUpdateRequestDto } from "../contracts/configContracts";

export function registerSettingsRoutes(fastify: FastifyInstance) {
  fastify.get("/settings", async (request, reply) => {
    try {
      return getAppSettings();
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });

  fastify.post<{ Body: SettingsUpdateRequestDto }>("/settings", async (request, reply) => {
    try {
      return updateAppSettings(request.body);
    } catch (error: any) {
      console.error(`[config] ✗ Erro ao atualizar settings:`, error.message);
      reply.code(500).send({ detail: error.message });
    }
  });
}
