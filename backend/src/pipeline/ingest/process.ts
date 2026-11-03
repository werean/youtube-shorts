import { config } from "../../core/config";
import * as operationRuntimeService from "../../services/operationRuntimeService";
import { runArgv } from "../externalProcess";

export function runDownloadCommand(
  jobId: string,
  args: string[],
  onLog: (lines: string[]) => void,
): Promise<void> {
  return runArgv(args, {
    onLog,
    timeoutMs: config.YTDLP_TIMEOUT_SECONDS * 1000,
    onSpawn: (child) => operationRuntimeService.trackActiveDownload(jobId, child),
    onClose: () => operationRuntimeService.clearActiveDownload(jobId),
    failureMessage: (code) => `yt-dlp failed with code ${code ?? "unknown"}`,
  });
}
