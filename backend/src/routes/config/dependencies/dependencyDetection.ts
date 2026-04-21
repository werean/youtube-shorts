import { existsSync } from "fs";
import path from "path";
import { MIN_SUPPORTED_PYTHON_MINOR } from "./dependencyTypes";
import { firstNonEmptyLine, runCommand, trimOutput } from "./dependencyCommands";
import type { CommandResult, DependencyChecks, DependencySnapshot, DependencyStatus, PythonRuntime } from "./dependencyTypes";

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

export async function snapshotDependencies(): Promise<DependencySnapshot> {
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
