import { spawn } from "child_process";
import type { ChildProcess } from "child_process";
import { appendTaskLogs } from "../../core/taskLogs";

const activeTranscriptions = new Map<string, ChildProcess>();

export function activeTranscriptionJobIds(): string[] {
  return Array.from(activeTranscriptions.keys());
}

function flushLines(buffer: { value: string }, onLines: (lines: string[]) => void): void {
  const parts = buffer.value.split(/[\r\n]+/);
  buffer.value = parts.pop() || "";
  const lines = parts.filter((line) => line.trim().length > 0);
  if (lines.length > 0) {
    onLines(lines);
  }
}

function runCommand(
  command: string,
  onLog: (lines: string[]) => void,
  onSpawn?: (child: ChildProcess) => void,
  onClose?: () => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PYTHONIOENCODING: "utf-8",
      },
    });
    if (onSpawn) {
      onSpawn(child);
    }
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

    child.on("error", (error) => reject(error));
    child.on("exit", (code) => {
      if (onClose) {
        onClose();
      }
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
      reject(new Error(`Whisper exited with code ${code}`));
    });
  });
}

export async function runWhisperProcess(jobId: string, command: string): Promise<void> {
  await runCommand(
    command,
    (lines) => appendTaskLogs(jobId, "transcription", lines),
    (child) => activeTranscriptions.set(jobId, child),
    () => activeTranscriptions.delete(jobId),
  );
}

export function cancelActiveTranscriptionProcess(jobId: string, onCancel?: () => void): boolean {
  const child = activeTranscriptions.get(jobId);
  if (!child || !child.pid) {
    return false;
  }

  onCancel?.();

  try {
    if (process.platform === "win32") {
      spawn("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch (error) {
    console.error(`[transcription] Failed to cancel process for job ${jobId}:`, error);
  }

  activeTranscriptions.delete(jobId);
  return true;
}
