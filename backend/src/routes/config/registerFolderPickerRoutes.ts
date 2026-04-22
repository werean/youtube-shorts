/**
 * Register folder picker routes.
 */

import type { FastifyInstance } from "fastify";
import { selectFolderWithSystemPicker } from "../../features/config/folders/folderPicker";

export function registerFolderPickerRoutes(fastify: FastifyInstance) {
  fastify.post("/select-folder", async (request, reply) => {
    try {
      return selectFolderWithSystemPicker();
    } catch (error: any) {
      console.error(`[config] ✗ Erro ao abrir seletor de pasta:`, error.message);
      reply.code(500).send({ detail: error.message });
    }
  });
}
