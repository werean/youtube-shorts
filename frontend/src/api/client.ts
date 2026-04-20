export const DEFAULT_BASE_URL = "http://localhost:8000";
export const apiBaseUrl = DEFAULT_BASE_URL;

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  console.log(`[API] ${init?.method || "GET"} ${apiBaseUrl}${path}`);
  console.log(`[API] Headers:`, init?.headers);
  console.log(`[API] Body:`, init?.body);

  try {
    const response = await fetch(`${apiBaseUrl}${path}`, init);
    console.log(`[API] Response status: ${response.status}`);
    console.log(`[API] Response headers:`, response.headers);

    if (!response.ok) {
      const text = await response.text();
      console.error(`[API] Error response: ${text}`);

      let detail = "";
      if (text) {
        try {
          const parsed = JSON.parse(text) as {
            detail?: unknown;
            message?: unknown;
            error?: unknown;
          };
          detail = String(parsed.detail || parsed.message || parsed.error || "").trim();
        } catch {
          detail = text.trim();
        }
      }

      throw new Error(detail || `Request failed: ${response.status}`);
    }

    const data = (await response.json()) as T;
    console.log(`[API] Success`, data);
    return data;
  } catch (error: any) {
    console.error(`[API] Fetch error:`, error.message);
    console.error(`[API] Error type:`, error.name);
    console.error(`[API] Full error:`, error);

    const message = String(error?.message || "");
    if (/Failed to fetch|fetch failed|NetworkError|network/i.test(message)) {
      throw new Error(
        "Não foi possível conectar ao backend da aplicação. Verifique se o servidor está em execução.",
      );
    }

    throw error;
  }
}
