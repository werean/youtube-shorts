import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FFmpegConfig } from "./types/ffmpeg";
import type { WhisperConfig } from "./types/whisper";
import type { ToolConfigs } from "./types/toolConfigs";
import { useUIState } from "./hooks";
import { useCutsWorkflow } from "./hooks/useCutsWorkflow";
import { useCutTimestampWorkflow } from "./hooks/useCutTimestampWorkflow";
import { useDependencyManagementWorkflow } from "./hooks/useDependencyManagementWorkflow";
import { useRenderingWorkflow } from "./hooks/useRenderingWorkflow";
import { useSharedTaskLogWorkflow } from "./hooks/useSharedTaskLogWorkflow";
import { useTranscriptionWorkflow } from "./hooks/useTranscriptionWorkflow";
import {
  analyzeJob,
  apiBaseUrl,
  archiveVideo,
  buildBlocks,
  deleteVideo,
  getJob,
  listArchivedVideos,
  listVideos,
  openVideoFolder,
  renameVideo,
  updateCuts,
  uploadVideoFile,
  getSettings,
  saveSettings,
  getToolConfigs,
  getOllamaModels,
  registerOllamaModel,
  removeOllamaModel,
  saveToolConfigs,
  resetAllToolConfigs,
  resetToolConfigSection,
  importToolConfigs,
  type AppSettings,
} from "./api";
import { useBatchPipelineWorkflow } from "./hooks/useBatchPipelineWorkflow";
import { WhisperConfigDialog } from "./components/dialogs/WhisperConfigDialog";
import { FFmpegConfigDialog } from "./components/dialogs/FFmpegConfigDialog";
import { InstallationInstructionsDialog } from "./components/dialogs/InstallationInstructionsDialog";
import { AppSupportDialogs } from "./components/app/AppSupportDialogs";
import { BatchPipelineControls } from "./components/app/BatchPipelineControls";
import { CutTimestampDialogs } from "./components/app/CutTimestampDialogs";
import { TranscriptionDialogs } from "./components/app/TranscriptionDialogs";
import { DependenciesDialog } from "./components/dialogs/DependenciesDialog";
import { LLMConfigDialog } from "./components/dialogs/LLMConfigDialog";
import { ConfigureAppDialog } from "./components/dialogs/ConfigureAppDialog";
import { SimpleDialogs } from "./components/dialogs/SimpleDialogs";
import { BlocksDialog } from "./components/dialogs/BlocksDialog";
import { AiResponseDialog } from "./components/dialogs/AiResponseDialog";
import { RegenerateAnalyzeDialog } from "./components/dialogs/RegenerateAnalyzeDialog";
import { ArcSidebar } from "./components/redesign/ArcSidebar";
import { FloatingChrome } from "./components/redesign/FloatingChrome";
import { GlassDock, type DockCutItem } from "./components/redesign/GlassDock";
import { ImmersiveVideoStage } from "./components/redesign/ImmersiveVideoStage";
import { NewVideoModal } from "./components/redesign/NewVideoModal";
import { SettingsHubModal } from "./components/redesign/SettingsHubModal";
import { TranscriptPopover } from "./components/redesign/TranscriptPopover";
import { CUT_PRESETS, type CutPreset } from "./components/redesign/presets";
import { VideoItem, recordToVideoItem } from "./utils/videoHelpers";

interface ActionState {
  busy: boolean;
  error?: string;
}

const initialAction: ActionState = { busy: false };
const SPEED_STEPS = [1, 1.25, 1.5, 2] as const;

interface OllamaModelCatalogItem {
  name: string;
  source: "cloud" | "local";
  installed: boolean;
  running: boolean;
  needsDownload: boolean;
  size?: number;
}

function formatTimestampForFilename(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}_${String(secs).padStart(2, "0")}`;
}

function buildCutFilenameFromRange(start: number, end: number): string {
  return `${formatTimestampForFilename(start)}-${formatTimestampForFilename(end)}.mp4`;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  try {
    const val = window.localStorage.getItem(key);
    if (val === "true") return true;
    if (val === "false") return false;
  } catch {
    // ignore storage errors
  }
  return fallback;
}

function readStoredPreset(): CutPreset["id"] {
  try {
    const val = window.localStorage.getItem("ui.cutPreset");
    if (val === "podcast" || val === "dinamico" || val === "curtos") {
      return val;
    }
  } catch {
    // ignore
  }
  return "dinamico";
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const {
    selectedFiles,
    setSelectedFiles,
    videoView,
    setVideoView,
    showBlocksDialog,
    showAiResponseDialog,
    showAiResponseOnAnalyze,
    showRegenerateAnalyzeDialog,
    setShowBlocksDialog,
    setShowAiResponseDialog,
    setShowRegenerateAnalyzeDialog,
    showLLMConfigDialog,
    showWhisperConfigDialog,
    showFFmpegConfigDialog,
    showDependenciesDialog,
    showInstallationDialog,
    showConfigureAppDialog,
    setShowLLMConfigDialog,
    setShowWhisperConfigDialog,
    setShowFFmpegConfigDialog,
    setShowDependenciesDialog,
    setShowInstallationDialog,
    setShowConfigureAppDialog,
    renameVideoId,
    renameVideoNewName,
    showMoveUploadDialog,
    dontAskMoveUpload,
    setRenameVideoId,
    setRenameVideoNewName,
    setShowMoveUploadDialog,
    setDontAskMoveUpload,
    selectedDependencyForInstall,
    setSelectedDependencyForInstall,
  } = useUIState();

  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [archivedVideos, setArchivedVideos] = useState<VideoItem[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [action, setAction] = useState<ActionState>(initialAction);
  const [blocks, setBlocks] = useState<Record<string, unknown>[]>([]);
  const [aiResponseRaw, setAiResponseRaw] = useState<string | null>(null);
  const [showHowToUseDialog, setShowHowToUseDialog] = useState(false);

  // Tool & app config state
  const [llmModel, setLlmModel] = useState<string>("");
  const [embeddingModel, setEmbeddingModel] = useState<string>("nomic-embed-text");
  const [registeredEmbeddingModels, setRegisteredEmbeddingModels] = useState<string[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelCatalog, setOllamaModelCatalog] = useState<OllamaModelCatalogItem[]>([]);
  const [ollamaLocalAvailable, setOllamaLocalAvailable] = useState(false);
  const [ollamaRemoteAvailable, setOllamaRemoteAvailable] = useState(false);
  const [llmSystemPrompt, setLlmSystemPrompt] = useState<string>("");
  const [whisperDevice, setWhisperDevice] = useState<"cpu" | "cuda">("cuda");
  const [whisperFormats, setWhisperFormats] = useState<string[]>(["json", "vtt", "txt"]);
  const [whisperConfig, setWhisperConfig] = useState<Partial<WhisperConfig>>({});
  const [ffmpegConfig, setFfmpegConfig] = useState<FFmpegConfig | null>(null);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [configBaseDir, setConfigBaseDir] = useState<string>("");
  const [configDownloadResolution, setConfigDownloadResolution] = useState<
    "1080p" | "1440p" | "4k"
  >("1080p");

  // Arc redesign UI state
  const [sidebarPinned, setSidebarPinned] = useState<boolean>(() =>
    readStoredBoolean("ui.sidebarPinned", false),
  );
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(() =>
    readStoredBoolean("ui.dockCollapsed", false),
  );
  const [selectedPreset, setSelectedPreset] = useState<CutPreset["id"]>(readStoredPreset);
  const [reviewBeforeRender, setReviewBeforeRender] = useState<boolean>(() =>
    readStoredBoolean("ui.reviewBeforeRender", true),
  );
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [showSettingsHub, setShowSettingsHub] = useState(false);
  const [showNewVideoModal, setShowNewVideoModal] = useState(false);

  // Video navigation history (back/forward arrows)
  const [videoHistory, setVideoHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number>(-1);

  // Immersive cut playback state
  const [immersiveCutId, setImmersiveCutId] = useState<string | null>(null);
  const immersiveRestoreTimeRef = useRef<number>(0);
  const [immersiveIdle, setImmersiveIdle] = useState(false);

  // HTML5 Video Player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [volume, setVolume] = useState<number>(1);
  const [muted, setMuted] = useState<boolean>(false);

  const {
    dependencies,
    loadingDependencies,
    installingDependency,
    uninstallingDependency,
    dependencyOperationFeedback,
    dependencyInstallSessionId,
    dependencyLogOperation,
    dependencyInstallLogDependency,
    dependencyInstallLogStatus,
    dependencyInstallLogs,
    showDependencyInstallLogs,
    refreshingDependencies,
    loadDependencies,
    refreshDependencies,
    prepareDependenciesDialog,
    startDependencyOperationSession,
    cancelActiveDependencyInstallSession,
    downloadDependencyLogsAsTxt,
  } = useDependencyManagementWorkflow();

  const activeVideo = useMemo(
    () =>
      videos.find((v) => v.job.job_id === activeVideoId) ??
      archivedVideos.find((v) => v.job.job_id === activeVideoId),
    [videos, archivedVideos, activeVideoId],
  );

  const {
    showBatchPipelineDialog,
    selectedVideosForBatch,
    batchPipelineOptions,
    isBatchProcessing,
    activeBatchId,
    showBatchCompletionNotification,
    batchCompletionMessage,
    batchWaitingForApproval,
    setShowBatchPipelineDialog,
    openBatchPipelineDialog,
    continueActiveBatchPipeline,
    toggleBatchVideo,
    updateBatchPipelineOptions,
    cancelBatchPipelineDialog,
    startBatchPipelineDialog,
    startSingleJobPipeline,
    closeBatchCompletionNotification,
  } = useBatchPipelineWorkflow({ onActiveVideosLoaded: setVideos });

  const {
    cuts,
    setCuts,
    suggestedCuts,
    setSuggestedCuts,
    selectedSuggestedCutId,
    setSelectedSuggestedCutId,
    isAnalyzing,
    setIsAnalyzing,
    showDeleteCutConfirmDialog,
    dontAskDeleteCutAgain,
    setDontAskDeleteCutAgain,
    clearCuts,
    clearSuggestedCuts,
    clearSelectedSuggestedCut,
    resetForActiveVideoChange,
    loadCutsForActiveJob,
    loadCutsForVideo,
    handleAnalyzeResult,
    closeDeleteCutConfirmDialog,
    confirmDeleteSuggestedCut,
  } = useCutsWorkflow({
    activeJobId: activeVideo?.job.job_id ?? null,
    appSettings,
    showAiResponseOnAnalyze,
    runAction,
    onAppSettingsUpdated: setAppSettings,
    onAiResponseRawChange: setAiResponseRaw,
    onShowAiResponseDialogChange: setShowAiResponseDialog,
    onRefreshVideo: refreshVideo,
    onPausePlayback: () => videoRef.current?.pause(),
    onSeekAndPlay: (seconds) => {
      if (videoRef.current) {
        videoRef.current.currentTime = seconds;
        void videoRef.current.play().catch(() => {});
      }
    },
  });

  const sharedTaskLogs = useSharedTaskLogWorkflow({
    activeJobId: activeVideo?.job.job_id ?? null,
    isTranscribing: activeVideo?.isTranscribing,
    isRendering: false,
  });

  function prepareTranscriptionTaskLog() {
    sharedTaskLogs.prepareTaskLog("transcription");
  }

  function prepareRenderTaskLog() {
    sharedTaskLogs.prepareTaskLog("render");
  }

  function stopSharedTaskLogsPolling() {
    sharedTaskLogs.stopLogsPolling();
  }

  function resetSharedTaskLogs() {
    sharedTaskLogs.resetTaskLogs();
  }

  const {
    showTranscriptionFormatListDialog,
    showTranscriptionContentDialog,
    showTranscriptionDeleteDialog,
    showTranscriptionRegenerateConfirmDialog,
    selectedTranscriptionFormat,
    pendingDeleteFormat,
    transcriptionContent,
    activeVideoHasText,
    activeVideoHasVtt,
    activeVideoHasSegments,
    hydrateTranscriptions,
    cancelActiveTranscription,
    closeTranscriptionFormatList,
    closeTranscriptionContent,
    requestDeleteTranscriptionFormat,
    cancelDeleteTranscriptionFormat,
    confirmDeleteTranscriptionFormat,
    selectTranscriptionFormat,
    deleteAllTranscriptionFormats,
    closeTranscriptionRegenerateConfirm,
    confirmTranscriptionRegenerate,
  } = useTranscriptionWorkflow({
    activeVideo,
    runAction,
    updateVideo,
    refreshVideo,
    closeBlocksDialog: () => setShowBlocksDialog(false),
    clearBlocks: () => setBlocks([]),
    clearSelectedCut: clearSelectedSuggestedCut,
    clearSuggestedCuts,
    prepareTranscriptionTaskLog,
    stopTaskLogsPolling: stopSharedTaskLogsPolling,
  });

  const {
    showCutEditDialog,
    editingCutId,
    editCutStartMinutes,
    editCutStartSeconds,
    editCutEndMinutes,
    editCutEndSeconds,
    showAddManualCutDialog,
    openEditCutDialog,
    closeEditCutDialog,
    saveEditedCutTimestamps,
    closeAddManualCutDialog,
    saveManualCutTimestamps,
  } = useCutTimestampWorkflow({
    activeJobId: activeVideo?.job.job_id ?? null,
    cuts,
    suggestedCuts,
    setCuts,
    setSuggestedCuts,
    setSelectedSuggestedCutId,
    persistCuts: async (jobId, nextCuts) => {
      await updateCuts(jobId, nextCuts);
    },
    seekTo: (seconds) => {
      if (videoRef.current) {
        videoRef.current.currentTime = seconds;
        void videoRef.current.play().catch(() => {});
      }
    },
  });

  const {
    renderOutputs,
    isRendering,
    buildRenderUrl,
    clearRenderOutputs,
    cancelActiveRendering,
    openRenderOutputFolder,
    deleteRenderOutputFile,
  } = useRenderingWorkflow({
    activeJobId: activeVideo?.job.job_id ?? null,
    cuts,
    runAction,
    updateVideo,
    prepareRenderTaskLog,
    stopTaskLogsPolling: stopSharedTaskLogsPolling,
    onRenderTimeout: () => {
      setAction({
        busy: false,
        error: "Renderização demorou muito tempo. Processo foi cancelado.",
      });
    },
  });

  // Persist UI preferences
  useEffect(() => {
    try {
      window.localStorage.setItem("ui.sidebarPinned", String(sidebarPinned));
    } catch {
      // ignore
    }
  }, [sidebarPinned]);

  useEffect(() => {
    try {
      window.localStorage.setItem("ui.dockCollapsed", String(dockCollapsed));
    } catch {
      // ignore
    }
  }, [dockCollapsed]);

  useEffect(() => {
    try {
      window.localStorage.setItem("ui.cutPreset", selectedPreset);
    } catch {
      // ignore
    }
  }, [selectedPreset]);

  useEffect(() => {
    try {
      window.localStorage.setItem("ui.reviewBeforeRender", String(reviewBeforeRender));
    } catch {
      // ignore
    }
  }, [reviewBeforeRender]);

  // Body scroll lock when any legacy modal is open
  useEffect(() => {
    const updateBodyScrollLock = () => {
      const hasDialog = document.querySelectorAll(".dialog-overlay").length > 0;
      document.body.classList.toggle("modal-open", hasDialog);
    };
    updateBodyScrollLock();
    const observer = new MutationObserver(updateBodyScrollLock);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.body.classList.remove("modal-open");
    };
  }, []);

  // Auto-dismiss error toast after 6s
  useEffect(() => {
    if (!action.error) return;
    const timer = window.setTimeout(() => {
      setAction((prev) => ({ ...prev, error: undefined }));
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [action.error]);

  async function runAction<T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) {
    setAction({ busy: true });
    try {
      const result = await fn();
      onSuccess?.(result);
      setAction({ busy: false });
    } catch (error: any) {
      const errorMessage = error instanceof Error ? error.message : "Erro inesperado";
      setAction({ busy: false, error: errorMessage });
    }
  }

  function mergeModelOptions(...modelLists: Array<Array<string | null | undefined>>): string[] {
    const merged = new Set<string>();
    for (const modelList of modelLists) {
      for (const candidate of modelList) {
        const model = String(candidate || "").trim();
        if (model) merged.add(model);
      }
    }
    return Array.from(merged);
  }

  async function refreshOllamaModelOptions(showErrorToast = false): Promise<void> {
    try {
      const result = await getOllamaModels();
      const backendCatalog = result.catalog || [];
      setOllamaModelCatalog(backendCatalog);
      setOllamaModels(
        mergeModelOptions(
          result.models,
          backendCatalog.map((entry) => entry.name),
          [result.configuredModel],
        ),
      );
      setOllamaLocalAvailable(Boolean(result.localAvailable));
      setOllamaRemoteAvailable(Boolean(result.remoteAvailable));
    } catch (error) {
      console.error("Failed to load Ollama models:", error);
      setOllamaLocalAvailable(false);
      setOllamaRemoteAvailable(false);
      if (showErrorToast) {
        setAction({
          busy: false,
          error: "Não foi possível carregar a lista de modelos do Ollama.",
        });
      }
    }
  }

  function updateVideo(jobId: string, updates: Partial<VideoItem>) {
    setVideos((current) => current.map((v) => (v.job.job_id === jobId ? { ...v, ...updates } : v)));
  }

  function updateArchivedVideo(jobId: string, updates: Partial<VideoItem>) {
    setArchivedVideos((current) =>
      current.map((v) => (v.job.job_id === jobId ? { ...v, ...updates } : v)),
    );
  }

  function refreshVideo(id: string) {
    return runAction(
      () => getJob(id),
      (value) => {
        updateVideo(id, { job: value });
      },
    );
  }

  function findActiveTranscriptionOrRendering(): string | null {
    const transcribingVideo = videos.find((v) => v.isTranscribing);
    if (transcribingVideo) return transcribingVideo.job.job_id;
    if (isRendering && activeVideoId) return activeVideoId;
    return null;
  }

  function canStartOperation(targetJobId: string): { allowed: boolean; message?: string } {
    const busyJobId = findActiveTranscriptionOrRendering();
    if (!busyJobId || busyJobId === targetJobId) return { allowed: true };
    return {
      allowed: false,
      message: "Já existe um vídeo em processamento. Cancele antes de iniciar outro.",
    };
  }

  const selectVideoWithHistory = useCallback(
    (jobId: string, pushHistory = true) => {
      setImmersiveCutId(null);
      setTranscriptOpen(false);
      setActiveVideoId(jobId);

      if (pushHistory) {
        setVideoHistory((prev) => {
          const base = prev.slice(0, historyIndex + 1);
          if (base[base.length - 1] === jobId) return prev;
          const next = [...base, jobId];
          setHistoryIndex(next.length - 1);
          return next;
        });
      }
    },
    [historyIndex],
  );

  const canGoBack = historyIndex > 0;
  const canGoForward = historyIndex >= 0 && historyIndex < videoHistory.length - 1;

  const handleGoBack = useCallback(() => {
    if (!canGoBack) return;
    const nextIndex = historyIndex - 1;
    setHistoryIndex(nextIndex);
    const targetId = videoHistory[nextIndex];
    if (targetId) {
      setImmersiveCutId(null);
      setTranscriptOpen(false);
      setActiveVideoId(targetId);
    }
  }, [canGoBack, historyIndex, videoHistory]);

  const handleGoForward = useCallback(() => {
    if (!canGoForward) return;
    const nextIndex = historyIndex + 1;
    setHistoryIndex(nextIndex);
    const targetId = videoHistory[nextIndex];
    if (targetId) {
      setImmersiveCutId(null);
      setTranscriptOpen(false);
      setActiveVideoId(targetId);
    }
  }, [canGoForward, historyIndex, videoHistory]);

  async function loadVideos() {
    await runAction(
      async () => {
        const [active, archived] = await Promise.all([listVideos(), listArchivedVideos()]);
        return { active, archived };
      },
      ({ active, archived }) => {
        const activeItems = active.map(recordToVideoItem);
        const archivedItems = archived.map(recordToVideoItem);
        setVideos(activeItems);
        setArchivedVideos(archivedItems);
        hydrateTranscriptions(activeItems, updateVideo);
        hydrateTranscriptions(archivedItems, updateArchivedVideo);

        if (activeItems.length > 0 && !activeVideoId) {
          const firstId = activeItems[0].job.job_id;
          setActiveVideoId(firstId);
          setVideoHistory([firstId]);
          setHistoryIndex(0);
        }
      },
    );
  }

  function upsertVideoIntoList(video: VideoItem) {
    const jobId = String(video?.job?.job_id ?? "").trim();
    const title = String(video?.job?.video_name ?? video?.job?.source_file_name ?? "").trim();
    const videoPath = String(video?.videoPath ?? "").trim();
    if (!jobId || !title || !videoPath) {
      void loadVideos();
      return;
    }

    const normalized: VideoItem = {
      ...video,
      job: { ...video.job, video_name: title },
      videoPath,
    };

    setVideos((current) => [normalized, ...current.filter((v) => v.job.job_id !== jobId)]);
    selectVideoWithHistory(jobId, true);
  }

  // Load initial data
  useEffect(() => {
    void loadVideos();

    (async () => {
      try {
        const toolConfigs = await getToolConfigs();
        applyToolConfigs(toolConfigs);
        await refreshOllamaModelOptions(false);
      } catch (error) {
        console.error("Failed to load tool configs:", error);
      }

      await loadDependencies();

      try {
        const settings = await getSettings();
        setAppSettings(settings);
        setConfigBaseDir(settings.media.base_dir);
        setConfigDownloadResolution(settings.media.download_resolution || "1080p");
      } catch (error) {
        console.error("Failed to load app settings:", error);
      }
    })();
  }, []);

  // Load cuts & reset video-scoped UI when active video changes
  useEffect(() => {
    setBlocks([]);
    resetForActiveVideoChange();
    setAiResponseRaw(null);
    setShowAiResponseDialog(false);
    resetSharedTaskLogs();
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    clearRenderOutputs();

    if (activeVideoId) {
      loadCutsForActiveJob(activeVideoId);
      void loadCutsForVideo(activeVideoId);
    } else {
      clearCuts();
    }
  }, [activeVideoId]);

  // Refresh active job & cuts when batch processing completes or waits for approval
  useEffect(() => {
    if (!activeVideoId) return;
    if (batchWaitingForApproval || !isBatchProcessing) {
      loadCutsForActiveJob(activeVideoId);
    }
  }, [batchWaitingForApproval, isBatchProcessing, activeVideoId]);

  // Build DockCutItem list with rendered MP4 filenames matched
  const dockCuts: DockCutItem[] = useMemo(() => {
    return cuts.map((cut) => {
      const expectedFile = buildCutFilenameFromRange(cut.start, cut.end);
      const matched = renderOutputs.find((p) => p.endsWith(expectedFile));
      return {
        ...cut,
        renderedFileName: matched ? expectedFile : null,
      };
    });
  }, [cuts, renderOutputs]);

  const immersiveCut = useMemo(
    () => (immersiveCutId ? dockCuts.find((c) => c.cut_id === immersiveCutId) ?? null : null),
    [immersiveCutId, dockCuts],
  );

  // Determine video source URL (either rendered short MP4 or source video)
  const isPlayingRenderedFile = Boolean(
    immersiveCut?.renderedFileName &&
      renderOutputs.some((p) => p.endsWith(immersiveCut.renderedFileName!)),
  );

  const videoSrc = useMemo(() => {
    if (!activeVideo?.job?.job_id) return null;
    if (immersiveCut?.renderedFileName) {
      const matchedPath = renderOutputs.find((p) => p.endsWith(immersiveCut.renderedFileName!));
      if (matchedPath) {
        return buildRenderUrl(matchedPath);
      }
    }
    return `${apiBaseUrl}/media/videos/${activeVideo.job.job_id}`;
  }, [activeVideo?.job?.job_id, immersiveCut?.renderedFileName, renderOutputs, buildRenderUrl]);

  // Single unified HTML5 video event listener (fixes duplicate timeupdate bug)
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onLoadedMetadata = () => {
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      video.playbackRate = playbackRate;
      video.volume = volume;
      video.muted = muted;
    };
    const onTimeUpdate = () => {
      setCurrentTime(video.currentTime);

      if (immersiveCut && !isPlayingRenderedFile) {
        if (video.currentTime >= immersiveCut.end) {
          video.pause();
          video.currentTime = immersiveCut.end;
        }
        return;
      }

      if (selectedSuggestedCutId) {
        const selectedCut = suggestedCuts.find((c) => c.cut_id === selectedSuggestedCutId);
        if (selectedCut && video.currentTime >= selectedCut.end && !video.paused) {
          video.pause();
        }
      }
    };

    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("loadedmetadata", onLoadedMetadata);
    video.addEventListener("durationchange", onLoadedMetadata);
    video.addEventListener("timeupdate", onTimeUpdate);

    return () => {
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("loadedmetadata", onLoadedMetadata);
      video.removeEventListener("durationchange", onLoadedMetadata);
      video.removeEventListener("timeupdate", onTimeUpdate);
    };
  }, [
    videoSrc,
    immersiveCut,
    isPlayingRenderedFile,
    selectedSuggestedCutId,
    suggestedCuts,
    playbackRate,
    volume,
    muted,
  ]);

  // Hide sidebar edge hint after 2s of mouse inactivity in immersive mode
  useEffect(() => {
    if (!immersiveCutId) {
      setImmersiveIdle(false);
      return;
    }

    let timer: number | null = null;
    const resetIdle = () => {
      setImmersiveIdle(false);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setImmersiveIdle(true), 2000);
    };

    resetIdle();
    window.addEventListener("mousemove", resetIdle);
    return () => {
      window.removeEventListener("mousemove", resetIdle);
      if (timer) window.clearTimeout(timer);
    };
  }, [immersiveCutId]);

  // Global keyboard shortcuts (DESIGN.md)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarPinned((prev) => !prev);
        return;
      }

      if (e.key === "Escape") {
        if (transcriptOpen) {
          setTranscriptOpen(false);
          return;
        }
        if (immersiveCutId) {
          handleExitImmersive();
          return;
        }
      }

      if (isTyping) return;

      if (e.code === "Space") {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleSeek(Math.max(0, displayedCurrentTime - 5));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleSeek(Math.min(displayedDuration, displayedCurrentTime + 5));
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  // Displayed time/duration (relative to cut when in source-based immersive mode)
  const displayedCurrentTime =
    immersiveCut && !isPlayingRenderedFile
      ? Math.max(0, currentTime - immersiveCut.start)
      : currentTime;

  const displayedDuration =
    immersiveCut && !isPlayingRenderedFile
      ? Math.max(1, immersiveCut.end - immersiveCut.start)
      : duration;

  function handleTogglePlay() {
    const video = videoRef.current;
    if (!video || !videoSrc) return;
    if (video.paused) {
      if (immersiveCut && !isPlayingRenderedFile) {
        if (video.currentTime < immersiveCut.start || video.currentTime >= immersiveCut.end) {
          video.currentTime = immersiveCut.start;
        }
      }
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  }

  function handleSeek(seconds: number) {
    const video = videoRef.current;
    if (!video) return;
    if (immersiveCut && !isPlayingRenderedFile) {
      const clamped = Math.min(
        immersiveCut.end,
        Math.max(immersiveCut.start, immersiveCut.start + seconds),
      );
      video.currentTime = clamped;
      setCurrentTime(clamped);
    } else {
      const clamped = Math.max(0, Math.min(duration || seconds, seconds));
      video.currentTime = clamped;
      setCurrentTime(clamped);
    }
  }

  function handleCycleSpeed() {
    const idx = SPEED_STEPS.indexOf(playbackRate as (typeof SPEED_STEPS)[number]);
    const next = SPEED_STEPS[(idx + 1) % SPEED_STEPS.length];
    setPlaybackRate(next);
    if (videoRef.current) {
      videoRef.current.playbackRate = next;
    }
  }

  function handleToggleMute() {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) {
      videoRef.current.muted = next;
    }
  }

  function handleVolumeChange(vol: number) {
    setVolume(vol);
    if (vol > 0 && muted) setMuted(false);
    if (videoRef.current) {
      videoRef.current.volume = vol;
      if (vol > 0) videoRef.current.muted = false;
    }
  }

  function handleSelectCut(cutId: string) {
    setSelectedSuggestedCutId(cutId);
    const cut = cuts.find((c) => c.cut_id === cutId);
    if (cut && videoRef.current) {
      videoRef.current.currentTime = cut.start;
      setCurrentTime(cut.start);
      void videoRef.current.play().catch(() => {});
    }
  }

  function handlePrevNextCut(direction: -1 | 1) {
    const visible = showDiscarded ? cuts : cuts.filter((c) => c.status !== "rejected");
    if (visible.length === 0) return;
    const sorted = visible.slice().sort((a, b) => a.start - b.start);
    const idx = sorted.findIndex((c) => c.cut_id === selectedSuggestedCutId);
    const nextIdx =
      idx === -1
        ? direction === 1
          ? 0
          : sorted.length - 1
        : (idx + direction + sorted.length) % sorted.length;
    handleSelectCut(sorted[nextIdx].cut_id);
  }

  function handleWatchCut(cut: DockCutItem) {
    if (videoRef.current) {
      immersiveRestoreTimeRef.current = videoRef.current.currentTime;
    }
    setSelectedSuggestedCutId(cut.cut_id);
    setImmersiveCutId(cut.cut_id);
    setDockCollapsed(true);

    if (!cut.renderedFileName && videoRef.current) {
      videoRef.current.currentTime = cut.start;
      void videoRef.current.play().catch(() => {});
    }
  }

  function handleExitImmersive() {
    setImmersiveCutId(null);
    setDockCollapsed(false);
    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.currentTime = immersiveRestoreTimeRef.current || 0;
    }
  }

  async function persistUpdatedCuts(nextCuts: typeof cuts) {
    setCuts(nextCuts);
    setSuggestedCuts(nextCuts);
    if (activeVideo?.job.job_id) {
      try {
        await updateCuts(activeVideo.job.job_id, nextCuts);
      } catch (err: any) {
        setAction({
          busy: false,
          error: err?.message || "Não foi possível salvar as alterações no corte.",
        });
      }
    }
  }

  function handleApproveCut(cutId: string) {
    const nextCuts = cuts.map((c) =>
      c.cut_id === cutId ? { ...c, status: "approved" as const } : c,
    );
    void persistUpdatedCuts(nextCuts);
  }

  function handleDiscardCut(cutId: string) {
    const nextCuts = cuts.map((c) =>
      c.cut_id === cutId ? { ...c, status: "rejected" as const } : c,
    );
    if (selectedSuggestedCutId === cutId) {
      setSelectedSuggestedCutId(null);
    }
    void persistUpdatedCuts(nextCuts);
  }

  function handleAdjustCutTime(cutId: string, field: "start" | "end", delta: number) {
    const nextCuts = cuts.map((c) => {
      if (c.cut_id !== cutId) return c;
      if (field === "start") {
        const nextStart = Math.max(0, Math.min(c.end - 5, c.start + delta));
        return { ...c, start: nextStart };
      } else {
        const maxEnd = duration > 0 ? duration : c.end + 60;
        const nextEnd = Math.min(maxEnd, Math.max(c.start + 5, c.end + delta));
        return { ...c, end: nextEnd };
      }
    });
    void persistUpdatedCuts(nextCuts);
  }

  function handleRenameCut(cutId: string, title: string) {
    const nextCuts = cuts.map((c) => (c.cut_id === cutId ? { ...c, title } : c));
    void persistUpdatedCuts(nextCuts);
  }

  function handleDownloadRenderedCut(fileName: string) {
    const matchedPath = renderOutputs.find((p) => p.endsWith(fileName));
    if (!matchedPath) return;
    const url = buildRenderUrl(matchedPath);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  }

  async function handleGenerateCuts() {
    if (!activeVideo) return;
    const check = canStartOperation(activeVideo.job.job_id);
    if (!check.allowed) {
      setAction({ busy: false, error: check.message });
      return;
    }

    try {
      await startSingleJobPipeline(activeVideo.job.job_id, {
        transcription: true,
        analysis: true,
        render: true,
        preApprove: reviewBeforeRender,
      });
    } catch (err: any) {
      setAction({
        busy: false,
        error: err?.message || "Não foi possível iniciar a geração de cortes.",
      });
    }
  }

  async function handleCancelProcessing() {
    if (activeBatchId && isBatchProcessing) {
      await cancelBatchPipelineDialog();
      return;
    }
    if (activeVideo?.isTranscribing) {
      await cancelActiveTranscription();
      return;
    }
    if (isRendering) {
      await cancelActiveRendering();
    }
  }

  async function handleToggleTranscript() {
    const next = !transcriptOpen;
    setTranscriptOpen(next);
    if (next && activeVideo && blocks.length === 0) {
      try {
        const res = await buildBlocks(activeVideo.job.job_id);
        if (Array.isArray(res)) {
          setBlocks(res);
        }
      } catch {
        // Silent fallback when blocks are not yet generated
      }
    }
  }

  function applyToolConfigs(response: { active: ToolConfigs; source?: "default" | "custom" }) {
    const active = response.active;
    setWhisperConfig(active.whisper || {});
    setWhisperDevice(active.whisper.device === "cpu" ? "cpu" : "cuda");
    setWhisperFormats(
      Array.isArray(active.whisper.output_format)
        ? active.whisper.output_format
        : ["json", "vtt", "txt"],
    );
    setFfmpegConfig(active.ffmpeg || null);
    const configuredModel = String(active.llm.model || "").trim();
    const configuredEmbeddingModel =
      String(active.llm.embedding_model || "nomic-embed-text").trim() || "nomic-embed-text";
    const configuredEmbeddingModels = Array.isArray(active.llm.registered_embedding_models)
      ? active.llm.registered_embedding_models
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      : [];
    const embeddingModelSet = new Set(configuredEmbeddingModels);
    embeddingModelSet.add(configuredEmbeddingModel);

    setLlmModel(configuredModel);
    setEmbeddingModel(configuredEmbeddingModel);
    setRegisteredEmbeddingModels(Array.from(embeddingModelSet));
    setOllamaModels((prev) => mergeModelOptions(prev, [configuredModel]));
    setLlmSystemPrompt(active.llm.system_prompt || "");
  }

  async function saveWhisperConfig(config: Partial<WhisperConfig>) {
    try {
      const outputFormats = (
        Array.isArray(config.output_format) ? config.output_format : whisperFormats
      ) as WhisperConfig["output_format"];
      const device = config.device === "cpu" ? "cpu" : "cuda";
      const response = await saveToolConfigs({
        whisper: { ...config, device, output_format: outputFormats },
      });
      applyToolConfigs(response);
      setShowWhisperConfigDialog(false);
    } catch (error: any) {
      setAction({ busy: false, error: error?.message || "Erro ao salvar Whisper." });
    }
  }

  async function saveLLMConfig(
    model: string,
    prompt: string,
    nextEmbeddingModel: string,
    nextRegisteredEmbeddingModels: string[],
  ) {
    try {
      const response = await saveToolConfigs({
        llm: {
          model,
          system_prompt: prompt,
          embedding_model: nextEmbeddingModel,
          registered_embedding_models: nextRegisteredEmbeddingModels,
        },
      });
      applyToolConfigs(response);
      setShowLLMConfigDialog(false);
    } catch (error: any) {
      setAction({ busy: false, error: error?.message || "Erro ao salvar IA." });
    }
  }

  async function saveFFmpegConfig(config: FFmpegConfig) {
    try {
      const response = await saveToolConfigs({ ffmpeg: config });
      applyToolConfigs(response);
      setShowFFmpegConfigDialog(false);
    } catch (error: any) {
      setAction({ busy: false, error: error?.message || "Erro ao salvar renderização." });
    }
  }

  async function handleMoveUploadDecision(moveUploads: boolean) {
    const askAgain = !dontAskMoveUpload;
    try {
      const updated = await saveSettings({
        preferences: {
          ask_move_on_upload: askAgain,
          move_uploads: moveUploads,
          ask_delete_cut_confirm: appSettings?.preferences?.ask_delete_cut_confirm ?? true,
        },
      });
      setAppSettings(updated);
    } catch (error) {
      console.error("Failed to save upload preferences:", error);
    }
    setShowMoveUploadDialog(false);
    setDontAskMoveUpload(false);

    if (selectedFiles.length > 0) {
      for (const file of selectedFiles) {
        await runAction(
          () => uploadVideoFile(file),
          (result) => {
            upsertVideoIntoList({
              job: result.job,
              transcriptionLogs: [],
              videoPath: result.video_path,
            });
          },
        );
      }
      setSelectedFiles([]);
      await loadVideos();
    }
  }

  const discardedCount = useMemo(
    () => cuts.filter((c) => c.status === "rejected").length,
    [cuts],
  );

  // Sync preset selection with active preset metadata if needed
  const activePresetObj = useMemo(
    () => CUT_PRESETS.find((p) => p.id === selectedPreset) ?? CUT_PRESETS[1],
    [selectedPreset],
  );

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-bg text-text-1 select-none">
      {/* Palco principal de vídeo */}
      <ImmersiveVideoStage
        videoRef={videoRef}
        videoSrc={videoSrc}
        sidebarPinned={sidebarPinned}
        hasActiveVideo={Boolean(activeVideo)}
        onTogglePlay={handleTogglePlay}
        onVideoAdded={upsertVideoIntoList}
        onLoadVideos={loadVideos}
        onError={(msg) => setAction({ busy: false, error: msg })}
      />

      {/* Barra lateral estilo Arc */}
      <ArcSidebar
        videos={videos}
        archivedVideos={archivedVideos}
        activeVideoId={activeVideoId}
        videoView={videoView}
        apiBaseUrl={apiBaseUrl}
        pinned={sidebarPinned}
        open={sidebarOpen}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        immersiveIdle={immersiveIdle}
        onSetOpen={setSidebarOpen}
        onTogglePin={() => setSidebarPinned((p) => !p)}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onSelectVideo={(jobId) => selectVideoWithHistory(jobId, true)}
        onSetView={setVideoView}
        onNewVideo={() => setShowNewVideoModal(true)}
        onOpenSettings={() => setShowSettingsHub(true)}
        onOpenFolder={(jobId) => void runAction(() => openVideoFolder(jobId))}
        onRenameVideo={(jobId, currentName) => {
          setRenameVideoId(jobId);
          setRenameVideoNewName(currentName);
        }}
        onArchiveVideo={(jobId) =>
          void runAction(
            () => archiveVideo(jobId),
            () => {
              if (activeVideoId === jobId) setActiveVideoId(null);
              void loadVideos();
            },
          )
        }
        onDeleteVideo={(jobId) =>
          void runAction(
            () => deleteVideo(jobId),
            () => {
              if (activeVideoId === jobId) setActiveVideoId(null);
              void loadVideos();
            },
          )
        }
      />

      {/* Controles flutuantes superiores */}
      <FloatingChrome
        sidebarPinned={sidebarPinned}
        sidebarOpen={sidebarOpen}
        canGoBack={canGoBack}
        canGoForward={canGoForward}
        immersiveCutTitle={immersiveCut?.title ?? null}
        onGoBack={handleGoBack}
        onGoForward={handleGoForward}
        onExitImmersive={handleExitImmersive}
        onOpenSettings={() => setShowSettingsHub(true)}
      />

      {/* Dock inferior de vidro fosco */}
      {activeVideo && (
        <GlassDock
          sidebarPinned={sidebarPinned}
          collapsed={dockCollapsed}
          isImmersive={Boolean(immersiveCut)}
          isPlaying={isPlaying}
          currentTime={displayedCurrentTime}
          duration={displayedDuration}
          playbackRate={playbackRate}
          volume={volume}
          muted={muted}
          videoSrc={videoSrc}
          jobStatus={activeVideo.job.status}
          jobError={
            (activeVideo.job as { error_message?: string | null; error?: string | null })
              .error_message ??
            (activeVideo.job as { error?: string | null }).error ??
            null
          }
          cuts={dockCuts}
          selectedCutId={selectedSuggestedCutId}
          showDiscarded={showDiscarded}
          selectedPreset={activePresetObj.id}
          reviewBeforeRender={reviewBeforeRender}
          waitingApproval={batchWaitingForApproval}
          transcriptOpen={transcriptOpen}
          onToggleCollapsed={() => setDockCollapsed((c) => !c)}
          onTogglePlay={handleTogglePlay}
          onSeek={handleSeek}
          onPrevCut={() => handlePrevNextCut(-1)}
          onNextCut={() => handlePrevNextCut(1)}
          onCycleSpeed={handleCycleSpeed}
          onToggleMute={handleToggleMute}
          onVolumeChange={handleVolumeChange}
          onToggleTranscript={() => void handleToggleTranscript()}
          onSelectCut={handleSelectCut}
          onWatchCut={handleWatchCut}
          onApproveCut={handleApproveCut}
          onDiscardCut={handleDiscardCut}
          onAdjustCutTime={handleAdjustCutTime}
          onRenameCut={handleRenameCut}
          onDownloadRenderedCut={handleDownloadRenderedCut}
          onOpenRenderedFolder={(fileName) => void openRenderOutputFolder(fileName)}
          onDeleteRenderedCut={(fileName) => void deleteRenderOutputFile(fileName)}
          onChangePreset={setSelectedPreset}
          onToggleReviewBefore={() => setReviewBeforeRender((r) => !r)}
          onGenerateCuts={() => void handleGenerateCuts()}
          onContinueApproval={() => void continueActiveBatchPipeline()}
          onCancelProcessing={() => void handleCancelProcessing()}
          onRetryError={() => void handleGenerateCuts()}
        />
      )}

      {/* Popover de transcrição */}
      <TranscriptPopover
        open={transcriptOpen}
        transcriptionText={activeVideo?.transcription || ""}
        segments={(activeVideo?.transcriptionSegments as any) || []}
        blocks={blocks}
        showDiscardedCuts={showDiscarded}
        discardedCount={discardedCount}
        onToggleShowDiscarded={() => setShowDiscarded((s) => !s)}
        onSeekTo={(seconds) => {
          handleSeek(seconds);
          if (videoRef.current?.paused) {
            void videoRef.current.play().catch(() => {});
          }
        }}
        onClose={() => setTranscriptOpen(false)}
      />

      {/* Modais de Novo Vídeo e Central de Configurações */}
      <NewVideoModal
        open={showNewVideoModal}
        onClose={() => setShowNewVideoModal(false)}
        onVideoAdded={upsertVideoIntoList}
        onLoadVideos={loadVideos}
        onError={(msg) => setAction({ busy: false, error: msg })}
      />

      <SettingsHubModal
        open={showSettingsHub}
        onClose={() => setShowSettingsHub(false)}
        onConfigureApp={() => setShowConfigureAppDialog(true)}
        onManageDependencies={() => {
          setShowDependenciesDialog(true);
          void prepareDependenciesDialog();
        }}
        onConfigureLLM={() => {
          setShowLLMConfigDialog(true);
          void refreshOllamaModelOptions(false);
        }}
        onConfigureWhisper={() => setShowWhisperConfigDialog(true)}
        onConfigureFFmpeg={() => setShowFFmpegConfigDialog(true)}
        onOpenBatchPipeline={openBatchPipelineDialog}
        onShowHowToUse={() => setShowHowToUseDialog(true)}
      />

      {/* Diálogos de suporte e configuração existentes */}
      <AppSupportDialogs
        showDeleteCutConfirmDialog={showDeleteCutConfirmDialog}
        dontAskDeleteCutAgain={dontAskDeleteCutAgain}
        showTranscriptionRegenerateConfirmDialog={showTranscriptionRegenerateConfirmDialog}
        showHowToUseDialog={showHowToUseDialog}
        onCloseDeleteCutConfirm={closeDeleteCutConfirmDialog}
        onConfirmDeleteCut={() => void confirmDeleteSuggestedCut()}
        onDontAskDeleteCutAgainChange={setDontAskDeleteCutAgain}
        onCloseTranscriptionRegenerateConfirm={closeTranscriptionRegenerateConfirm}
        onConfirmTranscriptionRegenerate={() => void confirmTranscriptionRegenerate()}
        onCloseHowToUse={() => setShowHowToUseDialog(false)}
      />

      <TranscriptionDialogs
        showTranscriptionFormatListDialog={showTranscriptionFormatListDialog}
        showTranscriptionContentDialog={showTranscriptionContentDialog}
        showTranscriptionDeleteDialog={showTranscriptionDeleteDialog}
        hasActiveVideo={Boolean(activeVideo)}
        activeVideoHasText={activeVideoHasText}
        activeVideoHasVtt={activeVideoHasVtt}
        activeVideoHasSegments={activeVideoHasSegments}
        deletingTranscription={action.busy}
        transcriptionContent={transcriptionContent}
        selectedTranscriptionFormat={selectedTranscriptionFormat}
        pendingDeleteFormat={pendingDeleteFormat}
        action={action}
        onSelectFormat={selectTranscriptionFormat}
        onDeleteAll={deleteAllTranscriptionFormats}
        onCloseFormatList={closeTranscriptionFormatList}
        onCloseContent={closeTranscriptionContent}
        onRequestDeleteFormat={requestDeleteTranscriptionFormat}
        onCancelDelete={cancelDeleteTranscriptionFormat}
        onConfirmDelete={confirmDeleteTranscriptionFormat}
      />

      {showBlocksDialog && blocks.length > 0 && (
        <BlocksDialog blocks={blocks} onClose={() => setShowBlocksDialog(false)} />
      )}

      {showAiResponseDialog && aiResponseRaw && (
        <AiResponseDialog
          aiResponseRaw={aiResponseRaw}
          onClose={() => setShowAiResponseDialog(false)}
        />
      )}

      {showRegenerateAnalyzeDialog && suggestedCuts.length > 0 && activeVideo && (
        <RegenerateAnalyzeDialog
          suggestedCuts={suggestedCuts}
          action={{ busy: isAnalyzing }}
          onCancel={() => setShowRegenerateAnalyzeDialog(false)}
          onMaintainSelected={(keptCutIds) => {
            const keptCuts = suggestedCuts.filter((cut) => keptCutIds.includes(cut.cut_id));
            setShowRegenerateAnalyzeDialog(false);
            void runAction(
              async () => {
                setIsAnalyzing(true);
                try {
                  return await analyzeJob(activeVideo.job.job_id);
                } finally {
                  setIsAnalyzing(false);
                }
              },
              (value) => handleAnalyzeResult(value, keptCuts),
            );
          }}
          onRegenerateAll={() => {
            setShowRegenerateAnalyzeDialog(false);
            void runAction(
              async () => {
                setIsAnalyzing(true);
                try {
                  return await analyzeJob(activeVideo.job.job_id);
                } finally {
                  setIsAnalyzing(false);
                }
              },
              (value) => handleAnalyzeResult(value),
            );
          }}
        />
      )}

      <CutTimestampDialogs
        showCutEditDialog={showCutEditDialog}
        editingCutId={editingCutId}
        editCutStartMinutes={editCutStartMinutes}
        editCutStartSeconds={editCutStartSeconds}
        editCutEndMinutes={editCutEndMinutes}
        editCutEndSeconds={editCutEndSeconds}
        showAddManualCutDialog={showAddManualCutDialog}
        onCloseEditCutDialog={closeEditCutDialog}
        onSaveEditedCut={saveEditedCutTimestamps}
        onCloseAddManualCutDialog={closeAddManualCutDialog}
        onSaveManualCut={saveManualCutTimestamps}
      />

      {showLLMConfigDialog && (
        <LLMConfigDialog
          llmModel={llmModel}
          embeddingModel={embeddingModel}
          registeredEmbeddingModels={registeredEmbeddingModels}
          availableModels={ollamaModels}
          modelCatalog={ollamaModelCatalog}
          localAvailable={ollamaLocalAvailable}
          remoteAvailable={ollamaRemoteAvailable}
          llmSystemPrompt={llmSystemPrompt}
          action={action}
          onRegisterModel={(name, source) => registerOllamaModel({ name, source })}
          onRemoveModel={(name) => removeOllamaModel(name)}
          onRefreshModels={() => refreshOllamaModelOptions(true)}
          onSave={(model, prompt, nextEmbeddingModel, nextRegisteredEmbeddingModels) => {
            setLlmModel(model);
            setLlmSystemPrompt(prompt);
            setEmbeddingModel(nextEmbeddingModel);
            setRegisteredEmbeddingModels(nextRegisteredEmbeddingModels);
            void saveLLMConfig(model, prompt, nextEmbeddingModel, nextRegisteredEmbeddingModels);
          }}
          onCancel={() => setShowLLMConfigDialog(false)}
        />
      )}

      {showWhisperConfigDialog && (
        <WhisperConfigDialog
          whisperDevice={whisperDevice}
          whisperFormats={whisperFormats}
          initialConfig={whisperConfig}
          action={action}
          onSave={saveWhisperConfig}
          onCancel={() => setShowWhisperConfigDialog(false)}
        />
      )}

      {showFFmpegConfigDialog && (
        <FFmpegConfigDialog
          initialConfig={ffmpegConfig || undefined}
          action={action}
          onSave={saveFFmpegConfig}
          onCancel={() => setShowFFmpegConfigDialog(false)}
        />
      )}

      {showDependenciesDialog && (
        <DependenciesDialog
          dependencies={dependencies}
          loadingDependencies={loadingDependencies}
          installingDependency={installingDependency}
          uninstallingDependency={uninstallingDependency}
          operationResultMessage={dependencyOperationFeedback?.message || null}
          operationResultTone={dependencyOperationFeedback?.kind || "success"}
          installSessionId={dependencyInstallSessionId}
          installLogOperation={dependencyLogOperation}
          installLogDependency={dependencyInstallLogDependency}
          installLogStatus={dependencyInstallLogStatus}
          installLogs={dependencyInstallLogs}
          showInstallLogs={showDependencyInstallLogs}
          refreshingDependencies={refreshingDependencies}
          onClose={() => setShowDependenciesDialog(false)}
          onRefresh={async () => {
            await refreshDependencies(true);
          }}
          onShowInstallInstructions={(name) => {
            setSelectedDependencyForInstall(name);
            setShowInstallationDialog(true);
          }}
          onInstallDependency={(name, viewMode, options) =>
            startDependencyOperationSession(name, "install", viewMode, options)
          }
          onUninstallDependency={(name, viewMode) =>
            startDependencyOperationSession(name, "uninstall", viewMode)
          }
          onCancelInstallSession={cancelActiveDependencyInstallSession}
          onDownloadInstallLogs={downloadDependencyLogsAsTxt}
        />
      )}

      {showInstallationDialog && selectedDependencyForInstall && (
        <div className="dialog-overlay" onClick={() => setShowInstallationDialog(false)}>
          <InstallationInstructionsDialog
            dependencyName={selectedDependencyForInstall}
            onClose={() => setShowInstallationDialog(false)}
          />
        </div>
      )}

      {showConfigureAppDialog && (
        <ConfigureAppDialog
          configBaseDir={configBaseDir}
          configDownloadResolution={configDownloadResolution}
          appSettings={appSettings}
          action={action}
          onSave={(baseDir, resolution, askDeleteCutConfirm) => {
            void runAction(
              () =>
                saveSettings({
                  media: {
                    base_dir: baseDir,
                    download_resolution: resolution,
                  },
                  preferences: {
                    ask_move_on_upload: appSettings?.preferences?.ask_move_on_upload ?? true,
                    move_uploads: appSettings?.preferences?.move_uploads ?? false,
                    ask_delete_cut_confirm: askDeleteCutConfirm,
                  },
                }),
              () => {
                setShowConfigureAppDialog(false);
                void getSettings().then((s) => {
                  setAppSettings(s);
                  setConfigBaseDir(s.media.base_dir);
                  setConfigDownloadResolution(s.media.download_resolution || "1080p");
                });
              },
            );
          }}
          onCancel={() => setShowConfigureAppDialog(false)}
        />
      )}

      <BatchPipelineControls
        showBatchPipelineDialog={showBatchPipelineDialog}
        videos={videos}
        selectedVideosForBatch={selectedVideosForBatch}
        batchPipelineOptions={batchPipelineOptions}
        isBatchProcessing={isBatchProcessing}
        activeBatchId={activeBatchId}
        showBatchCompletionNotification={showBatchCompletionNotification}
        batchCompletionMessage={batchCompletionMessage}
        onCloseDialog={() => setShowBatchPipelineDialog(false)}
        onVideoToggle={toggleBatchVideo}
        onOptionChange={updateBatchPipelineOptions}
        onCancel={cancelBatchPipelineDialog}
        onStart={startBatchPipelineDialog}
        onCloseCompletionNotification={closeBatchCompletionNotification}
      />

      <SimpleDialogs
        renameVideoId={renameVideoId}
        renameVideoNewName={renameVideoNewName}
        onRenameChange={setRenameVideoNewName}
        onRenameClose={() => {
          setRenameVideoId(null);
          setRenameVideoNewName("");
        }}
        onRenameSave={() => {
          if (renameVideoNewName.trim() && renameVideoId) {
            void runAction(
              () => renameVideo(renameVideoId, renameVideoNewName),
              () => {
                setRenameVideoId(null);
                setRenameVideoNewName("");
                void loadVideos();
              },
            );
          }
        }}
        showMoveUploadDialog={showMoveUploadDialog}
        dontAskMoveUpload={dontAskMoveUpload}
        onDontAskChange={setDontAskMoveUpload}
        onMoveUploadClose={() => setShowMoveUploadDialog(false)}
        onMoveUploadDecision={handleMoveUploadDecision}
        showBatchCompletionNotification={showBatchCompletionNotification}
        batchCompletionMessage={batchCompletionMessage}
        onBatchCompletionClose={closeBatchCompletionNotification}
      />

      {/* Toast não-bloqueante de erro */}
      {action.error && (
        <div
          role="alert"
          className="fixed top-4 left-1/2 -translate-x-1/2 z-modal max-w-[min(480px,90vw)] px-4 py-2.5 rounded-pill glass--strong border border-danger/40 text-sm text-text-1 shadow-panel flex items-center gap-3"
        >
          <span className="h-2 w-2 rounded-full bg-danger shrink-0" />
          <span className="truncate">{action.error}</span>
          <button
            type="button"
            onClick={() => setAction((prev) => ({ ...prev, error: undefined }))}
            className="text-xs text-text-3 hover:text-text-1 shrink-0"
          >
            Fechar
          </button>
        </div>
      )}
    </div>
  );
}
