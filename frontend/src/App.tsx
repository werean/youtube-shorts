import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Segment } from "./types";
import type { FFmpegConfig } from "./types/ffmpeg";
import type { WhisperConfig } from "./types/whisper";
import type { ToolConfigs } from "./types/toolConfigs";
import { useJobEvents, useUIState } from "./hooks";
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
  getBatchPipelineStatus,
  getJob,
  getTranscription,
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
  type AppSettings,
} from "./api";
import { useBatchPipelineWorkflow } from "./hooks/useBatchPipelineWorkflow";
import { InstallationInstructionsDialog } from "./components/dialogs/InstallationInstructionsDialog";
import { AppSupportDialogs } from "./components/app/AppSupportDialogs";
import { BatchPipelineControls } from "./components/app/BatchPipelineControls";
import { CutTimestampDialogs } from "./components/app/CutTimestampDialogs";
import { TranscriptionDialogs } from "./components/app/TranscriptionDialogs";
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
import type { LLMAutoSavePatch } from "./components/redesign/settings/AISections";
import type {
  AppSettingsPatch,
  DownloadResolution,
  SectionId,
} from "./components/redesign/settings/settingsShared";
import { TranscriptPopover } from "./components/redesign/TranscriptPopover";
import { CUT_PRESETS, isJobProcessingStatus, type CutPreset } from "./components/redesign/presets";
import { VideoItem, recordToVideoItem } from "./utils/videoHelpers";

interface ActionState {
  busy: boolean;
  error?: string;
}

const initialAction: ActionState = { busy: false };
const SPEED_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4] as const;

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
    showInstallationDialog,
    setShowInstallationDialog,
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
  const activeVideoIdRef = useRef<string | null>(activeVideoId);
  activeVideoIdRef.current = activeVideoId;
  const blocksJobIdRef = useRef<string | null>(null);
  const hydrateTranscriptionsRef = useRef<
    ((items: VideoItem[], updater: (jobId: string, updates: Partial<VideoItem>) => void) => Promise<void>) | null
  >(null);
  const [localProcessingJobs, setLocalProcessingJobs] = useState<Set<string>>(() => new Set());
  const localProcessingJobsRef = useRef<Set<string>>(localProcessingJobs);
  localProcessingJobsRef.current = localProcessingJobs;
  const [activeBatchJobId, setActiveBatchJobId] = useState<string | null>(null);
  const activeBatchJobIdRef = useRef<string | null>(null);
  const analyzingJobIdRef = useRef<string | null>(null);
  const renderingJobIdRef = useRef<string | null>(null);

  const markJobProcessing = useCallback((jobId: string | null | undefined, active: boolean) => {
    const id = String(jobId ?? "").trim();
    if (!id) return;
    setLocalProcessingJobs((prev) => {
      const has = prev.has(id);
      if (active && has) return prev;
      if (!active && !has) return prev;
      const next = new Set(prev);
      if (active) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  }, []);

  const [action, setAction] = useState<ActionState>(initialAction);
  const [blocks, setBlocks] = useState<Record<string, unknown>[]>([]);
  const [aiResponseRaw, setAiResponseRaw] = useState<string | null>(null);

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
  const [sidebarSide, setSidebarSide] = useState<"left" | "right">(() => {
    try {
      return window.localStorage.getItem("ui.sidebarSide") === "right" ? "right" : "left";
    } catch {
      return "left";
    }
  });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState<boolean>(() =>
    readStoredBoolean("ui.dockCollapsed", false),
  );
  const [dockMinimizedVisible, setDockMinimizedVisible] = useState(true);
  const [selectedPreset, setSelectedPreset] = useState<CutPreset["id"]>(readStoredPreset);
  const [reviewBeforeRender, setReviewBeforeRender] = useState<boolean>(() =>
    readStoredBoolean("ui.reviewBeforeRender", true),
  );
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [showDiscarded, setShowDiscarded] = useState(false);
  const [showSettingsHub, setShowSettingsHub] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SectionId>("app-folders");
  const [showNewVideoModal, setShowNewVideoModal] = useState(false);

  // Immersive cut playback state
  const [immersiveCutId, setImmersiveCutId] = useState<string | null>(null);
  const immersiveRestoreTimeRef = useRef<number>(0);
  const [immersiveIdle, setImmersiveIdle] = useState(false);
  const [cutResumePositions, setCutResumePositions] = useState<Record<string, number>>({});

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
    selectedVideosForBatch,
    batchPipelineOptions,
    isBatchProcessing,
    currentBatchVideoIndex,
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
  } = useBatchPipelineWorkflow({
    onActiveVideosLoaded: (items) => {
      setVideos(items);
      void hydrateTranscriptionsRef.current?.(items, updateVideo);
    },
  });

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
    requestDeleteSuggestedCut,
    pendingDeleteCutTitle,
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
    onCutDeleted: (cutId) => {
      if (immersiveCutId === cutId) {
        setImmersiveCutId(null);
        setDockCollapsed(false);
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
    clearBlocks: () => {
      blocksJobIdRef.current = null;
      setBlocks([]);
    },
    clearSelectedCut: clearSelectedSuggestedCut,
    clearSuggestedCuts,
    prepareTranscriptionTaskLog,
    stopTaskLogsPolling: stopSharedTaskLogsPolling,
  });
  hydrateTranscriptionsRef.current = hydrateTranscriptions;

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
    renderingJobId,
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

  const {
    progress: sseProgress,
    currentMessage: sseMessage,
    jobStatus: sseJobStatus,
  } = useJobEvents(activeVideoId);

  useEffect(() => {
    if (!activeVideoId || !sseJobStatus) return;
    const hasLiveActivity = sseProgress > 0 || Boolean(sseMessage);
    const isActiveStatus = isJobProcessingStatus(sseJobStatus);
    const isTrackedLocally =
      localProcessingJobsRef.current.has(activeVideoId) ||
      activeBatchJobIdRef.current === activeVideoId;

    if (isActiveStatus && (hasLiveActivity || isTrackedLocally)) {
      markJobProcessing(activeVideoId, true);
      setVideos((current) =>
        current.map((v) =>
          v.job.job_id === activeVideoId && v.job.status !== sseJobStatus
            ? { ...v, job: { ...v.job, status: sseJobStatus } }
            : v,
        ),
      );
      return;
    }

    if (!isActiveStatus) {
      markJobProcessing(activeVideoId, false);
      if (hasLiveActivity || isTrackedLocally) {
        setVideos((current) =>
          current.map((v) =>
            v.job.job_id === activeVideoId && v.job.status !== sseJobStatus
              ? { ...v, job: { ...v.job, status: sseJobStatus } }
              : v,
          ),
        );
      }
    }
  }, [activeVideoId, sseJobStatus, sseProgress, sseMessage, markJobProcessing]);

  useEffect(() => {
    if (isAnalyzing) {
      if (!analyzingJobIdRef.current && activeVideoId) {
        analyzingJobIdRef.current = activeVideoId;
        markJobProcessing(activeVideoId, true);
      }
    } else if (analyzingJobIdRef.current) {
      markJobProcessing(analyzingJobIdRef.current, false);
      analyzingJobIdRef.current = null;
    }
  }, [isAnalyzing, activeVideoId, markJobProcessing]);

  useEffect(() => {
    if (isRendering && renderingJobId) {
      if (renderingJobIdRef.current && renderingJobIdRef.current !== renderingJobId) {
        markJobProcessing(renderingJobIdRef.current, false);
      }
      renderingJobIdRef.current = renderingJobId;
      markJobProcessing(renderingJobId, true);
    } else if ((!isRendering || !renderingJobId) && renderingJobIdRef.current) {
      markJobProcessing(renderingJobIdRef.current, false);
      renderingJobIdRef.current = null;
    }
  }, [isRendering, renderingJobId, markJobProcessing]);

  useEffect(() => {
    if (!isBatchProcessing || batchWaitingForApproval) {
      if (activeBatchJobIdRef.current) {
        markJobProcessing(activeBatchJobIdRef.current, false);
        activeBatchJobIdRef.current = null;
      }
      setActiveBatchJobId(null);
      return;
    }

    if (!activeBatchId) {
      return;
    }

    const fallbackJobId = selectedVideosForBatch[currentBatchVideoIndex] ?? null;
    if (fallbackJobId && !activeBatchJobIdRef.current) {
      activeBatchJobIdRef.current = fallbackJobId;
      setActiveBatchJobId(fallbackJobId);
      markJobProcessing(fallbackJobId, true);
    }

    let cancelled = false;
    const syncBatchCurrentJob = async () => {
      try {
        const progress = await getBatchPipelineStatus(activeBatchId);
        if (cancelled) return;
        if (progress.is_running && !progress.waiting_for_approval && progress.current_job_id) {
          const nextJobId = progress.current_job_id;
          if (activeBatchJobIdRef.current && activeBatchJobIdRef.current !== nextJobId) {
            markJobProcessing(activeBatchJobIdRef.current, false);
          }
          activeBatchJobIdRef.current = nextJobId;
          setActiveBatchJobId(nextJobId);
          markJobProcessing(nextJobId, true);
        } else {
          if (activeBatchJobIdRef.current) {
            markJobProcessing(activeBatchJobIdRef.current, false);
            activeBatchJobIdRef.current = null;
          }
          setActiveBatchJobId(null);
        }
      } catch {
        // ignore transient poll error; useBatchPipelineWorkflow handles lifecycle
      }
    };

    void syncBatchCurrentJob();
    const timer = window.setInterval(() => {
      void syncBatchCurrentJob();
    }, 2000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [
    isBatchProcessing,
    activeBatchId,
    batchWaitingForApproval,
    selectedVideosForBatch,
    currentBatchVideoIndex,
    markJobProcessing,
  ]);

  const processingJobIds = useMemo(() => {
    const ids = new Set<string>(localProcessingJobs);
    for (const v of videos) {
      const isProcessingFlag = (v as { is_processing?: boolean }).is_processing === true;
      if (isProcessingFlag || v.isTranscribing === true) {
        ids.add(v.job.job_id);
      }
    }
    for (const v of archivedVideos) {
      const isProcessingFlag = (v as { is_processing?: boolean }).is_processing === true;
      if (isProcessingFlag || v.isTranscribing === true) {
        ids.add(v.job.job_id);
      }
    }
    if (isBatchProcessing && !batchWaitingForApproval && activeBatchJobId) {
      ids.add(activeBatchJobId);
    }
    if (isRendering && renderingJobId) {
      ids.add(renderingJobId);
    }
    return ids;
  }, [
    localProcessingJobs,
    videos,
    archivedVideos,
    isBatchProcessing,
    batchWaitingForApproval,
    activeBatchJobId,
    isRendering,
    renderingJobId,
  ]);

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
      window.localStorage.setItem("ui.sidebarSide", sidebarSide);
    } catch {
      // ignore
    }
  }, [sidebarSide]);

  useEffect(() => {
    try {
      window.localStorage.setItem("ui.dockCollapsed", String(dockCollapsed));
    } catch {
      // ignore
    }
  }, [dockCollapsed]);

  useEffect(() => {
    if (!dockCollapsed) {
      setDockMinimizedVisible(true);
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

  function mergeVideoUpdates(video: VideoItem, updates: Partial<VideoItem>): VideoItem {
    const next = { ...video, ...updates };
    if (
      updates.hasTranscription === undefined &&
      ("transcription" in updates || "transcriptionSegments" in updates)
    ) {
      next.hasTranscription = Boolean(
        next.transcription || (next.transcriptionSegments?.length ?? 0) > 0,
      );
    }
    return next;
  }

  function updateVideo(jobId: string, updates: Partial<VideoItem>) {
    setVideos((current) =>
      current.map((v) => (v.job.job_id === jobId ? mergeVideoUpdates(v, updates) : v)),
    );
    if ("isTranscribing" in updates) {
      markJobProcessing(jobId, Boolean(updates.isTranscribing));
    }
  }

  function updateArchivedVideo(jobId: string, updates: Partial<VideoItem>) {
    setArchivedVideos((current) =>
      current.map((v) => (v.job.job_id === jobId ? mergeVideoUpdates(v, updates) : v)),
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
    if (isRendering && (renderingJobId || activeVideoId)) {
      return renderingJobId ?? activeVideoId;
    }
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

  const selectVideo = useCallback(
    (jobId: string, keepTranscriptOpen = false) => {
      setImmersiveCutId(null);
      if (!keepTranscriptOpen) {
        setTranscriptOpen(false);
      }
      activeVideoIdRef.current = jobId;
      setActiveVideoId(jobId);
    },
    [],
  );

  async function loadVideos() {
    await runAction(
      async () => {
        const [active, archived] = await Promise.all([listVideos(), listArchivedVideos()]);
        return { active, archived };
      },
      ({ active, archived }) => {
        const activeItems = active.map((record) => ({
          ...recordToVideoItem(record),
          is_processing: (record as { is_processing?: boolean }).is_processing,
        }));
        const archivedItems = archived.map((record) => ({
          ...recordToVideoItem(record),
          is_processing: (record as { is_processing?: boolean }).is_processing,
        }));
        setVideos(activeItems);
        setArchivedVideos(archivedItems);
        hydrateTranscriptions(activeItems, updateVideo);
        hydrateTranscriptions(archivedItems, updateArchivedVideo);

        if (activeItems.length > 0 && !activeVideoId) {
          const firstId = activeItems[0].job.job_id;
          setActiveVideoId(firstId);
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
    selectVideo(jobId);
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
    if (blocksJobIdRef.current !== activeVideoId) {
      blocksJobIdRef.current = null;
      setBlocks([]);
    }
    resetForActiveVideoChange();
    setAiResponseRaw(null);
    setShowAiResponseDialog(false);
    resetSharedTaskLogs();
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    setDockMinimizedVisible(true);
    setCutResumePositions({});
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

      if (!immersiveCut && selectedSuggestedCutId) {
        const selectedCut =
          cuts.find((c) => c.cut_id === selectedSuggestedCutId) ??
          suggestedCuts.find((c) => c.cut_id === selectedSuggestedCutId);
        if (selectedCut && video.currentTime >= selectedCut.end && !video.paused) {
          video.pause();
          setSelectedSuggestedCutId(null);
          setCutResumePositions((prev) => {
            if (prev[selectedCut.cut_id] === undefined) return prev;
            const next = { ...prev };
            delete next[selectedCut.cut_id];
            return next;
          });
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
    cuts,
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
      const hasOpenModal =
        showSettingsHub ||
        showNewVideoModal ||
        showDeleteCutConfirmDialog ||
        Boolean(document.querySelector('dialog[open], [role="dialog"], [aria-modal="true"]'));

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarPinned((prev) => !prev);
        return;
      }

      if (e.key === "Escape") {
        if (hasOpenModal) return;
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
      if (hasOpenModal) return;

      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "a"
      ) {
        if (
          selectedSuggestedCutId &&
          dockCuts.some((c) => c.cut_id === selectedSuggestedCutId)
        ) {
          e.preventDefault();
          void handleApproveCut(selectedSuggestedCutId);
        }
        return;
      }

      if (
        (e.ctrlKey || e.metaKey) &&
        !e.altKey &&
        !e.shiftKey &&
        e.key.toLowerCase() === "d"
      ) {
        if (
          selectedSuggestedCutId &&
          dockCuts.some((c) => c.cut_id === selectedSuggestedCutId)
        ) {
          e.preventDefault();
          void handleDiscardCut(selectedSuggestedCutId);
        }
        return;
      }

      if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const buttonTarget = target?.closest('button, [role="button"]');
        const keepNativeEnter =
          Boolean(
            target?.closest(
              'a, input, textarea, select, [role="menuitem"], [role="switch"]',
            ),
          ) ||
          (Boolean(buttonTarget) &&
            !buttonTarget?.hasAttribute("data-enter-watch"));
        if (keepNativeEnter) {
          return;
        }
        if (selectedSuggestedCutId && !immersiveCutId) {
          const selectedCut = dockCuts.find(
            (c) => c.cut_id === selectedSuggestedCutId,
          );
          if (selectedCut) {
            e.preventDefault();
            handleWatchCut(selectedCut);
          }
        }
        return;
      }

      if (
        e.key === "Delete" &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        !e.shiftKey
      ) {
        if (
          activeVideo &&
          selectedSuggestedCutId &&
          dockCuts.some((c) => c.cut_id === selectedSuggestedCutId)
        ) {
          e.preventDefault();
          requestDeleteSuggestedCut(selectedSuggestedCutId);
        }
        return;
      }

      if (e.code === "Space") {
        if (
          target?.closest(
            'button, a, [role="button"], [role="menuitem"], [role="switch"], [role="slider"]',
          )
        ) {
          return;
        }
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleSeek(Math.max(0, displayedCurrentTime - 5));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleSeek(Math.min(displayedDuration, displayedCurrentTime + 5));
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        if (!activeVideo) return;
        const visible = showDiscarded ? cuts : cuts.filter((c) => c.status !== "rejected");
        if (visible.length === 0) return;
        const sorted = visible.slice().sort((a, b) => a.start - b.start);
        const idx = sorted.findIndex((c) => c.cut_id === selectedSuggestedCutId);
        if (e.key === "Home") {
          if (idx !== -1) {
            if (idx > 0) handleSelectCut(sorted[idx - 1].cut_id);
          } else {
            const prev = [...sorted].reverse().find((c) => c.start < currentTime - 0.5);
            if (prev) handleSelectCut(prev.cut_id);
          }
        } else {
          if (idx !== -1) {
            if (idx < sorted.length - 1) handleSelectCut(sorted[idx + 1].cut_id);
          } else {
            const next =
              currentTime < sorted[0].start
                ? sorted[0]
                : sorted.find((c) => c.start > currentTime + 0.5);
            if (next) handleSelectCut(next.cut_id);
          }
        }
      } else if (e.key === "PageUp" || e.key === "PageDown") {
        e.preventDefault();
        if (videoView !== "active") return;
        const orderedVideos = videos.slice().reverse();
        if (orderedVideos.length === 0) return;
        const currentIdx = orderedVideos.findIndex((v) => v.job.job_id === activeVideoId);
        if (e.key === "PageUp") {
          if (currentIdx > 0) {
            selectVideo(orderedVideos[currentIdx - 1].job.job_id);
          }
        } else {
          if (currentIdx !== -1 && currentIdx < orderedVideos.length - 1) {
            selectVideo(orderedVideos[currentIdx + 1].job.job_id);
          }
        }
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

  function saveResumePositionForCut(cutId: string | null) {
    if (!cutId) return;
    const cut = cuts.find((c) => c.cut_id === cutId);
    const t = videoRef.current?.currentTime;
    if (!cut || typeof t !== "number" || !Number.isFinite(t)) return;
    if (t > cut.start + 0.5 && t < cut.end - 0.5) {
      setCutResumePositions((prev) => ({ ...prev, [cutId]: t }));
    }
  }

  function handleSelectCut(cutId: string, options?: { seekTo?: number }) {
    if (selectedSuggestedCutId && selectedSuggestedCutId !== cutId) {
      saveResumePositionForCut(selectedSuggestedCutId);
    }
    setSelectedSuggestedCutId(cutId);
    const cut = cuts.find((c) => c.cut_id === cutId);
    if (cut && videoRef.current) {
      const targetTime =
        options?.seekTo !== undefined && Number.isFinite(options.seekTo)
          ? Math.max(0, Math.min(duration || options.seekTo, options.seekTo))
          : cut.start;
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
      void videoRef.current.play().catch(() => {});
    }
  }

  function handleResumeCut(cutId: string) {
    if (selectedSuggestedCutId && selectedSuggestedCutId !== cutId) {
      saveResumePositionForCut(selectedSuggestedCutId);
    }
    const cut = cuts.find((c) => c.cut_id === cutId);
    if (!cut) return;
    const saved = cutResumePositions[cutId];
    const maxResume = Math.max(cut.start, cut.end - 0.5);
    const resumeAt =
      typeof saved === "number" && Number.isFinite(saved)
        ? Math.min(maxResume, Math.max(cut.start, saved))
        : cut.start;
    setSelectedSuggestedCutId(cutId);
    if (videoRef.current) {
      videoRef.current.currentTime = resumeAt;
      setCurrentTime(resumeAt);
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
    const targetJobId = activeVideo.job.job_id;
    const check = canStartOperation(targetJobId);
    if (!check.allowed) {
      setAction({ busy: false, error: check.message });
      return;
    }

    activeBatchJobIdRef.current = targetJobId;
    setActiveBatchJobId(targetJobId);
    markJobProcessing(targetJobId, true);
    try {
      await startSingleJobPipeline(targetJobId, {
        transcription: true,
        analysis: true,
        render: true,
        preApprove: reviewBeforeRender,
      });
    } catch (err: any) {
      if (activeBatchJobIdRef.current === targetJobId) {
        activeBatchJobIdRef.current = null;
      }
      setActiveBatchJobId((prev) => (prev === targetJobId ? null : prev));
      markJobProcessing(targetJobId, false);
      setAction({
        busy: false,
        error: err?.message || "Não foi possível iniciar a geração de cortes.",
      });
    }
  }

  async function handleCancelProcessing() {
    const currentTargetJobId = activeBatchJobIdRef.current ?? activeVideo?.job.job_id ?? null;
    if (activeBatchId && isBatchProcessing) {
      await cancelBatchPipelineDialog();
      if (currentTargetJobId) {
        markJobProcessing(currentTargetJobId, false);
      }
      activeBatchJobIdRef.current = null;
      setActiveBatchJobId(null);
      return;
    }
    if (activeVideo?.isTranscribing) {
      await cancelActiveTranscription();
      markJobProcessing(activeVideo.job.job_id, false);
      return;
    }
    if (isRendering) {
      const targetRenderJobId =
        renderingJobId ?? renderingJobIdRef.current ?? activeVideo?.job.job_id ?? null;
      await cancelActiveRendering();
      if (targetRenderJobId) {
        markJobProcessing(targetRenderJobId, false);
      }
      renderingJobIdRef.current = null;
    }
  }

  async function loadTranscriptAndBlocksForJob(jobId: string, shouldLoadBlocks: boolean) {
    const isArchived =
      !videos.some((v) => v.job.job_id === jobId) &&
      archivedVideos.some((v) => v.job.job_id === jobId);
    const targetVideo =
      videos.find((v) => v.job.job_id === jobId) ??
      archivedVideos.find((v) => v.job.job_id === jobId);
    const needsTranscriptionHydration =
      !targetVideo?.transcription && !(targetVideo?.transcriptionSegments?.length);

    const tasks: Promise<void>[] = [];

    if (needsTranscriptionHydration) {
      tasks.push(
        getTranscription(jobId)
          .then((result) => {
            if (!result?.transcription && !(result?.segments?.length)) return;
            const updater = isArchived ? updateArchivedVideo : updateVideo;
            updater(jobId, {
              transcription: result.transcription || "",
              transcriptionSegments: (result.segments as unknown as Segment[]) || [],
              transcriptionFormats: result.available_formats,
              hasTranscription: true,
            });
          })
          .catch(() => {
            // Silent fallback when transcription is not yet generated
          }),
      );
    }

    if (shouldLoadBlocks) {
      markJobProcessing(jobId, true);
      tasks.push(
        buildBlocks(jobId)
          .then((res) => {
            if (activeVideoIdRef.current === jobId && Array.isArray(res)) {
              blocksJobIdRef.current = jobId;
              setBlocks(res);
            }
          })
          .catch(() => {
            // Silent fallback when blocks are not yet generated
          })
          .finally(() => {
            markJobProcessing(jobId, false);
          }),
      );
    }

    await Promise.all(tasks);
  }

  async function handleOpenVideoTranscript(jobId: string) {
    if (jobId !== activeVideoId) {
      activeVideoIdRef.current = jobId;
      blocksJobIdRef.current = null;
      setBlocks([]);
      setTranscriptOpen(true);
      selectVideo(jobId, true);
      await loadTranscriptAndBlocksForJob(jobId, true);
      return;
    }

    const nextOpen = !transcriptOpen;
    setTranscriptOpen(nextOpen);
    if (nextOpen) {
      await loadTranscriptAndBlocksForJob(jobId, blocks.length === 0);
    }
  }

  async function handleToggleTranscript() {
    const next = !transcriptOpen;
    setTranscriptOpen(next);
    if (next && activeVideo) {
      await loadTranscriptAndBlocksForJob(activeVideo.job.job_id, blocks.length === 0);
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

  function prepareSettingsSection(section: SectionId) {
    if (section === "dependencies") {
      void prepareDependenciesDialog();
    } else if (section === "ai-model" || section === "ai-search") {
      void refreshOllamaModelOptions(false);
    } else if (section === "batch") {
      if (!isBatchProcessing) {
        openBatchPipelineDialog();
        setShowBatchPipelineDialog(false);
      }
    }
  }

  function openSettingsAt(section: SectionId = "app-folders") {
    setSettingsInitialSection(section);
    setShowSettingsHub(true);
    prepareSettingsSection(section);
  }

  async function handleAutoSaveAppSettings(patch: AppSettingsPatch): Promise<void> {
    const updated = await saveSettings({
      media: {
        base_dir: patch.baseDir ?? configBaseDir,
        download_resolution:
          patch.downloadResolution ??
          (configDownloadResolution as DownloadResolution),
      },
      preferences: {
        ask_move_on_upload: appSettings?.preferences?.ask_move_on_upload ?? true,
        move_uploads: appSettings?.preferences?.move_uploads ?? false,
        ask_delete_cut_confirm:
          patch.askDeleteCutConfirm ??
          appSettings?.preferences?.ask_delete_cut_confirm ??
          true,
      },
    });
    setAppSettings(updated);
    setConfigBaseDir(updated.media.base_dir);
    setConfigDownloadResolution(updated.media.download_resolution || "1080p");
  }

  async function handleAutoSaveLLM(patch: LLMAutoSavePatch): Promise<void> {
    const nextModel = patch.model ?? llmModel;
    const nextPrompt = patch.system_prompt ?? llmSystemPrompt;
    const nextEmbeddingModel = patch.embedding_model ?? embeddingModel;
    const nextRegisteredEmbeddingModels =
      patch.registered_embedding_models ?? registeredEmbeddingModels;

    setLlmModel(nextModel);
    setLlmSystemPrompt(nextPrompt);
    setEmbeddingModel(nextEmbeddingModel);
    setRegisteredEmbeddingModels(nextRegisteredEmbeddingModels);

    const response = await saveToolConfigs({
      llm: {
        model: nextModel,
        system_prompt: nextPrompt,
        embedding_model: nextEmbeddingModel,
        registered_embedding_models: nextRegisteredEmbeddingModels,
      },
    });
    applyToolConfigs(response);
  }

  async function handleAutoSaveWhisper(patch: Partial<WhisperConfig>): Promise<void> {
    const merged: Partial<WhisperConfig> = {
      ...(whisperConfig || {}),
      ...patch,
    };
    const device =
      merged.device === "cpu"
        ? "cpu"
        : merged.device === "cuda"
          ? "cuda"
          : whisperDevice;
    const outputFormats = (
      Array.isArray(merged.output_format) ? merged.output_format : whisperFormats
    ) as WhisperConfig["output_format"];

    const response = await saveToolConfigs({
      whisper: { ...merged, device, output_format: outputFormats },
    });
    applyToolConfigs(response);
  }

  async function handleAutoSaveFFmpeg(nextConfig: FFmpegConfig): Promise<void> {
    const response = await saveToolConfigs({ ffmpeg: nextConfig });
    applyToolConfigs(response);
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
        sidebarSide={sidebarSide}
        hasActiveVideo={Boolean(activeVideo)}
        dockCollapsed={dockCollapsed}
        dockHidden={dockCollapsed && !dockMinimizedVisible}
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
        side={sidebarSide}
        open={sidebarOpen}
        immersiveIdle={immersiveIdle}
        activeVideoHasTranscription={Boolean(
          activeVideo?.transcription || (activeVideo?.transcriptionSegments?.length ?? 0) > 0,
        )}
        processingJobIds={processingJobIds}
        onSetOpen={setSidebarOpen}
        onTogglePin={() => setSidebarPinned((p) => !p)}
        onToggleSide={() => setSidebarSide((s) => (s === "left" ? "right" : "left"))}
        onSelectVideo={(jobId) => selectVideo(jobId)}
        onOpenTranscript={(jobId) => void handleOpenVideoTranscript(jobId)}
        onSetView={setVideoView}
        onNewVideo={() => setShowNewVideoModal(true)}
        onOpenSettings={() => openSettingsAt("app-folders")}
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
        sidebarSide={sidebarSide}
        sidebarOpen={sidebarOpen}
        immersiveCutTitle={immersiveCut?.title ?? null}
        onExitImmersive={handleExitImmersive}
        onOpenSettings={() => openSettingsAt("app-folders")}
      />

      {/* Dock inferior de vidro fosco */}
      {activeVideo && (
        <GlassDock
          key={activeVideo.job.job_id}
          sidebarPinned={sidebarPinned}
          sidebarSide={sidebarSide}
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
          isActivelyProcessing={Boolean(
            activeVideo && processingJobIds.has(activeVideo.job.job_id),
          )}
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
          cutResumePositions={cutResumePositions}
          onResumeCut={handleResumeCut}
          isRenderingCuts={
            Boolean(isRendering && renderingJobId === activeVideo.job.job_id) ||
            Boolean(
              isBatchProcessing &&
                activeVideo &&
                (activeVideo.job.status === "RENDERING" || sseJobStatus === "RENDERING") &&
                processingJobIds.has(activeVideo.job.job_id),
            )
          }
          onToggleCollapsed={() => setDockCollapsed((c) => !c)}
          onMinimizedVisibilityChange={setDockMinimizedVisible}
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
          onDeleteCut={requestDeleteSuggestedCut}
          onDownloadRenderedCut={handleDownloadRenderedCut}
          onOpenRenderedFolder={(fileName) => void openRenderOutputFolder(fileName)}
          onOpenVideoFolder={() =>
            activeVideo && void runAction(() => openVideoFolder(activeVideo.job.job_id))
          }
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
        sidebarPinned={sidebarPinned}
        sidebarSide={sidebarSide}
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
        initialSection={settingsInitialSection}
        onClose={() => setShowSettingsHub(false)}
        suppressEscape={showInstallationDialog}
        onSectionEnter={prepareSettingsSection}
        baseDir={configBaseDir}
        downloadResolution={configDownloadResolution}
        askDeleteCutConfirm={appSettings?.preferences?.ask_delete_cut_confirm ?? true}
        onSaveAppSettings={handleAutoSaveAppSettings}
        dependencies={dependencies}
        loadingDependencies={loadingDependencies}
        installingDependency={installingDependency}
        uninstallingDependency={uninstallingDependency}
        dependencyOperationMessage={dependencyOperationFeedback?.message || null}
        dependencyOperationTone={dependencyOperationFeedback?.kind || "success"}
        installSessionId={dependencyInstallSessionId}
        installLogOperation={dependencyLogOperation}
        installLogDependency={dependencyInstallLogDependency}
        installLogStatus={dependencyInstallLogStatus}
        installLogs={dependencyInstallLogs}
        showInstallLogs={showDependencyInstallLogs}
        refreshingDependencies={refreshingDependencies}
        onRefreshDependencies={async () => {
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
        llmModel={llmModel}
        embeddingModel={embeddingModel}
        registeredEmbeddingModels={registeredEmbeddingModels}
        availableModels={ollamaModels}
        modelCatalog={ollamaModelCatalog}
        llmSystemPrompt={llmSystemPrompt}
        onSaveLLM={handleAutoSaveLLM}
        onRegisterModel={(name, source) => registerOllamaModel({ name, source })}
        onRemoveModel={(name) => removeOllamaModel(name)}
        onRefreshModels={() => refreshOllamaModelOptions(true)}
        whisperConfig={whisperConfig}
        whisperDevice={whisperDevice}
        whisperFormats={whisperFormats}
        onSaveWhisper={handleAutoSaveWhisper}
        ffmpegConfig={ffmpegConfig}
        onSaveFFmpeg={handleAutoSaveFFmpeg}
        videos={videos}
        selectedVideosForBatch={selectedVideosForBatch}
        batchPipelineOptions={batchPipelineOptions}
        isBatchProcessing={isBatchProcessing}
        activeBatchId={activeBatchId}
        onBatchVideoToggle={toggleBatchVideo}
        onBatchOptionChange={updateBatchPipelineOptions}
        onCancelBatch={cancelBatchPipelineDialog}
        onStartBatch={async () => {
          if (selectedVideosForBatch.length > 0) {
            setShowSettingsHub(false);
          }
          await startBatchPipelineDialog();
        }}
      />

      {/* Diálogos de suporte e configuração existentes */}
      <AppSupportDialogs
        showDeleteCutConfirmDialog={showDeleteCutConfirmDialog}
        pendingDeleteCutTitle={pendingDeleteCutTitle}
        dontAskDeleteCutAgain={dontAskDeleteCutAgain}
        showTranscriptionRegenerateConfirmDialog={showTranscriptionRegenerateConfirmDialog}
        showHowToUseDialog={false}
        onCloseDeleteCutConfirm={closeDeleteCutConfirmDialog}
        onConfirmDeleteCut={() => void confirmDeleteSuggestedCut()}
        onDontAskDeleteCutAgainChange={setDontAskDeleteCutAgain}
        onCloseTranscriptionRegenerateConfirm={closeTranscriptionRegenerateConfirm}
        onConfirmTranscriptionRegenerate={() => void confirmTranscriptionRegenerate()}
        onCloseHowToUse={() => {}}
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
            const targetJobId = activeVideo.job.job_id;
            setShowRegenerateAnalyzeDialog(false);
            void runAction(
              async () => {
                setIsAnalyzing(true);
                markJobProcessing(targetJobId, true);
                try {
                  return await analyzeJob(targetJobId);
                } finally {
                  setIsAnalyzing(false);
                  markJobProcessing(targetJobId, false);
                }
              },
              (value) => handleAnalyzeResult(value, keptCuts),
            );
          }}
          onRegenerateAll={() => {
            const targetJobId = activeVideo.job.job_id;
            setShowRegenerateAnalyzeDialog(false);
            void runAction(
              async () => {
                setIsAnalyzing(true);
                markJobProcessing(targetJobId, true);
                try {
                  return await analyzeJob(targetJobId);
                } finally {
                  setIsAnalyzing(false);
                  markJobProcessing(targetJobId, false);
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

      {showInstallationDialog && selectedDependencyForInstall && (
        <div className="relative z-[90]">
          <InstallationInstructionsDialog
            dependencyName={selectedDependencyForInstall}
            onClose={() => setShowInstallationDialog(false)}
          />
        </div>
      )}

      <BatchPipelineControls
        showBatchPipelineDialog={false}
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
