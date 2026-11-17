import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DubbingApiError,
  cancelDubbing,
  deleteDubbingTrack,
  exportDubbedVideo,
  getDubbingManifest,
  getDubbingPreflight,
  sendDubbedToCuts,
  startCutDubbing,
  startDubbing,
  startDubbingPreview,
} from "../api/dubbing";
import type {
  DubbingAudioMode,
  DubbingCutTrack,
  DubbingExportResult,
  DubbingManifest,
  DubbingPreflightResult,
  DubbingSendToCutsResult,
  DubbingStartOptions,
  DubbingSubtitlePreset,
  Job,
} from "../types";
import type { DubbingEventState } from "./useJobEvents";

export interface DubbingWorkflowPreviewOptions {
  preview20s?: boolean;
  startTime?: number;
  duration?: number;
}

export interface PendingDubRequest {
  jobId: string;
  cutId?: string;
  overrides?: DubbingStartOptions;
  previewOptions?: DubbingWorkflowPreviewOptions;
}

export interface UseDubbingWorkflowOptions {
  activeJobId: string | null;
  dubbingState?: DubbingEventState | null;
  defaultSubtitlesEnabled?: boolean;
  onNotify?: (message: string) => void;
  onError?: (message: string) => void;
  onJobCreated?: (job: Job, videoPath: string) => void | Promise<void>;
  onRefreshVideo?: (jobId: string) => void | Promise<void>;
}

export interface StartDubWithPreflightResult {
  started: boolean;
  needsPreflight: boolean;
  preflight?: DubbingPreflightResult;
}

function getErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return fallback;
}

export function useDubbingWorkflow({
  activeJobId,
  dubbingState = null,
  defaultSubtitlesEnabled = true,
  onNotify,
  onError,
  onJobCreated,
  onRefreshVideo,
}: UseDubbingWorkflowOptions) {
  const [manifest, setManifest] = useState<DubbingManifest | null>(null);
  const [isLoadingManifest, setIsLoadingManifest] = useState(false);
  const [preflightDialogData, setPreflightDialogData] =
    useState<DubbingPreflightResult | null>(null);
  const [pendingDubRequest, setPendingDubRequest] =
    useState<PendingDubRequest | null>(null);
  const [isStartingDub, setIsStartingDub] = useState(false);
  const [startingDubCutId, setStartingDubCutId] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportResult, setExportResult] = useState<DubbingExportResult | null>(null);
  const [isSendingToCuts, setIsSendingToCuts] = useState(false);
  const [isDeletingDub, setIsDeletingDub] = useState(false);
  const [selectedAudioTrack, setSelectedAudioTrack] =
    useState<DubbingAudioMode>("original");
  const [selectedDubLang, setSelectedDubLang] = useState<string | null>(null);
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean>(
    defaultSubtitlesEnabled,
  );
  const [dubbingError, setDubbingError] = useState<string | null>(null);

  const pendingRequestRef = useRef<PendingDubRequest | null>(null);
  const activeJobIdRef = useRef<string | null>(activeJobId);
  const lastHandledSseKeyRef = useRef<string>("");

  const onNotifyRef = useRef(onNotify);
  const onErrorRef = useRef(onError);
  const onJobCreatedRef = useRef(onJobCreated);
  const onRefreshVideoRef = useRef(onRefreshVideo);

  useEffect(() => {
    onNotifyRef.current = onNotify;
  }, [onNotify]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    onJobCreatedRef.current = onJobCreated;
  }, [onJobCreated]);

  useEffect(() => {
    onRefreshVideoRef.current = onRefreshVideo;
  }, [onRefreshVideo]);

  useEffect(() => {
    activeJobIdRef.current = activeJobId;
  }, [activeJobId]);

  useEffect(() => {
    setSubtitlesEnabled(defaultSubtitlesEnabled);
  }, [defaultSubtitlesEnabled]);

  const refreshManifest = useCallback(
    async (jobId: string): Promise<DubbingManifest | null> => {
      if (!jobId) {
        setManifest(null);
        return null;
      }
      setIsLoadingManifest(true);
      try {
        const next = await getDubbingManifest(jobId);
        if (activeJobIdRef.current && activeJobIdRef.current !== jobId) {
          return next;
        }
        setManifest(next);
        const readyLangs = Object.values(next.tracks || {})
          .filter((t) => t.status === "ready")
          .map((t) => String(t.lang));
        setSelectedDubLang((prev) => {
          if (prev && (next.tracks?.[prev] || next.preview?.lang === prev)) {
            return prev;
          }
          if (next.active_lang) return next.active_lang;
          return readyLangs[0] ?? next.preview?.lang ?? null;
        });
        return next;
      } catch (err) {
        console.error("Failed to load dubbing manifest:", err);
        return null;
      } finally {
        setIsLoadingManifest(false);
      }
    },
    [],
  );

  useEffect(() => {
    setManifest(null);
    setExportResult(null);
    setDubbingError(null);
    setPreflightDialogData(null);
    setPendingDubRequest(null);
    pendingRequestRef.current = null;
    setIsStartingDub(false);
    setStartingDubCutId(null);
    setSelectedAudioTrack("original");
    setSelectedDubLang(null);
    lastHandledSseKeyRef.current = "";

    if (activeJobId) {
      void refreshManifest(activeJobId);
    }
  }, [activeJobId, refreshManifest]);

  useEffect(() => {
    if (!dubbingState || !activeJobId) return;

    const status = String(dubbingState.status || "").toLowerCase();
    if (!status || status === "idle") return;

    const eventCutId = dubbingState.cutId ?? dubbingState.cut_id ?? null;

    if (dubbingState.active) {
      setIsStartingDub(false);
      setStartingDubCutId(null);
      lastHandledSseKeyRef.current = "";
    }

    if (dubbingState.track || dubbingState.cutTrack || dubbingState.preview) {
      setManifest((prev) => {
        if (!prev || prev.job_id !== activeJobId) return prev;
        const nextTracks = { ...(prev.tracks || {}) };
        if (!eventCutId && dubbingState.track?.lang) {
          nextTracks[String(dubbingState.track.lang)] = dubbingState.track;
        }
        const nextCutDubs = { ...(prev.cut_dubs || {}) };
        const cutTrack: DubbingCutTrack | null | undefined = dubbingState.cutTrack;
        if (eventCutId && cutTrack?.lang) {
          nextCutDubs[eventCutId] = {
            ...(nextCutDubs[eventCutId] || {}),
            [String(cutTrack.lang)]: cutTrack,
          };
        }
        return {
          ...prev,
          active_lang: eventCutId ? prev.active_lang : dubbingState.lang || prev.active_lang,
          status: status || prev.status,
          tracks: nextTracks,
          cut_dubs: nextCutDubs,
          preview: dubbingState.preview ?? prev.preview,
        };
      });
    }

    const eventKey = `${activeJobId}:${status}:${dubbingState.stage || ""}:${dubbingState.lang || ""}:${eventCutId || ""}:${dubbingState.preview?.updated_at || ""}:${dubbingState.track?.updated_at || ""}:${dubbingState.cutTrack?.updated_at || ""}`;
    if (lastHandledSseKeyRef.current === eventKey) {
      return;
    }

    if (status === "ready") {
      lastHandledSseKeyRef.current = eventKey;
      setIsStartingDub(false);
      setStartingDubCutId(null);
      setDubbingError(null);
      if (dubbingState.lang) {
        setSelectedDubLang(dubbingState.lang);
      }
      if (!eventCutId) {
        setSelectedAudioTrack("dubbed");
      }
      void refreshManifest(activeJobId);
      void onRefreshVideoRef.current?.(activeJobId);
      onNotifyRef.current?.(
        dubbingState.message ||
          `Dublagem (${dubbingState.lang || "idioma"}) concluída!`,
      );
    } else if (status === "preview_ready") {
      lastHandledSseKeyRef.current = eventKey;
      setIsStartingDub(false);
      setStartingDubCutId(null);
      setDubbingError(null);
      if (dubbingState.lang) {
        setSelectedDubLang(dubbingState.lang);
      }
      setSelectedAudioTrack("preview");
      void refreshManifest(activeJobId);
      onNotifyRef.current?.(
        dubbingState.message || "Prévia de dublagem (20s) pronta!",
      );
    } else if (status === "cancelled") {
      lastHandledSseKeyRef.current = eventKey;
      setIsStartingDub(false);
      setStartingDubCutId(null);
      void refreshManifest(activeJobId);
      onNotifyRef.current?.(dubbingState.message || "Dublagem cancelada.");
    } else if (status === "error") {
      lastHandledSseKeyRef.current = eventKey;
      setIsStartingDub(false);
      setStartingDubCutId(null);
      const errMsg = dubbingState.error || dubbingState.message || "Erro na dublagem";
      setDubbingError(errMsg);
      void refreshManifest(activeJobId);
      onErrorRef.current?.(errMsg);
    }
  }, [activeJobId, dubbingState, refreshManifest]);

  const executeDubRequest = useCallback(
    async (
      jobId: string,
      overrides: DubbingStartOptions | undefined,
      previewOptions: DubbingWorkflowPreviewOptions | undefined,
      autoInstall: boolean,
      cutId?: string,
    ): Promise<StartDubWithPreflightResult> => {
      setDubbingError(null);
      setIsStartingDub(true);
      setStartingDubCutId(cutId ?? null);
      try {
        const response = cutId
          ? await startCutDubbing(jobId, cutId, {
              ...overrides,
              auto_install: autoInstall,
            })
          : previewOptions?.preview20s
            ? await startDubbingPreview(jobId, {
                ...overrides,
                start_time: previewOptions.startTime,
                duration: previewOptions.duration ?? 20,
                auto_install: autoInstall,
              })
            : await startDubbing(jobId, {
                ...overrides,
                auto_install: autoInstall,
              });

        if (response.deps_missing || !response.started) {
          setIsStartingDub(false);
          setStartingDubCutId(null);
          const preflight =
            response.preflight ??
            (await getDubbingPreflight(jobId, overrides?.engine));
          const req: PendingDubRequest = {
            jobId,
            ...(cutId ? { cutId } : {}),
            overrides,
            previewOptions,
          };
          pendingRequestRef.current = req;
          setPendingDubRequest(req);
          setPreflightDialogData(preflight);
          return {
            started: false,
            needsPreflight: true,
            preflight,
          };
        }

        pendingRequestRef.current = null;
        setPendingDubRequest(null);
        setPreflightDialogData(null);
        if (response.target_lang || response.lang) {
          setSelectedDubLang(String(response.target_lang || response.lang));
        }
        return {
          started: true,
          needsPreflight: false,
        };
      } catch (err) {
        if (err instanceof DubbingApiError && err.status === 424) {
          setIsStartingDub(false);
          setStartingDubCutId(null);
          const preflight =
            err.preflight ??
            (await getDubbingPreflight(jobId, overrides?.engine));
          const req: PendingDubRequest = {
            jobId,
            ...(cutId ? { cutId } : {}),
            overrides,
            previewOptions,
          };
          pendingRequestRef.current = req;
          setPendingDubRequest(req);
          setPreflightDialogData(preflight);
          return {
            started: false,
            needsPreflight: true,
            preflight,
          };
        }
        setIsStartingDub(false);
        setStartingDubCutId(null);
        const msg = getErrorMessage(err, "Falha ao iniciar dublagem.");
        setDubbingError(msg);
        onErrorRef.current?.(msg);
        throw err;
      }
    },
    [],
  );

  const startDubWithPreflight = useCallback(
    async (
      jobId: string,
      overrides?: DubbingStartOptions,
      previewOptions?: DubbingWorkflowPreviewOptions,
    ): Promise<StartDubWithPreflightResult> => {
      return executeDubRequest(jobId, overrides, previewOptions, false);
    },
    [executeDubRequest],
  );

  const startCutDubWithPreflight = useCallback(
    async (
      jobId: string,
      cutId: string,
      overrides?: DubbingStartOptions,
    ): Promise<StartDubWithPreflightResult> => {
      return executeDubRequest(jobId, overrides, undefined, false, cutId);
    },
    [executeDubRequest],
  );

  const confirmInstallAndDub = useCallback(async (): Promise<{ started: boolean }> => {
    const req = pendingRequestRef.current || pendingDubRequest;
    if (!req) {
      setPreflightDialogData(null);
      return { started: false };
    }
    setPreflightDialogData(null);
    const result = await executeDubRequest(
      req.jobId,
      req.overrides,
      req.previewOptions,
      true,
      req.cutId,
    );
    return { started: result.started };
  }, [executeDubRequest, pendingDubRequest]);

  const dismissPreflightDialog = useCallback(() => {
    pendingRequestRef.current = null;
    setPendingDubRequest(null);
    setPreflightDialogData(null);
  }, []);

  const cancelDub = useCallback(
    async (jobId?: string): Promise<void> => {
      const targetId = jobId || activeJobIdRef.current;
      if (!targetId) return;
      try {
        await cancelDubbing(targetId);
        setIsStartingDub(false);
        setStartingDubCutId(null);
        onNotifyRef.current?.("Cancelamento da dublagem solicitado.");
        await refreshManifest(targetId);
      } catch (err) {
        const msg = getErrorMessage(err, "Falha ao cancelar dublagem.");
        onErrorRef.current?.(msg);
        throw err;
      }
    },
    [refreshManifest],
  );

  const exportMp4 = useCallback(
    async (
      lang: string,
      preset: DubbingSubtitlePreset | string,
      subsEnabled: boolean,
      jobId?: string,
    ): Promise<DubbingExportResult> => {
      const targetId = jobId || activeJobIdRef.current;
      if (!targetId) {
        throw new Error("Nenhum vídeo selecionado para exportação.");
      }
      setIsExporting(true);
      try {
        const result = await exportDubbedVideo(targetId, lang, {
          preset,
          subtitles_enabled: subsEnabled,
        });
        setExportResult(result);
        await refreshManifest(targetId);
        onNotifyRef.current?.(`Vídeo dublado (${lang}) exportado com sucesso!`);
        return result;
      } catch (err) {
        const msg = getErrorMessage(err, "Falha ao exportar vídeo dublado.");
        onErrorRef.current?.(msg);
        throw err;
      } finally {
        setIsExporting(false);
      }
    },
    [refreshManifest],
  );

  const sendDubToCuts = useCallback(
    async (lang: string, jobId?: string): Promise<DubbingSendToCutsResult> => {
      const targetId = jobId || activeJobIdRef.current;
      if (!targetId) {
        throw new Error("Nenhum vídeo selecionado para enviar aos cortes.");
      }
      setIsSendingToCuts(true);
      try {
        const result = await sendDubbedToCuts(targetId, lang);
        await onJobCreatedRef.current?.(result.job, result.video_path);
        onNotifyRef.current?.(
          `Versão dublada (${lang}) adicionada à biblioteca pronta para Cortes!`,
        );
        return result;
      } catch (err) {
        const msg = getErrorMessage(
          err,
          "Falha ao enviar versão dublada para Cortes.",
        );
        onErrorRef.current?.(msg);
        throw err;
      } finally {
        setIsSendingToCuts(false);
      }
    },
    [],
  );

  const deleteDubTrack = useCallback(
    async (lang: string, jobId?: string): Promise<DubbingManifest | null> => {
      const targetId = jobId || activeJobIdRef.current;
      if (!targetId) return null;
      setIsDeletingDub(true);
      try {
        const res = await deleteDubbingTrack(targetId, lang);
        const nextManifest = res.manifest ?? (await getDubbingManifest(targetId));
        setManifest(nextManifest);
        setExportResult(null);

        const nextReadyLangs = Object.values(nextManifest?.tracks || {})
          .filter((t) => t.status === "ready")
          .map((t) => String(t.lang));

        if (selectedDubLang === lang) {
          setSelectedDubLang(nextManifest?.active_lang || nextReadyLangs[0] || null);
        }
        if (
          selectedAudioTrack === "dubbed" &&
          (selectedDubLang === lang || nextReadyLangs.length === 0)
        ) {
          setSelectedAudioTrack("original");
        }
        if (
          selectedAudioTrack === "preview" &&
          nextManifest?.preview?.lang === lang &&
          !nextManifest?.preview?.audio_url
        ) {
          setSelectedAudioTrack("original");
        }

        await onRefreshVideoRef.current?.(targetId);
        onNotifyRef.current?.(`Dublagem (${lang}) removida.`);
        return nextManifest;
      } catch (err) {
        const msg = getErrorMessage(err, "Falha ao remover dublagem.");
        onErrorRef.current?.(msg);
        throw err;
      } finally {
        setIsDeletingDub(false);
      }
    },
    [selectedAudioTrack, selectedDubLang],
  );

  const isDubbingActive = useMemo(
    () => Boolean(dubbingState?.active || isStartingDub),
    [dubbingState?.active, isStartingDub],
  );

  const activeDubCutId = useMemo(() => {
    if (dubbingState?.active) {
      return dubbingState.cutId ?? dubbingState.cut_id ?? null;
    }
    if (isStartingDub) {
      return startingDubCutId;
    }
    return null;
  }, [
    dubbingState?.active,
    dubbingState?.cutId,
    dubbingState?.cut_id,
    isStartingDub,
    startingDubCutId,
  ]);

  return {
    manifest,
    isLoadingManifest,
    preflightDialogData,
    pendingDubRequest,
    isDubbingActive,
    activeDubCutId,
    isExporting,
    exportResult,
    isSendingToCuts,
    isDeletingDub,
    selectedAudioTrack,
    setSelectedAudioTrack,
    selectedDubLang,
    setSelectedDubLang,
    subtitlesEnabled,
    setSubtitlesEnabled,
    dubbingError,
    startDubWithPreflight,
    startCutDubWithPreflight,
    confirmInstallAndDub,
    dismissPreflightDialog,
    cancelDub,
    exportMp4,
    sendDubToCuts,
    deleteDubTrack,
    refreshManifest,
  };
}
