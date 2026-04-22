import type { ChildProcess } from "child_process";
import type {
  DependenciesSnapshot,
  DependencyInstallOptions,
  DependencyInstallSessionStatus,
  DependencyOperationMode,
  DependencyStatusInfo,
  InstallDependencyResult,
  PytorchGpuTier,
} from "@youtube-shorts/contracts";

export interface DependencyStatus extends DependencyStatusInfo {}

export interface CommandResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  executable: string;
  args: string[];
  errorCode?: string;
  errorMessage?: string;
}

export interface PythonRuntime {
  executable: string;
  argsPrefix: string[];
  version: string;
  executablePath: string;
  source: string;
}

export interface DependencyChecks extends DependenciesSnapshot {}

export interface DependencySnapshot {
  checks: DependencyChecks;
  pythonRuntime: PythonRuntime | null;
  diagnostics: string[];
}

export interface InstallDependencyPayload
  extends Omit<InstallDependencyResult, "dependencies"> {
  dependencies?: DependencyChecks;
}

export interface InstallExecutionResult {
  statusCode: number;
  payload: InstallDependencyPayload;
}

export type {
  DependencyInstallOptions,
  DependencyInstallSessionStatus,
  DependencyOperationMode,
  PytorchGpuTier,
};

export interface DependencyInstallSession {
  id: string;
  operation: DependencyOperationMode;
  dependencyName: string;
  status: DependencyInstallSessionStatus;
  startedAt: string;
  endedAt?: string;
  logs: string[];
  result?: InstallDependencyPayload;
}

export interface DependencySessionControl {
  cancelRequested: boolean;
  currentChild: ChildProcess | null;
}

export interface CommandExecutionControl {
  isCancelled?: () => boolean;
  setCurrentChild?: (child: ChildProcess | null) => void;
}

export type InstallStrategy = {
  name: string;
  executable: string;
  args: string[];
};

export const MAX_OUTPUT_LEN = 1200;
export const MIN_SUPPORTED_PYTHON_MINOR = 10;
export const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
export const MAX_SESSION_LOG_LINES = 1000;
export const SESSION_TTL_MS = 30 * 60 * 1000;
