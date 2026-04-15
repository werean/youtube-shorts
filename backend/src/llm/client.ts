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
  private apiKey: string;
  private timeoutSeconds: number;

  constructor(
    baseUrl: string = config.OLLAMA_BASE_URL,
    model: string = config.OLLAMA_MODEL,
    apiKey: string = config.OLLAMA_API_KEY,
    timeoutSeconds: number = config.OLLAMA_TIMEOUT_SECONDS,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.model = model;
    this.apiKey = apiKey;
    this.timeoutSeconds = timeoutSeconds;
  }

  async chat(messages: Message[], options?: ChatOptions): Promise<string> {
    const buildPayload = (model: string): any => {
      const payload: any = {
        model,
        messages,
        stream: false,
      };

      if (options) {
        payload.options = options;
      }

      return payload;
    };

    try {
      const response = await this.postJson("/api/chat", buildPayload(this.model));
      const message = response.message || {};
      return String(message.content || "");
    } catch (error: any) {
      const message = String(error?.message || "");
      const unauthorized = /\b401\b|unauthorized/i.test(message);
      const cloudModel = this.model.endsWith("-cloud");

      if (unauthorized && cloudModel) {
        const fallbackModel = await this.findLocalFallbackModel();
        if (fallbackModel) {
          console.warn(
            `[analysis] Cloud model '${this.model}' unauthorized. Retrying with local model '${fallbackModel}'.`,
          );
          const response = await this.postJson("/api/chat", buildPayload(fallbackModel));
          const retryMessage = response.message || {};
          return String(retryMessage.content || "");
        }

        throw new Error(
          "Ollama retornou 401 para um modelo cloud. Faça login no Ollama CLI (ollama signin), configure OLLAMA_API_KEY, ou selecione um modelo local instalado.",
        );
      }

      throw error;
    }
  }

  private async findLocalFallbackModel(): Promise<string | null> {
    const url = `${this.baseUrl}/api/tags`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: this.buildHeaders(),
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as { models?: Array<{ name?: string }> };
      const modelNames = Array.isArray(data.models)
        ? data.models.map((m) => String(m?.name || "").trim()).filter(Boolean)
        : [];

      // Prefer non-cloud models to avoid auth requirements.
      const localModel = modelNames.find((name) => !name.endsWith("-cloud"));
      return localModel || null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers.Authorization = `Bearer ${this.apiKey}`;
    }
    return headers;
  }

  private async postJson(path: string, payload: any): Promise<ChatResponse> {
    const url = `${this.baseUrl}${path}`;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000);

      const response = await fetch(url, {
        method: "POST",
        headers: this.buildHeaders(),
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
