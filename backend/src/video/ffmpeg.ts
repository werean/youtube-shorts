/**
 * FFmpeg command helpers and GPU-accelerated presets.
 */

import { execSync, spawn } from "child_process";
import { config } from "../core/config";

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
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
    }, config.FFMPEG_TIMEOUT_SECONDS * 1000);
    if (onSpawn) {
      onSpawn(child);
    }
    const stdoutBuffer = { value: "" };
    const stderrBuffer = { value: "" };
    let stderrAll = "";

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      if (!onLog) return;
      stdoutBuffer.value += text;
      flushLines(stdoutBuffer, onLog);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderrAll += text;
      process.stderr.write(text);
      if (!onLog) return;
      stderrBuffer.value += text;
      flushLines(stderrBuffer, onLog);
    });

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    child.on("error", (error) => {
      finish(() => reject(error));
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
        finish(() => resolve());
        return;
      }
      const detail = stderrAll.trim().slice(-500);
      finish(() =>
        reject(new Error(`FFmpeg failed with code ${code ?? "unknown"}${detail ? `: ${detail}` : ""}`)),
      );
    });
  });
}
