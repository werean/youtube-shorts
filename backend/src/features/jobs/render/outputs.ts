import * as fs from "fs";
import * as path from "path";
import { archivedVideosDir, loadSettings } from "../../../core/settings";
import * as files from "../../../storage/files";
import { openFolderInExplorerForFile } from "../../../utils/openFolder";

export function deleteRenderOutputFile(
  jobId: string,
  file: string,
): { status: "not-found"; safeFile: string } | { status: "deleted"; safeFile: string } {
  const safeFile = path.basename(file);
  console.log(`[jobs] Deleting render: ${jobId}/${safeFile}`);

  const shortsDir = files.ensureShortsJobDir(jobId);
  const filePath = path.join(shortsDir, safeFile);

  if (!fs.existsSync(filePath)) {
    return { status: "not-found", safeFile };
  }

  fs.unlinkSync(filePath);
  console.log(`[jobs] ✓ Render deleted: ${filePath}`);

  return { status: "deleted", safeFile };
}

export function openRenderOutputFolder(
  jobId: string,
  file: string,
): { ok: true } | { ok: false; detail: string; statusCode: number } {
  const safeFile = path.basename(file);

  const shortsDir = files.ensureShortsJobDir(jobId);
  const filePath = path.join(shortsDir, safeFile);

  const settings = loadSettings();
  const allowedRoots = [settings.media.base_dir, archivedVideosDir()];
  const result = openFolderInExplorerForFile(filePath, allowedRoots);

  if (!result.ok) {
    const msg = result.detail || "Failed to open folder";
    const status = msg === "File not found" ? 404 : msg === "Invalid path" ? 400 : 500;
    return { ok: false, detail: msg, statusCode: status };
  }

  return { ok: true };
}
