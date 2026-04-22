/**
 * Register config info routes.
 */

import type { FastifyInstance } from "fastify";
import {
  deleteOllamaModel,
  getConfigInfoSummary,
  getOllamaModelsPayload,
  registerOllamaModel,
} from "../../features/config/ollama/models";
import {
  parseOllamaModelRegistrationRequest,
  type ConfigParamModelNameDto,
  type OllamaModelRegistrationRequestDto,
} from "../contracts/configContracts";

export function registerConfigInfoRoutes(fastify: FastifyInstance) {
  fastify.get("/", async () => {
    return getConfigInfoSummary();
  });

  fastify.get("/ollama-models", async () => {
    return getOllamaModelsPayload();
  });

  fastify.post<{ Body: OllamaModelRegistrationRequestDto }>(
    "/ollama-models/register",
    async (request, reply) => {
      const body = parseOllamaModelRegistrationRequest(request.body);
      const result = await registerOllamaModel(body.name, body.source);
      return reply.code(result.statusCode).send(result.payload);
    },
  );

  fastify.delete<{ Params: ConfigParamModelNameDto }>(
    "/ollama-models/:modelName",
    async (request, reply) => {
      const result = await deleteOllamaModel(request.params?.modelName);
      return reply.code(result.statusCode).send(result.payload);
    },
  );
}
