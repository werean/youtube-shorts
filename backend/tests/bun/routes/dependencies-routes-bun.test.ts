import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { EventEmitter } from "events";
import type { FastifyInstance } from "fastify";
import type { AddressInfo } from "net";
import { createServer } from "../../../src/app/createServer";

type SpawnSyncResult = {
  stdout?: string;
  stderr?: string;
  status?: number | null;
  error?: NodeJS.ErrnoException;
};

const originalFetch = globalThis.fetch;
const spawnCalls: Array<{ executable: string; args: string[] }> = [];

function ok(stdout = "", stderr = ""): SpawnSyncResult {
  return { stdout, stderr, status: 0 };
}

function fail(errorCode = "ENOENT", message = "not found"): SpawnSyncResult {
  const error = new Error(message) as NodeJS.ErrnoException;
  error.code = errorCode;
  return { stdout: "", stderr: "", status: null, error };
}

const spawnSyncMock = mock((executable: string, args: string[] = []): SpawnSyncResult => {
  spawnCalls.push({ executable, args });

  if (
    executable === "python" &&
    args.includes("-c") &&
    args.some((arg) => arg.includes("sys.version.split"))
  ) {
    return ok("3.11.8\nC:\\Python311\\python.exe\n");
  }

  if (executable === "python" && args.includes("-m") && args.includes("pip")) {
    return ok("pip 24.0 from C:\\Python311\\Lib\\site-packages\\pip\n");
  }

  if (executable === "yt-dlp" && args.includes("--version")) {
    return ok("2026.01.01\n");
  }

  if (executable === "ffmpeg" && args.includes("-version")) {
    return ok("ffmpeg version 7.0-full_build\n");
  }

  if (executable === "ollama" && args.includes("--version")) {
    return ok("ollama version 0.9.0\n");
  }

  return fail();
});

const spawnMock = mock(() => {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    kill: () => void;
    unref: () => void;
  };
  let killed = false;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {
    if (killed) {
      return;
    }
    killed = true;
    queueMicrotask(() =>
      child.emit("error", Object.assign(new Error("spawn cancelled in test"), { code: "ECANCELED" })),
    );
  };
  child.unref = () => undefined;
  setTimeout(() => {
    if (!killed) {
      child.emit("error", Object.assign(new Error("spawn disabled in test"), { code: "ENOENT" }));
    }
  }, 50);
  return child;
});

mock.module("child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

const { registerDependenciesRoutes } = await import(
  "../../../src/routes/config/registerDependenciesRoutes"
);

type RequestOptions = {
  method: string;
  url: string;
  payload?: unknown;
};

type TestHttpResponse = {
  statusCode: number;
  json: () => any;
};

function appBaseUrl(app: FastifyInstance): string {
  const address = app.server.address() as AddressInfo | string | null;
  if (!address || typeof address === "string") {
    throw new Error("Test server is not listening on a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
}

async function request(app: FastifyInstance, options: RequestOptions): Promise<TestHttpResponse> {
  const response = await originalFetch(`${appBaseUrl(app)}${options.url}`, {
    method: options.method,
    headers: options.payload === undefined ? undefined : { "content-type": "application/json" },
    body: options.payload === undefined ? undefined : JSON.stringify(options.payload),
  });
  const text = await response.text();

  return {
    statusCode: response.status,
    json: () => (text ? JSON.parse(text) : undefined),
  };
}

describe("dependencies routes", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    spawnCalls.length = 0;
    spawnSyncMock.mockClear();
    spawnMock.mockClear();
    globalThis.fetch = mock(async () => new Response(JSON.stringify({ models: [] }), { status: 200 })) as any;

    app = createServer();
    registerDependenciesRoutes(app);
    await app.listen({ host: "127.0.0.1", port: 0 });
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await app.close();
  });

  test("GET /dependencies returns the stable dependency snapshot shape", async () => {
    const response = await request(app, {
      method: "GET",
      url: "/dependencies",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      dependencies: {
        python: { installed: true, version: "3.11.8" },
        whisper: { installed: false, version: null },
        ytdlp: { installed: true, version: "2026.01.01" },
        ffmpeg: { installed: true, version: "7.0-full_build" },
        cuda: { installed: false, version: null },
        pytorch: { installed: false, version: null },
        ollama: { installed: true, version: "ollama version 0.9.0 (server online)" },
      },
      diagnostics: expect.any(Array),
    });
    expect(spawnCalls.some((call) => call.executable === "python")).toBe(true);
    expect(spawnCalls.some((call) => call.executable === "ffmpeg")).toBe(true);
  });

  test("dependency instructions return guide payloads and 404 for unknown names", async () => {
    const known = await request(app, {
      method: "GET",
      url: "/dependencies/python/instructions",
    });
    expect(known.statusCode).toBe(200);
    expect(known.json()).toMatchObject({
      name: "Python",
      manual: {
        title: expect.any(String),
        steps: expect.any(Array),
      },
    });

    const unknown = await request(app, {
      method: "GET",
      url: "/dependencies/not-real/instructions",
    });
    expect(unknown.statusCode).toBe(404);
    expect(unknown.json()).toEqual({ error: "Dependency not found" });
  });

  test("pytorch install/start/open-terminal require an explicit GPU tier", async () => {
    for (const routeRequest of [
      { method: "POST", url: "/dependencies/pytorch/install", payload: {} },
      { method: "POST", url: "/dependencies/pytorch/install/start", payload: {} },
      {
        method: "POST",
        url: "/dependencies/pytorch/open-terminal",
        payload: { mode: "install" },
      },
    ]) {
      const response = await request(app, routeRequest);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        success: false,
        message: expect.stringContaining("Selecione o tipo de GPU"),
      });
    }
  });

  test("direct install and uninstall unknown dependencies return stable error payloads", async () => {
    const install = await request(app, {
      method: "POST",
      url: "/dependencies/not-real/install",
      payload: {},
    });
    expect(install.statusCode).toBe(404);
    expect(install.json()).toEqual({
      success: false,
      message: "Dependency 'not-real' not found",
    });

    const uninstall = await request(app, {
      method: "POST",
      url: "/dependencies/not-real/uninstall",
      payload: {},
    });
    expect(uninstall.statusCode).toBe(404);
    expect(uninstall.json()).toEqual({
      success: false,
      message: "Dependency 'not-real' not found",
    });
  });

  test("install/start for unknown dependencies exposes the initial accepted shape", async () => {
    const start = await request(app, {
      method: "POST",
      url: "/dependencies/not-real/install/start",
      payload: {},
    });
    expect(start.statusCode).toBe(202);

    const startBody = start.json() as Record<string, any>;
    expect(startBody).toMatchObject({
      sessionId: expect.any(String),
      operation: "install",
      dependencyName: "not-real",
      status: "running",
      startedAt: expect.any(String),
    });
  });

  test("missing install sessions return the stable not-found shape", async () => {
    const missing = await request(app, {
      method: "GET",
      url: "/dependencies/install-sessions/missing-session",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      success: false,
      message: "Install session 'missing-session' was not found",
    });
  });

  test("cancel returns 404 for missing sessions and records cancellation in session output", async () => {
    const missing = await request(app, {
      method: "POST",
      url: "/dependencies/install-sessions/missing-session/cancel",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({
      success: false,
      message: "Install session 'missing-session' was not found",
    });

    const start = await request(app, {
      method: "POST",
      url: "/dependencies/ffmpeg/install/start",
      payload: {},
    });
    expect(start.statusCode).toBe(202);
    const sessionId = (start.json() as { sessionId: string }).sessionId;

    const cancel = await request(app, {
      method: "POST",
      url: `/dependencies/install-sessions/${sessionId}/cancel`,
    });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toEqual({
      success: true,
      message: "Cancellation requested successfully.",
      sessionId,
      status: "running",
    });

    const status = await request(app, {
      method: "GET",
      url: `/dependencies/install-sessions/${sessionId}`,
    });
    expect(status.statusCode).toBe(200);
    const cancelled = status.json();
    expect(cancelled).toMatchObject({
      sessionId,
      status: "cancelled",
      cancelRequested: false,
      logs: expect.arrayContaining([expect.stringContaining("Cancellation requested by user.")]),
      result: {
        success: false,
        message: expect.stringContaining("cancelada pelo usuário"),
      },
    });
  });

  test("open-terminal reports no command for unknown dependencies", async () => {
    const response = await request(app, {
      method: "POST",
      url: "/dependencies/not-real/open-terminal",
      payload: { mode: "install" },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      success: false,
      message: "No terminal command available for not-real (install)",
    });
  });
});
