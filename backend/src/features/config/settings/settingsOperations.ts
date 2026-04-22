import * as fs from "fs";

import { loadSettings, updateSettings } from "../../../core/settings";
import type { AppSettings } from "../../../core/settings";

export type { AppSettings };

export function getAppSettings(): AppSettings {
  return loadSettings();
}

export function updateAppSettings(body: Partial<AppSettings>): AppSettings {
  console.log(`[config] Atualizando settings:`, body);

  if (body.media?.base_dir) {
    const baseDir = body.media.base_dir;
    if (!fs.existsSync(baseDir)) {
      console.log(`[config] Criando diretório: ${baseDir}`);
      fs.mkdirSync(baseDir, { recursive: true });
    }
  }

  const updatedSettings = updateSettings(body);
  console.log(`[config] ✓ Settings atualizadas`);
  return updatedSettings;
}
