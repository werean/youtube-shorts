/**
 * Register common folders routes.
 */

import type { FastifyInstance } from "fastify";
import { getCommonFolders } from "../../features/config/folders/commonFolders";

export function registerCommonFoldersRoutes(fastify: FastifyInstance) {
  fastify.get("/common-folders", async (request, reply) => {
    try {
      return getCommonFolders();
    } catch (error: any) {
      reply.code(500).send({ detail: error.message });
    }
  });
}
