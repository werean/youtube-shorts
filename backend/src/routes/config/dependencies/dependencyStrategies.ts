import type { InstallStrategy, PythonRuntime } from "./dependencyTypes";

export function buildInstallStrategies(
  name: string,
  runtime: PythonRuntime | null,
): InstallStrategy[] {
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

export function buildUninstallStrategies(
  name: string,
  runtime: PythonRuntime | null,
): InstallStrategy[] {
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

export function strategyToCommand(strategy: InstallStrategy): string {
  const tokens = [strategy.executable, ...strategy.args].map(toPowerShellToken);
  const executableToken = tokens[0];
  const argsTokens = tokens.slice(1);
  const needsCallOperator = executableToken.startsWith("'") || executableToken.startsWith('"');
  const prefix = needsCallOperator ? "& " : "";
  return `${prefix}${executableToken}${argsTokens.length ? ` ${argsTokens.join(" ")}` : ""}`;
}
