/**
 * Register dependency status and install routes.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "crypto";
import { existsSync } from "fs";
import path from "path";
import { spawn, spawnSync, type ChildProcess } from "child_process";
import { INSTALLATION_GUIDES } from "../../config/installer";

interface DependencyStatus {
  installed: boolean;
  version: string | null;
}

interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  executable: string;
  args: string[];
  errorCode?: string;
  errorMessage?: string;
}

interface PythonRuntime {
  executable: string;
  argsPrefix: string[];
  version: string;
  executablePath: string;
  source: string;
}

interface DependencyChecks {
  python: DependencyStatus;
  whisper: DependencyStatus;
  ytdlp: DependencyStatus;
  ffmpeg: DependencyStatus;
  cuda: DependencyStatus;
  pytorch: DependencyStatus;
  ollama: DependencyStatus;
}

interface DependencySnapshot {
  checks: DependencyChecks;
  pythonRuntime: PythonRuntime | null;
  diagnostics: string[];
}

interface InstallDependencyPayload {
  success: boolean;
  message: string;
  output?: string;
  error?: string;
  failureCategory?: string;
  installer?: string;
  dependencies?: DependencyChecks;
  diagnostics?: string[];
}

interface InstallExecutionResult {
  statusCode: number;
  payload: InstallDependencyPayload;
}

type DependencyInstallSessionStatus = "running" | "success" | "failed" | "cancelled";
type DependencyOperationMode = "install" | "uninstall";

type PytorchGpuTier = "rtx_4000_or_lower" | "rtx_5000";

interface DependencyInstallOptions {
  pytorchGpuTier?: PytorchGpuTier;
}

interface DependencyInstallSession {
  id: string;
  operation: DependencyOperationMode;
  dependencyName: string;
  status: DependencyInstallSessionStatus;
  startedAt: string;
  endedAt?: string;
  logs: string[];
  result?: InstallDependencyPayload;
}

interface DependencySessionControl {
  cancelRequested: boolean;
  currentChild: ChildProcess | null;
}

interface CommandExecutionControl {
  isCancelled?: () => boolean;
  setCurrentChild?: (child: ChildProcess | null) => void;
}

type InstallStrategy = {
  name: string;
  executable: string;
  args: string[];
};

const MAX_OUTPUT_LEN = 1200;
const MIN_SUPPORTED_PYTHON_MINOR = 10;
const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_SESSION_LOG_LINES = 1000;
const SESSION_TTL_MS = 30 * 60 * 1000;

const dependencyInstallSessions = new Map<string, DependencyInstallSession>();
const dependencySessionControls = new Map<string, DependencySessionControl>();

function trimOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_LEN) {
    return value;
  }
  return `${value.slice(0, MAX_OUTPUT_LEN)}...`;
}

function parsePytorchGpuTier(value: unknown): PytorchGpuTier | null {
  if (value === "rtx_4000_or_lower" || value === "rtx_5000") {
    return value;
  }
  return null;
}

function expectedCudaPrefixForPytorchTier(tier: PytorchGpuTier): string {
  return tier === "rtx_5000" ? "12.8" : "12.1";
}

function runCommand(
  executable: string,
  args: string[],
  timeoutMs = 10000,
  envOverrides?: NodeJS.ProcessEnv,
): CommandResult {
  const result = spawnSync(executable, args, {
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
  });

  const stdout = (result.stdout || "").toString().trim();
  const stderr = (result.stderr || "").toString().trim();
  const error = result.error as NodeJS.ErrnoException | undefined;

  return {
    ok: !error && (result.status ?? 1) === 0,
    exitCode: result.status,
    stdout,
    stderr,
    executable,
    args,
    errorCode: error?.code,
    errorMessage: error?.message,
  };
}

async function runCommandAsync(
  executable: string,
  args: string[],
  timeoutMs = 10000,
  onLog?: (line: string) => void,
  envOverrides?: NodeJS.ProcessEnv,
  control?: CommandExecutionControl,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    if (control?.isCancelled?.()) {
      resolve({
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        executable,
        args,
        errorCode: "ECANCELED",
        errorMessage: "Command cancelled before start",
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timedOut = false;
    let cancelled = false;

    const child = spawn(executable, args, {
      windowsHide: true,
      env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    control?.setCurrentChild?.(child);

    const flushChunk = (chunk: string, target: "stdout" | "stderr") => {
      if (target === "stdout") {
        stdout += chunk;
      } else {
        stderr += chunk;
      }

      if (!onLog) {
        return;
      }

      const lines = chunk
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        onLog(line);
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      onLog?.(
        `Command timed out after ${Math.round(timeoutMs / 1000)}s: ${executable} ${args.join(" ")}`,
      );
      child.kill();
    }, timeoutMs);

    const cancelWatcher = setInterval(() => {
      if (resolved || !control?.isCancelled?.()) {
        return;
      }

      cancelled = true;
      onLog?.(`Command cancelled: ${executable} ${args.join(" ")}`);
      child.kill();
    }, 250);

    child.stdout?.on("data", (data: Buffer | string) =>
      flushChunk(typeof data === "string" ? data : data.toString("utf-8"), "stdout"),
    );
    child.stderr?.on("data", (data: Buffer | string) =>
      flushChunk(typeof data === "string" ? data : data.toString("utf-8"), "stderr"),
    );

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      clearInterval(cancelWatcher);
      control?.setCurrentChild?.(null);
      resolve({
        ok: false,
        exitCode: null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        executable,
        args,
        errorCode: cancelled ? "ECANCELED" : timedOut ? "ETIMEDOUT" : error.code,
        errorMessage: cancelled ? "Command execution cancelled" : error.message,
      });
    });

    child.on("close", (code) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      clearInterval(cancelWatcher);
      control?.setCurrentChild?.(null);
      resolve({
        ok: !timedOut && !cancelled && code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        executable,
        args,
        errorCode: cancelled ? "ECANCELED" : timedOut ? "ETIMEDOUT" : undefined,
        errorMessage: cancelled
          ? "Command execution cancelled"
          : timedOut
            ? "Command execution timed out"
            : undefined,
      });
    });
  });
}

function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

function nowLogStamp(): string {
  return new Date().toLocaleTimeString("pt-BR", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function appendSessionLog(session: DependencyInstallSession, message: string) {
  const lines = message
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return;
  }

  for (const line of lines) {
    session.logs.push(`[${nowLogStamp()}] ${line}`);
  }

  if (session.logs.length > MAX_SESSION_LOG_LINES) {
    session.logs.splice(0, session.logs.length - MAX_SESSION_LOG_LINES);
  }
}

function cleanupInstallSessions() {
  const now = Date.now();
  for (const [sessionId, session] of dependencyInstallSessions.entries()) {
    const referenceTime = session.endedAt
      ? Date.parse(session.endedAt)
      : Date.parse(session.startedAt);
    if (Number.isFinite(referenceTime) && now - referenceTime > SESSION_TTL_MS) {
      dependencyInstallSessions.delete(sessionId);
      dependencySessionControls.delete(sessionId);
    }
  }
}

function firstNonEmptyLine(...values: string[]): string | null {
  const joined = values
    .filter(Boolean)
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return joined || null;
}

function parseVersionTuple(version: string): [number, number, number] | null {
  const match = version.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3] || 0)];
}

function compareVersionTuple(a: [number, number, number], b: [number, number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return a[2] - b[2];
}

function parsePythonVersion(output: string): string | null {
  const line = firstNonEmptyLine(output);
  if (!line) {
    return null;
  }
  const match = line.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match ? match[1] : null;
}

function buildPythonCandidates(): Array<{
  executable: string;
  argsPrefix: string[];
  source: string;
}> {
  const candidates: Array<{ executable: string; argsPrefix: string[]; source: string }> = [
    { executable: "python", argsPrefix: [], source: "python-path" },
    { executable: "py", argsPrefix: ["-3"], source: "py-launcher-3" },
    { executable: "py", argsPrefix: [], source: "py-launcher-default" },
  ];

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || process.env.LocalAppData || "";
    const versions = ["312", "311", "310", "39"];

    for (const version of versions) {
      const fromLocal = path.join(
        localAppData,
        "Programs",
        "Python",
        `Python${version}`,
        "python.exe",
      );
      const fromRoot = path.join("C:\\", `Python${version}`, "python.exe");

      if (fromLocal && existsSync(fromLocal)) {
        candidates.push({
          executable: fromLocal,
          argsPrefix: [],
          source: `localappdata-python-${version}`,
        });
      }

      if (existsSync(fromRoot)) {
        candidates.push({
          executable: fromRoot,
          argsPrefix: [],
          source: `root-python-${version}`,
        });
      }
    }
  }

  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.executable}::${candidate.argsPrefix.join(" ")}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function detectPythonRuntime(diagnostics: string[]): {
  runtime: PythonRuntime | null;
  status: DependencyStatus;
} {
  const candidates = buildPythonCandidates();
  const validRuntimes: PythonRuntime[] = [];
  let bestUnsupported: { version: string; source: string } | null = null;

  for (const candidate of candidates) {
    const probe = runCommand(
      candidate.executable,
      [
        ...candidate.argsPrefix,
        "-c",
        "import sys; print(sys.version.split()[0]); print(sys.executable)",
      ],
      8000,
    );

    if (!probe.ok) {
      if (probe.errorCode && probe.errorCode !== "ENOENT") {
        diagnostics.push(
          `Python probe failed (${candidate.source}): ${probe.errorCode} ${probe.errorMessage || ""}`.trim(),
        );
      }
      continue;
    }

    const outputLines = `${probe.stdout}\n${probe.stderr}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parsedVersion = parsePythonVersion(outputLines[0] || "");
    const executablePath = outputLines[1] || candidate.executable;

    if (!parsedVersion) {
      diagnostics.push(`Python probe returned no parseable version (${candidate.source}).`);
      continue;
    }

    const tuple = parseVersionTuple(parsedVersion);
    if (!tuple) {
      diagnostics.push(
        `Python probe returned malformed version '${parsedVersion}' (${candidate.source}).`,
      );
      continue;
    }

    const isSupported = tuple[0] > 3 || (tuple[0] === 3 && tuple[1] >= MIN_SUPPORTED_PYTHON_MINOR);

    if (!isSupported) {
      if (
        !bestUnsupported ||
        compareVersionTuple(tuple, parseVersionTuple(bestUnsupported.version) || [0, 0, 0]) > 0
      ) {
        bestUnsupported = { version: parsedVersion, source: candidate.source };
      }
      continue;
    }

    validRuntimes.push({
      executable: candidate.executable,
      argsPrefix: candidate.argsPrefix,
      version: parsedVersion,
      executablePath,
      source: candidate.source,
    });
  }

  if (validRuntimes.length === 0) {
    if (bestUnsupported) {
      diagnostics.push(
        `Python found but unsupported version (${bestUnsupported.version}) via ${bestUnsupported.source}. Minimum required is 3.10.`,
      );
      return {
        runtime: null,
        status: {
          installed: false,
          version: `${bestUnsupported.version} (unsupported)`,
        },
      };
    }
    return {
      runtime: null,
      status: { installed: false, version: null },
    };
  }

  validRuntimes.sort((a, b) => {
    const tupleA = parseVersionTuple(a.version) || [0, 0, 0];
    const tupleB = parseVersionTuple(b.version) || [0, 0, 0];
    return compareVersionTuple(tupleB, tupleA);
  });

  const runtime = validRuntimes[0];
  const pipProbe = runCommand(
    runtime.executable,
    [...runtime.argsPrefix, "-m", "pip", "--version"],
    8000,
  );

  if (!pipProbe.ok) {
    diagnostics.push(
      `Python runtime detected (${runtime.version}) but pip is not available. Install/repair pip to enable automatic dependency install.`,
    );
  }

  return {
    runtime,
    status: {
      installed: true,
      version: runtime.version,
    },
  };
}

function runPython(runtime: PythonRuntime, args: string[], timeoutMs = 12000): CommandResult {
  return runCommand(runtime.executable, [...runtime.argsPrefix, ...args], timeoutMs);
}

function detectWhisper(runtime: PythonRuntime | null, diagnostics: string[]): DependencyStatus {
  if (!runtime) {
    return { installed: false, version: null };
  }

  const importProbe = runPython(runtime, [
    "-c",
    "import whisper, importlib.metadata as m; print(getattr(whisper, '__version__', m.version('openai-whisper')))",
  ]);

  const metadataVersion = runPython(runtime, [
    "-c",
    "import importlib.metadata as m; print(m.version('openai-whisper'))",
  ]);

  const moduleHelp = runPython(runtime, ["-m", "whisper", "--help"], 12000);

  const version = firstNonEmptyLine(
    importProbe.stdout,
    metadataVersion.stdout,
    metadataVersion.stderr,
    importProbe.stderr,
  );

  const cliLooksHealthy = moduleHelp.ok || /usage:/i.test(moduleHelp.stdout + moduleHelp.stderr);
  const installed = importProbe.ok || (metadataVersion.ok && cliLooksHealthy);

  if (!installed && metadataVersion.ok && !importProbe.ok) {
    diagnostics.push(
      "Whisper package metadata exists but import failed. This is usually a broken or partial install.",
    );
  }

  if (importProbe.ok && !cliLooksHealthy) {
    diagnostics.push(
      "Whisper package import succeeded, but CLI entrypoint failed. The package is installed, but CLI/path may be inconsistent.",
    );
  }

  if (!installed && !cliLooksHealthy) {
    diagnostics.push(
      "Whisper CLI/module entrypoint failed. This is usually a broken or partial install.",
    );

    const details = trimOutput(
      [moduleHelp.stdout, moduleHelp.stderr, moduleHelp.errorMessage].filter(Boolean).join("\n"),
    );

    if (details) {
      diagnostics.push(`Whisper CLI failure details: ${details}`);
    }

    diagnostics.push("Manual fallback command: pip install -U openai-whisper");
  }

  return {
    installed,
    version: installed ? version || "OK" : null,
  };
}

function detectYtDlp(runtime: PythonRuntime | null, diagnostics: string[]): DependencyStatus {
  const cliProbe = runCommand("yt-dlp", ["--version"], 8000);

  if (!runtime) {
    return {
      installed: cliProbe.ok,
      version: cliProbe.ok ? firstNonEmptyLine(cliProbe.stdout, cliProbe.stderr) || "OK" : null,
    };
  }

  const importProbe = runPython(runtime, [
    "-c",
    "import importlib.metadata as m; print(m.version('yt-dlp'))",
  ]);

  const moduleProbe = runPython(runtime, ["-m", "yt_dlp", "--version"], 12000);

  const version = firstNonEmptyLine(importProbe.stdout, moduleProbe.stdout, moduleProbe.stderr);
  const installed = importProbe.ok || moduleProbe.ok || cliProbe.ok;

  if (!installed) {
    const details = trimOutput(
      [
        importProbe.stderr,
        moduleProbe.stdout,
        moduleProbe.stderr,
        moduleProbe.errorMessage,
        cliProbe.stderr,
        cliProbe.errorMessage,
      ]
        .filter(Boolean)
        .join("\n"),
    );

    if (details) {
      diagnostics.push(`yt-dlp probe failed: ${details}`);
    }
  }

  return {
    installed,
    version: installed
      ? version || firstNonEmptyLine(cliProbe.stdout, cliProbe.stderr) || "OK"
      : null,
  };
}

function detectFFmpeg(): DependencyStatus {
  const probe = runCommand("ffmpeg", ["-version"], 8000);
  if (!probe.ok) {
    return { installed: false, version: null };
  }

  const line = firstNonEmptyLine(probe.stdout, probe.stderr);
  const match = line?.match(/ffmpeg version\s+(\S+)/i);
  return {
    installed: true,
    version: match ? match[1] : line,
  };
}

function detectCuda(): DependencyStatus {
  const probe = runCommand(
    "nvidia-smi",
    ["--query-gpu=driver_version", "--format=csv,noheader"],
    10000,
  );

  if (!probe.ok) {
    return { installed: false, version: null };
  }

  return {
    installed: true,
    version: firstNonEmptyLine(probe.stdout, probe.stderr),
  };
}

function detectPyTorch(runtime: PythonRuntime | null): DependencyStatus {
  if (!runtime) {
    return { installed: false, version: null };
  }

  const probe = runPython(runtime, ["-c", "import torch; print(torch.__version__)"]);
  return {
    installed: probe.ok,
    version: probe.ok ? firstNonEmptyLine(probe.stdout, probe.stderr) : null,
  };
}

async function detectOllama(): Promise<DependencyStatus> {
  const binaryProbe = runCommand("ollama", ["--version"], 8000);

  if (!binaryProbe.ok) {
    return { installed: false, version: null };
  }

  const binaryVersion = firstNonEmptyLine(binaryProbe.stdout, binaryProbe.stderr) || "OK";

  try {
    const response = await fetch("http://localhost:11434/api/tags", {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      return {
        installed: true,
        version: `${binaryVersion} (server online)`,
      };
    }
  } catch {
    // service offline is not treated as missing install
  }

  return {
    installed: true,
    version: `${binaryVersion} (server offline)`,
  };
}

async function snapshotDependencies(): Promise<DependencySnapshot> {
  const diagnostics: string[] = [];
  const pythonDetection = detectPythonRuntime(diagnostics);

  const checks: DependencyChecks = {
    python: pythonDetection.status,
    whisper: detectWhisper(pythonDetection.runtime, diagnostics),
    ytdlp: detectYtDlp(pythonDetection.runtime, diagnostics),
    ffmpeg: detectFFmpeg(),
    cuda: detectCuda(),
    pytorch: detectPyTorch(pythonDetection.runtime),
    ollama: await detectOllama(),
  };

  return {
    checks,
    pythonRuntime: pythonDetection.runtime,
    diagnostics,
  };
}

function detectFailureCategory(output: string): string {
  const text = output.toLowerCase();

  if (
    text.includes("access is denied") ||
    text.includes("administrator") ||
    text.includes("eacces") ||
    text.includes("permission")
  ) {
    return "permission-error";
  }

  if (
    text.includes("conflict") ||
    text.includes("resolutionimpossible") ||
    text.includes("incompatible")
  ) {
    return "version-conflict";
  }

  if (text.includes("not recognized") || text.includes("enoent") || text.includes("path")) {
    return "path-env-error";
  }

  return "install-failed";
}

function buildInstallStrategies(name: string, runtime: PythonRuntime | null): InstallStrategy[] {
  switch (name) {
    case "python":
      return [
        {
          name: "chocolatey",
          executable: "choco",
          args: ["install", "python", "-y"],
        },
        {
          name: "winget",
          executable: "winget",
          args: [
            "install",
            "-e",
            "--id",
            "Python.Python.3.11",
            "--accept-package-agreements",
            "--accept-source-agreements",
          ],
        },
      ];
    case "ffmpeg":
      return [
        {
          name: "winget",
          executable: "winget",
          args: ["install", "Gyan.FFmpeg"],
        },
      ];
    case "whisper":
      if (!runtime) {
        return [];
      }
      return [
        {
          name: "python-pip",
          executable: runtime.executable,
          args: [...runtime.argsPrefix, "-m", "pip", "install", "-U", "openai-whisper"],
        },
        {
          name: "pip",
          executable: "pip",
          args: ["install", "-U", "openai-whisper"],
        },
      ];
    case "ytdlp":
      if (!runtime) {
        return [];
      }
      return [
        {
          name: "python-pip",
          executable: runtime.executable,
          args: [...runtime.argsPrefix, "-m", "pip", "install", "-U", "yt-dlp"],
        },
        {
          name: "pip",
          executable: "pip",
          args: ["install", "-U", "yt-dlp"],
        },
      ];
    case "pytorch":
      if (!runtime) {
        return [];
      }
      return [
        {
          name: "python-pip",
          executable: runtime.executable,
          args: [
            ...runtime.argsPrefix,
            "-m",
            "pip",
            "install",
            "torch",
            "torchvision",
            "torchaudio",
            "--index-url",
            "https://download.pytorch.org/whl/cu121",
          ],
        },
      ];
    default:
      return [];
  }
}

function buildUninstallStrategies(name: string, runtime: PythonRuntime | null): InstallStrategy[] {
  switch (name) {
    case "python":
      return [
        {
          name: "winget",
          executable: "winget",
          args: ["uninstall", "Python.Python.3.11"],
        },
      ];
    case "ffmpeg":
      return [
        {
          name: "winget",
          executable: "winget",
          args: ["uninstall", "Gyan.FFmpeg"],
        },
      ];
    case "whisper":
      return runtime
        ? [
            {
              name: "python-pip",
              executable: runtime.executable,
              args: [...runtime.argsPrefix, "-m", "pip", "uninstall", "-y", "openai-whisper"],
            },
            {
              name: "pip",
              executable: "pip",
              args: ["uninstall", "-y", "openai-whisper"],
            },
          ]
        : [
            {
              name: "pip",
              executable: "pip",
              args: ["uninstall", "-y", "openai-whisper"],
            },
          ];
    case "ytdlp":
      return runtime
        ? [
            {
              name: "python-pip",
              executable: runtime.executable,
              args: [...runtime.argsPrefix, "-m", "pip", "uninstall", "-y", "yt-dlp"],
            },
            {
              name: "pip",
              executable: "pip",
              args: ["uninstall", "-y", "yt-dlp"],
            },
          ]
        : [
            {
              name: "pip",
              executable: "pip",
              args: ["uninstall", "-y", "yt-dlp"],
            },
          ];
    case "pytorch":
      return runtime
        ? [
            {
              name: "python-pip",
              executable: runtime.executable,
              args: [
                ...runtime.argsPrefix,
                "-m",
                "pip",
                "uninstall",
                "-y",
                "torch",
                "torchvision",
                "torchaudio",
              ],
            },
            {
              name: "pip",
              executable: "pip",
              args: ["uninstall", "-y", "torch", "torchvision", "torchaudio"],
            },
          ]
        : [
            {
              name: "pip",
              executable: "pip",
              args: ["uninstall", "-y", "torch", "torchvision", "torchaudio"],
            },
          ];
    default:
      return [];
  }
}

function toPowerShellToken(token: string): string {
  if (/^[A-Za-z0-9_./:=+\-]+$/.test(token)) {
    return token;
  }
  return `'${token.replace(/'/g, "''")}'`;
}

function strategyToCommand(strategy: InstallStrategy): string {
  const tokens = [strategy.executable, ...strategy.args].map(toPowerShellToken);
  const executableToken = tokens[0];
  const argsTokens = tokens.slice(1);
  const needsCallOperator = executableToken.startsWith("'") || executableToken.startsWith('"');
  const prefix = needsCallOperator ? "& " : "";
  return `${prefix}${executableToken}${argsTokens.length ? ` ${argsTokens.join(" ")}` : ""}`;
}

function buildPytorchTerminalInstallScript(runtime: PythonRuntime, tier: PytorchGpuTier): string {
  const expectedCudaPrefix = expectedCudaPrefixForPytorchTier(tier);
  const validateStrategy: InstallStrategy = {
    name: "validate",
    executable: runtime.executable,
    args: [...runtime.argsPrefix, ...buildPytorchCudaValidationArgs(expectedCudaPrefix)],
  };
  const uninstallStrategy: InstallStrategy = {
    name: "uninstall",
    executable: runtime.executable,
    args: [...runtime.argsPrefix, ...buildPytorchPipUninstallArgs()],
  };
  const installStrategy: InstallStrategy = {
    name: "install",
    executable: runtime.executable,
    args: [...runtime.argsPrefix, ...buildPytorchPipInstallArgs(tier)],
  };

  const validateCmd = strategyToCommand(validateStrategy);
  const uninstallCmd = strategyToCommand(uninstallStrategy);
  const installCmd = strategyToCommand(installStrategy);

  return [
    "Write-Host 'Validando PyTorch existente...';",
    validateCmd,
    "if ($LASTEXITCODE -eq 0) { Write-Host 'PyTorch já está instalado e validado.'; exit 0 }",
    "Write-Host 'Removendo PyTorch existente (torch/torchvision/torchaudio)...';",
    uninstallCmd,
    "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    "Write-Host 'Instalando PyTorch...';",
    installCmd,
    "if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }",
    "Write-Host 'Validando CUDA no PyTorch...';",
    validateCmd,
    "exit $LASTEXITCODE",
  ].join("; ");
}

async function getDependencyTerminalCommand(
  name: string,
  mode: DependencyOperationMode,
  options?: DependencyInstallOptions,
): Promise<string | null> {
  const snapshot = await snapshotDependencies();
  const runtime = snapshot.pythonRuntime;

  if (name === "pytorch" && mode === "install") {
    const tier = options?.pytorchGpuTier;
    if (!tier || !runtime) {
      return null;
    }
    return buildPytorchTerminalInstallScript(runtime, tier);
  }

  const strategies =
    mode === "uninstall"
      ? buildUninstallStrategies(name, runtime)
      : buildInstallStrategies(name, runtime);

  if (strategies.length > 0) {
    return strategyToCommand(strategies[0]);
  }

  return INSTALLATION_GUIDES[name]?.automatic?.command || null;
}

function openSystemTerminal(command: string): { success: boolean; error?: string } {
  if (process.platform !== "win32") {
    return {
      success: false,
      error: `Opening a system terminal is currently supported only on Windows (current: ${process.platform}).`,
    };
  }

  const terminalCandidates: string[] = ["powershell.exe", "pwsh.exe"];

  const launchErrorMessages: string[] = [];

  for (const terminalExe of terminalCandidates) {
    try {
      spawn(
        "cmd.exe",
        [
          "/c",
          "start",
          "",
          terminalExe,
          "-NoProfile",
          "-NoExit",
          "-ExecutionPolicy",
          "Bypass",
          "-Command",
          command,
        ],
        {
          stdio: "ignore",
        },
      );

      return { success: true };
    } catch (error: any) {
      launchErrorMessages.push(`${terminalExe}: ${error?.message || "unknown error"}`);
    }
  }

  try {
    spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", command], {
      stdio: "ignore",
    });

    return { success: true };
  } catch (error: any) {
    return {
      success: false,
      error:
        launchErrorMessages.length > 0
          ? `Failed to open terminal (${launchErrorMessages.join(" | ")})`
          : error?.message || "Failed to open system terminal",
    };
  }
}

function summarizeCommand(result: CommandResult): string {
  const command = [result.executable, ...result.args].join(" ");
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const trimmed = trimOutput(output || result.errorMessage || "No output captured.");
  return `${command}\n${trimmed}`;
}

function isSessionCancelled(control?: DependencySessionControl): boolean {
  return Boolean(control?.cancelRequested);
}

function buildPytorchPipUninstallArgs(): string[] {
  return ["-m", "pip", "uninstall", "-y", "torch", "torchvision", "torchaudio"];
}

function buildPytorchPipInstallArgs(tier: PytorchGpuTier): string[] {
  if (tier === "rtx_5000") {
    return [
      "-m",
      "pip",
      "install",
      "--pre",
      "torch",
      "torchvision",
      "torchaudio",
      "--index-url",
      "https://download.pytorch.org/whl/nightly/cu128",
    ];
  }

  return [
    "-m",
    "pip",
    "install",
    "torch",
    "torchvision",
    "torchaudio",
    "--index-url",
    "https://download.pytorch.org/whl/cu121",
  ];
}

function buildPytorchCudaValidationArgs(expectedCudaPrefix: string): string[] {
  const code =
    "import torch, sys; " +
    `expected_prefix=${JSON.stringify(expectedCudaPrefix)}; ` +
    "cuda_version=getattr(getattr(torch,'version',None),'cuda',None); " +
    "cuda_available=bool(torch.cuda.is_available()); " +
    "print(f'torch.__version__={torch.__version__}'); " +
    "print(f'torch.version.cuda={cuda_version}'); " +
    "print(f'torch.cuda.is_available()={cuda_available}'); " +
    "sys.exit(0 if (cuda_available and cuda_version and str(cuda_version).startswith(expected_prefix)) else 1)";

  return ["-u", "-c", code];
}

async function runPythonAsync(
  runtime: PythonRuntime,
  args: string[],
  timeoutMs: number,
  onLog?: (line: string) => void,
  sessionControl?: DependencySessionControl,
): Promise<CommandResult> {
  return runCommandAsync(
    runtime.executable,
    [...runtime.argsPrefix, ...args],
    timeoutMs,
    onLog,
    { PYTHONUNBUFFERED: "1" },
    {
      isCancelled: () => isSessionCancelled(sessionControl),
      setCurrentChild: (child) => {
        if (sessionControl) {
          sessionControl.currentChild = child;
        }
      },
    },
  );
}

async function performPytorchGpuAwareInstall(
  runtime: PythonRuntime,
  tier: PytorchGpuTier,
  onLog?: (line: string) => void,
  sessionControl?: DependencySessionControl,
): Promise<InstallExecutionResult> {
  const guide = INSTALLATION_GUIDES.pytorch;
  const expectedCudaPrefix = expectedCudaPrefixForPytorchTier(tier);

  onLog?.(`PyTorch GPU tier selected: ${tier}. Expected CUDA: ${expectedCudaPrefix}`);
  onLog?.("Validating existing PyTorch installation...");

  const preValidation = await runPythonAsync(
    runtime,
    buildPytorchCudaValidationArgs(expectedCudaPrefix),
    45_000,
    (line) => onLog?.(`[validate] ${line}`),
    sessionControl,
  );

  if (isSessionCancelled(sessionControl) || preValidation.errorCode === "ECANCELED") {
    return {
      statusCode: 499,
      payload: {
        success: false,
        message: `Instalação de ${guide.name} cancelada pelo usuário`,
      },
    };
  }

  if (preValidation.ok) {
    const snapshot = await snapshotDependencies();
    return {
      statusCode: 200,
      payload: {
        success: true,
        message: `${guide.name} já está instalado e validado para CUDA ${expectedCudaPrefix}.`,
        installer: "validated",
        output: trimOutput([preValidation.stdout, preValidation.stderr].filter(Boolean).join("\n")),
        dependencies: snapshot.checks,
        diagnostics: snapshot.diagnostics,
      },
    };
  }

  onLog?.("Removing existing PyTorch packages (torch/torchvision/torchaudio)...");
  const uninstallResult = await runPythonAsync(
    runtime,
    buildPytorchPipUninstallArgs(),
    INSTALL_TIMEOUT_MS,
    (line) => onLog?.(`[uninstall] ${line}`),
    sessionControl,
  );

  if (isSessionCancelled(sessionControl) || uninstallResult.errorCode === "ECANCELED") {
    return {
      statusCode: 499,
      payload: {
        success: false,
        message: `Instalação de ${guide.name} cancelada pelo usuário`,
      },
    };
  }

  if (!uninstallResult.ok) {
    const output = trimOutput(
      [uninstallResult.stdout, uninstallResult.stderr, uninstallResult.errorMessage]
        .filter(Boolean)
        .join("\n"),
    );

    return {
      statusCode: 500,
      payload: {
        success: false,
        message: `Falha ao remover instalação existente do ${guide.name}`,
        failureCategory: detectFailureCategory(output),
        error: output,
      },
    };
  }

  const installArgs = buildPytorchPipInstallArgs(tier);
  onLog?.(
    `[install] Executing: ${runtime.executable} ${[...runtime.argsPrefix, ...installArgs].join(" ")}`,
  );

  const installResult = await runPythonAsync(
    runtime,
    installArgs,
    INSTALL_TIMEOUT_MS,
    (line) => onLog?.(`[install] ${line}`),
    sessionControl,
  );

  if (isSessionCancelled(sessionControl) || installResult.errorCode === "ECANCELED") {
    return {
      statusCode: 499,
      payload: {
        success: false,
        message: `Instalação de ${guide.name} cancelada pelo usuário`,
      },
    };
  }

  if (!installResult.ok) {
    const output = trimOutput(
      [installResult.stdout, installResult.stderr, installResult.errorMessage]
        .filter(Boolean)
        .join("\n"),
    );

    const snapshot = await snapshotDependencies();

    return {
      statusCode: 500,
      payload: {
        success: false,
        message: `Falha ao instalar ${guide.name} (CUDA ${expectedCudaPrefix})`,
        failureCategory: detectFailureCategory(output),
        error: output,
        dependencies: snapshot.checks,
        diagnostics: snapshot.diagnostics,
      },
    };
  }

  onLog?.("Validating PyTorch CUDA availability...");
  const postValidation = await runPythonAsync(
    runtime,
    buildPytorchCudaValidationArgs(expectedCudaPrefix),
    60_000,
    (line) => onLog?.(`[validate] ${line}`),
    sessionControl,
  );

  const snapshot = await snapshotDependencies();

  if (!postValidation.ok) {
    const output = trimOutput(
      [postValidation.stdout, postValidation.stderr, postValidation.errorMessage]
        .filter(Boolean)
        .join("\n"),
    );

    return {
      statusCode: 500,
      payload: {
        success: false,
        message:
          "PyTorch foi instalado, mas a validação de CUDA falhou. Verifique drivers NVIDIA e compatibilidade CUDA.",
        failureCategory: "install-failed",
        error: output,
        dependencies: snapshot.checks,
        diagnostics: snapshot.diagnostics,
      },
    };
  }

  const output = trimOutput(
    [installResult.stdout, installResult.stderr].filter(Boolean).join("\n"),
  );

  return {
    statusCode: 200,
    payload: {
      success: true,
      message: `${guide.name} instalado e validado com CUDA ${expectedCudaPrefix}.`,
      installer: tier === "rtx_5000" ? "pip-nightly-cu128" : "pip-cu121",
      output,
      dependencies: snapshot.checks,
      diagnostics: snapshot.diagnostics,
    },
  };
}

async function performDependencyInstall(
  name: string,
  onLog?: (line: string) => void,
  sessionControl?: DependencySessionControl,
  options?: DependencyInstallOptions,
): Promise<InstallExecutionResult> {
  const guide = INSTALLATION_GUIDES[name];

  if (!guide) {
    return {
      statusCode: 404,
      payload: {
        success: false,
        message: `Dependency '${name}' not found`,
      },
    };
  }

  onLog?.(`Starting automatic dependency install for ${name}.`);

  if (isSessionCancelled(sessionControl)) {
    return {
      statusCode: 499,
      payload: {
        success: false,
        message: `Instalação de ${name} cancelada antes de iniciar`,
      },
    };
  }

  if (name === "pytorch" && !options?.pytorchGpuTier) {
    return {
      statusCode: 400,
      payload: {
        success: false,
        message:
          "Selecione o tipo de GPU (RTX 4000 ou inferior / RTX 5000) antes de instalar o PyTorch automaticamente.",
      },
    };
  }

  const preSnapshot = await snapshotDependencies();
  let activeSnapshot = preSnapshot;

  onLog?.(
    `Pre-check: python=${preSnapshot.checks.python.installed ? preSnapshot.checks.python.version || "installed" : "missing"} whisper=${preSnapshot.checks.whisper.installed ? "installed" : "missing"}`,
  );

  if (!guide.automatic) {
    return {
      statusCode: 400,
      payload: {
        success: false,
        error: "Automatic installation not available for this dependency",
        message: `Use manual installation for ${name}`,
        dependencies: preSnapshot.checks,
      },
    };
  }

  let strategies = buildInstallStrategies(name, preSnapshot.pythonRuntime);

  if (strategies.length === 0 && (name === "whisper" || name === "pytorch")) {
    onLog?.("Python runtime is not ready. Attempting Python bootstrap first.");
    const pythonBootstrapStrategies = buildInstallStrategies("python", preSnapshot.pythonRuntime);
    const pythonBootstrapFailures: string[] = [];

    for (const strategy of pythonBootstrapStrategies) {
      onLog?.(`[${strategy.name}] Executing: ${strategy.executable} ${strategy.args.join(" ")}`);
      const result = await runCommandAsync(
        strategy.executable,
        strategy.args,
        INSTALL_TIMEOUT_MS,
        (line) => onLog?.(`[${strategy.name}] ${line}`),
        undefined,
        {
          isCancelled: () => isSessionCancelled(sessionControl),
          setCurrentChild: (child) => {
            if (sessionControl) {
              sessionControl.currentChild = child;
            }
          },
        },
      );

      if (isSessionCancelled(sessionControl) || result.errorCode === "ECANCELED") {
        onLog?.("Installation cancelled by user during Python bootstrap.");
        return {
          statusCode: 499,
          payload: {
            success: false,
            message: `Instalação de ${guide.name} cancelada pelo usuário`,
          },
        };
      }

      if (!result.ok) {
        pythonBootstrapFailures.push(`[${strategy.name}] ${summarizeCommand(result)}`);
        onLog?.(`[${strategy.name}] Failed to bootstrap Python.`);
        continue;
      }

      onLog?.(`[${strategy.name}] Python bootstrap command finished. Revalidating runtime.`);
      activeSnapshot = await snapshotDependencies();
      strategies = buildInstallStrategies(name, activeSnapshot.pythonRuntime);

      if (strategies.length > 0) {
        onLog?.("Python runtime became available. Continuing dependency installation.");
        break;
      }

      const bootstrapValidationFailure = `[${strategy.name}] Python install command succeeded but Python 3.10+ with pip is still unavailable for ${name}.`;
      pythonBootstrapFailures.push(bootstrapValidationFailure);
      onLog?.(bootstrapValidationFailure);
    }

    if (strategies.length === 0 && pythonBootstrapFailures.length > 0) {
      const mergedBootstrapOutput = pythonBootstrapFailures.join("\n\n");
      const diagnostics = [...activeSnapshot.diagnostics];

      if (name === "whisper") {
        diagnostics.push("Manual fallback command: pip install -U openai-whisper");
      }

      return {
        statusCode: 500,
        payload: {
          success: false,
          message: `Failed to prepare Python runtime required for ${name}`,
          failureCategory: detectFailureCategory(mergedBootstrapOutput),
          error: trimOutput(mergedBootstrapOutput),
          dependencies: activeSnapshot.checks,
          diagnostics,
        },
      };
    }
  }

  if (name === "pytorch") {
    const tier = options?.pytorchGpuTier;
    if (!tier) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          message:
            "Selecione o tipo de GPU (RTX 4000 ou inferior / RTX 5000) antes de instalar o PyTorch automaticamente.",
          dependencies: activeSnapshot.checks,
          diagnostics: activeSnapshot.diagnostics,
        },
      };
    }

    if (!activeSnapshot.pythonRuntime) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          message: "Python 3.10+ com pip é necessário antes de instalar PyTorch automaticamente.",
          dependencies: activeSnapshot.checks,
          diagnostics: activeSnapshot.diagnostics,
        },
      };
    }

    return performPytorchGpuAwareInstall(activeSnapshot.pythonRuntime, tier, onLog, sessionControl);
  }

  if (strategies.length === 0) {
    const diagnostics = [...activeSnapshot.diagnostics];
    if (name === "whisper") {
      diagnostics.push("Manual fallback command: pip install -U openai-whisper");
    }

    return {
      statusCode: 400,
      payload: {
        success: false,
        message:
          name === "whisper" || name === "pytorch"
            ? "Python 3.10+ with pip is required before installing this dependency automatically"
            : `No automatic installation strategy is available for ${name}`,
        dependencies: activeSnapshot.checks,
        diagnostics,
      },
    };
  }

  const strategyFailures: string[] = [];

  for (const strategy of strategies) {
    if (isSessionCancelled(sessionControl)) {
      onLog?.(`Installation cancelled before running installer strategy ${strategy.name}.`);
      return {
        statusCode: 499,
        payload: {
          success: false,
          message: `Instalação de ${guide.name} cancelada pelo usuário`,
        },
      };
    }

    const commandText = `${strategy.executable} ${strategy.args.join(" ")}`;
    onLog?.(`[${strategy.name}] Executing: ${commandText}`);

    const result = await runCommandAsync(
      strategy.executable,
      strategy.args,
      INSTALL_TIMEOUT_MS,
      (line) => onLog?.(`[${strategy.name}] ${line}`),
      undefined,
      {
        isCancelled: () => isSessionCancelled(sessionControl),
        setCurrentChild: (child) => {
          if (sessionControl) {
            sessionControl.currentChild = child;
          }
        },
      },
    );

    if (isSessionCancelled(sessionControl) || result.errorCode === "ECANCELED") {
      onLog?.("Installation cancelled by user.");
      return {
        statusCode: 499,
        payload: {
          success: false,
          message: `Instalação de ${guide.name} cancelada pelo usuário`,
        },
      };
    }

    if (!result.ok) {
      strategyFailures.push(`[${strategy.name}] ${summarizeCommand(result)}`);
      onLog?.(`[${strategy.name}] Installer command failed.`);
      continue;
    }

    onLog?.(`[${strategy.name}] Installer command finished. Validating dependency state.`);
    const postSnapshot = await snapshotDependencies();
    const installedAfterRun = Boolean(
      postSnapshot.checks[name as keyof DependencyChecks]?.installed,
    );

    if (!installedAfterRun) {
      const validationFailure = `[${strategy.name}] install command succeeded but validation failed (possible partial install or PATH/environment issue).`;
      strategyFailures.push(validationFailure);
      onLog?.(validationFailure);

      const relevantDiagnostics = postSnapshot.diagnostics.filter((line) =>
        /(whisper|python|pip|path|entrypoint|manual fallback)/i.test(line),
      );
      if (relevantDiagnostics.length > 0) {
        onLog?.(`Validation diagnostics:\n${relevantDiagnostics.join("\n")}`);
      }

      continue;
    }

    const output = trimOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
    onLog?.(`[${strategy.name}] Installation validated successfully.`);

    return {
      statusCode: 200,
      payload: {
        success: true,
        message: `${guide.name} installed and validated successfully`,
        installer: strategy.name,
        output,
        dependencies: postSnapshot.checks,
        diagnostics: postSnapshot.diagnostics,
      },
    };
  }

  const mergedFailureOutput = strategyFailures.join("\n\n");
  const category = detectFailureCategory(mergedFailureOutput);
  const postFailureSnapshot = await snapshotDependencies();
  const failureDiagnostics = [...postFailureSnapshot.diagnostics];

  if (name === "whisper") {
    failureDiagnostics.push("Manual fallback command: pip install -U openai-whisper");
  }

  onLog?.(`All installer strategies failed for ${name}.`);

  return {
    statusCode: 500,
    payload: {
      success: false,
      message: `Failed to install ${guide.name}`,
      failureCategory: category,
      error: trimOutput(mergedFailureOutput || "No installer strategy succeeded."),
      dependencies: postFailureSnapshot.checks,
      diagnostics: failureDiagnostics,
    },
  };
}

async function performDependencyUninstall(
  name: string,
  onLog?: (line: string) => void,
  sessionControl?: DependencySessionControl,
): Promise<InstallExecutionResult> {
  const guide = INSTALLATION_GUIDES[name];

  if (!guide) {
    return {
      statusCode: 404,
      payload: {
        success: false,
        message: `Dependency '${name}' not found`,
      },
    };
  }

  onLog?.(`Starting automatic dependency uninstall for ${name}.`);

  if (isSessionCancelled(sessionControl)) {
    return {
      statusCode: 499,
      payload: {
        success: false,
        message: `Desinstalação de ${name} cancelada antes de iniciar`,
      },
    };
  }

  const preSnapshot = await snapshotDependencies();
  const preState = preSnapshot.checks[name as keyof DependencyChecks];

  if (preState && !preState.installed) {
    onLog?.(`${name} is already not installed.`);
    return {
      statusCode: 200,
      payload: {
        success: true,
        message: `${guide.name} is already not installed`,
        dependencies: preSnapshot.checks,
        diagnostics: preSnapshot.diagnostics,
      },
    };
  }

  const strategies = buildUninstallStrategies(name, preSnapshot.pythonRuntime);

  if (strategies.length === 0) {
    return {
      statusCode: 400,
      payload: {
        success: false,
        message: `No automatic uninstall strategy is available for ${name}`,
        dependencies: preSnapshot.checks,
        diagnostics: preSnapshot.diagnostics,
      },
    };
  }

  const strategyFailures: string[] = [];

  for (const strategy of strategies) {
    if (isSessionCancelled(sessionControl)) {
      onLog?.(`Uninstall cancelled before running strategy ${strategy.name}.`);
      return {
        statusCode: 499,
        payload: {
          success: false,
          message: `Desinstalação de ${guide.name} cancelada pelo usuário`,
        },
      };
    }

    const commandText = `${strategy.executable} ${strategy.args.join(" ")}`;
    onLog?.(`[${strategy.name}] Executing: ${commandText}`);

    const result = await runCommandAsync(
      strategy.executable,
      strategy.args,
      INSTALL_TIMEOUT_MS,
      (line) => onLog?.(`[${strategy.name}] ${line}`),
      undefined,
      {
        isCancelled: () => isSessionCancelled(sessionControl),
        setCurrentChild: (child) => {
          if (sessionControl) {
            sessionControl.currentChild = child;
          }
        },
      },
    );

    if (isSessionCancelled(sessionControl) || result.errorCode === "ECANCELED") {
      onLog?.("Uninstall cancelled by user.");
      return {
        statusCode: 499,
        payload: {
          success: false,
          message: `Desinstalação de ${guide.name} cancelada pelo usuário`,
        },
      };
    }

    if (!result.ok) {
      strategyFailures.push(`[${strategy.name}] ${summarizeCommand(result)}`);
      onLog?.(`[${strategy.name}] Uninstall command failed.`);
      continue;
    }

    onLog?.(`[${strategy.name}] Uninstall command finished. Validating dependency state.`);
    const postSnapshot = await snapshotDependencies();
    const stillInstalled = Boolean(postSnapshot.checks[name as keyof DependencyChecks]?.installed);

    if (stillInstalled) {
      const validationFailure = `[${strategy.name}] uninstall command succeeded but validation still reports dependency as installed.`;
      strategyFailures.push(validationFailure);
      onLog?.(validationFailure);

      const relevantDiagnostics = postSnapshot.diagnostics.filter((line) =>
        /(whisper|python|pip|path|entrypoint|manual fallback)/i.test(line),
      );
      if (relevantDiagnostics.length > 0) {
        onLog?.(`Validation diagnostics:\n${relevantDiagnostics.join("\n")}`);
      }

      continue;
    }

    const output = trimOutput([result.stdout, result.stderr].filter(Boolean).join("\n"));
    onLog?.(`[${strategy.name}] Uninstall validated successfully.`);

    return {
      statusCode: 200,
      payload: {
        success: true,
        message: `${guide.name} uninstalled and validated successfully`,
        installer: strategy.name,
        output,
        dependencies: postSnapshot.checks,
        diagnostics: postSnapshot.diagnostics,
      },
    };
  }

  const mergedFailureOutput = strategyFailures.join("\n\n");
  const category = detectFailureCategory(mergedFailureOutput);
  const postFailureSnapshot = await snapshotDependencies();

  onLog?.(`All uninstall strategies failed for ${name}.`);

  return {
    statusCode: 500,
    payload: {
      success: false,
      message: `Failed to uninstall ${guide.name}`,
      failureCategory: category,
      error: trimOutput(mergedFailureOutput || "No uninstall strategy succeeded."),
      dependencies: postFailureSnapshot.checks,
      diagnostics: postFailureSnapshot.diagnostics,
    },
  };
}

export function registerDependenciesRoutes(fastify: FastifyInstance) {
  fastify.get("/dependencies", async () => {
    const snapshot = await snapshotDependencies();
    return {
      dependencies: snapshot.checks,
      diagnostics: snapshot.diagnostics,
    };
  });

  fastify.get("/dependencies/:name/instructions", async (request: any, reply) => {
    const { name } = request.params;
    const guide = INSTALLATION_GUIDES[name];

    if (!guide) {
      return reply.status(404).send({ error: "Dependency not found" });
    }

    return guide;
  });

  fastify.post("/dependencies/:name/install", async (request: any, reply) => {
    const { name } = request.params;

    const options: DependencyInstallOptions = {};
    const pytorchGpuTier = parsePytorchGpuTier(request.body?.pytorchGpuTier);
    if (pytorchGpuTier) {
      options.pytorchGpuTier = pytorchGpuTier;
    }

    if (name === "pytorch" && !options.pytorchGpuTier) {
      return reply.status(400).send({
        success: false,
        message:
          "Selecione o tipo de GPU (RTX 4000 ou inferior / RTX 5000) antes de instalar o PyTorch automaticamente.",
      });
    }

    const result = await performDependencyInstall(name, undefined, undefined, options);
    return reply.status(result.statusCode).send(result.payload);
  });

  fastify.post("/dependencies/:name/uninstall", async (request: any, reply) => {
    const { name } = request.params;
    const result = await performDependencyUninstall(name);
    return reply.status(result.statusCode).send(result.payload);
  });

  fastify.post("/dependencies/:name/install/start", async (request: any, reply) => {
    cleanupInstallSessions();

    const { name } = request.params;

    const options: DependencyInstallOptions = {};
    const pytorchGpuTier = parsePytorchGpuTier(request.body?.pytorchGpuTier);
    if (pytorchGpuTier) {
      options.pytorchGpuTier = pytorchGpuTier;
    }

    if (name === "pytorch" && !options.pytorchGpuTier) {
      return reply.status(400).send({
        success: false,
        message:
          "Selecione o tipo de GPU (RTX 4000 ou inferior / RTX 5000) antes de instalar o PyTorch automaticamente.",
      });
    }

    const sessionId = randomUUID();
    const session: DependencyInstallSession = {
      id: sessionId,
      operation: "install",
      dependencyName: name,
      status: "running",
      startedAt: nowIsoTimestamp(),
      logs: [],
    };

    const sessionControl: DependencySessionControl = {
      cancelRequested: false,
      currentChild: null,
    };

    dependencyInstallSessions.set(sessionId, session);
    dependencySessionControls.set(sessionId, sessionControl);
    appendSessionLog(session, `Install session created for ${name}.`);

    void (async () => {
      try {
        const result = await performDependencyInstall(
          name,
          (line) => appendSessionLog(session, line),
          sessionControl,
          options,
        );
        session.result = result.payload;
        session.status = sessionControl.cancelRequested
          ? "cancelled"
          : result.payload.success
            ? "success"
            : "failed";
        session.endedAt = nowIsoTimestamp();
        appendSessionLog(
          session,
          session.status === "cancelled"
            ? `Installation cancelled for ${name}.`
            : result.payload.success
              ? `Installation finished successfully for ${name}.`
              : `Installation finished with errors for ${name}.`,
        );
      } catch (error: any) {
        session.result = {
          success: false,
          message: `Failed to install ${name}`,
          error: error?.message || "Unexpected install session error",
        };
        session.status = "failed";
        session.endedAt = nowIsoTimestamp();
        appendSessionLog(session, `Unexpected install session error: ${session.result.error}`);
      } finally {
        sessionControl.currentChild = null;
        dependencySessionControls.delete(sessionId);
      }
    })();

    return reply.status(202).send({
      sessionId,
      operation: session.operation,
      dependencyName: name,
      status: session.status,
      startedAt: session.startedAt,
    });
  });

  fastify.post("/dependencies/:name/uninstall/start", async (request: any, reply) => {
    cleanupInstallSessions();

    const { name } = request.params;
    const sessionId = randomUUID();
    const session: DependencyInstallSession = {
      id: sessionId,
      operation: "uninstall",
      dependencyName: name,
      status: "running",
      startedAt: nowIsoTimestamp(),
      logs: [],
    };

    const sessionControl: DependencySessionControl = {
      cancelRequested: false,
      currentChild: null,
    };

    dependencyInstallSessions.set(sessionId, session);
    dependencySessionControls.set(sessionId, sessionControl);
    appendSessionLog(session, `Uninstall session created for ${name}.`);

    void (async () => {
      try {
        const result = await performDependencyUninstall(
          name,
          (line) => appendSessionLog(session, line),
          sessionControl,
        );
        session.result = result.payload;
        session.status = sessionControl.cancelRequested
          ? "cancelled"
          : result.payload.success
            ? "success"
            : "failed";
        session.endedAt = nowIsoTimestamp();
        appendSessionLog(
          session,
          session.status === "cancelled"
            ? `Uninstall cancelled for ${name}.`
            : result.payload.success
              ? `Uninstall finished successfully for ${name}.`
              : `Uninstall finished with errors for ${name}.`,
        );
      } catch (error: any) {
        session.result = {
          success: false,
          message: `Failed to uninstall ${name}`,
          error: error?.message || "Unexpected uninstall session error",
        };
        session.status = "failed";
        session.endedAt = nowIsoTimestamp();
        appendSessionLog(session, `Unexpected uninstall session error: ${session.result.error}`);
      } finally {
        sessionControl.currentChild = null;
        dependencySessionControls.delete(sessionId);
      }
    })();

    return reply.status(202).send({
      sessionId,
      operation: session.operation,
      dependencyName: name,
      status: session.status,
      startedAt: session.startedAt,
    });
  });

  fastify.get("/dependencies/install-sessions/:sessionId", async (request: any, reply) => {
    cleanupInstallSessions();

    const { sessionId } = request.params;
    const session = dependencyInstallSessions.get(sessionId);

    if (!session) {
      return reply.status(404).send({
        success: false,
        message: `Install session '${sessionId}' was not found`,
      });
    }

    return {
      sessionId: session.id,
      operation: session.operation,
      dependencyName: session.dependencyName,
      status: session.status,
      cancelRequested: dependencySessionControls.get(session.id)?.cancelRequested || false,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      logs: session.logs,
      result: session.result,
    };
  });

  fastify.post("/dependencies/install-sessions/:sessionId/cancel", async (request: any, reply) => {
    cleanupInstallSessions();

    const { sessionId } = request.params;
    const session = dependencyInstallSessions.get(sessionId);
    const control = dependencySessionControls.get(sessionId);

    if (!session || !control) {
      return reply.status(404).send({
        success: false,
        message: `Install session '${sessionId}' was not found`,
      });
    }

    if (session.status !== "running") {
      return reply.status(409).send({
        success: false,
        message: `Session '${sessionId}' is not running anymore`,
        status: session.status,
      });
    }

    control.cancelRequested = true;
    appendSessionLog(session, "Cancellation requested by user.");

    try {
      if (control.currentChild) {
        control.currentChild.kill();
      }
    } catch {
      // ignore kill failures, polling loop will eventually resolve session
    }

    return {
      success: true,
      message: "Cancellation requested successfully.",
      sessionId,
      status: session.status,
    };
  });

  fastify.post("/dependencies/:name/open-terminal", async (request: any, reply) => {
    const { name } = request.params;
    const mode: DependencyOperationMode =
      request.body && request.body.mode === "uninstall" ? "uninstall" : "install";

    const options: DependencyInstallOptions = {};
    const pytorchGpuTier = parsePytorchGpuTier(request.body?.pytorchGpuTier);
    if (pytorchGpuTier) {
      options.pytorchGpuTier = pytorchGpuTier;
    }

    if (name === "pytorch" && mode === "install" && !options.pytorchGpuTier) {
      return reply.status(400).send({
        success: false,
        message:
          "Selecione o tipo de GPU (RTX 4000 ou inferior / RTX 5000) antes de instalar o PyTorch automaticamente.",
      });
    }

    const command = await getDependencyTerminalCommand(name, mode, options);

    if (!command) {
      return reply.status(400).send({
        success: false,
        message: `No terminal command available for ${name} (${mode})`,
      });
    }

    const opened = openSystemTerminal(command);
    if (!opened.success) {
      return reply.status(500).send({
        success: false,
        message: opened.error || "Failed to open terminal",
        command,
      });
    }

    return {
      success: true,
      message: `Opened the default system terminal with the ${mode} command.`,
      command,
    };
  });
}
