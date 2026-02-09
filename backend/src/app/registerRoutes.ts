/**
 * Register API routes.
 */

import type { FastifyInstance } from "fastify";
import healthRoutes from "../routes/healthRoutes";
import jobsRoutes from "../routes/jobs";
import videosRoutes from "../routes/videosRoutes";
import mediaRoutes from "../routes/mediaRoutes";
import configRoutes from "../routes/configRoutes";

export async function registerRoutes(fastify: FastifyInstance) {
  await fastify.register(healthRoutes);
  await fastify.register(jobsRoutes, { prefix: "/jobs" });
  await fastify.register(videosRoutes);
  await fastify.register(mediaRoutes);
  await fastify.register(configRoutes, { prefix: "/config" });
}
