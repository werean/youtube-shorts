import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";

import { createServer } from "../../../src/app/createServer";
import { registerDependenciesRoutes } from "../../../src/routes/config/registerDependenciesRoutes";

describe("Integration: dependencies routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = createServer();
    registerDependenciesRoutes(app);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns 404 for unknown dependency instructions", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/dependencies/not-real/instructions",
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ error: "Dependency not found" });
  });

  it("returns 400 when installing pytorch without gpu tier", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/dependencies/pytorch/install",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false });
  });

  it("returns 400 when starting pytorch install without gpu tier", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/dependencies/pytorch/install/start",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false });
  });

  it("returns 400 when opening terminal for pytorch install without gpu tier", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/dependencies/pytorch/open-terminal",
      payload: { mode: "install" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ success: false });
  });
});
