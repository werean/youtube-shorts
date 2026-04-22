import { INSTALLATION_GUIDES } from "../installationGuides";
import { snapshotDependencies } from "../detection/dependencyDetection";
import { INSTALL_TIMEOUT_MS } from "../shared/dependencyTypes";
import type {
  DependencyChecks,
  DependencySessionControl,
  InstallExecutionResult,
} from "../shared/dependencyTypes";
import { runCommandAsync, summarizeCommand, trimOutput } from "./commandRunner";
import { buildUninstallStrategies } from "./dependencyStrategies";
import { detectFailureCategory } from "./failureClassification";
import { commandControlFromSession, isSessionCancelled } from "./sessionControl";

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
