import * as childProcess from "node:child_process";
import * as fs from "fs";
import * as path from "path";
import { loadSettings } from "../../core/settings";
import { Job } from "../../models/job";

function resolveMaxHeight(resolution: string): number {
  switch (resolution) {
    case "4k":
      return 2160;
    case "1440p":
      return 1440;
    case "1080p":
    default:
      return 1080;
  }
}

function buildYtDlpFormat(resolution: string): string {
  const maxHeight = resolveMaxHeight(resolution);
  return `bv*[height<=${maxHeight}]+ba/b[height<=${maxHeight}]`;
}

const DENO_NAMES = process.platform === "win32" ? ["deno.exe", "deno"] : ["deno"];

let cachedDenoRuntimeSpec: string | null = null;

export function denoRuntimeSpecFromPaths(searchPaths: readonly string[]): string {
  for (const entry of searchPaths) {
    const directory = entry.trim();
    if (!directory) continue;
    for (const name of DENO_NAMES) {
      const candidate = path.join(directory, name);
      if (fs.existsSync(candidate)) {
        return `deno:${candidate}`;
      }
    }
  }
  return "deno";
}

function decodeRegistryOutput(output: Buffer): string {
  if (output.length >= 2 && output[0] === 0xff && output[1] === 0xfe) {
    return output.subarray(2).toString("utf16le");
  }
  if (output.includes(0)) {
    return output.toString("utf16le");
  }
  return output.toString("utf8");
}

function expandWindowsEnv(value: string): string {
  return value.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? "");
}

function readWindowsRegistryPath(key: string): string[] {
  const execFileSync = childProcess.execFileSync;
  if (typeof execFileSync !== "function") return [];
  try {
    const output = execFileSync("reg", ["query", key, "/v", "Path"], {
      windowsHide: true,
      timeout: 4000,
    });
    const text = decodeRegistryOutput(output);
    const match = text.match(/REG_(?:EXPAND_)?SZ\s+(.+)/i);
    const raw = match?.[1]?.trim();
    if (!raw) return [];
    return expandWindowsEnv(raw).split(";");
  } catch {
    return [];
  }
}

function denoSearchPaths(): string[] {
  const fromProcess = (process.env.PATH ?? process.env.Path ?? "").split(path.delimiter);
  if (process.platform !== "win32") {
    return fromProcess;
  }
  return [
    ...fromProcess,
    ...readWindowsRegistryPath("HKCU\\Environment"),
    ...readWindowsRegistryPath(
      "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    ),
  ];
}

export function denoJsRuntimeSpec(): string {
  if (cachedDenoRuntimeSpec) return cachedDenoRuntimeSpec;
  const spec = denoRuntimeSpecFromPaths(denoSearchPaths());
  if (spec.startsWith("deno:")) {
    cachedDenoRuntimeSpec = spec;
  }
  return spec;
}

export function buildDownloadArgs(job: Job, outputPattern: string): string[] {
  const settings = loadSettings();
  const format = buildYtDlpFormat(settings.media.download_resolution || "1080p");
  return [
    "python",
    "-m",
    "yt_dlp",
    "--no-playlist",
    "--js-runtimes",
    denoJsRuntimeSpec(),
    "--write-info-json",
    "--format",
    format,
    "--output",
    outputPattern,
    job.youtube_url,
  ];
}

export function formatDownloadCommand(args: string[]): string {
  return args
    .map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
    .join(" ");
}
