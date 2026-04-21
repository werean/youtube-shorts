import { firstNonEmptyLine, runCommand, trimOutput } from "../execution/commandRunner";
import type { DependencyStatus, PythonRuntime } from "../shared/dependencyTypes";
import { runPython } from "./pythonRuntime";

export function detectWhisper(
  runtime: PythonRuntime | null,
  diagnostics: string[],
): DependencyStatus {
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

export function detectYtDlp(
  runtime: PythonRuntime | null,
  diagnostics: string[],
): DependencyStatus {
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

export function detectFFmpeg(): DependencyStatus {
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

export function detectCuda(): DependencyStatus {
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

export function detectPyTorch(runtime: PythonRuntime | null): DependencyStatus {
  if (!runtime) {
    return { installed: false, version: null };
  }

  const probe = runPython(runtime, ["-c", "import torch; print(torch.__version__)"]);
  return {
    installed: probe.ok,
    version: probe.ok ? firstNonEmptyLine(probe.stdout, probe.stderr) : null,
  };
}

export async function detectOllama(): Promise<DependencyStatus> {
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
