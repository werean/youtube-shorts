import { useEffect, useState, useRef, useCallback } from "react";
import { apiBaseUrl } from "../api/client";
import type { JobStatus } from "../types";

export interface JobEventPayload {
  job_id: string;
  status: JobStatus;
  task?: "ingest" | "transcription" | "render";
  percent?: number;
  eta_seconds?: number;
  message?: string;
  timestamp?: string;
}

export function useJobEvents(jobId: string | null, onStatusChange?: (status: JobStatus) => void) {
  const [progress, setProgress] = useState<number>(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);

  const resetProgress = useCallback(() => {
    setProgress(0);
    setEtaSeconds(null);
    setCurrentMessage("");
  }, []);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    resetProgress();
    setJobStatus(null);
    setLogs([]);

    if (!jobId) return;

    const url = `${apiBaseUrl}/jobs/${jobId}/events`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    const handleEvent = (e: MessageEvent) => {
      try {
        const data: JobEventPayload = JSON.parse(e.data);
        let normalizedStatus: JobStatus | undefined;

        if (data.status) {
          const rawStatus = String(data.status);
          const cleanStatus = rawStatus.replace(/^JobStatus\./i, "").toUpperCase() as JobStatus;
          normalizedStatus = cleanStatus;
          setJobStatus(cleanStatus);
          onStatusChangeRef.current?.(cleanStatus);
        }

        const isTerminalOrReset =
          normalizedStatus === "ERROR" ||
          normalizedStatus === "DOWNLOADED" ||
          normalizedStatus === "DONE" ||
          data.percent === 0;

        if (isTerminalOrReset) {
          setProgress(0);
          setEtaSeconds(null);
        } else {
          if (typeof data.percent === "number") setProgress(data.percent);
          if (typeof data.eta_seconds === "number") setEtaSeconds(data.eta_seconds);
        }

        if (data.message) {
          setCurrentMessage(data.message);
          setLogs((prev) => {
            if (prev.length > 0 && prev[prev.length - 1] === data.message) return prev;
            return [...prev, data.message!];
          });
        }
      } catch (err) {
        console.error("Erro ao decodificar evento SSE:", err);
      }
    };

    es.addEventListener("progress", handleEvent);
    es.addEventListener("state", handleEvent);
    es.addEventListener("state_change", handleEvent);
    es.onmessage = handleEvent;

    es.onerror = () => {
      // EventSource reconecta automaticamente no backend FastAPI
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [jobId, resetProgress]);

  return { progress, etaSeconds, currentMessage, jobStatus, logs, resetProgress };
}
