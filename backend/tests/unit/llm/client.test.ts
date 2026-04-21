import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OllamaClient } from "../../../src/llm/client";

describe("OllamaClient", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("retries with local model when cloud model returns 401", async () => {
    const fetchMock = vi.fn();

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"error":"unauthorized"}',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          models: [{ name: "llama3.2:3b" }, { name: "gpt-oss:120b-cloud" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ message: { content: "[]" } }),
      });

    global.fetch = fetchMock as any;

    const client = new OllamaClient("http://localhost:11434", "gpt-oss:120b-cloud", "", 5);
    const result = await client.chat([{ role: "user", content: "hello" }]);

    expect(result).toBe("[]");
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const thirdCall = fetchMock.mock.calls[2];
    expect(thirdCall?.[0]).toContain("/api/chat");
    expect(String(thirdCall?.[1]?.body)).toContain("llama3.2:3b");
  });

  it("throws actionable message when cloud model unauthorized and no local fallback", async () => {
    const fetchMock = vi.fn();

    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => '{"error":"unauthorized"}',
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ models: [{ name: "gpt-oss:120b-cloud" }] }),
      });

    global.fetch = fetchMock as any;

    const client = new OllamaClient("http://localhost:11434", "gpt-oss:120b-cloud", "", 5);

    await expect(client.chat([{ role: "user", content: "hello" }])).rejects.toThrow(
      "Você está usando um modelo cloud e o Ollama não autorizou a requisição",
    );
  });
});
