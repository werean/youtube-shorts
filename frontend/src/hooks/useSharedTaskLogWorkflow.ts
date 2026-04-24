import { useEffect, useRef, useState } from "react";
import { getJobLogs } from "../api/logs";

type TaskLogType = "transcription" | "render";

interface UseSharedTaskLogWorkflowOptions {
  activeJobId: string | null;
  isTranscribing?: boolean;
  isRendering: boolean;
}

export function useSharedTaskLogWorkflow({
  activeJobId,
  isTranscribing,
  isRendering,
}: UseSharedTaskLogWorkflowOptions) {
  const logsPollRef = useRef<number | null>(null);
  const taskLogsContainerRef = useRef<HTMLDivElement>(null);
  const [activeTaskLogs, setActiveTaskLogs] = useState<string[]>([]);
  const [activeTaskLogType, setActiveTaskLogType] = useState<TaskLogType | null>(null);
  const [expandTaskLogs, setExpandTaskLogs] = useState(false);

  async function pollTaskLogs(jobId: string, task: TaskLogType) {
    try {
      const result = await getJobLogs(jobId, task);
      setActiveTaskLogs(result.logs || []);
    } catch (error) {
      console.error("[logs] Failed to fetch task logs:", error);
    }
  }

  function startLogsPollingInterval(jobId: string, task: TaskLogType) {
    if (logsPollRef.current) {
      window.clearInterval(logsPollRef.current);
    }
    void pollTaskLogs(jobId, task);
    logsPollRef.current = window.setInterval(() => {
      void pollTaskLogs(jobId, task);
    }, 1500);
  }

  function stopLogsPolling() {
    if (logsPollRef.current) {
      window.clearInterval(logsPollRef.current);
      logsPollRef.current = null;
    }
  }

  function prepareTaskLog(task: TaskLogType) {
    setActiveTaskLogType(task);
    setActiveTaskLogs([]);
    setExpandTaskLogs(false);
  }

  function resetTaskLogs() {
    setActiveTaskLogs([]);
    setActiveTaskLogType(null);
    setExpandTaskLogs(false);
    stopLogsPolling();
  }

  function showMoreTaskLogs() {
    setExpandTaskLogs(true);
  }

  useEffect(() => {
    if (taskLogsContainerRef.current) {
      taskLogsContainerRef.current.scrollTop = taskLogsContainerRef.current.scrollHeight;
    }
  }, [activeTaskLogs]);

  useEffect(() => {
    return () => {
      if (logsPollRef.current) {
        window.clearInterval(logsPollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeJobId || !activeTaskLogType) {
      stopLogsPolling();
      return;
    }

    const shouldPoll =
      activeTaskLogType === "transcription" ? Boolean(isTranscribing) : isRendering;

    if (!shouldPoll) {
      stopLogsPolling();
      return;
    }

    if (!logsPollRef.current) {
      startLogsPollingInterval(activeJobId, activeTaskLogType);
    }
  }, [activeJobId, activeTaskLogType, isTranscribing, isRendering]);

  useEffect(() => {
    if (activeJobId && activeTaskLogType === "transcription" && isTranscribing === false) {
      void pollTaskLogs(activeJobId, "transcription");
    }
  }, [isTranscribing, activeJobId, activeTaskLogType]);

  useEffect(() => {
    if (activeJobId && activeTaskLogType === "render" && isRendering === false) {
      void pollTaskLogs(activeJobId, "render");
    }
  }, [isRendering, activeJobId, activeTaskLogType]);

  return {
    taskLogsContainerRef,
    activeTaskLogs,
    activeTaskLogType,
    expandTaskLogs,
    prepareTaskLog,
    resetTaskLogs,
    showMoreTaskLogs,
    stopLogsPolling,
  };
}
