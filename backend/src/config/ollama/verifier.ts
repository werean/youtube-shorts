import { config } from "../../core/config";

export async function testOllamaModel(
  model: string,
): Promise<{ ok: true; content: string } | { ok: false; error: string }> {
  const isCloudModel = model.endsWith("-cloud");

  try {
    const baseUrl = config.OLLAMA_BASE_URL.replace(/\/$/, "");
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.OLLAMA_API_KEY ? { Authorization: `Bearer ${config.OLLAMA_API_KEY}` } : {}),
      },
      signal: AbortSignal.timeout(30000),
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Responda apenas com: ok" }],
        stream: false,
      }),
    });

    if (!response.ok) {
      const detail = (await response.text()).trim();

      if (response.status === 401 || response.status === 403) {
        if (isCloudModel) {
          return {
            ok: false,
            error:
              "Autenticação necessária para usar modelo cloud. Faça login com 'ollama signin' ou configure OLLAMA_API_KEY.",
          };
        }

        return {
          ok: false,
          error: "Ollama rejeitou a autenticação da requisição. Verifique suas credenciais.",
        };
      }

      if (response.status === 404) {
        return {
          ok: false,
          error: `Modelo '${model}' não encontrado. Verifique o nome ou baixe localmente com 'ollama pull ${model}'.`,
        };
      }

      if (response.status === 429) {
        return {
          ok: false,
          error:
            "Limite de requisições no Ollama (429). Aguarde alguns instantes e tente novamente.",
        };
      }

      return {
        ok: false,
        error: `Teste do modelo falhou (${response.status}). ${detail || "Sem detalhes"}`,
      };
    }

    const payload = (await response.json()) as {
      message?: { content?: unknown };
      response?: unknown;
    };

    const content = String(payload.message?.content || payload.response || "").trim();
    if (!content) {
      return {
        ok: false,
        error: "O modelo respondeu sem conteúdo no teste.",
      };
    }

    return { ok: true, content };
  } catch (error: any) {
    const message = String(error?.message || "");

    if (/timed out|timeout/i.test(message)) {
      return {
        ok: false,
        error: "Tempo limite ao testar o modelo no Ollama. Tente novamente em alguns instantes.",
      };
    }

    if (/fetch failed|ECONNREFUSED|ENOTFOUND|network/i.test(message)) {
      return {
        ok: false,
        error:
          "Não foi possível conectar ao Ollama. Verifique se o serviço está em execução e acessível.",
      };
    }

    return {
      ok: false,
      error: message || "Falha ao testar o modelo.",
    };
  }
}
