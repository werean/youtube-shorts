import type { AppSettings } from "../../features/config/settings/settingsOperations";
import type { ToolConfigs } from "../../features/config/toolConfigs/toolConfigOperations";
import type {
  DependencyInstallOptions,
  DependencyOperationMode,
} from "../../features/dependencies/shared/dependencyTypes";

export type ConfigParamNameDto = {
  name: string;
};

export type ConfigParamModelNameDto = {
  modelName: string;
};

export type ConfigParamSessionIdDto = {
  sessionId: string;
};

export type ToolConfigSectionParamsDto = {
  section: string;
};

export type SavePromptRequestDto = {
  name?: unknown;
  prompt?: unknown;
};

export type SavePromptResponseDto = {
  prompts: Array<{
    id: string;
    name: string;
    prompt: string;
    created_at: string;
    updated_at: string;
  }>;
};

export type OllamaModelRegistrationRequestDto = {
  name?: unknown;
  source?: unknown;
};

export type SettingsUpdateRequestDto = Partial<AppSettings>;

export type ToolConfigsUpdateRequestDto = Partial<ToolConfigs>;

export type DependencyInstallRequestDto = {
  pytorchGpuTier?: unknown;
};

export type DependencyTerminalRequestDto = DependencyInstallRequestDto & {
  mode?: unknown;
};

export function parseSavePromptRequest(body: SavePromptRequestDto | undefined): {
  name: string;
  prompt: string;
} {
  const requestBody = body || {};
  return {
    name: String(requestBody.name || "").trim(),
    prompt: String(requestBody.prompt || "").trim(),
  };
}

export function parseOllamaModelRegistrationRequest(
  body: OllamaModelRegistrationRequestDto | undefined,
): OllamaModelRegistrationRequestDto {
  return body || {};
}

export function getDependencyOperationMode(
  body: DependencyTerminalRequestDto | undefined,
): DependencyOperationMode {
  return body && body.mode === "uninstall" ? "uninstall" : "install";
}

export function emptyDependencyInstallOptions(): DependencyInstallOptions {
  return {};
}
