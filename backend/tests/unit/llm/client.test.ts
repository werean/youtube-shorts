import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocalChatClient } from "../../../src/llm/client";

describe("LocalChatClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("posts to the LM Studio chat endpoint and does not send an API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: "[]" } }],
      }),
    });
    global.fetch = fetchMock as typeof fetch;

    const client = new LocalChatClient("http://localhost:1234/v1", "qwen2.5-7b-instruct", 5);
    const result = await client.chat([{ role: "user", content: "hello" }]);

    expect(result).toBe("[]");
    expect(client.model).toBe("qwen2.5-7b-instruct");
    expect(client.baseUrl).toBe("http://localhost:1234/v1");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    expect(init.headers).toEqual({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body)).toMatchObject({
      model: "qwen2.5-7b-instruct",
      stream: false,
    });
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
  });

  it("replaces a cloud Ollama model and Ollama URL before any request", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "[]" } }] }),
    });
    global.fetch = fetchMock as typeof fetch;

    const client = new LocalChatClient("http://localhost:11434", "gpt-oss:120b-cloud", 5);
    await client.chat([{ role: "user", content: "hello" }]);

    expect(client.model).toBe("local-model");
    expect(client.baseUrl).toBe("http://localhost:1234/v1");
    expect(fetchMock.mock.calls[0][0]).toBe("http://localhost:1234/v1/chat/completions");
    expect(String(fetchMock.mock.calls[0][1].body)).not.toContain("gpt-oss");
    expect(String(fetchMock.mock.calls[0][1].body)).not.toContain("11434");
  });
});
