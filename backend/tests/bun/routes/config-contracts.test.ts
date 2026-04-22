import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AddressInfo } from "net";
import type { FastifyInstance } from "fastify";

import { createServer } from "../../../src/app/createServer";

const { registerConfigInfoRoutes } = await import(
  "../../../src/routes/config/registerConfigInfoRoutes"
);
const { registerPromptRoutes } = await import("../../../src/routes/config/registerPromptRoutes");
const { registerToolConfigsRoutes } = await import(
  "../../../src/routes/config/registerToolConfigsRoutes"
);

let app: FastifyInstance;

function baseUrl(): string {
  const address = app.server.address();
  if (!address || typeof address === "string") {
    throw new Error("Fastify test server is not listening on a TCP port");
  }

  return `http://127.0.0.1:${(address as AddressInfo).port}`;
}

async function request(
  method: "POST",
  routePath: string,
  payload?: unknown,
): Promise<{ statusCode: number; body: unknown }> {
  const response = await fetch(`${baseUrl()}${routePath}`, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });

  return {
    statusCode: response.status,
    body: await response.json(),
  };
}

describe("config route contracts", () => {
  beforeEach(async () => {
    app = createServer();
    registerPromptRoutes(app);
    registerConfigInfoRoutes(app);
    registerToolConfigsRoutes(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    await app.close();
  });

  test("saved prompt validation keeps the existing 400 response shapes", async () => {
    expect(await request("POST", "/llm-saved-prompts", {})).toEqual({
      statusCode: 400,
      body: { detail: "Nome do prompt é obrigatório." },
    });

    expect(await request("POST", "/llm-saved-prompts", { name: "My prompt" })).toEqual({
      statusCode: 400,
      body: { detail: "Prompt não pode estar vazio." },
    });
  });

  test("Ollama model registration validation keeps the existing 400 response shapes", async () => {
    expect(await request("POST", "/ollama-models/register", {})).toEqual({
      statusCode: 400,
      body: { detail: "O nome do modelo é obrigatório." },
    });

    expect(
      await request("POST", "/ollama-models/register", { name: "model", source: "remote" }),
    ).toEqual({
      statusCode: 400,
      body: { detail: "A origem do modelo deve ser cloud ou local." },
    });
  });

  test("tool config section validation keeps the existing 400 response shape", async () => {
    expect(await request("POST", "/tool-configs/reset/not-real")).toEqual({
      statusCode: 400,
      body: { detail: "Invalid section" },
    });
  });
});
