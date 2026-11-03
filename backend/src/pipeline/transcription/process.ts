import { config } from "../../core/config";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import { runArgv } from "../externalProcess";

export async function runWhisperProcess(jobId: string, args: string[]): Promise<void> {
  await runArgv(args, {
    onLog: (lines) => operationRuntimeService.appendTaskLogs(jobId, "transcription", lines),
    onSpawn: (child) => operationRuntimeService.trackActiveTranscription(jobId, child),
    onClose: () => operationRuntimeService.clearActiveTranscription(jobId),
    timeoutMs: config.WHISPER_TIMEOUT_SECONDS * 1000,
    env: {
      PYTHONUNBUFFERED: "1",
      PYTHONIOENCODING: "utf-8",
    },
    failureMessage: (code) => `Whisper exited with code ${code ?? "unknown"}`,
  });
}
