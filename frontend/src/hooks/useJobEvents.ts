import { useEffect, useState, useRef, useCallback } from "react";
import { apiBaseUrl } from "../api/client";
import type { DubbingCutTrack, DubbingPreview, DubbingTrack, JobStatus } from "../types";

export interface JobEventPayload {
  job_id: string;
  status: JobStatus | string;
  task?: "ingest" | "transcription" | "render" | "dubbing" | string;
  percent?: number;
  eta_seconds?: number | null;
  message?: string;
  timestamp?: string;
  lang?: string;
  cut_id?: string | null;
  short_file?: string | null;
  stage?: string;
  download_percent?: number | null;
  prep_stage?: string | null;
  error?: string | null;
  error_phase?: string | null;
  track?: DubbingTrack | null;
  cut_track?: DubbingCutTrack | null;
  preview?: DubbingPreview | null;
}

export interface DubbingEventState {
  active: boolean;
  status: string;
  stage: string | null;
  lang: string | null;
  cut_id?: string | null;
  cutId?: string | null;
  short_file?: string | null;
  percent: number;
  etaSeconds: number | null;
  message: string;
  downloadPercent: number | null;
  prepStage: string | null;
  error: string | null;
  errorPhase: string | null;
  track: DubbingTrack | null;
  cutTrack?: DubbingCutTrack | null;
  preview: DubbingPreview | null;
  logs: string[];
}

export const INITIAL_DUBBING_EVENT_STATE: DubbingEventState = {
  active: false,
  status: "idle",
  stage: null,
  lang: null,
  cut_id: null,
  cutId: null,
  short_file: null,
  percent: 0,
  etaSeconds: null,
  message: "",
  downloadPercent: null,
  prepStage: null,
  error: null,
  errorPhase: null,
  track: null,
  cutTrack: null,
  preview: null,
  logs: [],
};

const ACTIVE_DUBBING_STATUSES = new Set([
  "preparing",
  "downloading",
  "translating",
  "separating",
  "diarizing",
  "synthesizing",
  "mixing",
  "previewing",
]);

const TERMINAL_DUBBING_STATUSES = new Set([
  "idle",
  "ready",
  "preview_ready",
  "cancelled",
  "error",
]);

const PREP_DUBBING_STAGES = new Set([
  "prep",
  "translate",
  "demucs",
  "diarize",
  "tts",
  "mix",
  "preview_prep",
]);

export function useJobEvents(
  jobId: string | null,
  onStatusChange?: (status: JobStatus) => void,
  onDubbingEvent?: (state: DubbingEventState) => void,
) {
  const [progress, setProgress] = useState<number>(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [dubbingState, setDubbingState] = useState<DubbingEventState>(
    INITIAL_DUBBING_EVENT_STATE,
  );
  const eventSourceRef = useRef<EventSource | null>(null);
  const onStatusChangeRef = useRef(onStatusChange);
  const onDubbingEventRef = useRef(onDubbingEvent);
  const lastNotifiedStatusRef = useRef<JobStatus | null>(null);

  const resetProgress = useCallback(() => {
    setProgress(0);
    setEtaSeconds(null);
    setCurrentMessage("");
  }, []);

  const resetDubbingState = useCallback(() => {
    setDubbingState(INITIAL_DUBBING_EVENT_STATE);
  }, []);

  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  useEffect(() => {
    onDubbingEventRef.current = onDubbingEvent;
  }, [onDubbingEvent]);

  useEffect(() => {
    resetProgress();
    resetDubbingState();
    setJobStatus(null);
    setLogs([]);
    lastNotifiedStatusRef.current = null;

    if (!jobId) return;

    const url = `${apiBaseUrl}/jobs/${jobId}/events`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    const applyDubbingPayload = (data: JobEventPayload) => {
      setDubbingState((prev) => {
        const rawStatus = String(data.status || prev.status || "idle")
          .trim()
          .toLowerCase();
        const rawStage =
          typeof data.stage === "string" && data.stage.trim()
            ? data.stage.trim().toLowerCase()
            : prev.stage;
        const isTerminal = TERMINAL_DUBBING_STATUSES.has(rawStatus);
        const isActive =
          !isTerminal &&
          (ACTIVE_DUBBING_STATUSES.has(rawStatus) || rawStatus.length > 0);

        const nextPercent =
          rawStatus === "cancelled"
            ? 0
            : rawStatus === "ready" || rawStatus === "preview_ready"
              ? 100
              : typeof data.percent === "number"
                ? data.percent
                : prev.percent;

        const nextEta = isTerminal
          ? null
          : typeof data.eta_seconds === "number"
            ? data.eta_seconds
            : prev.etaSeconds;

        let nextDownloadPercent = prev.downloadPercent;
        if (typeof data.download_percent === "number") {
          nextDownloadPercent = data.download_percent;
        } else if (rawStage === "download" || rawStatus === "downloading") {
          if (typeof data.percent === "number") {
            nextDownloadPercent = data.percent;
          }
        } else if (
          rawStatus === "ready" ||
          rawStatus === "preview_ready" ||
          rawStatus === "cancelled"
        ) {
          nextDownloadPercent = null;
        }

        let nextPrepStage = prev.prepStage;
        if (typeof data.prep_stage === "string" && data.prep_stage.trim()) {
          nextPrepStage = data.prep_stage.trim();
        } else if (rawStage && PREP_DUBBING_STAGES.has(rawStage)) {
          nextPrepStage = rawStage;
        } else if (
          rawStatus === "translating" ||
          rawStatus === "separating" ||
          rawStatus === "diarizing" ||
          rawStatus === "synthesizing" ||
          rawStatus === "mixing"
        ) {
          nextPrepStage = rawStatus;
        } else if (isTerminal) {
          nextPrepStage = null;
        }

        const nextMessage = data.message ? String(data.message) : prev.message;
        const nextLogs =
          data.message &&
          (prev.logs.length === 0 || prev.logs[prev.logs.length - 1] !== data.message)
            ? [...prev.logs, data.message]
            : prev.logs;

        const nextError =
          rawStatus === "error"
            ? data.error
              ? String(data.error)
              : data.message
                ? String(data.message)
                : prev.error || "Erro durante a dublagem"
            : isActive || rawStatus === "ready" || rawStatus === "preview_ready" || rawStatus === "cancelled"
              ? null
              : prev.error;

        const nextErrorPhase =
          rawStatus === "error"
            ? data.error_phase
              ? String(data.error_phase)
              : rawStage || prev.errorPhase
            : isActive || rawStatus === "ready" || rawStatus === "preview_ready" || rawStatus === "cancelled"
              ? null
              : prev.errorPhase;

        const rawCutId =
          data.cut_id !== undefined
            ? data.cut_id
            : data.cut_track?.cut_id !== undefined
              ? data.cut_track.cut_id
              : undefined;
        const nextCutId =
          rawCutId !== undefined
            ? rawCutId
              ? String(rawCutId)
              : null
            : prev.active
              ? (prev.cut_id ?? prev.cutId ?? null)
              : null;

        const nextShortFile =
          data.short_file !== undefined
            ? data.short_file
              ? String(data.short_file)
              : null
            : data.cut_track?.short_file !== undefined
              ? data.cut_track.short_file
                ? String(data.cut_track.short_file)
                : null
              : nextCutId
                ? (prev.short_file ?? null)
                : null;

        const nextTrack = !nextCutId && data.track ? data.track : prev.track;
        const nextCutTrack = nextCutId
          ? (data.cut_track ??
            (data.track ? (data.track as unknown as DubbingCutTrack) : prev.cutTrack ?? null))
          : null;

        const nextState: DubbingEventState = {
          active: isActive,
          status: rawStatus,
          stage: rawStage ?? null,
          lang: data.lang ? String(data.lang) : prev.lang,
          cut_id: nextCutId,
          cutId: nextCutId,
          short_file: nextShortFile,
          percent: nextPercent,
          etaSeconds: nextEta,
          message: nextMessage,
          downloadPercent: nextDownloadPercent,
          prepStage: nextPrepStage,
          error: nextError,
          errorPhase: nextErrorPhase,
          track: nextTrack,
          cutTrack: nextCutTrack,
          preview: data.preview ?? prev.preview,
          logs: nextLogs,
        };

        onDubbingEventRef.current?.(nextState);
        return nextState;
      });
    };

    const handleDubbingStateEvent = (e: MessageEvent) => {
      try {
        const data: JobEventPayload = JSON.parse(e.data);
        applyDubbingPayload(data);
      } catch (err) {
        console.error("Erro ao decodificar evento dubbing_state SSE:", err);
      }
    };

    const handleEvent = (e: MessageEvent) => {
      try {
        const data: JobEventPayload = JSON.parse(e.data);

        // Isolate dubbing task progress before touching Shorts JobStatus or progress state.
        if (data?.task === "dubbing") {
          applyDubbingPayload(data);
          return;
        }

        let normalizedStatus: JobStatus | undefined;

        if (data.status) {
          const rawStatus = String(data.status);
          const cleanStatus = rawStatus.replace(/^JobStatus\./i, "").toUpperCase() as JobStatus;
          normalizedStatus = cleanStatus;
          setJobStatus(cleanStatus);
          if (lastNotifiedStatusRef.current !== cleanStatus) {
            lastNotifiedStatusRef.current = cleanStatus;
            onStatusChangeRef.current?.(cleanStatus);
          }
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

    es.addEventListener("dubbing_state", handleDubbingStateEvent);
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
  }, [jobId, resetProgress, resetDubbingState]);

  return {
    progress,
    etaSeconds,
    currentMessage,
    jobStatus,
    logs,
    resetProgress,
    dubbingState,
    resetDubbingState,
  };
}
