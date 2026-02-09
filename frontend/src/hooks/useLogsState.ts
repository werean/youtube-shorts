import { useState, useCallback } from "react";
import { getJobLogs } from "../api/logs";
import { usePolling, useAutoScroll } from "./usePolling";

/**
 * Hook for managing task logs (transcription/render/ingest)
 */
export function useLogs() {
  const [activeTaskLogs, setActiveTaskLogs] = useState<string[]>([]);
  const [activeTaskLogType, setActiveTaskLogType] = useState<"transcription" | "render" | null>(
    null,
  );
  const [expandTaskLogs, setExpandTaskLogs] = useState(false);

  const [ingestLogs, setIngestLogs] = useState<string[]>([]);
  const [expandIngestLogs, setExpandIngestLogs] = useState(false);

  const { startPolling, stopPolling } = usePolling();
  const { startPolling: startIngestPolling, stopPolling: stopIngestPolling } = usePolling();

  const taskLogsContainerRef = useAutoScroll([activeTaskLogs]);
  const ingestLogsContainerRef = useAutoScroll([ingestLogs]);

  const pollTaskLogs = useCallback(async (jobId: string, task: "transcription" | "render") => {
    try {
      const result = await getJobLogs(jobId, task);
      setActiveTaskLogs(result.logs || []);
    } catch (error) {
      console.error("[logs] Failed to fetch task logs:", error);
    }
  }, []);

  const pollIngestLogs = useCallback(async (jobId: string) => {
    try {
      const result = await getJobLogs(jobId, "ingest");
      setIngestLogs(result.logs || []);
    } catch (error) {
      console.error("[logs] Failed to fetch ingest logs:", error);
    }
  }, []);

  const startLogsPolling = useCallback(
    (jobId: string, task: "transcription" | "render") => {
      stopPolling();
      setActiveTaskLogType(task);
      startPolling(() => pollTaskLogs(jobId, task), 1500);
    },
    [startPolling, stopPolling, pollTaskLogs],
  );

  const startIngestLogsPolling = useCallback(
    (jobId: string) => {
      stopIngestPolling();
      startIngestPolling(() => pollIngestLogs(jobId), 1500);
    },
    [startIngestPolling, stopIngestPolling, pollIngestLogs],
  );

  const stopLogsPolling = useCallback(() => {
    stopPolling();
    setActiveTaskLogType(null);
  }, [stopPolling]);

  return {
    activeTaskLogs,
    activeTaskLogType,
    setActiveTaskLogType,
    expandTaskLogs,
    setExpandTaskLogs,
    ingestLogs,
    expandIngestLogs,
    setExpandIngestLogs,
    taskLogsContainerRef,
    ingestLogsContainerRef,
    startLogsPolling,
    stopLogsPolling,
    startIngestLogsPolling,
    stopIngestPolling,
    pollTaskLogs,
  };
}
