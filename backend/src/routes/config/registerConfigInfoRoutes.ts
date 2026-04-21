/**
 * Register config info routes.
 */

import type { FastifyInstance } from "fastify";
import {
  deleteOllamaModel,
  getConfigInfoSummary,
  getOllamaModelsPayload,
  registerOllamaModel,
} from "../../config/ollama/models";

export function registerConfigInfoRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () => {
    return getConfigInfoSummary();
  });

  fastify.get("/ollama-models", async () => {
    return getOllamaModelsPayload();
  });

  fastify.post("/ollama-models/register", async (request: any, reply) => {
    const body = (request.body || {}) as { name?: unknown; source?: unknown };
    const result = await registerOllamaModel(body.name, body.source);
    return reply.code(result.statusCode).send(result.payload);
  });

  fastify.delete("/ollama-models/:modelName", async (request: any, reply) => {
    const result = await deleteOllamaModel(request.params?.modelName);
    return reply.code(result.statusCode).send(result.payload);
  });
}
