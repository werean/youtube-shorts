import { useEffect, useMemo, useRef, useState } from "react";
import type { Job, VideoRecord } from "./types";
import type { FFmpegConfig } from "./types/ffmpeg";
import type { WhisperConfig } from "./types/whisper";
import type { ToolConfigs } from "./types/toolConfigs";
import { LM_STUDIO_DEFAULT_MODEL } from "../../shared/localInference";
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
  listCuts,
  openVideoFolder,
  uploadVideoFile,
  getSettings,
  saveSettings,
  getDependencies,
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
import { AppDialog } from "./components/shared";
import { formatTimestamp, parseTimestampInput } from "./utils/formatters";
import { VideoItem, recordToVideoItem } from "./utils/videoHelpers";
import { useShortStyleLibrary } from "./hooks/useShortStyleLibrary";
import { GlassWorkspace, type StageSelection } from "./components/workspace/GlassWorkspace";
import type { Cut } from "./types";

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
  const [llmModel, setLlmModel] = useState<string>(LM_STUDIO_DEFAULT_MODEL);
  const [llmBaseUrl, setLlmBaseUrl] = useState("http://localhost:1234/v1");
  const [embeddingModel, setEmbeddingModel] = useState<string>("nomic-embed-text");
  const [registeredEmbeddingModels, setRegisteredEmbeddingModels] = useState<string[]>([]);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ollamaModelCatalog, setOllamaModelCatalog] = useState<OllamaModelCatalogItem[]>([]);
  const [ollamaLocalAvailable, setOllamaLocalAvailable] = useState(false);
  const [ollamaRemoteAvailable, setOllamaRemoteAvailable] = useState(false);
  const [llmSystemPrompt, setLlmSystemPrompt] = useState<string>("");
  const [llmForceCpu, setLlmForceCpu] = useState(false);
  const [gpuAvailable, setGpuAvailable] = useState<boolean | null>(null);
  const [whisperDevice, setWhisperDevice] = useState<"cpu" | "cuda">("cuda");
  const [whisperFormats, setWhisperFormats] = useState<string[]>(["json", "vtt", "txt"]);
  const [whisperConfig, setWhisperConfig] = useState<Partial<WhisperConfig>>({});
  const [ffmpegConfig, setFfmpegConfig] = useState<FFmpegConfig | null>(null);
  const [expandUploadSection, setExpandUploadSection] = useState(true);
  const [expandVideoListSection, setExpandVideoListSection] = useState(true);
  const [expandVideoPlayerSection, setExpandVideoPlayerSection] = useState(true);
  const [expandRenderingSection, setExpandRenderingSection] = useState(true);
  const [ingestLogs, setIngestLogs] = useState<string[]>([]);
  const [expandIngestLogs, setExpandIngestLogs] = useState(false);
  const [ingestJobId, setIngestJobId] = useState<string | null>(null);
  const [isIngesting, setIsIngesting] = useState(false);
  const [uploadTick, setUploadTick] = useState(0);
  const pendingStagesRef = useRef<StageSelection | null>(null);
  const uploadingBatchRef = useRef(false);
  const renderAfterSyncRef = useRef(false);
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const styleLibraryApi = useShortStyleLibrary(appSettings, setAppSettings);
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
      return result;
    } catch (error: any) {
      console.error(`[App] Erro na ação:`, error);
      console.error(`[App] Mensagem:`, error.message);
      console.error(`[App] Stack:`, error.stack);
      const errorMessage = error instanceof Error ? error.message : "Erro inesperado";
      console.error(`[App] Será exibido ao usuário:`, errorMessage);
      setAction({ busy: false, error: errorMessage });
      return undefined;
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

  async function startUploadSelectedFiles() {
    if (selectedFiles.length === 0) return;

    console.log(`\n[UI] Botão "Upload de arquivos" clicado`);
    console.log(`[UI] Arquivos: ${selectedFiles.length}`);

    uploadingBatchRef.current = true;
    let lastUploadedId: string | null = null;
    try {
      for (const file of selectedFiles) {
        try {
          await new Promise<void>((resolve) => {
            void runAction(
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
                lastUploadedId = result.job.job_id;
                resolve();
              },
            ).finally(() => resolve());
          });
        } catch (error) {
          console.error(`[UI] Erro ao fazer upload de ${file.name}:`, error);
        }
      }

      setSelectedFiles([]);
      const fileInput = document.getElementById("video-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      await loadVideos();
    } finally {
      uploadingBatchRef.current = false;
      if (!lastUploadedId) pendingStagesRef.current = null;
      setUploadTick((tick) => tick + 1);
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
    const configuredModel = String(active.llm.model || "").trim() || LM_STUDIO_DEFAULT_MODEL;
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
    setLlmBaseUrl(String(active.llm.base_url || "http://localhost:1234/v1"));
    setEmbeddingModel(configuredEmbeddingModel);
    setRegisteredEmbeddingModels(Array.from(embeddingModelSet));
    setOllamaModels((prev) => mergeModelOptions(prev, [configuredModel]));
    setLlmSystemPrompt(active.llm.system_prompt || "");
    setLlmForceCpu(active.llm.force_cpu === true);
  }

  async function refreshGpuAvailability() {
    try {
      const snapshot = await getDependencies();
      setGpuAvailable(snapshot.dependencies.cuda?.installed === true);
    } catch (error) {
      console.error("[UI] Não foi possível detectar a GPU:", error);
    }
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
    forceCpu: boolean,
    baseUrl: string,
  ) {
    try {
      const response = await saveToolConfigs({
        llm: {
          model,
          base_url: baseUrl,
          system_prompt: prompt,
          embedding_model: nextEmbeddingModel,
          registered_embedding_models: nextRegisteredEmbeddingModels,
          force_cpu: forceCpu,
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
        void refreshGpuAvailability();
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

  async function commitCutChange(
    cutId: string,
    changes: Partial<Pick<Cut, "start" | "end" | "title">>,
  ) {
    if (!activeVideo) return;
    const source = cuts.length > 0 ? cuts : suggestedCuts;
    const current = source.find((cut) => cut.cut_id === cutId);
    if (!current) return;
    const nextCut = { ...current, ...changes };
    if (typeof nextCut.title === "string") {
      nextCut.title = nextCut.title.trim() || null;
    }
    if (nextCut.end <= nextCut.start) {
      setAction({ busy: false, error: "O fim do corte precisa ser depois do início." });
      return;
    }
    const mapCuts = (list: Cut[]) =>
      list.map((cut) => (cut.cut_id === cutId ? nextCut : cut));
    const nextCuts = mapCuts(source);
    const nextSuggested = mapCuts(suggestedCuts.length > 0 ? suggestedCuts : source);
    setCuts(nextCuts);
    setSuggestedCuts(nextSuggested);
    setSelectedSuggestedCutId(cutId);
    if (typeof changes.start === "number" && videoRef.current) {
      videoRef.current.currentTime = changes.start;
    }
    try {
      await updateCuts(activeVideo.job.job_id, nextCuts);
    } catch (error) {
      console.error("Failed to update cuts:", error);
      setAction({ busy: false, error: "Não foi possível salvar o corte." });
    }
  }

  async function runSelectedStages(stages: StageSelection) {
    const video = activeVideo;
    if (!video) {
      setAction({ busy: false, error: "Selecione ou adicione um vídeo antes de iniciar." });
      return;
    }
    const jobId = video.job.job_id;
    const validation = canStartOperation(jobId);
    if (!validation.allowed) {
      alert(validation.message);
      return;
    }
    // `download` is handled by ingest/upload in handleIniciar; nothing else to run.
    if (!stages.transcribe && !stages.blocks && !stages.analyze && !stages.render) return;

    if (stages.transcribe) {
      if (hasAnyTranscription) {
        requestTranscriptionStart();
        return;
      }
      const transcribed = await requestTranscriptionStart();
      if (transcribed === undefined) return;
    }

    if (stages.blocks) {
      const value = await runAction(() => buildBlocks(jobId));
      if (!value) return;
      setBlocks(value);
      setShowBlocksDialog(true);
      void refreshVideo(jobId);
    }

    if (stages.analyze) {
      if (suggestedCuts.length > 0) {
        setShowRegenerateAnalyzeDialog(true);
        return;
      }
      setIsAnalyzing(true);
      const value = await runAction(async () => {
        try {
          return await analyzeJob(jobId);
        } finally {
          setIsAnalyzing(false);
        }
      });
      if (!value) return;
      handleAnalyzeResult(value);
    }

    if (stages.render) {
      if (stages.transcribe || stages.blocks || stages.analyze) {
        const latest = await listCuts(jobId);
        if (latest.length === 0) {
          setAction({ busy: false, error: "Não há cortes para renderizar." });
          return;
        }
        setCuts(latest);
        setSuggestedCuts(latest);
        renderAfterSyncRef.current = true;
        return;
      }
      if (cuts.length === 0) {
        setAction({ busy: false, error: "Não há cortes para renderizar." });
        return;
      }
      await startRenderFlow();
    }
  }

  useEffect(() => {
    if (!renderAfterSyncRef.current || cuts.length === 0) return;
    renderAfterSyncRef.current = false;
    void startRenderFlow();
  }, [cuts]);

  useEffect(() => {
    if (uploadingBatchRef.current || isIngesting || action.busy) return;
    if (!pendingStagesRef.current || !activeVideo) return;
    const stages = pendingStagesRef.current;
    pendingStagesRef.current = null;
    void runSelectedStages(stages);
  }, [activeVideo?.job.job_id, action.busy, isIngesting, uploadTick]);

  async function handleIniciar(stages: StageSelection) {
    // Download/upload always happens from the URL/file path below.
    // Only queue post-download stages so "Baixar" alone stops after ingest.
    const wantsPostDownload =
      stages.transcribe || stages.blocks || stages.analyze || stages.render;
    pendingStagesRef.current = wantsPostDownload ? stages : null;

    if (uploadMode === "url" && youtubeUrl.trim()) {
      try {
        setAction({ busy: true });
        setIsIngesting(true);
        const job = await createJob(youtubeUrl.trim());
        setYoutubeUrl("");
        setIngestJobId(job.job_id);
        const ingestResult = await ingestJob(job.job_id);
        const updatedJob = await getJob(job.job_id);
        const title = String(updatedJob?.video_name ?? updatedJob?.source_file_name ?? "").trim();
        const videoPath = String(ingestResult?.video_path ?? "").trim();
        if (title && videoPath) {
          upsertVideoIntoList({
            job: { ...updatedJob, video_name: title },
            transcriptionLogs: [],
            videoPath,
          });
        }
        setAction({ busy: false });
        setUploadTick((tick) => tick + 1);
      } catch (error) {
        pendingStagesRef.current = null;
        const message = error instanceof Error ? error.message : "Falha ao adicionar o vídeo.";
        setAction({ busy: false, error: message });
      } finally {
        setIsIngesting(false);
      }
      return;
    }

    if (uploadMode === "file" && selectedFiles.length > 0) {
      const shouldAsk = appSettings?.preferences?.ask_move_on_upload ?? true;
      if (shouldAsk) {
        setDontAskMoveUpload(false);
        setShowMoveUploadDialog(true);
        return;
      }
      await startUploadSelectedFiles();
      return;
    }

    pendingStagesRef.current = null;
    await runSelectedStages(stages);
  }

  async function renderWithPreset() {
    const validation = activeVideo ? canStartOperation(activeVideo.job.job_id) : { allowed: false, message: "Selecione um vídeo." };
    if (!validation.allowed) {
      alert(validation.message);
      return;
    }
    try {
      await styleLibraryApi.flush();
    } catch (error) {
      console.error("[style] Falha ao salvar o preset antes do render:", error);
      setAction({ busy: false, error: "Não foi possível salvar o preset antes do render." });
      return;
    }
    const preset = styleLibraryApi.activePreset;
    const videoFilter = preset?.ffmpegVideoFilter.trim();
    const audioFilter = preset?.ffmpegAudioFilter.trim();
    if (videoFilter || audioFilter) {
      try {
        const response = await saveToolConfigs({
          ffmpeg: {
            ...(videoFilter ? { video_filter: videoFilter } : {}),
            ...(audioFilter ? { audio_filter: audioFilter } : {}),
          } as FFmpegConfig,
        });
        applyToolConfigs(response);
      } catch (error) {
        console.error("[style] Falha ao aplicar filtro do preset:", error);
        setAction({ busy: false, error: "Não foi possível aplicar o filtro do preset." });
        return;
      }
    }
    return startRenderFlow();
  }

  return (
    <>
      <GlassWorkspace
        uploadMode={uploadMode}
        youtubeUrl={youtubeUrl}
        selectedFiles={selectedFiles}
        isDraggingFile={isDraggingFile}
        onUploadMode={setUploadMode}
        onYoutubeUrl={setYoutubeUrl}
        onSelectedFiles={setSelectedFiles}
        onDraggingFile={setIsDraggingFile}
        videos={videos}
        archivedVideos={archivedVideos}
        activeVideoId={activeVideoId}
        activeVideo={activeVideo}
        videoView={videoView}
        onSelectVideo={(videoId) => {
          if (videoId === null) {
            setActiveVideoId(null);
            return;
          }
          const validation = canStartOperation(videoId);
          if (!validation.allowed) {
            alert(validation.message);
            return;
          }
          setActiveVideoId(videoId);
        }}
        onSetView={setView}
        onOpenFolder={(videoId) => {
          void runAction(() => openVideoFolder(videoId));
        }}
        onRename={(videoId, name) => {
          setRenameVideoId(videoId);
          setRenameVideoNewName(name);
        }}
        onArchive={(videoId) => {
          void runAction(
            () => archiveVideo(videoId),
            () => {
              if (activeVideoId === videoId) setActiveVideoId(null);
              void loadVideos();
            },
          );
        }}
        onDelete={(videoId) => {
          void runAction(
            () => deleteVideo(videoId),
            () => {
              if (activeVideoId === videoId) setActiveVideoId(null);
              void loadVideos();
            },
          );
        }}
        onStart={(stages) => {
          void handleIniciar(stages);
        }}
        busy={action.busy || isIngesting}
        videoRef={videoRef}
        apiBaseUrl={apiBaseUrl}
        suggestedCuts={suggestedCuts}
        selectedSuggestedCutId={selectedSuggestedCutId}
        onSelectCut={selectSuggestedCut}
        onAdjustCut={openEditCutDialog}
        onCommitCut={(cutId, changes) => {
          void commitCutChange(cutId, changes);
        }}
        onRender={() => {
          void renderWithPreset();
        }}
        isRendering={isRendering}
        renderOutputs={renderOutputs}
        renderTitlesByFileName={renderTitlesByFileName}
        onOpenRenderFolder={(fileName) => {
          void openRenderOutputFolder(fileName);
        }}
        onDeleteRender={(fileName) => {
          void deleteRenderOutputFile(fileName);
        }}
        onOpenSettings={(which) => {
          if (which === "app") setShowConfigureAppDialog(true);
          if (which === "deps") {
            setShowDependenciesDialog(true);
            void prepareDependenciesDialog();
          }
          if (which === "llm") {
            setShowLLMConfigDialog(true);
            void refreshOllamaModelOptions(false);
            void refreshGpuAvailability();
          }
          if (which === "whisper") {
            setShowWhisperConfigDialog(true);
            void refreshGpuAvailability();
          }
          if (which === "ffmpeg") setShowFFmpegConfigDialog(true);
          if (which === "help") setShowHowToUseDialog(true);
        }}
        onShowTranscription={openTranscriptionFormatList}
        onAddManualCut={openAddManualCutDialog}
        onBatch={openBatchPipelineDialog}
        showContinueBatch={batchWaitingForApproval && Boolean(activeBatchId)}
        onContinueBatch={() => {
          void continueActiveBatchPipeline();
        }}
        batchLogs={batchProcessingLogs}
        taskLogsContainerRef={taskLogsContainerRef}
        activeTaskLogType={activeTaskLogType}
        activeTaskLogs={activeTaskLogs}
        expandTaskLogs={expandTaskLogs}
        onShowMoreTaskLogs={showMoreTaskLogs}
        onCancelTranscription={() => {
          void cancelActiveTranscription();
        }}
        onCancelRendering={() => {
          void cancelActiveRendering();
        }}
        isTranscribing={Boolean(activeVideo?.isTranscribing)}
        styleLibrary={styleLibraryApi.library}
        activePreset={styleLibraryApi.activePreset}
        onSelectPreset={styleLibraryApi.selectPreset}
        onUpdatePreset={styleLibraryApi.updateActive}
        onCreatePreset={styleLibraryApi.createPreset}
        onDuplicatePreset={styleLibraryApi.duplicateActive}
        onRemovePreset={styleLibraryApi.removeActive}
        onResetPreset={styleLibraryApi.resetActiveBuiltin}
        onAddExtra={styleLibraryApi.addExtra}
        onRemoveExtra={styleLibraryApi.removeExtra}
      />

      <AppSupportDialogs
        showTranscriptionRegenerateConfirmDialog={showTranscriptionRegenerateConfirmDialog}
        showDeleteCutConfirmDialog={showDeleteCutConfirmDialog}
        showHowToUseDialog={showHowToUseDialog}
        dontAskDeleteCutAgain={dontAskDeleteCutAgain}
        onCloseTranscriptionRegenerateConfirm={() => closeTranscriptionRegenerateConfirm()}
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
          llmBaseUrl={llmBaseUrl}
          embeddingModel={embeddingModel}
          registeredEmbeddingModels={registeredEmbeddingModels}
          availableModels={ollamaModels}
          modelCatalog={ollamaModelCatalog}
          localAvailable={ollamaLocalAvailable}
          remoteAvailable={ollamaRemoteAvailable}
          llmSystemPrompt={llmSystemPrompt}
          forceCpu={llmForceCpu}
          gpuAvailable={gpuAvailable}
          action={action}
          onRegisterModel={registerNewOllamaModel}
          onRemoveModel={removeRegisteredOllamaModel}
          onRefreshModels={() => refreshOllamaModelOptions(true)}
          onSave={(
            model,
            prompt,
            nextEmbeddingModel,
            nextRegisteredEmbeddingModels,
            forceCpu,
            baseUrl,
          ) => {
            setLlmModel(model);
            setLlmBaseUrl(baseUrl);
            setLlmSystemPrompt(prompt);
            setEmbeddingModel(nextEmbeddingModel);
            setRegisteredEmbeddingModels(nextRegisteredEmbeddingModels);
            setLlmForceCpu(forceCpu);
            void saveLLMConfig(
              model,
              prompt,
              nextEmbeddingModel,
              nextRegisteredEmbeddingModels,
              forceCpu,
              baseUrl,
            );
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
          gpuAvailable={gpuAvailable}
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
    </>
  );
}
