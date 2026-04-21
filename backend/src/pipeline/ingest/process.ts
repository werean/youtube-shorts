import { spawn } from "child_process";

function flushLines(buffer: { value: string }, onLines: (lines: string[]) => void): void {
  const parts = buffer.value.split(/[\r\n]+/);
  buffer.value = parts.pop() || "";
  const lines = parts.filter((line) => line.trim().length > 0);
  if (lines.length > 0) {
    onLines(lines);
  }
}

export function runDownloadCommand(
  command: string,
  onLog: (lines: string[]) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, { shell: true, stdio: ["ignore", "pipe", "pipe"] });
    const stdoutBuffer = { value: "" };
    const stderrBuffer = { value: "" };

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      stdoutBuffer.value += text;
      flushLines(stdoutBuffer, onLog);
    });

    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      process.stderr.write(text);
      stderrBuffer.value += text;
      flushLines(stderrBuffer, onLog);
    });

    child.on("error", (error) => {
      reject(error);
    });

    child.on("exit", (code) => {
      if (stdoutBuffer.value.trim().length > 0) {
        onLog([stdoutBuffer.value.trim()]);
      }
      if (stderrBuffer.value.trim().length > 0) {
        onLog([stderrBuffer.value.trim()]);
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`yt-dlp failed with code ${code ?? "unknown"}`));
    });
  });
}
