/**
 * Filesystem paths and workspace layout helpers.
 */

import * as path from "path";
import { fileURLToPath } from "url";

export function projectRoot(): string {
  // From src/core/paths.ts, go up 3 levels
  // Compatible with both Node and Bun
  try {
    if (typeof __dirname !== "undefined") {
      const rootPath = path.resolve(__dirname, "..", "..", "..");
      console.log(`[paths] Project root (Node): ${rootPath}`);
      return rootPath;
    }
    // Bun/ESM fallback
    const rootPath = path.resolve(import.meta.dir, "..", "..", "..");
    console.log(`[paths] Project root (Bun): ${rootPath}`);
    return rootPath;
  } catch (error) {
    console.error(`[paths] ✗ Erro ao resolver project root:`, error);
    throw error;
  }
}

export function dataDir(): string {
  return path.join(projectRoot(), "data");
}

export function jobsDir(): string {
  return path.join(dataDir(), "jobs");
}

export function jobDir(jobId: string): string {
  return path.join(jobsDir(), jobId);
}

export function jobMetadataPath(jobId: string): string {
  return path.join(jobDir(jobId), "job.json");
}

export function uploadDir(): string {
  return path.join(projectRoot(), "upload");
}

export function uploadJobDir(jobId: string): string {
  return path.join(uploadDir(), jobId);
}

export function archivedDir(): string {
  return path.join(projectRoot(), "archived");
}

export function archivedJobDir(jobId: string): string {
  return path.join(archivedDir(), jobId);
}
