import {
  importToolConfigs,
  loadActiveToolConfigs,
  loadDefaultToolConfigs,
  resetAllToolConfigs,
  resetToolConfigSection,
  toolConfigsSource,
  updateToolConfigs,
} from "../../../core/toolConfigs";
import type { ToolConfigs } from "../../../core/toolConfigs";

export type { ToolConfigs };

export type ResettableToolConfigSection = "whisper" | "ffmpeg" | "llm";

export function isResettableToolConfigSection(
  section: string,
): section is ResettableToolConfigSection {
  return ["whisper", "ffmpeg", "llm"].includes(section);
}

export function getToolConfigsPayload() {
  const defaults = loadDefaultToolConfigs();
  const active = loadActiveToolConfigs();
  return { source: toolConfigsSource(), defaults, active };
}

export function updateToolConfigsPayload(body: Partial<ToolConfigs>) {
  const active = updateToolConfigs(body);
  return { source: toolConfigsSource(), active };
}

export function resetAllToolConfigsPayload() {
  const active = resetAllToolConfigs();
  return { source: toolConfigsSource(), active };
}

export function resetToolConfigSectionPayload(section: ResettableToolConfigSection) {
  const active = resetToolConfigSection(section);
  return { source: toolConfigsSource(), active };
}

export function importToolConfigsPayload(body: Partial<ToolConfigs>) {
  const active = importToolConfigs(body);
  return { source: toolConfigsSource(), active };
}
