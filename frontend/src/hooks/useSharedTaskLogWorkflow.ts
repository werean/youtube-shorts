import { useEffect, useRef, useState, useCallback } from "react";
import { getJobLogs } from "../api/logs";

export type TaskLogType = "ingest" | "transcription" | "render" | "orchestrator" | "all";

interface UseSharedTaskLogWorkflowOptions {
  activeJobId: string | null;
  isTranscribing?: boolean;
  isRendering?: boolean;
  isProcessing?: boolean;
}

export function useSharedTaskLogWorkflow({
  activeJobId,
  isTranscribing,
  isRendering,
  isProcessing = false,
}: UseSharedTaskLogWorkflowOptions) {
  const logsPollRef = useRef<number | null>(null);
  const taskLogsContainerRef = useRef<HTMLDivElement>(null);
  const [activeTaskLogs, setActiveTaskLogs] = useState<string[]>([]);
  const [activeTaskLogType, setActiveTaskLogType] = useState<TaskLogType | null>("all");
  const [expandTaskLogs, setExpandTaskLogs] = useState(true);

  const pollTaskLogs = useCallback(async (jobId: string, task: TaskLogType = "all") => {
    try {
      const result = await getJobLogs(jobId, task);
      if (Array.isArray(result.logs)) {
        setActiveTaskLogs(result.logs);
      }
    } catch (error) {
      console.error("[logs] Failed to fetch task logs:", error);
    }
  }, []);

  const appendLogLine = useCallback((line: string) => {
    if (!line) return;
    setActiveTaskLogs((current) => {
      if (current.length > 0 && current[current.length - 1] === line) {
        return current;
      }
      return [...current, line];
    });
  }, []);

  const clearLogs = useCallback(() => {
    setActiveTaskLogs([]);
  }, []);

  const startLogsPollingInterval = useCallback(
    (jobId: string, task: TaskLogType = "all") => {
      if (logsPollRef.current) {
        window.clearInterval(logsPollRef.current);
      }
      void pollTaskLogs(jobId, task);
      logsPollRef.current = window.setInterval(() => {
        void pollTaskLogs(jobId, task);
      }, 1500);
    },
    [pollTaskLogs],
  );

  const stopLogsPolling = useCallback(() => {
    if (logsPollRef.current) {
      window.clearInterval(logsPollRef.current);
      logsPollRef.current = null;
    }
  }, []);

  const prepareTaskLog = useCallback((task: TaskLogType) => {
    setActiveTaskLogType(task);
    setActiveTaskLogs([]);
  }, []);

  const resetTaskLogs = useCallback(() => {
    setActiveTaskLogs([]);
    setActiveTaskLogType("all");
    stopLogsPolling();
  }, [stopLogsPolling]);

  // Carrega logs ao trocar de vídeo ativo
  useEffect(() => {
    if (activeJobId) {
      void pollTaskLogs(activeJobId, "all");
    } else {
      setActiveTaskLogs([]);
    }
  }, [activeJobId, pollTaskLogs]);

  // Gerencia o polling enquanto alguma operação estiver em andamento
  useEffect(() => {
    if (!activeJobId) {
      stopLogsPolling();
      return;
    }

    const shouldPoll = Boolean(isProcessing || isTranscribing || isRendering);

    if (shouldPoll) {
      startLogsPollingInterval(activeJobId, "all");
    } else {
      stopLogsPolling();
    }

    return () => {
      stopLogsPolling();
    };
  }, [activeJobId, isProcessing, isTranscribing, isRendering, startLogsPollingInterval, stopLogsPolling]);

  return {
    taskLogsContainerRef,
    activeTaskLogs,
    activeTaskLogType,
    expandTaskLogs,
    setExpandTaskLogs,
    prepareTaskLog,
    resetTaskLogs,
    pollTaskLogs,
    appendLogLine,
    clearLogs,
    stopLogsPolling,
  };
}
