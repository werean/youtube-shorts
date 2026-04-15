import { spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

export interface OpenFolderResult {
  ok: boolean;
  detail?: string;
}

function isSubPath(parentDir: string, childPath: string): boolean {
  const parent = path.resolve(parentDir);
  const child = path.resolve(childPath);
  const relative = path.relative(parent, child);
  return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

export function openFolderInExplorerForFile(
  filePath: string,
  allowedRoots?: string[],
): OpenFolderResult {
  if (!filePath || typeof filePath !== "string") {
    return { ok: false, detail: "Invalid path" };
  }

  const resolvedPath = path.resolve(filePath);

  if (!fs.existsSync(resolvedPath)) {
    return { ok: false, detail: "File not found" };
  }

  const stat = fs.statSync(resolvedPath);
  if (!stat.isFile()) {
    return { ok: false, detail: "Path is not a file" };
  }

  if (allowedRoots && allowedRoots.length > 0) {
    const allowed = allowedRoots.some((root) => isSubPath(root, resolvedPath));
    if (!allowed) {
      return { ok: false, detail: "Path not allowed" };
    }
  }

  if (process.platform !== "win32") {
    return { ok: false, detail: "Open Folder is only supported on Windows" };
  }

  try {
    const child = spawn("explorer.exe", ["/select,", resolvedPath], {
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
    return { ok: true };
  } catch (error: any) {
    return { ok: false, detail: error?.message || "Failed to open folder" };
  }
}
