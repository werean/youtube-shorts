export type { OllamaCatalogEntry } from "@youtube-shorts/contracts";

export type OllamaCommandResult = {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  errorMessage?: string;
};

export type OllamaRouteResult = {
  statusCode: number;
  payload: unknown;
};
