import { spawn, type ChildProcess } from "child_process";

export type ProcessRunOptions = {
  onLog?: (lines: string[]) => void;
  onSpawn?: (child: ChildProcess) => void;
  onClose?: () => void;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  failureMessage?: (code: number | null) => string;
};

function flushLines(buffer: { value: string }, onLines: (lines: string[]) => void): void {
  const parts = buffer.value.split(/[\r\n]+/);
  buffer.value = parts.pop() || "";
  const lines = parts.filter((line) => line.trim().length > 0);
  if (lines.length > 0) {
    onLines(lines);
  }
}

export function killProcessTree(child: ChildProcess): void {
  if (!child.pid) {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process is already gone.
    }
    return;
  }

  if (process.platform === "win32") {
    spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
    return;
  }

  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      // The process is already gone.
    }
  }
}

export function runArgv(args: string[], options: ProcessRunOptions = {}): Promise<void> {
  const [bin, ...rest] = args;
  if (!bin) {
    return Promise.reject(new Error("Missing executable"));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(bin, rest, {
      shell: false,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
      env: options.env ? { ...process.env, ...options.env } : process.env,
    });
    options.onSpawn?.(child);

    const stdoutBuffer = { value: "" };
    const stderrBuffer = { value: "" };
    let settled = false;
    const onLines = (lines: string[]) => options.onLog?.(lines);
    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            killProcessTree(child);
            finish(() =>
              reject(new Error(`${bin} timed out after ${Math.round(options.timeoutMs! / 1000)}s`)),
            );
          }, options.timeoutMs)
        : undefined;

    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      options.onClose?.();
      fn();
    };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdoutBuffer.value += text;
      flushLines(stdoutBuffer, onLines);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      stderrBuffer.value += text;
      flushLines(stderrBuffer, onLines);
    });

    child.on("error", (error) => finish(() => reject(error)));
    child.on("exit", (code) => {
      if (stdoutBuffer.value.trim().length > 0) {
        onLines([stdoutBuffer.value.trim()]);
      }
      if (stderrBuffer.value.trim().length > 0) {
        onLines([stderrBuffer.value.trim()]);
      }
      if (code === 0) {
        finish(() => resolve());
        return;
      }
      const message = options.failureMessage
        ? options.failureMessage(code)
        : `${bin} exited with code ${code ?? "unknown"}`;
      finish(() => reject(new Error(message)));
    });
  });
}
