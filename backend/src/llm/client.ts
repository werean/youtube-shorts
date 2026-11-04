/**
 * Local chat client for analysis.
 * Speaks the OpenAI-compatible API used by LM Studio. It does not call Ollama
 * and it never sends an API key.
 */

import { config } from "../core/config";
import { resolveAnalysisEndpoint } from "../../../shared/localInference";
import { redactSecrets } from "./redact";

interface Message {
  role: string;
  content: string;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

class LocalChatHttpError extends Error {
  status: number;
  responseText: string;

  constructor(status: number, responseText: string) {
    super(`LM Studio HTTP error: ${status} ${responseText}`.trim());
    this.name = "LocalChatHttpError";
    this.status = status;
    this.responseText = responseText;
  }
}

export interface AnalysisChatClient {
  readonly model: string;
  readonly baseUrl: string;
  chat(messages: Message[]): Promise<string>;
}

export class LocalChatClient implements AnalysisChatClient {
  readonly baseUrl: string;
  readonly model: string;
  private timeoutSeconds: number;

  constructor(
    baseUrl: string = config.LM_STUDIO_BASE_URL,
    model: string = config.LM_STUDIO_MODEL,
    timeoutSeconds: number = config.LLM_TIMEOUT_SECONDS,
  ) {
    const resolved = resolveAnalysisEndpoint({ baseUrl, model });
    this.baseUrl = resolved.baseUrl;
    this.model = resolved.model;
    this.timeoutSeconds = timeoutSeconds;
  }

  async chat(messages: Message[]): Promise<string> {
    const payload = {
      model: this.model,
      messages,
      temperature: 0,
      stream: false,
    };

    try {
      const response = await this.postJson("/chat/completions", payload);
      const content = response.choices?.[0]?.message?.content;
      return String(content || "");
    } catch (error: unknown) {
      throw new Error(this.toUserFriendlyError(error));
    }
  }

  private toUserFriendlyError(error: unknown): string {
    if (error instanceof LocalChatHttpError) {
      const detail = redactSecrets(String(error.responseText || "")).trim();
      const modelLabel = this.model || "modelo local";

      if (error.status === 404) {
        return `Modelo '${modelLabel}' não encontrado em ${this.baseUrl}. Carregue um modelo local no LM Studio e atualize o nome nas configurações.`;
      }

      if (error.status >= 500) {
        return `LM Studio retornou erro interno (${error.status}). ${detail || "Tente novamente em instantes."}`;
      }

      return `Falha na chamada ao LM Studio (${error.status}). ${detail || "Sem detalhes."}`;
    }

    const message = redactSecrets(String((error as { message?: string })?.message || ""));

    if (/timed out|timeout/i.test(message)) {
      return `A requisição para o LM Studio em ${this.baseUrl} excedeu o tempo limite. Confirme se o modelo local está carregado.`;
    }

    if (/Failed to reach LM Studio|fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
      return `Não foi possível conectar ao LM Studio em ${this.baseUrl}. Confirme se o servidor local está em execução.`;
    }

    return message || "Falha inesperada ao comunicar com o LM Studio.";
  }

  private async postJson(path: string, payload: unknown): Promise<ChatCompletionResponse> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutSeconds * 1000);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new LocalChatHttpError(response.status, errorText);
      }

      return (await response.json()) as ChatCompletionResponse;
    } catch (error: unknown) {
      if (error instanceof LocalChatHttpError) {
        throw error;
      }
      const name = (error as { name?: string })?.name;
      const message = (error as { message?: string })?.message || "";
      if (name === "AbortError") {
        throw new Error("LM Studio request timed out");
      }
      throw new Error(`Failed to reach LM Studio: ${message}`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
