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

export function runFfmpegAsync(command: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const [bin, ...args] = command;
    const child = spawn(bin, args, { stdio: "inherit" });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg failed with code ${code ?? "unknown"}`));
      }
    });
  });
}
