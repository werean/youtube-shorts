import { spawn, spawnSync } from "child_process";
import { MAX_OUTPUT_LEN } from "./dependencyTypes";
import type { CommandExecutionControl, CommandResult } from "./dependencyTypes";

export function trimOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_LEN) {
    return value;
  }
  return `${value.slice(0, MAX_OUTPUT_LEN)}...`;
}

export function runCommand(
  executable: string,
  args: string[],
  timeoutMs = 10000,
  envOverrides?: NodeJS.ProcessEnv,
): CommandResult {
  const result = spawnSync(executable, args, {
    encoding: "utf-8",
    timeout: timeoutMs,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
    env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
  });

  const stdout = (result.stdout || "").toString().trim();
  const stderr = (result.stderr || "").toString().trim();
  const error = result.error as NodeJS.ErrnoException | undefined;

  return {
    ok: !error && (result.status ?? 1) === 0,
    exitCode: result.status,
    stdout,
    stderr,
    executable,
    args,
    errorCode: error?.code,
    errorMessage: error?.message,
  };
}

export async function runCommandAsync(
  executable: string,
  args: string[],
  timeoutMs = 10000,
  onLog?: (line: string) => void,
  envOverrides?: NodeJS.ProcessEnv,
  control?: CommandExecutionControl,
): Promise<CommandResult> {
  return new Promise((resolve) => {
    if (control?.isCancelled?.()) {
      resolve({
        ok: false,
        exitCode: null,
        stdout: "",
        stderr: "",
        executable,
        args,
        errorCode: "ECANCELED",
        errorMessage: "Command cancelled before start",
      });
      return;
    }

    let stdout = "";
    let stderr = "";
    let resolved = false;
    let timedOut = false;
    let cancelled = false;

    const child = spawn(executable, args, {
      windowsHide: true,
      env: envOverrides ? { ...process.env, ...envOverrides } : process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    control?.setCurrentChild?.(child);

    const flushChunk = (chunk: string, target: "stdout" | "stderr") => {
      if (target === "stdout") {
        stdout += chunk;
      } else {
        stderr += chunk;
      }

      if (!onLog) {
        return;
      }

      const lines = chunk
        .replace(/\r/g, "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);

      for (const line of lines) {
        onLog(line);
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      onLog?.(
        `Command timed out after ${Math.round(timeoutMs / 1000)}s: ${executable} ${args.join(" ")}`,
      );
      child.kill();
    }, timeoutMs);

    const cancelWatcher = setInterval(() => {
      if (resolved || !control?.isCancelled?.()) {
        return;
      }

      cancelled = true;
      onLog?.(`Command cancelled: ${executable} ${args.join(" ")}`);
      child.kill();
    }, 250);

    child.stdout?.on("data", (data: Buffer | string) =>
      flushChunk(typeof data === "string" ? data : data.toString("utf-8"), "stdout"),
    );
    child.stderr?.on("data", (data: Buffer | string) =>
      flushChunk(typeof data === "string" ? data : data.toString("utf-8"), "stderr"),
    );

    child.on("error", (error: NodeJS.ErrnoException) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      clearInterval(cancelWatcher);
      control?.setCurrentChild?.(null);
      resolve({
        ok: false,
        exitCode: null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        executable,
        args,
        errorCode: cancelled ? "ECANCELED" : timedOut ? "ETIMEDOUT" : error.code,
        errorMessage: cancelled ? "Command execution cancelled" : error.message,
      });
    });

    child.on("close", (code) => {
      if (resolved) {
        return;
      }
      resolved = true;
      clearTimeout(timeout);
      clearInterval(cancelWatcher);
      control?.setCurrentChild?.(null);
      resolve({
        ok: !timedOut && !cancelled && code === 0,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        executable,
        args,
        errorCode: cancelled ? "ECANCELED" : timedOut ? "ETIMEDOUT" : undefined,
        errorMessage: cancelled
          ? "Command execution cancelled"
          : timedOut
            ? "Command execution timed out"
            : undefined,
      });
    });
  });
}

export function firstNonEmptyLine(...values: string[]): string | null {
  const joined = values
    .filter(Boolean)
    .join("\n")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);

  return joined || null;
}

export function summarizeCommand(result: CommandResult): string {
  const command = [result.executable, ...result.args].join(" ");
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  const trimmed = trimOutput(output || result.errorMessage || "No output captured.");
  return `${command}\n${trimmed}`;
}
