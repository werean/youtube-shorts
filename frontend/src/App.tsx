import { useEffect, useMemo, useRef, useState } from "react";
import type { Job, VideoRecord } from "./types";
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
  createJob,
  deleteVideo,
  getJob,
  ingestJob,
  listArchivedVideos,
  listVideos,
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
  getCommonFolders,
  selectFolder,
  type AppSettings,
} from "./api";
import { getJobLogs } from "./api/logs";
import { useBatchPipelineWorkflow } from "./hooks/useBatchPipelineWorkflow";
import { WhisperConfigDialog } from "./components/dialogs/WhisperConfigDialog";
import { FFmpegConfigDialog } from "./components/dialogs/FFmpegConfigDialog";
import { InstallationInstructionsDialog } from "./components/dialogs/InstallationInstructionsDialog";
import { ConfigurationSection } from "./components/ConfigurationSection";
import { AppSupportDialogs } from "./components/app/AppSupportDialogs";
import { BatchPipelineControls } from "./components/app/BatchPipelineControls";
import { CutTimestampDialogs } from "./components/app/CutTimestampDialogs";
import { SelectedVideoWorkspace } from "./components/app/SelectedVideoWorkspace";
import { TranscriptionDialogs } from "./components/app/TranscriptionDialogs";
import { DependenciesDialog } from "./components/dialogs/DependenciesDialog";
import { LLMConfigDialog } from "./components/dialogs/LLMConfigDialog";
import { ConfigureAppDialog } from "./components/dialogs/ConfigureAppDialog";
import { SimpleDialogs } from "./components/dialogs/SimpleDialogs";
import { RenderingSection } from "./components/RenderingSection";
import { UploadSection } from "./components/UploadSection";
import { VideoListSection } from "./components/VideoListSection";
import { BlocksDialog } from "./components/dialogs/BlocksDialog";
import { AiResponseDialog } from "./components/dialogs/AiResponseDialog";
import { RegenerateAnalyzeDialog } from "./components/dialogs/RegenerateAnalyzeDialog";
import { AppDialog } from "./components/shared";
import { formatTimestamp, parseTimestampInput } from "./utils/formatters";
import { GlassWindow, GlassToast, GlassCard, GlassButton } from "./components/ui/glass";
import {
  StudioTopbar,
  type StudioTab,
  VideoLibrarySidebar,
  type WorkspaceVideoItem,
  VideoPlayerView,
  type VideoPlayerViewHandle,
  TranscriptInteractiveView,
  ShortInspectorView,
} from "./components/workspace";
import { getTranscription } from "./api/transcription";
import type { Segment } from "./types";

interface ActionState {
  busy: boolean;
  error?: string;
}

const initialAction: ActionState = { busy: false };

interface OllamaModelCatalogItem {
  name: string;
  source: "cloud" | "local";
  installed: boolean;
  running: boolean;
  needsDownload: boolean;
  size?: number;
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const toolConfigsInputRef = useRef<HTMLInputElement>(null);
  const {
    uploadMode,
    youtubeUrl,
    selectedFiles,
    isDraggingFile,
    setUploadMode,
    setYoutubeUrl,
    setSelectedFiles,
    setIsDraggingFile,
    videoView,
    menuOpenId,
    setVideoView,
    setMenuOpenId,
    showBlocksDialog,
    showAiResponseDialog,
    showAiResponseOnAnalyze,
    showRegenerateAnalyzeDialog,
    setShowBlocksDialog,
    setShowAiResponseDialog,
    setShowAiResponseOnAnalyze,
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
  const ingestLogsPollRef = useRef<number | null>(null);
  const ingestLogsContainerRef = useRef<HTMLDivElement>(null);
  const [action, setAction] = useState<ActionState>(initialAction);
  const [blocks, setBlocks] = useState<Record<string, unknown>[]>([]);
  const [aiResponseRaw, setAiResponseRaw] = useState<string | null>(null);
  const [showHowToUseDialog, setShowHowToUseDialog] = useState(false);
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
  const [expandUploadSection, setExpandUploadSection] = useState(true);
  const [expandVideoListSection, setExpandVideoListSection] = useState(true);
  const [expandVideoPlayerSection, setExpandVideoPlayerSection] = useState(true);
  const [expandRenderingSection, setExpandRenderingSection] = useState(true);
  const [studioTab, setStudioTab] = useState<StudioTab>("workspace");
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [currentVideoTime, setCurrentVideoTime] = useState(0);
  const [toastNotification, setToastNotification] = useState<string | null>(null);
  const videoPlayerHandleRef = useRef<VideoPlayerViewHandle>(null);
  const [ingestLogs, setIngestLogs] = useState<string[]>([]);
  const [expandIngestLogs, setExpandIngestLogs] = useState(false);
  const [ingestJobId, setIngestJobId] = useState<string | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [configBaseDir, setConfigBaseDir] = useState<string>("");
  const [configDownloadResolution, setConfigDownloadResolution] = useState<
    "1080p" | "1440p" | "4k"
  >("1080p");
  const [commonFolders, setCommonFolders] = useState<
    { name: string; path: string; exists: boolean }[]
  >([]);
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
    () => videos.find((v) => v.job.job_id === activeVideoId),
    [videos, activeVideoId],
  );
  const {
    showBatchPipelineDialog,
    selectedVideosForBatch,
    batchPipelineOptions,
    isBatchProcessing,
    batchProcessingLogs,
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
    isLoadingCuts,
    hoveredCutId,
    hoveredCutAction,
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
    requestDeleteSuggestedCut,
    closeDeleteCutConfirmDialog,
    confirmDeleteSuggestedCut,
    selectSuggestedCut,
    setCutActionHover,
    clearCutActionHover,
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
        videoRef.current.play();
      }
    },
  });

  const workspaceVideos: WorkspaceVideoItem[] = useMemo(() => {
    return videos.map((v) => {
      const isCurrentActive = v.job.job_id === activeVideoId;
      const cutsCount = isCurrentActive ? suggestedCuts.length : 0;
      return {
        id: v.job.job_id,
        title: String(v.job.video_name || v.job.youtube_url || "Vídeo sem título").trim(),
        durationSeconds: null,
        cutsCount,
        status: v.job.status,
        isProcessing: [
          "DOWNLOADING",
          "TRANSCRIBING",
          "BUILDING_BLOCKS",
          "BUILDING_TOPICS",
          "ANALYZING",
          "RENDERING",
        ].includes(v.job.status),
      };
    });
  }, [videos, activeVideoId, suggestedCuts]);

  const selectedSuggestedCut = useMemo(() => {
    if (!suggestedCuts.length) return null;
    return suggestedCuts.find((c) => c.cut_id === selectedSuggestedCutId) || suggestedCuts[0];
  }, [suggestedCuts, selectedSuggestedCutId]);

  const handleQuickAdjustStart = (newStart: number) => {
    if (!activeVideo || !selectedSuggestedCut) return;
    const updatedCut = { ...selectedSuggestedCut, start: newStart };
    const updatedSuggested = suggestedCuts.map((c) =>
      c.cut_id === updatedCut.cut_id ? updatedCut : c,
    );
    setSuggestedCuts(updatedSuggested);
    const updatedCuts = cuts.map((c) => (c.cut_id === updatedCut.cut_id ? updatedCut : c));
    setCuts(updatedCuts);
    void updateCuts(activeVideo.job.job_id, updatedSuggested);
  };

  const handleQuickAdjustEnd = (newEnd: number) => {
    if (!activeVideo || !selectedSuggestedCut) return;
    const updatedCut = { ...selectedSuggestedCut, end: newEnd };
    const updatedSuggested = suggestedCuts.map((c) =>
      c.cut_id === updatedCut.cut_id ? updatedCut : c,
    );
    setSuggestedCuts(updatedSuggested);
    const updatedCuts = cuts.map((c) => (c.cut_id === updatedCut.cut_id ? updatedCut : c));
    setCuts(updatedCuts);
    void updateCuts(activeVideo.job.job_id, updatedSuggested);
  };

  const handleCreateCutFromTranscript = (start: number, end: number, text?: string) => {
    if (!activeVideo) return;
    const newCut: Cut = {
      cut_id: `manual_${Date.now()}`,
      start,
      end,
      explanation: text || "Corte criado manualmente a partir da transcrição",
      viral_score: 90,
    };
    const nextSuggested = [...suggestedCuts, newCut];
    setSuggestedCuts(nextSuggested);
    setSelectedSuggestedCutId(newCut.cut_id);
    setCuts([...cuts, newCut]);
    void updateCuts(activeVideo.job.job_id, nextSuggested);
    setToastNotification(
      `Novo corte criado (${formatTimestamp(start)} - ${formatTimestamp(end)})`,
    );
  };

  useEffect(() => {
    if (!activeVideoId) return;
    const video = videos.find((v) => v.job.job_id === activeVideoId);
    if (!video) return;

    if (
      video.hasTranscription &&
      (!video.transcriptionSegments || video.transcriptionSegments.length === 0)
    ) {
      getTranscription(activeVideoId)
        .then((data) => {
          if (data?.segments && Array.isArray(data.segments)) {
            const segments: Segment[] = data.segments.map((s: any, idx: number) => ({
              segment_id: String(s.segment_id || `seg_${idx}`),
              start: Number(s.start) || 0,
              end: Number(s.end) || 0,
              text: String(s.text || "").trim(),
            }));
            updateVideo(activeVideoId, { transcriptionSegments: segments });
          }
        })
        .catch((err) => {
          console.warn("[UI] Falha ao carregar segmentos da transcrição:", err);
        });
    }
  }, [activeVideoId, videos]);

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
    hasAnyTranscription,
    activeVideoHasText,
    activeVideoHasVtt,
    activeVideoHasSegments,
    hydrateTranscriptions,
    requestTranscriptionStart,
    cancelActiveTranscription,
    openTranscriptionFormatList,
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
    openAddManualCutDialog,
    closeAddManualCutDialog,
    saveManualCutTimestamps,
  } = useCutTimestampWorkflow({
    activeJobId: activeVideo?.job.job_id ?? null,
    cuts,
    suggestedCuts,
    setCuts,
    setSuggestedCuts,
    setSelectedSuggestedCutId,
    persistCuts: updateCuts,
    seekTo: (seconds) => {
      if (videoRef.current) {
        videoRef.current.currentTime = seconds;
        videoRef.current.play();
      }
    },
  });
  const {
    renderOutputs,
    isRendering,
    isLoadingRenderOutputs,
    expectedRenderCount,
    renderTitlesByFileName,
    buildRenderUrl,
    clearRenderOutputs,
    startRenderFlow,
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
  const sharedTaskLogs = useSharedTaskLogWorkflow({
    activeJobId: activeVideo?.job.job_id ?? null,
    isTranscribing: activeVideo?.isTranscribing,
    isRendering,
  });
  const {
    taskLogsContainerRef,
    activeTaskLogs,
    activeTaskLogType,
    expandTaskLogs,
    showMoreTaskLogs,
  } = sharedTaskLogs;

  const statusLabel = useMemo(
    () => videos.find((v) => v.job.job_id === activeVideoId)?.job.status ?? "NENHUM VÍDEO",
    [videos, activeVideoId],
  );
  const hasAnyBlocks = useMemo(() => {
    if (!activeVideo) return false;
    return blocks.length > 0;
  }, [blocks, activeVideo]);

  useEffect(() => {
    const updateBodyScrollLock = () => {
      const hasDialog = document.querySelectorAll(".dialog-overlay").length > 0;
      document.body.classList.toggle("modal-open", hasDialog);
    };

    updateBodyScrollLock();

    const observer = new MutationObserver(() => {
      updateBodyScrollLock();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      document.body.classList.remove("modal-open");
    };
  }, []);

  async function runAction<T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) {
    console.log(`\n[App] Executando ação...`);
    setAction({ busy: true });
    try {
      console.log(`[App] Chamando função...`);
      const result = await fn();
      console.log(`[App] Ação completada com sucesso`);
      onSuccess?.(result);
      setAction({ busy: false });
    } catch (error: any) {
      console.error(`[App] Erro na ação:`, error);
      console.error(`[App] Mensagem:`, error.message);
      console.error(`[App] Stack:`, error.stack);
      const errorMessage = error instanceof Error ? error.message : "Erro inesperado";
      console.error(`[App] Será exibido ao usuário:`, errorMessage);
      setAction({ busy: false, error: errorMessage });
    }
  }

  function mergeModelOptions(...modelLists: Array<Array<string | null | undefined>>): string[] {
    const merged = new Set<string>();

    for (const modelList of modelLists) {
      for (const candidate of modelList) {
        const model = String(candidate || "").trim();
        if (model) {
          merged.add(model);
        }
      }
    }

    return Array.from(merged);
  }

  async function refreshOllamaModelOptions(showAlertOnError = false): Promise<void> {
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
      if (showAlertOnError) {
        alert("Não foi possível carregar a lista de modelos do Ollama.");
      }
    }
  }

  async function pollIngestLogs(jobId: string) {
    try {
      const result = await getJobLogs(jobId, "ingest");
      setIngestLogs(result.logs || []);
    } catch (error) {
      console.error("[logs] Failed to fetch ingest logs:", error);
    }
  }

  function startIngestLogsPolling(jobId: string) {
    if (ingestLogsPollRef.current) {
      window.clearInterval(ingestLogsPollRef.current);
    }
    void pollIngestLogs(jobId);
    ingestLogsPollRef.current = window.setInterval(() => {
      void pollIngestLogs(jobId);
    }, 1500);
  }

  function stopIngestLogsPolling() {
    if (ingestLogsPollRef.current) {
      window.clearInterval(ingestLogsPollRef.current);
      ingestLogsPollRef.current = null;
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

  // Find any video currently transcribing or rendering
  function findActiveTranscriptionOrRendering(): string | null {
    // Check if any video is transcribing
    const transcribingVideo = videos.find((v) => v.isTranscribing);
    if (transcribingVideo) return transcribingVideo.job.job_id;

    // Check if rendering is in progress (applies to activeVideo)
    if (isRendering && activeVideoId) return activeVideoId;

    return null;
  }

  function canStartOperation(targetJobId: string): { allowed: boolean; message?: string } {
    const activeJobId = findActiveTranscriptionOrRendering();
    if (!activeJobId) return { allowed: true };
    if (activeJobId === targetJobId) return { allowed: true }; // Same video can continue
    return {
      allowed: false,
      message: `Transcrição ou renderização já em andamento. Cancele para iniciar outra operação.`,
    };
  }

  // Auto-scroll ingest logs to bottom when new logs arrive
  useEffect(() => {
    if (ingestLogsContainerRef.current) {
      ingestLogsContainerRef.current.scrollTop = ingestLogsContainerRef.current.scrollHeight;
    }
  }, [ingestLogs]);

  useEffect(() => {
    return () => {
      if (ingestLogsPollRef.current) {
        window.clearInterval(ingestLogsPollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!ingestJobId || !isIngesting || uploadMode !== "url") {
      stopIngestLogsPolling();
      return;
    }

    if (!ingestLogsPollRef.current) {
      startIngestLogsPolling(ingestJobId);
    }
  }, [ingestJobId, isIngesting, uploadMode]);

  // Load cuts when active video changes
  useEffect(() => {
    if (activeVideo?.job?.job_id) {
      clearRenderOutputs();
      loadCutsForActiveJob(activeVideo.job.job_id);
    }
  }, [activeVideo?.job?.job_id]);

  function loadVideos() {
    return runAction(
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

        // Auto-selecionar o primeiro vídeo (mais antigo) se nenhum estiver selecionado
        if (activeItems.length > 0 && !activeVideoId) {
          const firstVideo = activeItems[0]; // Primeiro do array = mais antigo (ordenado por created_at)
          setActiveVideoId(firstVideo.job.job_id);
        }
      },
    );
  }

  function upsertVideoIntoList(video: VideoItem) {
    const jobId = String(video?.job?.job_id ?? "").trim();
    const title = String(video?.job?.video_name ?? video?.job?.source_file_name ?? "").trim();
    const videoPath = String(video?.videoPath ?? "").trim();

    if (!jobId || !title || !videoPath) {
      console.warn("[UI] Ignorando vídeo inválido (faltando dados obrigatórios)", {
        jobId,
        title,
        videoPath,
      });
      return;
    }

    const normalized: VideoItem = {
      ...video,
      job: {
        ...video.job,
        video_name: title,
      },
      videoPath,
    };

    setVideos((current) => [normalized, ...current.filter((v) => v.job.job_id !== jobId)]);
    setActiveVideoId(jobId);
  }

  function setView(next: "active" | "archived") {
    setVideoView(next);
    setMenuOpenId(null);
    if (next === "archived") {
      setActiveVideoId(null);
    }
    if (next === "archived") {
      window.history.pushState({}, "", "/arquivados");
    } else {
      window.history.pushState({}, "", "/");
    }
  }

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedSuggestedCutId) return;

    const selectedCut = suggestedCuts.find((c) => c.cut_id === selectedSuggestedCutId);
    if (!selectedCut) return;

    const handleTimeUpdate = () => {
      if (video.currentTime >= selectedCut.end) {
        video.pause();
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => {
      video.removeEventListener("timeupdate", handleTimeUpdate);
    };
  }, [selectedSuggestedCutId, suggestedCuts]);

  useEffect(() => {
    setBlocks([]);
    resetForActiveVideoChange();
    setAiResponseRaw(null);
    setShowAiResponseDialog(false);
    resetSharedTaskLogs();
    if (activeVideoId) {
      loadCutsForVideo(activeVideoId);
    } else {
      clearCuts();
    }
  }, [activeVideoId]);

  useEffect(() => {
    if (showAiResponseOnAnalyze && aiResponseRaw) {
      setShowAiResponseDialog(true);
    }
  }, [showAiResponseOnAnalyze, aiResponseRaw]);

  function startUploadSelectedFiles() {
    if (selectedFiles.length === 0) return;

    console.log(`\n[UI] Botão "Upload de arquivos" clicado`);
    console.log(`[UI] Arquivos: ${selectedFiles.length}`);

    // Upload all files sequentially
    const uploadSequentially = async () => {
      for (const file of selectedFiles) {
        try {
          await new Promise<void>((resolve, reject) => {
            runAction(
              () => uploadVideoFile(file),
              (result) => {
                console.log(`[UI] Upload completado: ${result.job.job_id}`);
                const newVideo: VideoItem = {
                  job: result.job,
                  transcriptionLogs: [],
                  videoPath: result.video_path,
                };
                setVideos((current) => [newVideo, ...current]);
                setActiveVideoId(result.job.job_id);
                resolve();
              },
            );
          });
        } catch (error) {
          console.error(`[UI] Erro ao fazer upload de ${file.name}:`, error);
        }
      }

      setSelectedFiles([]);
      const fileInput = document.getElementById("video-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      loadVideos();
    };

    uploadSequentially();
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
    startUploadSelectedFiles();
  }

  function applyToolConfigs(response: { active: ToolConfigs; source?: "default" | "custom" }) {
    const active = response.active;
    setWhisperConfig(active.whisper || {});
    const device = active.whisper.device === "cpu" ? "cpu" : "cuda";
    setWhisperDevice(device);
    const formats = Array.isArray(active.whisper.output_format)
      ? active.whisper.output_format
      : ["json", "vtt", "txt"];
    setWhisperFormats(formats);
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
        whisper: {
          ...config,
          device,
          output_format: outputFormats,
        },
      });
      applyToolConfigs(response);
      console.log("[UI] Configurações do Whisper salvas");
      setShowWhisperConfigDialog(false);
    } catch (error) {
      console.error("[UI] Erro ao salvar configurações do Whisper:", error);
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
      console.log("[UI] Configurações do LLM salvas");
      setShowLLMConfigDialog(false);
    } catch (error) {
      console.error("[UI] Erro ao salvar configurações do LLM:", error);
    }
  }

  async function registerNewOllamaModel(name: string, source: "cloud" | "local") {
    return registerOllamaModel({ name, source });
  }

  async function removeRegisteredOllamaModel(name: string) {
    return removeOllamaModel(name);
  }

  async function saveFFmpegConfig(config: FFmpegConfig) {
    try {
      const response = await saveToolConfigs({ ffmpeg: config });
      applyToolConfigs(response);
      console.log("[UI] Configurações do FFmpeg salvas");
      setShowFFmpegConfigDialog(false);
    } catch (error) {
      console.error("[UI] Erro ao salvar configurações do FFmpeg:", error);
    }
  }

  async function resetAllConfigs() {
    try {
      const response = await resetAllToolConfigs();
      applyToolConfigs(response);
      console.log("[UI] Configurações resetadas");
    } catch (error) {
      console.error("[UI] Erro ao resetar configurações:", error);
    }
  }

  async function resetConfigSection(section: "whisper" | "ffmpeg" | "llm") {
    try {
      const response = await resetToolConfigSection(section);
      applyToolConfigs(response);
      console.log(`[UI] Configuração resetada: ${section}`);
    } catch (error) {
      console.error(`[UI] Erro ao resetar ${section}:`, error);
    }
  }

  async function handleImportToolConfigs(file: File) {
    try {
      const content = await file.text();
      const parsed = JSON.parse(content) as ToolConfigs;
      const response = await importToolConfigs(parsed);
      applyToolConfigs(response);
      console.log("[UI] Configurações importadas");
    } catch (error) {
      console.error("[UI] Erro ao importar configurações:", error);
    }
  }

  useEffect(() => {
    const pathname = window.location.pathname;
    if (pathname === "/arquivados") {
      setVideoView("archived");
    }
    loadVideos();

    // Load tool configs
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

      try {
        const foldersData = await getCommonFolders();
        setCommonFolders(foldersData.folders);
      } catch (error) {
        console.error("Failed to load common folders:", error);
      }
    })();

    const onPopState = () => {
      setVideoView(window.location.pathname === "/arquivados" ? "archived" : "active");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  // Monitor video playback for cut end time
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !selectedSuggestedCutId) return;

    // Find the selected cut
    const selectedCut = suggestedCuts.find((cut) => cut.cut_id === selectedSuggestedCutId);
    if (!selectedCut) return;

    const handleTimeUpdate = () => {
      // Check if we've reached or passed the end time of the cut
      if (video.currentTime >= selectedCut.end) {
        video.pause();
        console.log(`[UI] Paused at ${formatTimestamp(selectedCut.end)}`);
      }
    };

    video.addEventListener("timeupdate", handleTimeUpdate);
    return () => video.removeEventListener("timeupdate", handleTimeUpdate);
  }, [selectedSuggestedCutId, suggestedCuts]);

  return (
    <div className="min-h-screen w-full bg-[#060608] text-[#f5f5f7] p-2 md:p-3 flex flex-col overflow-hidden relative">
      {/* Ambient Light Mesh Background */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[460px] h-[460px] bg-blue-600/10 rounded-full blur-[140px]" />
        <div className="absolute top-1/3 -right-24 w-[480px] h-[480px] bg-indigo-500/10 rounded-full blur-[160px]" />
        <div className="absolute -bottom-24 left-1/4 w-[540px] h-[540px] bg-slate-300/5 rounded-full blur-[150px]" />
      </div>

      {/* Janela Unificada Liquid Glass */}
      <GlassWindow
        title="ClipFlow Studio"
        subtitle={activeVideo ? String(activeVideo.job.video_name || activeVideo.job.youtube_url) : "Workspace"}
        className="flex-1 w-full flex flex-col overflow-hidden z-10 relative"
        hideTrafficLights={true}
      >
        <StudioTopbar
          activeTab={studioTab}
          onTabChange={setStudioTab}
          activeVideoTitle={activeVideo ? String(activeVideo.job.video_name || activeVideo.job.youtube_url) : null}
          gpuStatus={action.busy ? "busy" : "online"}
          gpuLabel={action.busy ? "PROCESSANDO" : "GPU ONLINE"}
          onOpenSettings={() => setShowConfigureAppDialog(true)}
        />

        <div className="flex-1 flex overflow-hidden">
          {studioTab === "workspace" && (
            <>
              {/* Coluna 1: Biblioteca de Vídeos */}
              <VideoLibrarySidebar
                videos={workspaceVideos}
                selectedVideoId={activeVideoId}
                onSelectVideo={(id) => {
                  const validation = canStartOperation(id);
                  if (!validation.allowed) {
                    console.warn(`[UI] ${validation.message}`);
                    alert(validation.message);
                    return;
                  }
                  setActiveVideoId(id);
                }}
                onImportClick={() => setShowUploadModal(true)}
              />

              {/* Coluna 2: Player e Transcrição Interativa */}
              <main className="flex-1 flex flex-col overflow-hidden bg-black/10">
                {activeVideo ? (
                  <>
                    <div className="h-60 flex-none border-b border-white/[0.08] bg-black/60 relative">
                      <VideoPlayerView
                        ref={videoPlayerHandleRef}
                        src={activeVideo.videoPath ? `${apiBaseUrl}${activeVideo.videoPath}` : undefined}
                        title={activeVideo.job.video_name || activeVideo.job.youtube_url}
                        cuts={suggestedCuts}
                        selectedCutId={selectedSuggestedCutId}
                        onSelectCut={selectSuggestedCut}
                        onTimeUpdate={setCurrentVideoTime}
                      />
                    </div>

                    <div className="flex-1 overflow-hidden p-3">
                      <TranscriptInteractiveView
                        segments={activeVideo.transcriptionSegments || []}
                        currentTime={currentVideoTime}
                        activeCut={selectedSuggestedCut}
                        onSeek={(seconds) => videoPlayerHandleRef.current?.seek(seconds)}
                        onCreateCutFromSelection={handleCreateCutFromTranscript}
                        onRequestTranscription={() => {
                          const validation = canStartOperation(activeVideo.job.job_id);
                          if (!validation.allowed) {
                            alert(validation.message);
                            return;
                          }
                          requestTranscriptionStart();
                        }}
                        isLoading={action.busy}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center p-8 text-center text-text-3 space-y-3">
                    <svg
                      className="w-12 h-12 text-white/20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                    >
                      <rect x="2" y="2" width="20" height="20" rx="4" />
                      <path d="M10 8l6 4-6 4V8z" fill="currentColor" stroke="none" />
                    </svg>
                    <p className="text-sm text-text-2 font-medium">Nenhum vídeo selecionado</p>
                    <p className="text-xs max-w-sm">
                      Selecione um vídeo na biblioteca lateral ou clique em "+ Importar Vídeo" para começar.
                    </p>
                  </div>
                )}
              </main>

              {/* Coluna 3: Inspetor do Short 9:16 */}
              <ShortInspectorView
                cut={selectedSuggestedCut}
                videoSrc={activeVideo?.videoPath ? `${apiBaseUrl}${activeVideo.videoPath}` : undefined}
                isRendering={isRendering}
                onAdjustStart={handleQuickAdjustStart}
                onAdjustEnd={handleQuickAdjustEnd}
                onRenderShort={() => {
                  if (!activeVideo) return;
                  const validation = canStartOperation(activeVideo.job.job_id);
                  if (!validation.allowed) {
                    alert(validation.message);
                    return;
                  }
                  startRenderFlow();
                }}
                onDiscardCut={(cutId) => requestDeleteSuggestedCut(cutId)}
              />
            </>
          )}

          {studioTab === "render-queue" && (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="max-w-4xl mx-auto space-y-6">
                <div className="flex items-center justify-between pb-4 border-b border-white/[0.08]">
                  <div>
                    <h2 className="text-base font-semibold text-white tracking-tight">Fila de Processamento & Batch</h2>
                    <p className="text-xs text-text-3 mt-0.5">Acompanhe tarefas em segundo plano, transcrição e renderização em lote.</p>
                  </div>
                  <GlassButton
                    variant="primary"
                    onClick={openBatchPipelineDialog}
                    leadingIcon={
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    }
                  >
                    Iniciar Processamento em Lote
                  </GlassButton>
                </div>

                {isBatchProcessing ? (
                  <GlassCard className="p-5 border-white/15 bg-[#0e0e14]/90 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse shadow-[0_0_8px_rgba(52,211,153,0.8)]" />
                        <span className="text-sm font-semibold text-white">Processamento em Lote Ativo</span>
                      </div>
                      <span className="font-mono text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 rounded-full">
                        Em andamento
                      </span>
                    </div>

                    {batchProcessingLogs.length > 0 && (
                      <div className="h-44 overflow-y-auto font-mono text-xs text-zinc-300 bg-black/60 p-3 rounded-xl border border-white/10 space-y-1">
                        {batchProcessingLogs.map((log, i) => (
                          <div key={i} className="leading-relaxed">{log}</div>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center justify-end gap-3 pt-2 border-t border-white/[0.06]">
                      <GlassButton
                        variant="danger"
                        size="sm"
                        onClick={cancelBatchPipelineDialog}
                        leadingIcon={
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        }
                      >
                        Cancelar Lote
                      </GlassButton>
                    </div>
                  </GlassCard>
                ) : (
                  <GlassCard className="p-8 border-white/10 bg-white/[0.02] text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-white/[0.05] border border-white/10 mx-auto flex items-center justify-center text-zinc-400">
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
                        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-white">Nenhum processamento em lote em execução</p>
                      <p className="text-xs text-zinc-400 mt-1 max-w-md mx-auto">
                        Inicie um lote para transcrever múltiplos vídeos, extrair blocos semânticos e gerar cortes sugeridos automaticamente.
                      </p>
                    </div>
                    <div className="pt-2">
                      <GlassButton
                        variant="glass"
                        size="sm"
                        onClick={openBatchPipelineDialog}
                        leadingIcon={
                          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                        }
                      >
                        Configurar Novo Lote
                      </GlassButton>
                    </div>
                  </GlassCard>
                )}
              </div>
            </div>
          )}

          {studioTab === "completed" && (
            <div className="flex-1 overflow-y-auto p-6">
              <div className="max-w-5xl mx-auto">
                <RenderingSection
                  isLoadingRenderOutputs={isLoadingRenderOutputs}
                  isRendering={isRendering}
                  renderOutputs={renderOutputs}
                  renderTitlesByFileName={renderTitlesByFileName}
                  buildRenderUrl={buildRenderUrl}
                  onOpenRenderFolder={openRenderOutputFolder}
                  onDeleteRender={deleteRenderOutputFile}
                  isExpanded={true}
                  onToggle={() => {}}
                />
              </div>
            </div>
          )}
        </div>
      </GlassWindow>

      {/* Modal de Importação de Vídeo em Liquid Glass */}
      {showUploadModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md"
          onClick={() => setShowUploadModal(false)}
        >
          <div
            className="w-full max-w-xl rounded-2xl border border-white/15 bg-[#0f0f14]/90 p-6 shadow-2xl space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between pb-2 border-b border-white/10">
              <h2 className="text-sm font-semibold text-white">Importar Novo Vídeo</h2>
              <button
                onClick={() => setShowUploadModal(false)}
                className="text-text-3 hover:text-white text-xs"
              >
                Fechar
              </button>
            </div>

            <UploadSection
              action={action}
              onVideoAdded={(video) => {
                upsertVideoIntoList(video);
                setActiveVideoId(video.job.job_id);
                setShowUploadModal(false);
              }}
              onLoadVideos={loadVideos}
              appSettings={appSettings}
              onShowMoveUploadDialog={() => {
                setDontAskMoveUpload(false);
                setShowMoveUploadDialog(true);
              }}
              isExpanded={true}
              onToggle={() => {}}
            />
          </div>
        </div>
      )}

      {/* Toast Notification estilo Apple */}
      {toastNotification && (
        <GlassToast
          message={toastNotification}
          onClose={() => setToastNotification(null)}
          duration={3000}
        />
      )}
      <AppSupportDialogs
        showTranscriptionRegenerateConfirmDialog={showTranscriptionRegenerateConfirmDialog}
        showDeleteCutConfirmDialog={showDeleteCutConfirmDialog}
        showHowToUseDialog={showHowToUseDialog}
        dontAskDeleteCutAgain={dontAskDeleteCutAgain}
        onCloseTranscriptionRegenerateConfirm={() =>
          closeTranscriptionRegenerateConfirm()
        }
        onConfirmTranscriptionRegenerate={() => void confirmTranscriptionRegenerate()}
        onCloseDeleteCutConfirm={closeDeleteCutConfirmDialog}
        onConfirmDeleteCut={() => void confirmDeleteSuggestedCut()}
        onDontAskDeleteCutAgainChange={setDontAskDeleteCutAgain}
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

      {/* Blocks Dialog */}
      {showBlocksDialog && blocks.length > 0 && (
        <BlocksDialog blocks={blocks} onClose={() => setShowBlocksDialog(false)} />
      )}

      {/* AI Response Dialog */}
      {showAiResponseDialog && aiResponseRaw && (
        <AiResponseDialog
          aiResponseRaw={aiResponseRaw}
          onClose={() => setShowAiResponseDialog(false)}
        />
      )}

      {/* Regenerate Analyze Dialog */}
      {showRegenerateAnalyzeDialog && suggestedCuts.length > 0 && activeVideo && (
        <RegenerateAnalyzeDialog
          suggestedCuts={suggestedCuts}
          action={{ busy: isAnalyzing }}
          onCancel={() => setShowRegenerateAnalyzeDialog(false)}
          onMaintainSelected={(keptCutIds) => {
            const keptCuts = suggestedCuts.filter((cut) => keptCutIds.includes(cut.cut_id));
            setShowRegenerateAnalyzeDialog(false);
            runAction(
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
            runAction(
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

      {/* 4. Rendering Section */}
      <RenderingSection
        isLoadingRenderOutputs={isLoadingRenderOutputs}
        isRendering={isRendering}
        renderOutputs={renderOutputs}
        renderTitlesByFileName={renderTitlesByFileName}
        buildRenderUrl={buildRenderUrl}
        onOpenRenderFolder={openRenderOutputFolder}
        onDeleteRender={deleteRenderOutputFile}
        isExpanded={expandRenderingSection}
        onToggle={() => setExpandRenderingSection((current) => !current)}
      />

      {/* LLM Config Dialog */}
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
          onRegisterModel={registerNewOllamaModel}
          onRemoveModel={removeRegisteredOllamaModel}
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
      {/* Whisper Config Dialog */}
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

      {/* Dependencies Dialog */}
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
            runAction(
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
                getSettings().then((s) => {
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
        onRenameChange={(name) => setRenameVideoNewName(name)}
        onRenameClose={() => {
          setRenameVideoId(null);
          setRenameVideoNewName("");
        }}
        onRenameSave={() => {
          if (renameVideoNewName.trim()) {
            runAction(
              () => renameVideo(renameVideoId!, renameVideoNewName),
              () => {
                setRenameVideoId(null);
                setRenameVideoNewName("");
                loadVideos();
              },
            );
          }
        }}
        showMoveUploadDialog={showMoveUploadDialog}
        dontAskMoveUpload={dontAskMoveUpload}
        onDontAskChange={(value) => setDontAskMoveUpload(value)}
        onMoveUploadClose={() => setShowMoveUploadDialog(false)}
        onMoveUploadDecision={handleMoveUploadDecision}
        showBatchCompletionNotification={showBatchCompletionNotification}
        batchCompletionMessage={batchCompletionMessage}
        onBatchCompletionClose={closeBatchCompletionNotification}
      />

      {action.error && <div className="toast error">{action.error}</div>}
    </div>
  );
}
