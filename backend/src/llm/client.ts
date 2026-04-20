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

class OllamaHttpError extends Error {
  status: number;
  responseText: string;

  constructor(status: number, responseText: string) {
    super(`Ollama HTTP error: ${status} ${responseText}`.trim());
    this.name = "OllamaHttpError";
    this.status = status;
    this.responseText = responseText;
  }
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
      const unauthorized = this.isUnauthorizedError(error);
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
          "Você está usando um modelo cloud e o Ollama não autorizou a requisição. Faça login com 'ollama signin', configure OLLAMA_API_KEY, ou selecione um modelo local já baixado.",
        );
      }

      throw new Error(this.toUserFriendlyError(error));
    }
  }

  private isUnauthorizedError(error: unknown): boolean {
    if (error instanceof OllamaHttpError) {
      return error.status === 401 || error.status === 403;
    }

    const message = String((error as any)?.message || "");
    return /\b401\b|\b403\b|unauthorized|forbidden|not\s+authenticated/i.test(message);
  }

  private toUserFriendlyError(error: unknown): string {
    if (error instanceof OllamaHttpError) {
      const detail = String(error.responseText || "").trim();
      const modelLabel = this.model || "modelo configurado";

      if (error.status === 401 || error.status === 403) {
        if (this.model.endsWith("-cloud")) {
          return `Falha de autenticação no Ollama Cloud para o modelo '${modelLabel}'. Faça login com 'ollama signin' ou configure OLLAMA_API_KEY.`;
        }
        return `Falha de autenticação ao acessar o Ollama para o modelo '${modelLabel}'. Verifique credenciais e permissões.`;
      }

      if (error.status === 404) {
        return `Modelo '${modelLabel}' não encontrado no Ollama. Se for local, baixe com 'ollama pull ${modelLabel}'. Se for cloud, confirme o nome do modelo e login.`;
      }

      if (error.status === 429) {
        return "Ollama retornou limite de requisições (429). Aguarde alguns instantes e tente novamente.";
      }

      if (error.status >= 500) {
        return `Ollama retornou erro interno (${error.status}). ${detail || "Tente novamente em instantes."}`;
      }

      return `Falha na chamada ao Ollama (${error.status}). ${detail || "Sem detalhes."}`;
    }

    const message = String((error as any)?.message || "");

    if (/timed out|timeout/i.test(message)) {
      return "A requisição para o Ollama excedeu o tempo limite. Verifique se o modelo está disponível e tente novamente.";
    }

    if (
      /Failed to reach Ollama server|fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)
    ) {
      return `Não foi possível conectar ao Ollama em ${this.baseUrl}. Confirme se o Ollama está em execução.`;
    }

    return message || "Falha inesperada ao comunicar com o Ollama.";
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
        throw new OllamaHttpError(response.status, errorText);
      }

      return (await response.json()) as ChatResponse;
    } catch (error: any) {
      if (error instanceof OllamaHttpError) {
        throw error;
      }
      if (error.name === "AbortError") {
        throw new Error("Ollama request timed out");
      }
      throw new Error(`Failed to reach Ollama server: ${error.message}`);
    }
  }
}
