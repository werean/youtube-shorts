import { existsSync } from "fs";
import path from "path";

import { firstNonEmptyLine, runCommand } from "../execution/commandRunner";
import { MIN_SUPPORTED_PYTHON_MINOR } from "../shared/dependencyTypes";
import type { CommandResult, DependencyStatus, PythonRuntime } from "../shared/dependencyTypes";

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

export function detectPythonRuntime(diagnostics: string[]): {
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

export function runPython(runtime: PythonRuntime, args: string[], timeoutMs = 12000): CommandResult {
  return runCommand(runtime.executable, [...runtime.argsPrefix, ...args], timeoutMs);
}
