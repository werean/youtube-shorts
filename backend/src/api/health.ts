/**
 * API endpoints for health and readiness checks.
 */

import { FastifyPluginAsync } from "fastify";

const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async (request, reply) => {
    return { status: "ok" };
  });
};

export default healthRoutes;
