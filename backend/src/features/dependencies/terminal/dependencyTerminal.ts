import { spawn } from "child_process";

import { INSTALLATION_GUIDES } from "../installationGuides";
import { snapshotDependencies } from "../detection/dependencyDetection";
import {
  buildPytorchCudaValidationArgs,
  buildPytorchPipInstallArgs,
  buildPytorchPipUninstallArgs,
  expectedCudaPrefixForPytorchTier,
} from "../policy/pytorchPolicy";
import {
  buildInstallStrategies,
  buildUninstallStrategies,
  strategyToCommand,
} from "../execution/dependencyStrategies";
import type {
  DependencyInstallOptions,
  DependencyOperationMode,
  InstallStrategy,
  PythonRuntime,
  PytorchGpuTier,
} from "../shared/dependencyTypes";

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

export async function getDependencyTerminalCommand(
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

export function openSystemTerminal(command: string): { success: boolean; error?: string } {
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
