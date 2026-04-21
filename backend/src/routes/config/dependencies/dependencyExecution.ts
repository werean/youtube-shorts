import { INSTALLATION_GUIDES } from "../../../config/installer";
import { INSTALL_TIMEOUT_MS } from "./dependencyTypes";
import { runCommandAsync, summarizeCommand, trimOutput } from "./dependencyCommands";
import { snapshotDependencies } from "./dependencyDetection";
import { detectFailureCategory } from "./dependencyFailures";
import {
  buildPytorchCudaValidationArgs,
  buildPytorchPipInstallArgs,
  buildPytorchPipUninstallArgs,
  expectedCudaPrefixForPytorchTier,
} from "./dependencyPytorchPolicy";
import { buildInstallStrategies, buildUninstallStrategies } from "./dependencyStrategies";
import type { CommandResult, DependencyChecks, DependencyInstallOptions, DependencySessionControl, InstallExecutionResult, PythonRuntime, PytorchGpuTier } from "./dependencyTypes";

function isSessionCancelled(control?: DependencySessionControl): boolean {
  return Boolean(control?.cancelRequested);
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

export async function performDependencyInstall(
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

export async function performDependencyUninstall(
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
