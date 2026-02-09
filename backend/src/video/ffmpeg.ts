/**
 * FFmpeg command helpers and GPU-accelerated presets.
 */

import { execSync, spawn } from "child_process";

export function runFfmpeg(command: string[]): void {
  try {
    execSync(command.join(" "), { stdio: "inherit" });
  } catch (error) {
    throw new Error("FFmpeg failed to render output");
  }
}

function flushLines(buffer: { value: string }, onLines: (lines: string[]) => void): void {
  const parts = buffer.value.split(/[\r\n]+/);
  buffer.value = parts.pop() || "";
  const lines = parts.filter((line) => line.trim().length > 0);
  if (lines.length > 0) {
    onLines(lines);
  }
}

export function runFfmpegAsync(
  command: string[],
  onLog?: (lines: string[]) => void,
  onSpawn?: (child: ReturnType<typeof spawn>) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = command;
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    if (onSpawn) {
      onSpawn(child);
    }
    const stdoutBuffer = { value: "" };
    const stderrBuffer = { value: "" };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (!onLog) return;
      stdoutBuffer.value += text;
      flushLines(stdoutBuffer, onLog);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      if (!onLog) return;
      stderrBuffer.value += text;
      flushLines(stderrBuffer, onLog);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (onLog) {
        if (stdoutBuffer.value.trim().length > 0) {
          onLog([stdoutBuffer.value.trim()]);
        }
        if (stderrBuffer.value.trim().length > 0) {
          onLog([stderrBuffer.value.trim()]);
        }
      }
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed with code ${code ?? "unknown"}`));
      }
    });
  });
}
