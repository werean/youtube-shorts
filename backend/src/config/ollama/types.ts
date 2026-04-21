export type OllamaCatalogEntry = {
  name: string;
  model: string;
  source: "cloud" | "local";
  installed: boolean;
  running: boolean;
  needsDownload: boolean;
  size?: number;
};

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
