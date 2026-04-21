import { INSTALLATION_GUIDES } from "../../../config/installer";
import { INSTALL_TIMEOUT_MS } from "../shared/dependencyTypes";
import { runCommandAsync, summarizeCommand, trimOutput } from "./commandRunner";
import { snapshotDependencies } from "../detection/dependencyDetection";
import { detectFailureCategory } from "./failureClassification";
import { buildInstallStrategies, buildUninstallStrategies } from "./dependencyStrategies";
import { performPytorchGpuAwareInstall } from "./pytorchInstall";
import { commandControlFromSession, isSessionCancelled } from "./sessionControl";
import type {
  DependencyChecks,
  DependencyInstallOptions,
  DependencySessionControl,
  InstallExecutionResult,
} from "../shared/dependencyTypes";

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
        commandControlFromSession(sessionControl),
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
      commandControlFromSession(sessionControl),
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
      commandControlFromSession(sessionControl),
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
