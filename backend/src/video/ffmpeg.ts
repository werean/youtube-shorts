/**
 * FFmpeg command helpers and GPU-accelerated presets.
 */

import { execSync } from "child_process";

export function runFfmpeg(command: string[]): void {
  try {
    execSync(command.join(" "), { stdio: "inherit" });
  } catch (error) {
    throw new Error("FFmpeg failed to render output");
  }
}
