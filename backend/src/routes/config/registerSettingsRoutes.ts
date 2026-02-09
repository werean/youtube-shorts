/**
 * Register settings routes.
 */

import type { FastifyInstance } from "fastify";
import * as fs from "fs";
import { loadSettings, updateSettings } from "../../core/settings";
import type { AppSettings } from "../../core/settings";

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
      console.log(`[config] Atualizando settings:`, body);

      if (body.media?.base_dir) {
        const baseDir = body.media.base_dir;
        if (!fs.existsSync(baseDir)) {
          console.log(`[config] Criando diretório: ${baseDir}`);
          fs.mkdirSync(baseDir, { recursive: true });
        }
      }

      const updatedSettings = updateSettings(body);
      console.log(`[config] ✓ Settings atualizadas`);
      return updatedSettings;
    } catch (error: any) {
      console.error(`[config] ✗ Erro ao atualizar settings:`, error.message);
      reply.code(500).send({ detail: error.message });
    }
  });
}
