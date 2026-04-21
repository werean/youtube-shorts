import { INSTALLATION_GUIDES } from "../../../config/installer";
import { snapshotDependencies } from "../detection/dependencyDetection";
import {
  buildPytorchCudaValidationArgs,
  buildPytorchPipInstallArgs,
  buildPytorchPipUninstallArgs,
  expectedCudaPrefixForPytorchTier,
} from "../policy/pytorchPolicy";
import { INSTALL_TIMEOUT_MS } from "../shared/dependencyTypes";
import type {
  DependencySessionControl,
  InstallExecutionResult,
  PythonRuntime,
  PytorchGpuTier,
} from "../shared/dependencyTypes";
import { trimOutput } from "./commandRunner";
import { detectFailureCategory } from "./failureClassification";
import { runPythonAsync } from "./pythonCommand";
import { isSessionCancelled } from "./sessionControl";

export async function performPytorchGpuAwareInstall(
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
