/**
 * Local Hugging Face cache probe for faster-whisper weights.
 * This only looks at disk. The download itself happens inside the
 * transcription process on the user's machine.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { fasterWhisperCacheFolder } from "../../../../shared/localInference";

export function fasterWhisperCacheRoots(
  env: NodeJS.ProcessEnv = process.env,
  home = os.homedir(),
): string[] {
  const roots: string[] = [];
  if (env.HUGGINGFACE_HUB_CACHE) roots.push(env.HUGGINGFACE_HUB_CACHE);
  if (env.HF_HOME) roots.push(path.join(env.HF_HOME, "hub"));
  roots.push(path.join(home, ".cache", "huggingface", "hub"));
  return roots;
}

export function fasterWhisperWeightsCached(
  model: string,
  roots = fasterWhisperCacheRoots(),
): boolean {
  const folder = fasterWhisperCacheFolder(model);
  for (const root of roots) {
    try {
      const snapshots = path.join(root, folder, "snapshots");
      if (!fs.existsSync(snapshots)) continue;
      if (fs.readdirSync(snapshots).length > 0) return true;
    } catch {
      continue;
    }
  }
  return false;
}
