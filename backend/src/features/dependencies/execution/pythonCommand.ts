import { runCommandAsync } from "./commandRunner";
import { commandControlFromSession } from "./sessionControl";
import type {
  CommandResult,
  DependencySessionControl,
  PythonRuntime,
} from "../shared/dependencyTypes";

export async function runPythonAsync(
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
    commandControlFromSession(sessionControl),
  );
}
