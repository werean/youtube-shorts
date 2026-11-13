import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AttemptDetail,
  AttemptSummary,
  Cut,
  Job,
  JobStatus,
  Segment,
  VideoItem,
  VideoRecord,
} from "./types";
import { recordToVideoItem } from "./utils/videoHelpers";
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
  archiveJobAttempt,
  archiveVideo,
  buildBlocks,
  cancelJob,
  cancelRendering,
  cancelTranscription,
  createJob,
  deleteJobAttempt,
  deleteVideo,
  getJob,
  getJobAttempt,
  ingestJob,
  listArchivedVideos,
  listJobAttempts,
  listVideos,
  openVideoFolder,
  renameVideo,
  runJobPipeline,
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
import { cn } from "./lib/utils";
import { GlassWindow, GlassToast, GlassToastContainer, GlassCard, GlassButton } from "./components/ui/glass";
import {
  StudioTopbar,
  type StudioTab,
  VideoLibrarySidebar,
  type WorkspaceVideoItem,
  VideoPlayerView,
  type VideoPlayerViewHandle,
  TranscriptInteractiveView,
  ShortInspectorView,
  TerminalLogsView,
  LiveTaskFeedbackCard,
} from "./components/workspace";
import { getTranscription } from "./api/transcription";

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

const STATUS_DESCRIPTIONS: Record<string, string> = {
  CREATED: "Vídeo criado",
  DOWNLOADING: "Baixando vídeo fonte via yt-dlp",
  DOWNLOADED: "Pronto para processar",
  TRANSCRIBING: "Transcrevendo áudio na GPU (Whisper + VAD)",
  BUILDING_BLOCKS: "Construindo blocos semânticos e prosódicos",
  BUILDING_TOPICS: "Segmentando tópicos contextuais (TextTiling)",
  ANALYZING: "Minerando cortes virais via IA (LLM)",
  WAITING_APPROVAL: "Aguardando aprovação de cortes",
  RENDERING: "Renderizando Shorts 9:16 (NVENC)",
  DONE: "Processamento concluído com sucesso",
  ERROR: "Erro durante o processamento",
};

function formatEtaSeconds(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || seconds < 0) return "";
  if (seconds < 60) return `~${Math.round(seconds)}s restantes`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `~${mins}m ${secs}s restantes`;
}

function formatTimestampForFilename(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(mins).padStart(2, "0")}_${String(secs).padStart(2, "0")}`;
}

function buildCutFilenameFromRange(start: number, end: number): string {
  return `${formatTimestampForFilename(start)}-${formatTimestampForFilename(end)}.mp4`;
}

function toCatchyTitle(cut: Cut): string {
  const base = String(cut.title || "")
    .replace(/\s+/g, " ")
    .replace(/[.]+$/g, "")
    .trim();

  if (!base) {
    return "Corte em destaque";
  }

  if (base.length <= 72) {
    return base;
  }

  return `${base.slice(0, 69).trimEnd()}...`;
}

function normalizeArchivedRenderPath(jobId: string, attemptId: string, path: string): string {
  const trimmed = String(path || "").trim();
  if (!trimmed) return "";
  if (
    trimmed.startsWith("http://") ||
    trimmed.startsWith("https://") ||
    trimmed.startsWith("/")
  ) {
    return trimmed;
  }
  return `/media/shorts/${encodeURIComponent(jobId)}/attempts/${encodeURIComponent(attemptId)}/${encodeURIComponent(trimmed)}`;
}

function formatAttemptTimestamp(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function App() {
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
  const [expandTerminalSection, setExpandTerminalSection] = useState(true);
  const [expandTranscriptSection, setExpandTranscriptSection] = useState(true);
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
    approveSingleCut,
    rejectSingleCut,
    approveAllSuggestedCuts,
    rejectAllSuggestedCuts,
  } = useCutsWorkflow({
    activeJobId: activeVideo?.job.job_id ?? null,
    appSettings,
    showAiResponseOnAnalyze,
    runAction,
    onAppSettingsUpdated: setAppSettings,
    onAiResponseRawChange: setAiResponseRaw,
    onShowAiResponseDialogChange: setShowAiResponseDialog,
    onRefreshVideo: refreshVideo,
    onPausePlayback: () => {
      videoPlayerHandleRef.current?.pause();
    },
    onSeekAndPlay: (seconds) => {
      if (videoPlayerHandleRef.current) {
        videoPlayerHandleRef.current.seek(seconds);
        void videoPlayerHandleRef.current.play();
      }
    },
  });

  const [is1ClickRunning, setIs1ClickRunning] = useState(false);
  const pipelineIncludeRenderRef = useRef<boolean>(true);
  const [attemptsByJobId, setAttemptsByJobId] = useState<Record<string, AttemptSummary[]>>({});
  const [attemptsCountByJobId, setAttemptsCountByJobId] = useState<Record<string, number>>({});
  const [loadingAttemptsByJobId, setLoadingAttemptsByJobId] = useState<Record<string, boolean>>({});
  const [archivingJobId, setArchivingJobId] = useState<string | null>(null);
  const [inspectingAttempt, setInspectingAttempt] = useState<{
    jobId: string;
    attemptId: string;
    detail: AttemptDetail;
  } | null>(null);
  const [selectedArchivedCutId, setSelectedArchivedCutId] = useState<string | null>(null);
  const [isLoadingAttemptDetail, setIsLoadingAttemptDetail] = useState(false);

  const {
    progress,
    etaSeconds,
    currentMessage,
    jobStatus: sseJobStatus,
    logs: sseLogs,
    resetProgress,
  } = useJobEvents(activeVideoId, (newStatus) => {
    const normalizedStatus = String(newStatus).replace(/^JobStatus\./i, "").toUpperCase() as JobStatus;
    console.log(`[SSE] Status alterado para ${activeVideoId}: ${normalizedStatus}`);
    if (activeVideoId) {
      updateVideo(activeVideoId, {
        job: {
          ...(videos.find((v) => v.job.job_id === activeVideoId)?.job ?? {
            job_id: activeVideoId,
            youtube_url: "",
            status: normalizedStatus,
            created_at: new Date().toISOString(),
          }),
          status: normalizedStatus,
        },
        isTranscribing: normalizedStatus === "TRANSCRIBING",
      });

      if (normalizedStatus === "WAITING_APPROVAL") {
        void loadCutsForActiveJob(activeVideoId);
        void refreshVideo(activeVideoId);
        if (!pipelineIncludeRenderRef.current) {
          setIs1ClickRunning(false);
          setToastNotification(
            "Cortes prontos! Revise, aprove ou recuse no menu à direita antes de renderizar.",
          );
          void loadVideos();
        }
      }
      if (normalizedStatus === "DONE") {
        void loadCutsForActiveJob(activeVideoId);
        void refreshRenderOutputs(activeVideoId);
        void refreshVideo(activeVideoId);
      }
      if (normalizedStatus === "DOWNLOADED" || normalizedStatus === "DONE" || normalizedStatus === "ERROR") {
        setIs1ClickRunning(false);
        pipelineIncludeRenderRef.current = true;
        void refreshVideo(activeVideoId);
        void loadVideos();
      }
    }
  });

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
    persistCuts: async (jobId, cutsToPersist) => {
      await updateCuts(jobId, cutsToPersist);
    },
    seekTo: (seconds) => {
      if (videoPlayerHandleRef.current) {
        videoPlayerHandleRef.current.seek(seconds);
        void videoPlayerHandleRef.current.play();
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
    refreshRenderOutputs,
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
  const rawActiveStatus = (activeVideoId && sseJobStatus) ? sseJobStatus : activeVideo?.job.status;
  const activeStatus = rawActiveStatus ? String(rawActiveStatus).replace(/^JobStatus\./i, "").toUpperCase() : "";

  const isVideoProcessing = [
    "DOWNLOADING",
    "TRANSCRIBING",
    "BUILDING_BLOCKS",
    "BUILDING_TOPICS",
    "ANALYZING",
    "RENDERING",
  ].includes(activeStatus || "");

  const isAnyOperationRunning =
    isVideoProcessing ||
    is1ClickRunning ||
    isRendering ||
    Boolean(activeVideo?.isTranscribing) ||
    isIngesting ||
    action.busy;

  const isInspectingArchive = Boolean(
    inspectingAttempt && inspectingAttempt.jobId === activeVideoId,
  );

  const archivedCuts = useMemo(() => {
    if (!isInspectingArchive || !inspectingAttempt) return [];
    return inspectingAttempt.detail.cuts || [];
  }, [isInspectingArchive, inspectingAttempt]);

  const selectedArchivedCut = useMemo(() => {
    if (!isInspectingArchive || !archivedCuts.length) return null;
    return archivedCuts.find((c) => c.cut_id === selectedArchivedCutId) || archivedCuts[0];
  }, [isInspectingArchive, archivedCuts, selectedArchivedCutId]);

  const archivedSegments: Segment[] = useMemo(() => {
    if (!isInspectingArchive || !inspectingAttempt) return [];
    const rawSegs = inspectingAttempt.detail.transcription?.segments || [];
    return rawSegs.map((s, idx) => ({
      segment_id: String(s.segment_id || `arch_seg_${idx}`),
      start: Number(s.start) || 0,
      end: Number(s.end) || 0,
      text: String(s.text || "").trim(),
    }));
  }, [isInspectingArchive, inspectingAttempt]);

  const archivedRenderOutputs = useMemo(() => {
    if (!isInspectingArchive || !inspectingAttempt) return [];
    const raw =
      inspectingAttempt.detail.renders && inspectingAttempt.detail.renders.length > 0
        ? inspectingAttempt.detail.renders
        : inspectingAttempt.detail.attempt.rendered_urls || [];
    return raw
      .map((item) =>
        normalizeArchivedRenderPath(inspectingAttempt.jobId, inspectingAttempt.attemptId, item),
      )
      .filter(Boolean);
  }, [isInspectingArchive, inspectingAttempt]);

  const archivedRenderTitlesByFileName = useMemo(() => {
    const next: Record<string, string> = {};
    for (const cut of archivedCuts) {
      const filename = buildCutFilenameFromRange(cut.start, cut.end);
      next[filename] = toCatchyTitle(cut);
    }
    return next;
  }, [archivedCuts]);

  const effectiveCuts = isInspectingArchive ? archivedCuts : suggestedCuts;
  const effectiveSelectedCut = isInspectingArchive ? selectedArchivedCut : selectedSuggestedCut;
  const effectiveSelectedCutId = isInspectingArchive
    ? (selectedArchivedCutId && archivedCuts.some((c) => c.cut_id === selectedArchivedCutId)
        ? selectedArchivedCutId
        : null)
    : selectedSuggestedCutId;
  const effectiveSegments = isInspectingArchive
    ? archivedSegments
    : activeVideo?.transcriptionSegments || [];
  const effectiveRenderOutputs = isInspectingArchive ? archivedRenderOutputs : renderOutputs;
  const effectiveRenderTitlesByFileName = isInspectingArchive
    ? archivedRenderTitlesByFileName
    : renderTitlesByFileName;

  const workspaceVideos: WorkspaceVideoItem[] = useMemo(() => {
    return videos.map((v) => {
      const jobId = v.job.job_id;
      const isCurrentActive = jobId === activeVideoId;
      const cutsCount = isCurrentActive ? suggestedCuts.length : 0;
      const rawStatus = isCurrentActive && sseJobStatus ? sseJobStatus : v.job.status;
      const status = rawStatus ? String(rawStatus).replace(/^JobStatus\./i, "").toUpperCase() : "";
      const isProcessing = [
        "DOWNLOADING",
        "TRANSCRIBING",
        "BUILDING_BLOCKS",
        "BUILDING_TOPICS",
        "ANALYZING",
        "RENDERING",
      ].includes(status);
      const hasTranscriptionContent = Boolean(
        v.hasTranscription ||
          v.transcription ||
          (v.transcriptionSegments && v.transcriptionSegments.length > 0),
      );
      const hasActiveContent = Boolean(
        hasTranscriptionContent ||
          v.hasAnalysis ||
          (isCurrentActive && (suggestedCuts.length > 0 || renderOutputs.length > 0)) ||
          status === "WAITING_APPROVAL" ||
          status === "DONE",
      );
      const attemptsCount =
        attemptsCountByJobId[jobId] ??
        attemptsByJobId[jobId]?.length ??
        v.attemptsCount ??
        0;

      return {
        id: jobId,
        title: String(v.job.video_name || v.job.youtube_url || "Vídeo sem título").trim(),
        durationSeconds: v.job.video_duration_seconds ?? null,
        cutsCount,
        status,
        isProcessing,
        attemptsCount,
        canArchive: !isProcessing && hasActiveContent,
      };
    });
  }, [
    videos,
    activeVideoId,
    suggestedCuts,
    sseJobStatus,
    renderOutputs.length,
    attemptsCountByJobId,
    attemptsByJobId,
  ]);

  async function loadAttemptsForJob(jobId: string) {
    setLoadingAttemptsByJobId((prev) => ({ ...prev, [jobId]: true }));
    try {
      const list = await listJobAttempts(jobId);
      setAttemptsByJobId((prev) => ({ ...prev, [jobId]: list }));
      setAttemptsCountByJobId((prev) => ({ ...prev, [jobId]: list.length }));
    } catch (error) {
      console.error("[UI] Falha ao carregar tentativas arquivadas:", error);
    } finally {
      setLoadingAttemptsByJobId((prev) => ({ ...prev, [jobId]: false }));
    }
  }

  function handleExitArchivedInspection() {
    setInspectingAttempt(null);
    setSelectedArchivedCutId(null);
  }

  async function handleSelectArchivedAttempt(jobId: string, attemptId: string) {
    if (activeVideoId !== jobId) {
      const validation = canStartOperation(jobId);
      if (!validation.allowed) {
        alert(validation.message);
        return;
      }
    }

    setIsLoadingAttemptDetail(true);
    try {
      const detail = await getJobAttempt(jobId, attemptId);
      if (activeVideoId !== jobId) {
        setActiveVideoId(jobId);
      }
      setInspectingAttempt({ jobId, attemptId, detail });
      setSelectedArchivedCutId(detail.cuts?.[0]?.cut_id ?? null);
      videoPlayerHandleRef.current?.pause();
    } catch (error: unknown) {
      console.error("[UI] Erro ao carregar tentativa arquivada:", error);
      const msg = error instanceof Error ? error.message : "Falha ao carregar tentativa arquivada";
      setAction({ busy: false, error: msg });
    } finally {
      setIsLoadingAttemptDetail(false);
    }
  }

  async function handleArchiveAttempt(jobId: string, resetActive: boolean) {
    const targetVideo = videos.find((v) => v.job.job_id === jobId);
    const targetStatus = String(targetVideo?.job.status || "")
      .replace(/^JobStatus\./i, "")
      .toUpperCase();
    const isTargetProcessing = [
      "DOWNLOADING",
      "TRANSCRIBING",
      "BUILDING_BLOCKS",
      "BUILDING_TOPICS",
      "ANALYZING",
      "RENDERING",
    ].includes(targetStatus);

    if (isTargetProcessing || (jobId === activeVideoId && isAnyOperationRunning)) {
      setToastNotification("Aguarde ou cancele o processamento antes de arquivar.");
      return;
    }

    setArchivingJobId(jobId);
    try {
      const result = await archiveJobAttempt(jobId, { reset_active: resetActive });
      setAttemptsByJobId((prev) => ({ ...prev, [jobId]: result.attempts }));
      setAttemptsCountByJobId((prev) => ({ ...prev, [jobId]: result.attempts.length }));

      if (resetActive) {
        updateVideo(jobId, {
          job: result.job,
          hasTranscription: false,
          transcription: "",
          transcriptionSegments: [],
          transcriptionFormats: undefined,
          attemptsCount: result.attempts.length,
        });

        if (jobId === activeVideoId) {
          clearCuts();
          clearRenderOutputs();
          setBlocks([]);
          setAiResponseRaw(null);
          setShowAiResponseDialog(false);
          handleExitArchivedInspection();
          resetProgress();
        } else if (inspectingAttempt?.jobId === jobId) {
          handleExitArchivedInspection();
        }

        setToastNotification(
          `Tentativa "${result.attempt.label}" arquivada! Workspace pronto em DOWNLOADED para nova tentativa.`,
        );
      } else {
        updateVideo(jobId, {
          job: result.job,
          attemptsCount: result.attempts.length,
        });
        setToastNotification(`Cópia "${result.attempt.label}" salva nos arquivados!`);
      }
    } catch (error: unknown) {
      console.error("[UI] Erro ao arquivar tentativa:", error);
      const msg = error instanceof Error ? error.message : "Falha ao arquivar tentativa";
      setAction({ busy: false, error: msg });
    } finally {
      setArchivingJobId(null);
    }
  }

  async function handleDeleteAttempt(jobId: string, attemptId: string) {
    try {
      const result = await deleteJobAttempt(jobId, attemptId);
      setAttemptsByJobId((prev) => ({ ...prev, [jobId]: result.attempts }));
      setAttemptsCountByJobId((prev) => ({ ...prev, [jobId]: result.attempts.length }));
      updateVideo(jobId, { attemptsCount: result.attempts.length });

      if (inspectingAttempt?.jobId === jobId && inspectingAttempt?.attemptId === attemptId) {
        handleExitArchivedInspection();
      }
      setToastNotification("Tentativa arquivada removida.");
    } catch (error: unknown) {
      console.error("[UI] Erro ao excluir tentativa arquivada:", error);
      const msg = error instanceof Error ? error.message : "Falha ao excluir tentativa arquivada";
      setAction({ busy: false, error: msg });
    }
  }

  async function handleStartNewAttemptFromBanner() {
    if (!activeVideo) return;
    const jobId = activeVideo.job.job_id;
    const activeItem = workspaceVideos.find((v) => v.id === jobId);

    if (activeItem?.isProcessing || isAnyOperationRunning) {
      setToastNotification("Aguarde ou cancele o processamento ativo antes de iniciar nova tentativa.");
      return;
    }

    if (activeItem?.canArchive) {
      await handleArchiveAttempt(jobId, true);
      return;
    }

    handleExitArchivedInspection();
    setToastNotification("Workspace ativo pronto em DOWNLOADED para iniciar nova tentativa.");
  }

  const sharedTaskLogs = useSharedTaskLogWorkflow({
    activeJobId: activeVideo?.job.job_id ?? null,
    isTranscribing: activeVideo?.isTranscribing,
    isRendering,
    isProcessing: Boolean(isAnyOperationRunning),
  });
  const {
    taskLogsContainerRef,
    activeTaskLogs,
    activeTaskLogType,
    appendLogLine,
    clearLogs,
  } = sharedTaskLogs;

  useEffect(() => {
    if (currentMessage) {
      appendLogLine(currentMessage);
    }
  }, [currentMessage, appendLogLine]);

  const statusLabel = useMemo(
    () => videos.find((v) => v.job.job_id === activeVideoId)?.job.status ?? "NENHUM VÍDEO",
    [videos, activeVideoId],
  );

  const showProgressBanner = Boolean(
    activeVideo &&
      (isVideoProcessing || is1ClickRunning) &&
      activeStatus !== "DOWNLOADED" &&
      activeStatus !== "ERROR" &&
      activeStatus !== "DONE",
  );

  const allLogs = useMemo(() => {
    const combined = [...activeTaskLogs];
    for (const log of sseLogs) {
      if (!combined.includes(log)) {
        combined.push(log);
      }
    }
    return combined.length > 0 ? combined : sseLogs;
  }, [activeTaskLogs, sseLogs]);

  async function handleRunPipeline(includeRender: boolean) {
    if (!activeVideoId) {
      setToastNotification("Selecione um vídeo na biblioteca primeiro.");
      return;
    }

    if (isInspectingArchive) {
      setToastNotification("Volte para a tentativa ativa para iniciar um processamento.");
      return;
    }

    const validation = canStartOperation(activeVideoId);
    if (!validation.allowed) {
      alert(validation.message);
      return;
    }

    pipelineIncludeRenderRef.current = includeRender;
    setIs1ClickRunning(true);
    try {
      setToastNotification(
        includeRender
          ? "Pipeline 1-Clique iniciado com sucesso!"
          : "Pipeline iniciado até curadoria (pausará antes de renderizar).",
      );
      await runJobPipeline(activeVideoId, { include_render: includeRender });
      await refreshVideo(activeVideoId);
    } catch (error: unknown) {
      console.error("[UI] Erro ao iniciar pipeline:", error);
      const message = error instanceof Error ? error.message : "Falha ao iniciar pipeline";
      setAction({ busy: false, error: message });
      setIs1ClickRunning(false);
      pipelineIncludeRenderRef.current = true;
    }
  }

  function handleRun1ClickPipeline() {
    void handleRunPipeline(true);
  }

  function handleRunCuratePipeline() {
    void handleRunPipeline(false);
  }

  async function handleDirectTranscribe(targetJobId?: string) {
    const jobId = targetJobId || activeVideoId;
    if (!jobId) {
      setToastNotification("Selecione um vídeo primeiro.");
      return;
    }

    if (isInspectingArchive && jobId === activeVideoId) {
      setToastNotification("Volte para a tentativa ativa para transcrever.");
      return;
    }

    const validation = canStartOperation(jobId);
    if (!validation.allowed) {
      alert(validation.message);
      return;
    }

    if (jobId !== activeVideoId) {
      handleExitArchivedInspection();
      setActiveVideoId(jobId);
    }

    setToastNotification("Iniciando transcrição de áudio (Whisper)...");
    requestTranscriptionStart();
  }

  async function handleDirectAnalyze(targetJobId?: string) {
    const jobId = targetJobId || activeVideoId;
    if (!jobId) {
      setToastNotification("Selecione um vídeo primeiro.");
      return;
    }

    if (isInspectingArchive && jobId === activeVideoId) {
      setToastNotification("Volte para a tentativa ativa para gerar cortes.");
      return;
    }

    const validation = canStartOperation(jobId);
    if (!validation.allowed) {
      alert(validation.message);
      return;
    }

    if (jobId !== activeVideoId) {
      handleExitArchivedInspection();
      setActiveVideoId(jobId);
    }

    const targetVideo = videos.find((v) => v.job.job_id === jobId);
    if (!targetVideo?.hasTranscription) {
      setToastNotification("É necessário transcrever o áudio antes de minerar os cortes.");
      return;
    }

    try {
      setIsAnalyzing(true);
      setToastNotification("Minerando cortes virais com IA...");
      const result = await analyzeJob(jobId);
      handleAnalyzeResult(result);
      await loadCutsForActiveJob(jobId);
      await refreshVideo(jobId);
      setToastNotification("Cortes minerados com sucesso!");
    } catch (err: any) {
      console.error("[UI] Erro ao minerar cortes com IA:", err);
      const msg = err?.message || "Falha ao minerar cortes com IA";
      setAction({ busy: false, error: msg });
    } finally {
      setIsAnalyzing(false);
    }
  }

  async function handleCancelActiveOperation() {
    if (!activeVideoId) return;
    console.log(`[UI] Cancelando operação ativa para ${activeVideoId}`);
    try {
      // 1. Aciona o cancelamento unificado do job no backend
      try {
        await cancelJob(activeVideoId);
      } catch (e) {
        console.warn("[UI] cancelJob fallback:", e);
      }

      // 2. Aciona cancelamentos específicos adicionais por garantia
      try {
        await cancelTranscription(activeVideoId);
      } catch {}
      try {
        await cancelRendering(activeVideoId);
      } catch {}

      // 3. Reseta estados visuais de loading do frontend imediatamente
      pipelineIncludeRenderRef.current = true;
      setIs1ClickRunning(false);
      setIsRendering(false);
      updateVideo(activeVideoId, {
        isTranscribing: false,
      });

      setToastNotification("Operação cancelada com sucesso.");
    } catch (err: any) {
      console.error("[UI] Erro ao cancelar cooperativamente:", err);
      setToastNotification("Falha ao cancelar operação.");
    } finally {
      setIs1ClickRunning(false);
      setIsRendering(false);
      resetProgress();
      if (activeVideoId) {
        await refreshVideo(activeVideoId);
        await loadVideos();
      }
    }
  }

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

  // Poll progressive render outputs during 1-click pipeline RENDERING stage
  useEffect(() => {
    if (!activeVideoId || activeStatus !== "RENDERING" || isRendering) return;
    void refreshRenderOutputs(activeVideoId);
    const intervalId = window.setInterval(() => {
      void refreshRenderOutputs(activeVideoId);
    }, 2000);
    return () => window.clearInterval(intervalId);
  }, [activeVideoId, activeStatus, isRendering]);

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
        setAttemptsCountByJobId((prev) => {
          const next = { ...prev };
          for (const record of active) {
            if (typeof record.attempts_count === "number") {
              next[record.job_id] = record.attempts_count;
            }
          }
          return next;
        });
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
    if (!jobId) {
      console.warn("[UI] Ignorando vídeo inválido (sem job_id)", video);
      return;
    }

    const rawTitle = String(
      video?.job?.video_name ??
      video?.job?.source_file_name ??
      video?.job?.youtube_url ??
      ""
    ).trim();
    const title = rawTitle || "Vídeo sem título";

    const videoPath = String(video?.videoPath ?? "").trim() || `/media/videos/${jobId}`;

    const normalized: VideoItem = {
      ...video,
      job: {
        ...video.job,
        video_name: title,
      },
      videoPath,
    };

    setVideos((current) => [normalized, ...current.filter((v) => v.job.job_id !== jobId)]);
    handleExitArchivedInspection();
    setActiveVideoId(jobId);
  }

  function setView(next: "active" | "archived") {
    setVideoView(next);
    setMenuOpenId(null);
    if (next === "archived") {
      handleExitArchivedInspection();
      setActiveVideoId(null);
    }
    if (next === "archived") {
      window.history.pushState({}, "", "/arquivados");
    } else {
      window.history.pushState({}, "", "/");
    }
  }

  useEffect(() => {
    if (activeVideoId) {
      const count = attemptsCountByJobId[activeVideoId];
      if (typeof count === "number" && count > 0 && !attemptsByJobId[activeVideoId]) {
        void loadAttemptsForJob(activeVideoId);
      }
    }
  }, [activeVideoId, attemptsCountByJobId]);

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

  return (
    <div className="h-[100dvh] w-[100dvw] bg-[#07080b] text-[#f5f5f7] flex flex-col overflow-hidden relative select-none">
      {/* Ambient Light Mesh Background */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
        <div className="absolute -top-32 -left-32 w-[460px] h-[460px] bg-blue-600/10 rounded-full blur-[140px]" />
        <div className="absolute top-1/3 -right-24 w-[480px] h-[480px] bg-indigo-500/10 rounded-full blur-[160px]" />
        <div className="absolute -bottom-24 left-1/4 w-[540px] h-[540px] bg-slate-300/5 rounded-full blur-[150px]" />
      </div>

      {/* Janela Unificada Liquid Glass Edge-to-Edge */}
      <GlassWindow className="w-full h-full flex flex-col">
        <StudioTopbar
          activeTab={studioTab}
          onTabChange={setStudioTab}
          activeVideoTitle={activeVideo ? String(activeVideo.job.video_name || activeVideo.job.youtube_url) : null}
          gpuStatus={isAnyOperationRunning ? "busy" : "online"}
          gpuLabel={isAnyOperationRunning ? (STATUS_DESCRIPTIONS[activeStatus || ""] ? (activeStatus || "PROCESSANDO") : "PROCESSANDO") : "GPU ONLINE"}
          onConfigureApp={() => setShowConfigureAppDialog(true)}
          onManageDependencies={() => setShowDependenciesDialog(true)}
          onConfigureLLM={() => setShowLLMConfigDialog(true)}
          onConfigureWhisper={() => setShowWhisperConfigDialog(true)}
          onConfigureFFmpeg={() => setShowFFmpegConfigDialog(true)}
          onShowHowToUse={() => setShowHowToUseDialog(true)}
          actions={
            <div className="flex items-center gap-2">
              {activeVideo && (
                <>
                  <GlassButton
                    variant="glass"
                    size="sm"
                    onClick={() => handleDirectTranscribe()}
                    disabled={isAnyOperationRunning || isInspectingArchive}
                    leadingIcon={
                      <svg className="w-3.5 h-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                      </svg>
                    }
                    className="text-xs font-medium border-white/10 hover:border-cyan-500/40 disabled:opacity-40"
                    title={
                      isInspectingArchive
                        ? "Volte para a tentativa ativa para transcrever"
                        : "Transcrever áudio deste vídeo com Whisper na GPU"
                    }
                  >
                    Transcrever
                  </GlassButton>

                  <GlassButton
                    variant="glass"
                    size="sm"
                    onClick={() => handleDirectAnalyze()}
                    disabled={isAnyOperationRunning || isInspectingArchive || !activeVideo.hasTranscription}
                    leadingIcon={
                      <svg className="w-3.5 h-3.5 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="6" cy="6" r="3" />
                        <circle cx="6" cy="18" r="3" />
                        <line x1="20" y1="4" x2="8.12" y2="15.88" />
                      </svg>
                    }
                    className="text-xs font-medium border-white/10 hover:border-amber-500/40 disabled:opacity-40"
                    title={
                      isInspectingArchive
                        ? "Volte para a tentativa ativa para gerar cortes"
                        : activeVideo.hasTranscription
                          ? "Minerar cortes narrativos com IA (LLM)"
                          : "Transcreva o áudio primeiro para habilitar a mineração de cortes"
                    }
                  >
                    Gerar Cortes
                  </GlassButton>

                  <GlassButton
                    variant="glass"
                    size="sm"
                    onClick={handleRunCuratePipeline}
                    disabled={isAnyOperationRunning || isInspectingArchive}
                    leadingIcon={
                      <svg className="w-3.5 h-3.5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                    }
                    className="text-xs font-medium border-white/10 hover:border-emerald-500/40 disabled:opacity-40"
                    title={
                      isInspectingArchive
                        ? "Volte para a tentativa ativa para gerar e revisar cortes"
                        : "Transcrever, gerar cortes e pausar para sua revisão antes de renderizar"
                    }
                  >
                    Gerar e Revisar
                  </GlassButton>

                  <GlassButton
                    variant="primary"
                    size="sm"
                    onClick={handleRun1ClickPipeline}
                    disabled={isAnyOperationRunning || isInspectingArchive}
                    leadingIcon={
                      isAnyOperationRunning ? (
                        <svg className="w-3.5 h-3.5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                      ) : (
                        <svg className="w-3.5 h-3.5 text-amber-300" viewBox="0 0 24 24" fill="currentColor">
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                        </svg>
                      )
                    }
                    className={cn(
                      "shadow-[0_0_16px_rgba(59,130,246,0.35)] hover:shadow-[0_0_24px_rgba(59,130,246,0.55)] transition-all font-semibold text-sm",
                      (isAnyOperationRunning || isInspectingArchive) && "opacity-60 cursor-not-allowed",
                    )}
                    title={
                      isInspectingArchive
                        ? "Volte para a tentativa ativa para iniciar o pipeline 1-Clique"
                        : undefined
                    }
                  >
                    {isAnyOperationRunning ? "Processando..." : "Gerar Shorts com 1-Clique"}
                  </GlassButton>
                </>
              )}
            </div>
          }
        />

        {/* Real-time SSE Progress Banner */}
        {showProgressBanner && (
          <div className="flex-none px-4 py-2.5 bg-gradient-to-r from-blue-950/80 via-[#0d1224]/90 to-[#07080b]/90 border-b border-blue-500/25 backdrop-blur-xl flex items-center justify-between gap-4 z-30 transition-all duration-300 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-3 min-w-0">
              <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-blue-500/20 border border-blue-400/30 flex-none">
                <div className="w-3 h-3 rounded-full bg-blue-400 animate-ping absolute" />
                <div className="w-2.5 h-2.5 rounded-full bg-blue-400" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-xs tracking-wide uppercase text-blue-300">
                    {STATUS_DESCRIPTIONS[activeStatus || ""] || activeStatus || "Processando"}
                  </span>
                  {etaSeconds !== null && etaSeconds !== undefined && etaSeconds > 0 && (
                    <span className="text-xs font-mono font-medium text-cyan-300 bg-cyan-950/60 px-2.5 py-0.5 rounded-md border border-cyan-500/30">
                      {formatEtaSeconds(etaSeconds)}
                    </span>
                  )}
                </div>
                {currentMessage && (
                  <p className="text-xs text-zinc-200 truncate max-w-md sm:max-w-xl mt-0.5">
                    {currentMessage}
                  </p>
                )}
              </div>
            </div>

            {/* Barra de Progresso + % e Botão de Cancelar Cooperativo */}
            <div className="flex items-center gap-4 flex-none">
              <div className="flex items-center gap-2.5">
                <div className="w-28 sm:w-48 h-2 rounded-full bg-white/10 overflow-hidden border border-white/10 relative">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 transition-all duration-300 ease-out"
                    style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
                  />
                </div>
                <span className="font-mono text-sm font-bold text-white min-w-[3rem] text-right">
                  {progress.toFixed(0)}%
                </span>
              </div>

              <GlassButton
                variant="danger"
                size="sm"
                onClick={handleCancelActiveOperation}
                leadingIcon={
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                }
              >
                Cancelar
              </GlassButton>
            </div>
          </div>
        )}

        {/* Banner de Inspeção de Tentativa Arquivada (Somente Leitura) */}
        {isInspectingArchive && inspectingAttempt && (
          <div className="flex-none px-4 py-2.5 bg-gradient-to-r from-amber-950/80 via-[#1c1608]/90 to-[#0c0c0e]/95 border-b border-amber-400/30 backdrop-blur-xl flex flex-wrap items-center justify-between gap-3 z-30 shadow-[0_4px_20px_rgba(0,0,0,0.4)]">
            <div className="flex items-center gap-3 min-w-0 flex-wrap">
              <div className="flex items-center gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-200">
                <svg
                  className="w-3.5 h-3.5 text-amber-300 flex-shrink-0"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polyline points="21 8 21 21 3 21 3 8" />
                  <rect x="1" y="3" width="22" height="5" />
                  <line x1="10" y1="12" x2="14" y2="12" />
                </svg>
                <span>Tentativa Arquivada: {inspectingAttempt.detail.attempt.label}</span>
              </div>

              <div className="flex items-center gap-2 text-xs text-zinc-300 flex-wrap">
                {formatAttemptTimestamp(
                  inspectingAttempt.detail.attempt.archived_at ||
                    inspectingAttempt.detail.attempt.created_at,
                ) && (
                  <span className="text-zinc-400">
                    {formatAttemptTimestamp(
                      inspectingAttempt.detail.attempt.archived_at ||
                        inspectingAttempt.detail.attempt.created_at,
                    )}
                  </span>
                )}
                <span className="rounded bg-white/[0.06] border border-white/[0.08] px-2 py-0.5 text-[11px]">
                  {archivedCuts.length} {archivedCuts.length === 1 ? "corte" : "cortes"}
                </span>
                <span className="rounded bg-emerald-500/10 border border-emerald-500/25 px-2 py-0.5 text-[11px] text-emerald-300">
                  {archivedRenderOutputs.length}{" "}
                  {archivedRenderOutputs.length === 1 ? "render" : "renders"}
                </span>
                <span className="rounded bg-zinc-800/80 border border-white/10 px-2 py-0.5 text-[11px] text-zinc-300">
                  Somente leitura
                </span>
              </div>

              {studioTab === "workspace" && archivedCuts.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap">
                  {archivedCuts.map((cut, idx) => {
                    const isCutActive = cut.cut_id === effectiveSelectedCutId;
                    return (
                      <button
                        key={cut.cut_id}
                        type="button"
                        onClick={() => {
                          setSelectedArchivedCutId(cut.cut_id);
                          videoPlayerHandleRef.current?.seek(cut.start);
                          void videoPlayerHandleRef.current?.play();
                        }}
                        title={
                          cut.title ||
                          `Corte ${idx + 1} (${formatTimestamp(cut.start)} - ${formatTimestamp(cut.end)})`
                        }
                        className={cn(
                          "rounded-md border px-2 py-0.5 text-[11px] font-medium transition-colors",
                          isCutActive
                            ? "border-amber-400/50 bg-amber-400/20 text-amber-200"
                            : "border-white/10 bg-white/[0.04] text-zinc-300 hover:border-amber-400/30 hover:text-white",
                        )}
                      >
                        #{idx + 1} · {formatTimestamp(cut.start)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 flex-none">
              <GlassButton
                variant="glass"
                size="sm"
                onClick={handleExitArchivedInspection}
                className="text-xs border-white/15 hover:border-white/30"
              >
                Voltar para tentativa ativa
              </GlassButton>
              <GlassButton
                variant="primary"
                size="sm"
                disabled={archivingJobId === activeVideoId || isAnyOperationRunning}
                onClick={() => void handleStartNewAttemptFromBanner()}
                className="text-xs"
              >
                {archivingJobId === activeVideoId ? "Preparando..." : "Iniciar nova tentativa"}
              </GlassButton>
            </div>
          </div>
        )}

        <div className="flex-1 flex overflow-hidden @container/workspace">
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
                  handleExitArchivedInspection();
                  setActiveVideoId(id);
                }}
                onImportClick={() => setShowUploadModal(true)}
                onTranscribeVideo={(id) => handleDirectTranscribe(id)}
                onGenerateCuts={(id) => handleDirectAnalyze(id)}
                attemptsByVideoId={attemptsByJobId}
                loadingAttemptsByVideoId={loadingAttemptsByJobId}
                selectedAttemptKey={
                  isInspectingArchive && inspectingAttempt
                    ? { jobId: inspectingAttempt.jobId, attemptId: inspectingAttempt.attemptId }
                    : null
                }
                onToggleAttemptsDrawer={(videoId, expanded) => {
                  if (expanded) {
                    void loadAttemptsForJob(videoId);
                  }
                }}
                onSelectAttempt={(jobId, attemptId) => void handleSelectArchivedAttempt(jobId, attemptId)}
                onArchiveAndReset={(jobId) => void handleArchiveAttempt(jobId, true)}
                onArchiveCopy={(jobId) => void handleArchiveAttempt(jobId, false)}
                onDeleteAttempt={(jobId, attemptId) => void handleDeleteAttempt(jobId, attemptId)}
                archivingVideoId={archivingJobId}
              />

              {/* Coluna 2: Player, Terminal de Logs e Transcrição Interativa com Painéis Estruturados e Colapsáveis */}
              <main className="flex-1 flex flex-col min-w-0 overflow-hidden p-[clamp(0.5rem,1.2cqi,0.75rem)] gap-[clamp(0.5rem,1.2cqi,0.75rem)]">
                {/* 1. Card do Player de Vídeo Master 16:9 */}
                <div
                  className={cn(
                    "flex flex-col min-h-0 overflow-hidden transition-all duration-300",
                    expandVideoPlayerSection && expandTranscriptSection
                      ? "flex-1 min-h-[160px]"
                      : expandVideoPlayerSection && !expandTranscriptSection
                        ? "flex-1 h-full min-h-[220px]"
                        : "h-auto flex-none",
                  )}
                >
                  <VideoPlayerView
                    ref={videoPlayerHandleRef}
                    className="h-full flex flex-col justify-between"
                    src={activeVideo?.videoPath ? `${apiBaseUrl}${activeVideo.videoPath}` : undefined}
                    title={activeVideo?.job.video_name || activeVideo?.job.youtube_url}
                    status={activeStatus}
                    archiveLabel={
                      isInspectingArchive && inspectingAttempt
                        ? inspectingAttempt.detail.attempt.label
                        : null
                    }
                    cuts={effectiveCuts}
                    selectedCutId={effectiveSelectedCutId}
                    onSelectCut={(cutId) => {
                      if (isInspectingArchive) {
                        const found = archivedCuts.find((c) => c.cut_id === cutId);
                        if (found) {
                          setSelectedArchivedCutId(found.cut_id);
                          videoPlayerHandleRef.current?.seek(found.start);
                          void videoPlayerHandleRef.current?.play();
                        }
                        return;
                      }
                      const found = suggestedCuts.find((c) => c.cut_id === cutId);
                      if (found) selectSuggestedCut(found);
                    }}
                    onClearSelectedCut={() => {
                      if (isInspectingArchive) {
                        setSelectedArchivedCutId(null);
                        return;
                      }
                      clearSelectedSuggestedCut();
                    }}
                    onTimeUpdate={setCurrentVideoTime}
                    isExpanded={expandVideoPlayerSection}
                    onToggleExpanded={() => setExpandVideoPlayerSection((prev) => !prev)}
                  />
                </div>

                {/* 2. Card de Feedback em Tempo Real Durante Processamento (Liquid Glass com Ponto Pulsante, ETA, Barra e Mini Console) */}
                {(isVideoProcessing || is1ClickRunning) && (
                  <div className="flex-none transition-all duration-300">
                    <LiveTaskFeedbackCard
                      status={activeStatus}
                      progress={progress}
                      etaSeconds={etaSeconds}
                      currentMessage={currentMessage}
                      logs={allLogs}
                      onCancel={handleCancelActiveOperation}
                      isExpanded={expandTerminalSection}
                      onToggleExpanded={() => setExpandTerminalSection((prev) => !prev)}
                    />
                  </div>
                )}

                {/* 3. Card de Terminal / Logs de Execução Histórico (Abaixo do Vídeo e Acima da Transcrição) */}
                {!(isVideoProcessing || is1ClickRunning) && (
                  <div className="flex-none transition-all duration-300">
                    <TerminalLogsView
                      logs={allLogs}
                      activeTask={activeTaskLogType || (is1ClickRunning ? "1-Clique" : isRendering ? "Render" : activeVideo?.isTranscribing ? "Whisper" : null)}
                      isProcessing={Boolean(isAnyOperationRunning)}
                      isExpanded={expandTerminalSection}
                      onToggleExpanded={() => setExpandTerminalSection((prev) => !prev)}
                      onClearLogs={clearLogs}
                    />
                  </div>
                )}

                {/* 3. Card de Transcrição Interativa */}
                <div
                  className={cn(
                    "flex flex-col min-h-0 overflow-hidden transition-all duration-300",
                    expandVideoPlayerSection && expandTranscriptSection
                      ? "flex-1 min-h-[160px]"
                      : !expandVideoPlayerSection && expandTranscriptSection
                        ? "flex-1 h-full min-h-[220px]"
                        : "h-auto flex-none",
                  )}
                >
                  <TranscriptInteractiveView
                    segments={effectiveSegments}
                    currentTime={currentVideoTime}
                    activeCut={effectiveSelectedCut}
                    onSeek={(seconds) => videoPlayerHandleRef.current?.seek(seconds)}
                    onCreateCutFromSelection={
                      isInspectingArchive ? undefined : handleCreateCutFromTranscript
                    }
                    onRequestTranscription={
                      isInspectingArchive ? undefined : () => handleDirectTranscribe()
                    }
                    onGenerateCuts={
                      isInspectingArchive ? undefined : () => handleDirectAnalyze()
                    }
                    isLoading={
                      isInspectingArchive
                        ? isLoadingAttemptDetail
                        : action.busy || isAnalyzing
                    }
                    isExpanded={expandTranscriptSection}
                    onToggleExpanded={() => setExpandTranscriptSection((prev) => !prev)}
                  />
                </div>
              </main>

              {/* Coluna 3: Inspetor do Short 9:16 */}
              <ShortInspectorView
                cut={effectiveSelectedCut}
                cuts={effectiveCuts}
                videoSrc={activeVideo?.videoPath ? `${apiBaseUrl}${activeVideo.videoPath}` : undefined}
                renderOutputs={effectiveRenderOutputs}
                renderTitlesByFileName={effectiveRenderTitlesByFileName}
                buildRenderUrl={buildRenderUrl}
                readOnly={isInspectingArchive}
                isRendering={isInspectingArchive ? false : isRendering}
                onSelectCut={(cutId) => {
                  if (isInspectingArchive) {
                    const found = archivedCuts.find((c) => c.cut_id === cutId);
                    if (found) {
                      setSelectedArchivedCutId(found.cut_id);
                      videoPlayerHandleRef.current?.seek(found.start);
                      void videoPlayerHandleRef.current?.play();
                    }
                    return;
                  }
                  const found = suggestedCuts.find((c) => c.cut_id === cutId);
                  if (found) selectSuggestedCut(found);
                }}
                onAdjustStart={isInspectingArchive ? undefined : handleQuickAdjustStart}
                onAdjustEnd={isInspectingArchive ? undefined : handleQuickAdjustEnd}
                onApproveCut={
                  isInspectingArchive ? undefined : (cutId) => void approveSingleCut(cutId)
                }
                onRejectCut={
                  isInspectingArchive ? undefined : (cutId) => void rejectSingleCut(cutId)
                }
                onApproveAllCuts={
                  isInspectingArchive ? undefined : () => void approveAllSuggestedCuts()
                }
                onRejectAllCuts={
                  isInspectingArchive ? undefined : () => void rejectAllSuggestedCuts()
                }
                onRenderApprovedCuts={
                  isInspectingArchive
                    ? undefined
                    : () => {
                        if (!activeVideo) return;
                        const validation = canStartOperation(activeVideo.job.job_id);
                        if (!validation.allowed) {
                          alert(validation.message);
                          return;
                        }
                        void startRenderFlow();
                      }
                }
                onRenderShort={
                  isInspectingArchive
                    ? undefined
                    : () => {
                        if (!activeVideo) return;
                        const validation = canStartOperation(activeVideo.job.job_id);
                        if (!validation.allowed) {
                          alert(validation.message);
                          return;
                        }
                        void startRenderFlow();
                      }
                }
                onDiscardCut={
                  isInspectingArchive ? undefined : (cutId) => requestDeleteSuggestedCut(cutId)
                }
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
                  isLoadingRenderOutputs={
                    isInspectingArchive ? isLoadingAttemptDetail : isLoadingRenderOutputs
                  }
                  isRendering={isInspectingArchive ? false : isRendering}
                  renderOutputs={effectiveRenderOutputs}
                  renderTitlesByFileName={effectiveRenderTitlesByFileName}
                  buildRenderUrl={buildRenderUrl}
                  onOpenRenderFolder={async (fileName) => {
                    if (isInspectingArchive && inspectingAttempt) {
                      await openVideoFolder(inspectingAttempt.jobId);
                      return;
                    }
                    await openRenderOutputFolder(fileName);
                  }}
                  onDeleteRender={async (fileName) => {
                    if (isInspectingArchive) {
                      setToastNotification(
                        "Tentativa arquivada é somente leitura. Para remover, exclua a tentativa na barra lateral.",
                      );
                      return;
                    }
                    await deleteRenderOutputFile(fileName);
                  }}
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

      {/* Toast Notifications (Sucesso e Erros) em Liquid Glass */}
      <GlassToastContainer position="bottom-right">
        {toastNotification && (
          <GlassToast
            variant="default"
            message={toastNotification}
            onClose={() => setToastNotification(null)}
            duration={4000}
          />
        )}
        {action.error && (
          <GlassToast
            variant="danger"
            title="Erro na operação"
            message={action.error}
            onClose={() => setAction((prev) => ({ ...prev, error: undefined }))}
            duration={6000}
          />
        )}
      </GlassToastContainer>
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
    </div>
  );
}
