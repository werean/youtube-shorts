/**
 * LLM client wrapper for semantic analysis requests.
 */

import { config } from "../core/config";

interface Message {
  role: string;
  content: string;
}

interface ChatOptions {
  [key: string]: any;
}

interface ChatResponse {
  message?: {
    content?: string;
  };
}

export class OllamaClient {
  private baseUrl: string;
  private model: string;
  private timeoutSeconds: number;

  constructor(
    baseUrl: string = config.OLLAMA_BASE_URL,
    model: string = config.OLLAMA_MODEL,
    timeoutSeconds: number = config.OLLAMA_TIMEOUT_SECONDS,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.timeoutSeconds = timeoutSeconds;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const payload: any = {
      model: this.model,
      messages,
      stream: false,
    };

    if (options) {
      payload.options = options;
    }

    const response = await this.postJson("/api/chat", payload);
    const message = response.message || {};
    return String(message.content || "");
  }

  private async postJson(path: string, payload: any): Promise<ChatResponse> {
    const url = `${this.baseUrl}${path}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000);

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Ollama HTTP error: ${response.status} ${errorText}`);
      }

      return (await response.json()) as ChatResponse;
    } catch (error: any) {
      if (error.name === "AbortError") {
        throw new Error("Ollama request timed out");
      }
      throw new Error(`Failed to reach Ollama server: ${error.message}`);
    }
  }
}
