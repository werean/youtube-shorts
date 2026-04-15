import { useEffect, useMemo, useRef, useState } from "react";
import type { Cut, Job, Segment, VideoRecord } from "./types";
import type { FFmpegConfig } from "./types/ffmpeg";
import type { WhisperConfig } from "./types/whisper";
import type { ToolConfigs } from "./types/toolConfigs";
import { useUIState } from "./hooks";
import {
  analyzeJob,
  apiBaseUrl,
  archiveVideo,
  approveCut,
  buildBlocks,
  cancelTranscription,
  cancelRendering,
  createJob,
  deleteTranscription,
  deleteVideo,
  getTranscription,
  getJob,
  ingestJob,
  listArchivedVideos,
  listCuts,
  listVideos,
  rejectCut,
  renderJob,
  listRenderOutputs,
  deleteRenderOutput,
  renameVideo,
  transcribeJob,
  updateCuts,
  openRenderFolder,
  uploadVideoFile,
  getDependencies,
  getInstallationGuide,
  startDependencyInstallSession,
  startDependencyUninstallSession,
  getDependencyInstallSession,
  cancelDependencyInstallSession,
  openDependencyInstallTerminal,
  getSettings,
  saveSettings,
  getToolConfigs,
  getOllamaModels,
  saveToolConfigs,
  resetAllToolConfigs,
  resetToolConfigSection,
  importToolConfigs,
  getCommonFolders,
  selectFolder,
  startBatchPipeline,
  getBatchPipelineStatus,
  cancelBatchPipeline,
  continueBatchPipeline,
  type AppSettings,
  type BatchPipelineProgress,
  type DependencyInstallOptions,
  type DependencyInstallSessionStatus,
  type DependencyOperationMode,
} from "./api";
import { getJobLogs } from "./api/logs";
import { WhisperConfigDialog } from "./components/WhisperConfigDialog";
import { FFmpegConfigDialog } from "./components/FFmpegConfigDialog";
import { InstallationInstructionsDialog } from "./components/InstallationInstructionsDialog";
import { ConfigurationSection } from "./components/ConfigurationSection";
import { ActionCard } from "./components/ActionCard";
import { DependenciesDialog } from "./components/DependenciesDialog";
import { BatchPipelineDialog } from "./components/BatchPipelineDialog";
import { LLMConfigDialog } from "./components/LLMConfigDialog";
import { ConfigureAppDialog } from "./components/ConfigureAppDialog";
import { TimestampDialog } from "./components/TimestampDialog";
import { SimpleDialogs } from "./components/SimpleDialogs";
import { RenderingSection } from "./components/RenderingSection";
import { UploadSection } from "./components/UploadSection";
import { VideoListSection } from "./components/VideoListSection";
import { TranscriptionFormatListDialog } from "./components/TranscriptionFormatListDialog";
import { TranscriptionContentDialog } from "./components/TranscriptionContentDialog";
import { TranscriptionDeleteDialog } from "./components/TranscriptionDeleteDialog";
import { BlocksDialog } from "./components/BlocksDialog";
import { AiResponseDialog } from "./components/AiResponseDialog";
import { RegenerateAnalyzeDialog } from "./components/RegenerateAnalyzeDialog";
import { AppButton, AppCheckboxField, AppDialog } from "./components/shared";
import {
  formatTimestamp,
  buildRenderUrl as buildRenderUrlUtil,
  parseTimestampInput,
} from "./utils/formatters";
import {
  VideoItem,
  recordToVideoItem,
  buildVtt,
  getTranscriptionContent,
} from "./utils/videoHelpers";

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
    showTranscriptionFormatListDialog,
    showTranscriptionContentDialog,
    showTranscriptionDeleteDialog,
    selectedTranscriptionFormat,
    pendingDeleteFormat,
    setShowTranscriptionFormatListDialog,
    setShowTranscriptionContentDialog,
    setShowTranscriptionDeleteDialog,
    setSelectedTranscriptionFormat,
    setPendingDeleteFormat,
    showBlocksDialog,
    showAiResponseDialog,
    showAiResponseOnAnalyze,
    showRegenerateAnalyzeDialog,
    setShowBlocksDialog,
    setShowAiResponseDialog,
    setShowAiResponseOnAnalyze,
    setShowRegenerateAnalyzeDialog,
    showCutEditDialog,
    editingCutId,
    editCutStart,
    editCutEnd,
    editCutStartMinutes,
    editCutStartSeconds,
    editCutEndMinutes,
    editCutEndSeconds,
    hoveredCutId,
    hoveredCutAction,
    setShowCutEditDialog,
    setEditingCutId,
    setEditCutStart,
    setEditCutEnd,
    setEditCutStartMinutes,
    setEditCutStartSeconds,
    setEditCutEndMinutes,
    setEditCutEndSeconds,
    setHoveredCutId,
    setHoveredCutAction,
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
    installingDependency,
    setSelectedDependencyForInstall,
    setInstallingDependency,
  } = useUIState();
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [archivedVideos, setArchivedVideos] = useState<VideoItem[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [suggestedCuts, setSuggestedCuts] = useState<Cut[]>([]);
  const [selectedSuggestedCutId, setSelectedSuggestedCutId] = useState<string | null>(null);
  const [renderOutputs, setRenderOutputs] = useState<string[]>([]);
  const [renderOutputsVersion, setRenderOutputsVersion] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingCuts, setIsLoadingCuts] = useState(false);
  const [isLoadingRenderOutputs, setIsLoadingRenderOutputs] = useState(false);
  const [expectedRenderCount, setExpectedRenderCount] = useState(0);
  const renderPollRef = useRef<number | null>(null);
  const renderPollStartTimeRef = useRef<number | null>(null);
  const renderOutputsKeyRef = useRef<string>("");
  const logsPollRef = useRef<number | null>(null);
  const ingestLogsPollRef = useRef<number | null>(null);
  const taskLogsContainerRef = useRef<HTMLDivElement>(null);
  const ingestLogsContainerRef = useRef<HTMLDivElement>(null);
  const [action, setAction] = useState<ActionState>(initialAction);
  const [blocks, setBlocks] = useState<Record<string, unknown>[]>([]);
  const [aiResponseRaw, setAiResponseRaw] = useState<string | null>(null);
  const [showAddManualCutDialog, setShowAddManualCutDialog] = useState(false);
  const [newCutStartMinutes, setNewCutStartMinutes] = useState<string>("");
  const [newCutStartSeconds, setNewCutStartSeconds] = useState<string>("");
  const [newCutEndMinutes, setNewCutEndMinutes] = useState<string>("");
  const [newCutEndSeconds, setNewCutEndSeconds] = useState<string>("");
  const [showTranscriptionRegenerateConfirmDialog, setShowTranscriptionRegenerateConfirmDialog] =
    useState(false);
  const [showDeleteCutConfirmDialog, setShowDeleteCutConfirmDialog] = useState(false);
  const [pendingDeleteCutId, setPendingDeleteCutId] = useState<string | null>(null);
  const [dontAskDeleteCutAgain, setDontAskDeleteCutAgain] = useState(false);
  const [showBatchPipelineDialog, setShowBatchPipelineDialog] = useState(false);
  const [selectedVideosForBatch, setSelectedVideosForBatch] = useState<string[]>([]);
  const [batchPipelineOptions, setBatchPipelineOptions] = useState({
    transcription: true,
    analysis: false,
    render: false,
    preApprove: false,
  });
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProcessingLogs, setBatchProcessingLogs] = useState<string[]>([]);
  const [currentBatchVideoIndex, setCurrentBatchVideoIndex] = useState(0);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const batchPollRef = useRef<number | null>(null);
  const [showBatchCompletionNotification, setShowBatchCompletionNotification] = useState(false);
  const [batchCompletionMessage, setBatchCompletionMessage] = useState("");
  const [batchWaitingForApproval, setBatchWaitingForApproval] = useState(false);
  const [batchPendingCuts, setBatchPendingCuts] = useState<any[]>([]);
  const [llmModel, setLlmModel] = useState<string>("");
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
  const [activeTaskLogs, setActiveTaskLogs] = useState<string[]>([]);
  const [activeTaskLogType, setActiveTaskLogType] = useState<"transcription" | "render" | null>(
    null,
  );
  const [expandTaskLogs, setExpandTaskLogs] = useState(false);
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
  const [dependencies, setDependencies] = useState<{
    python: { installed: boolean; version: string | null };
    whisper: { installed: boolean; version: string | null };
    ffmpeg: { installed: boolean; version: string | null };
    cuda: { installed: boolean; version: string | null };
    pytorch: { installed: boolean; version: string | null };
    ollama: { installed: boolean; version: string | null };
  } | null>(null);
  const [refreshingDependencies, setRefreshingDependencies] = useState(false);
  const [loadingDependencies, setLoadingDependencies] = useState<Set<string>>(new Set());
  const [uninstallingDependency, setUninstallingDependency] = useState<string | null>(null);
  const [dependencyOperationFeedback, setDependencyOperationFeedback] = useState<{
    kind: "success" | "warning" | "error";
    message: string;
  } | null>(null);
  const dependencyInstallPollRef = useRef<number | null>(null);
  const [dependencyInstallSessionId, setDependencyInstallSessionId] = useState<string | null>(null);
  const [dependencyInstallLogs, setDependencyInstallLogs] = useState<string[]>([]);
  const [dependencyInstallLogDependency, setDependencyInstallLogDependency] = useState<
    string | null
  >(null);
  const [dependencyLogOperation, setDependencyLogOperation] =
    useState<DependencyOperationMode | null>(null);
  const [dependencyInstallLogStatus, setDependencyInstallLogStatus] = useState<
    DependencyInstallSessionStatus | "idle"
  >("idle");
  const [showDependencyInstallLogs, setShowDependencyInstallLogs] = useState(false);

  const statusLabel = useMemo(
    () => videos.find((v) => v.job.job_id === activeVideoId)?.job.status ?? "NENHUM VÍDEO",
    [videos, activeVideoId],
  );
  const activeVideo = useMemo(
    () => videos.find((v) => v.job.job_id === activeVideoId),
    [videos, activeVideoId],
  );
  const transcriptionContent = useMemo(() => {
    if (!activeVideo || !selectedTranscriptionFormat) return null;
    return getTranscriptionContent(activeVideo, selectedTranscriptionFormat);
  }, [activeVideo, selectedTranscriptionFormat]);
  const hasAnyTranscription = useMemo(() => {
    if (!activeVideo) return false;
    return Boolean(
      activeVideo.transcription ||
      activeVideo.transcriptionSegments?.length ||
      activeVideo.transcriptionFormats?.vtt,
    );
  }, [activeVideo]);
  const hasAnyBlocks = useMemo(() => {
    if (!activeVideo) return false;
    return blocks.length > 0;
  }, [blocks, activeVideo]);

  useEffect(() => {
    return () => {
      stopDependencyInstallPolling();
    };
  }, []);

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

  useEffect(() => {
    if (!activeVideo) {
      stopRenderPolling();
      return;
    }
  }, [activeVideo]);

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

  function stopDependencyInstallPolling() {
    if (dependencyInstallPollRef.current !== null) {
      window.clearInterval(dependencyInstallPollRef.current);
      dependencyInstallPollRef.current = null;
    }
  }

  function clearDependencyLoading(name: string) {
    setLoadingDependencies((prev) => {
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  function normalizeDependencySnapshot(snapshot: {
    python: { installed: boolean; version: string | null };
    whisper: { installed: boolean; version: string | null };
    ffmpeg: { installed: boolean; version: string | null };
    cuda: { installed: boolean; version: string | null };
    pytorch: { installed: boolean; version: string | null };
    ollama: { installed: boolean; version: string | null };
  }) {
    return {
      python: { ...snapshot.python },
      whisper: { ...snapshot.whisper },
      ffmpeg: { ...snapshot.ffmpeg },
      cuda: { ...snapshot.cuda },
      pytorch: { ...snapshot.pytorch },
      ollama: { ...snapshot.ollama },
    };
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

  function mergeOllamaCatalog(
    ...catalogLists: Array<Array<OllamaModelCatalogItem | null | undefined>>
  ): OllamaModelCatalogItem[] {
    const merged = new Map<string, OllamaModelCatalogItem>();

    for (const catalogList of catalogLists) {
      for (const candidate of catalogList) {
        if (!candidate) {
          continue;
        }

        const name = String(candidate.name || "").trim();
        if (!name) {
          continue;
        }

        const existing = merged.get(name);
        if (!existing) {
          merged.set(name, {
            ...candidate,
            name,
          });
          continue;
        }

        merged.set(name, {
          ...existing,
          ...candidate,
          name,
          installed: existing.installed || candidate.installed,
          running: existing.running || candidate.running,
          needsDownload: !(
            existing.installed ||
            candidate.installed ||
            existing.running ||
            candidate.running
          ),
          source:
            existing.installed || candidate.installed || existing.running || candidate.running
              ? "local"
              : "cloud",
          size: existing.size || candidate.size,
        });
      }
    }

    return Array.from(merged.values());
  }

  async function refreshOllamaModelOptions(
    fallbackModel?: string,
    showAlertOnError = false,
  ): Promise<void> {
    try {
      const result = await getOllamaModels();

      const fallbackCatalog = mergeModelOptions(
        [result.configuredModel],
        [fallbackModel],
        [llmModel],
      ).map((name) => ({
        name,
        source: "local" as const,
        installed: true,
        running: false,
        needsDownload: false,
      }));

      const mergedCatalog = mergeOllamaCatalog(
        ollamaModelCatalog,
        result.catalog || [],
        fallbackCatalog,
      );

      setOllamaModelCatalog(mergedCatalog);
      setOllamaModels((prev) =>
        mergeModelOptions(
          prev,
          result.models,
          mergedCatalog.map((entry) => entry.name),
          [result.configuredModel],
          [fallbackModel],
          [llmModel],
        ),
      );
      setOllamaLocalAvailable(Boolean(result.localAvailable));
      setOllamaRemoteAvailable(Boolean(result.remoteAvailable));
    } catch (error) {
      console.error("Failed to load Ollama models:", error);
      const fallbackCatalog = mergeModelOptions([fallbackModel], [llmModel]).map((name) => ({
        name,
        source: "local" as const,
        installed: true,
        running: false,
        needsDownload: false,
      }));

      setOllamaModelCatalog((prev) => mergeOllamaCatalog(prev, fallbackCatalog));
      setOllamaModels((prev) => mergeModelOptions(prev, [fallbackModel], [llmModel]));
      setOllamaLocalAvailable(false);
      setOllamaRemoteAvailable(false);
      if (showAlertOnError) {
        alert("Não foi possível carregar a lista de modelos do Ollama.");
      }
    }
  }

  async function refreshDependencies(showAlertOnError = false): Promise<boolean> {
    setRefreshingDependencies(true);
    try {
      const depsData = await getDependencies();
      setDependencies(normalizeDependencySnapshot(depsData.dependencies));
      if (!installingDependency && !uninstallingDependency) {
        setLoadingDependencies(new Set());
      }
      return true;
    } catch (error) {
      console.error("Failed to refresh dependencies:", error);
      if (showAlertOnError) {
        alert("Não foi possível atualizar as dependências no momento.");
      }
      return false;
    } finally {
      setRefreshingDependencies(false);
    }
  }

  async function openSystemTerminalForDependency(
    name: string,
    mode: DependencyOperationMode,
    showFeedback = false,
    options?: DependencyInstallOptions,
  ): Promise<boolean> {
    try {
      const result = await openDependencyInstallTerminal(name, mode, options);
      if (showFeedback) {
        const commandInfo = result.command ? `\n\nComando:\n${result.command}` : "";
        alert(`${result.message}${commandInfo}`);
      }
      return true;
    } catch (error) {
      console.error(`Failed to open terminal for ${name}:`, error);
      if (showFeedback) {
        alert(`Não foi possível abrir o terminal para ${name}.`);
      }
      return false;
    }
  }

  async function finalizeDependencyOperation(
    operation: DependencyOperationMode,
    name: string,
    status: "success" | "failed" | "cancelled",
    result?: any,
  ) {
    try {
      if (result?.dependencies) {
        setDependencies(result.dependencies);
      } else {
        const depsData = await getDependencies();
        setDependencies(depsData.dependencies);
      }
    } catch (refreshError) {
      console.error("Failed to refresh dependencies after install session:", refreshError);
    }

    const operationVerb = operation === "uninstall" ? "desinstalação" : "instalação";

    if (status === "cancelled") {
      setDependencyOperationFeedback({
        kind: "warning",
        message: `A ${operationVerb} de ${name} foi cancelada.`,
      });
    } else if (status === "success" && result?.success) {
      const installerInfo = result.installer ? ` (Instalador: ${result.installer})` : "";
      setDependencyOperationFeedback({
        kind: "success",
        message: `${result.message}${installerInfo}`,
      });
    } else if (result) {
      const categoryInfo = result.failureCategory ? `\nCategoria: ${result.failureCategory}` : "";
      const details = result.error || result.output;
      const diagnosticsInfo = result.diagnostics?.length
        ? `\n\nDiagnóstico:\n${result.diagnostics.join("\n")}`
        : "";
      const detailsInfo = details ? `\n\n${details}` : "\n\nSem detalhes adicionais";
      setDependencyOperationFeedback({
        kind: "error",
        message: result.message || `Falha na ${operationVerb} de ${name}.`,
      });
      alert(`${result.message}${categoryInfo}${detailsInfo}${diagnosticsInfo}`);
    } else {
      setDependencyOperationFeedback({
        kind: "warning",
        message: `A ${operationVerb} de ${name} terminou sem retornar um resultado válido.`,
      });
      alert(`A ${operationVerb} de ${name} terminou sem retornar um resultado válido.`);
    }

    clearDependencyLoading(name);
    if (operation === "install") {
      setInstallingDependency(null);
    } else {
      setUninstallingDependency(null);
    }
    setDependencyInstallSessionId(null);
    setDependencyLogOperation(null);
  }

  async function pollDependencyInstallSession(
    sessionId: string,
    name: string,
    operation: DependencyOperationMode,
  ): Promise<boolean> {
    const session = await getDependencyInstallSession(sessionId);
    setDependencyInstallLogs(session.logs || []);
    setDependencyInstallLogStatus(session.status);
    setDependencyLogOperation(session.operation || operation);

    if (session.status === "running") {
      return true;
    }

    stopDependencyInstallPolling();
    await finalizeDependencyOperation(
      session.operation || operation,
      name,
      session.status,
      session.result,
    );
    return false;
  }

  async function cancelActiveDependencyInstallSession(): Promise<void> {
    if (!dependencyInstallSessionId) {
      return;
    }

    try {
      const result = await cancelDependencyInstallSession(dependencyInstallSessionId);
      setDependencyInstallLogs((prev) => [...prev, `[local] ${result.message}`]);
    } catch (error) {
      console.error("Failed to request install session cancellation:", error);
      alert("Não foi possível cancelar a execução no momento.");
    }
  }

  function downloadDependencyLogsAsTxt() {
    if (dependencyInstallLogs.length === 0) {
      alert("Não há logs disponíveis para download.");
      return;
    }

    const dependency = dependencyInstallLogDependency || "dependencia";
    const operation = dependencyLogOperation || "install";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeDependency = dependency.replace(/[^a-zA-Z0-9_-]/g, "_");
    const filename = `${safeDependency}-${operation}-${timestamp}.txt`;

    const payload = [
      `Dependência: ${dependency}`,
      `Operação: ${operation}`,
      `Status: ${dependencyInstallLogStatus}`,
      `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
      "",
      ...dependencyInstallLogs,
    ].join("\n");

    const blob = new Blob([payload], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  async function startDependencyOperationSession(
    name: string,
    operation: DependencyOperationMode,
    viewMode: "terminal" | "logs",
    options?: DependencyInstallOptions,
  ): Promise<void> {
    const operationLabel = operation === "uninstall" ? "desinstalação" : "instalação";
    setDependencyOperationFeedback(null);

    if (operation === "install") {
      setInstallingDependency(name);
      setUninstallingDependency(null);
    } else {
      setUninstallingDependency(name);
      setInstallingDependency(null);
    }

    setDependencyInstallLogDependency(name);
    setDependencyLogOperation(operation);
    setDependencyInstallLogStatus("running");
    setDependencyInstallLogs([`[local] Iniciando sessão de ${operationLabel} para ${name}...`]);
    setShowDependencyInstallLogs(viewMode === "logs");

    setLoadingDependencies((prev) => {
      const next = new Set(prev);
      next.add(name);
      return next;
    });

    try {
      stopDependencyInstallPolling();

      if (viewMode === "terminal") {
        const terminalOpened = await openSystemTerminalForDependency(
          name,
          operation,
          false,
          options,
        );

        if (terminalOpened) {
          setDependencyInstallSessionId(null);
          setDependencyInstallLogStatus("idle");
          setDependencyInstallLogs([]);
          setShowDependencyInstallLogs(false);
          setDependencyOperationFeedback({
            kind: "success",
            message: `Comando de ${operationLabel} de ${name} enviado para o terminal externo.`,
          });
          clearDependencyLoading(name);
          if (operation === "install") {
            setInstallingDependency(null);
          } else {
            setUninstallingDependency(null);
          }
          void refreshDependencies(false);
          return;
        }

        setShowDependencyInstallLogs(true);
        setDependencyInstallLogs((prev) => [
          ...prev,
          "[local] Falha ao abrir terminal. Exibindo logs integrados.",
        ]);
      }

      const sessionStart =
        operation === "install"
          ? await startDependencyInstallSession(name, options)
          : await startDependencyUninstallSession(name);

      setDependencyInstallSessionId(sessionStart.sessionId);
      setDependencyInstallLogs((prev) => [
        ...prev,
        `[local] Sessão criada (${operation}): ${sessionStart.sessionId}`,
      ]);

      const shouldContinuePolling = await pollDependencyInstallSession(
        sessionStart.sessionId,
        name,
        operation,
      );

      if (shouldContinuePolling) {
        dependencyInstallPollRef.current = window.setInterval(() => {
          void pollDependencyInstallSession(sessionStart.sessionId, name, operation).catch(
            (pollError) => {
              console.error(
                `Failed to poll dependency ${operation} session for ${name}:`,
                pollError,
              );
              stopDependencyInstallPolling();
              setDependencyInstallLogStatus("failed");
              setDependencyInstallLogs((prev) => [
                ...prev,
                `[local] Falha ao consultar logs da sessão ${sessionStart.sessionId}.`,
              ]);
              void finalizeDependencyOperation(operation, name, "failed", {
                success: false,
                message: `Erro ao acompanhar ${operationLabel} de ${name}`,
                error: pollError instanceof Error ? pollError.message : String(pollError),
              });
            },
          );
        }, 1200);
      }
    } catch (error) {
      console.error(`Failed to start dependency ${operation} session for ${name}:`, error);
      stopDependencyInstallPolling();
      setDependencyInstallSessionId(null);
      setDependencyInstallLogStatus("failed");
      setDependencyInstallLogs((prev) => [
        ...prev,
        `[local] Não foi possível iniciar a sessão de ${operationLabel} de ${name}.`,
      ]);
      clearDependencyLoading(name);
      if (operation === "install") {
        setInstallingDependency(null);
      } else {
        setUninstallingDependency(null);
      }
      alert(
        `Erro ao iniciar ${operationLabel} de ${name}. Verifique permissões, PATH e conflitos de versão.`,
      );
    }
  }

  async function pollRenderOutputs(jobId: string) {
    try {
      const outputs = await listRenderOutputs(jobId);
      const outputsKey = outputs.join("|");
      if (outputsKey !== renderOutputsKeyRef.current) {
        renderOutputsKeyRef.current = outputsKey;
        setRenderOutputs(outputs);
        setRenderOutputsVersion((value) => value + 1);
      }

      const job = await getJob(jobId);
      updateVideo(jobId, { job });

      if (expectedRenderCount > 0 && outputs.length >= expectedRenderCount) {
        console.log(
          `[render] All expected renders completed (${outputs.length}/${expectedRenderCount})`,
        );
        stopRenderPolling();
        return;
      }

      if (job.status === "DONE" || job.status === "ERROR") {
        console.log(`[render] Job status is ${job.status}, stopping polling`);
        setRenderOutputsVersion((value) => value + 1);
        stopRenderPolling();
        return;
      }

      if (job.status !== "RENDERING") {
        console.log(`[render] Job status is ${job.status}, stopping polling`);
        setRenderOutputsVersion((value) => value + 1);
        stopRenderPolling();
        return;
      }

      // Check if polling has been running too long (2 hours)
      if (renderPollStartTimeRef.current) {
        const elapsedMs = Date.now() - renderPollStartTimeRef.current;
        const maxTimeMs = 2 * 60 * 60 * 1000; // 2 hours
        if (elapsedMs > maxTimeMs) {
          console.error(`[render] Render polling timeout after ${elapsedMs}ms`);
          setAction({
            busy: false,
            error: "Renderização demorou muito tempo. Processo foi cancelado.",
          });
          stopRenderPolling();
        }
      }
    } catch (error) {
      console.error("[render] Failed to poll outputs:", error);
    }
  }

  function startRenderPolling(jobId: string, totalCuts: number) {
    setExpectedRenderCount(totalCuts);
    setIsRendering(true);
    renderPollStartTimeRef.current = Date.now();

    if (renderPollRef.current) {
      window.clearInterval(renderPollRef.current);
    }

    void pollRenderOutputs(jobId);
    renderPollRef.current = window.setInterval(() => {
      void pollRenderOutputs(jobId);
    }, 2000);
  }

  async function pollTaskLogs(jobId: string, task: "transcription" | "render") {
    try {
      const result = await getJobLogs(jobId, task);
      setActiveTaskLogs(result.logs || []);
    } catch (error) {
      console.error("[logs] Failed to fetch task logs:", error);
    }
  }

  function startLogsPollingInterval(jobId: string, task: "transcription" | "render") {
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

  function startBatchPolling(batchId: string) {
    if (batchPollRef.current) {
      window.clearInterval(batchPollRef.current);
    }

    const pollBatch = async () => {
      try {
        const progress = await getBatchPipelineStatus(batchId);

        // Update current video index
        setCurrentBatchVideoIndex(progress.current_job_index);

        // Check if waiting for approval
        if (progress.waiting_for_approval) {
          setBatchWaitingForApproval(true);
          if (progress.pending_cuts) {
            setBatchPendingCuts(progress.pending_cuts);
          }

          const approvalLog = `Aguardando aprovação dos cortes do vídeo ${progress.current_job_index + 1}`;
          setBatchProcessingLogs((prev) => {
            if (prev[prev.length - 1] !== approvalLog) {
              return [...prev, approvalLog];
            }
            return prev;
          });
          return; // Don't update other logs while waiting
        } else {
          setBatchWaitingForApproval(false);
          setBatchPendingCuts([]);
        }

        // Generate log messages based on progress
        const stepLabels: Record<string, string> = {
          starting: "Iniciando...",
          transcription: "Transcrição",
          semantic_blocks: "Blocos Semânticos",
          analysis: "Análise com IA",
          rendering: "Renderização",
          completed: "Concluído",
          waiting_approval: "Aguardando aprovação",
        };

        const newLog = `Vídeo ${progress.current_job_index + 1} - ${stepLabels[progress.current_step] || progress.current_step}`;

        setBatchProcessingLogs((prev) => {
          // Avoid duplicate logs
          if (prev[prev.length - 1] !== newLog) {
            return [...prev, newLog];
          }
          return prev;
        });

        // Check if processing completed
        if (!progress.is_running) {
          stopBatchPolling();
          setIsBatchProcessing(false);
          setBatchWaitingForApproval(false);

          // Add summary
          const completionMessage = `Pipeline em Lote Concluído!\n\nSucesso: ${progress.completed_jobs.length}\nFalhas: ${progress.failed_jobs.length}`;

          setBatchProcessingLogs((prev) => [
            ...prev,
            "",
            `Processamento concluído!`,
            `   Sucesso: ${progress.completed_jobs.length}`,
            `   Falhas: ${progress.failed_jobs.length}`,
          ]);

          // List failed jobs if any
          if (progress.failed_jobs.length > 0) {
            setBatchProcessingLogs((prev) => [
              ...prev,
              "",
              "Jobs com falha:",
              ...progress.failed_jobs.map((f) => `   - ${f.job_id}: ${f.error}`),
            ]);
          }

          // Show completion notification
          setBatchCompletionMessage(completionMessage);
          setShowBatchCompletionNotification(true);

          // Refresh video list
          const activeVideos = await listVideos();
          setVideos(activeVideos.map(recordToVideoItem));
        }
      } catch (error: any) {
        console.error("[UI] Error polling batch status:", error);
        stopBatchPolling();
        setBatchProcessingLogs((prev) => [...prev, `Erro ao buscar status: ${error.message}`]);
        setIsBatchProcessing(false);
      }
    };

    // Poll immediately and then every 2 seconds
    pollBatch();
    batchPollRef.current = window.setInterval(pollBatch, 2000);
  }

  function stopBatchPolling() {
    if (batchPollRef.current) {
      window.clearInterval(batchPollRef.current);
      batchPollRef.current = null;
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

  function stopRenderPolling() {
    if (renderPollRef.current) {
      window.clearInterval(renderPollRef.current);
      renderPollRef.current = null;
    }
    renderPollStartTimeRef.current = null;
    setIsRendering(false);
  }

  // Ensure polling stops if isRendering becomes false externally
  useEffect(() => {
    if (isRendering === false && renderPollRef.current !== null) {
      console.log("[render] isRendering false but poll still running, stopping...");
      stopRenderPolling();
    }
  }, [isRendering]);

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

  // Helper to build render URL with cache busting
  function buildRenderUrl(renderPath: string): string {
    return buildRenderUrlUtil(renderPath, renderOutputsVersion);
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

  // Auto-scroll task logs to bottom when new logs arrive
  useEffect(() => {
    if (taskLogsContainerRef.current) {
      taskLogsContainerRef.current.scrollTop = taskLogsContainerRef.current.scrollHeight;
    }
  }, [activeTaskLogs]);

  // Auto-scroll ingest logs to bottom when new logs arrive
  useEffect(() => {
    if (ingestLogsContainerRef.current) {
      ingestLogsContainerRef.current.scrollTop = ingestLogsContainerRef.current.scrollHeight;
    }
  }, [ingestLogs]);

  useEffect(() => {
    return () => {
      if (renderPollRef.current) {
        window.clearInterval(renderPollRef.current);
      }
      if (logsPollRef.current) {
        window.clearInterval(logsPollRef.current);
      }
      if (ingestLogsPollRef.current) {
        window.clearInterval(ingestLogsPollRef.current);
      }
      if (batchPollRef.current) {
        window.clearInterval(batchPollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeVideoId || !activeTaskLogType) {
      stopLogsPolling();
      return;
    }

    const shouldPoll =
      activeTaskLogType === "transcription" ? Boolean(activeVideo?.isTranscribing) : isRendering;

    if (!shouldPoll) {
      stopLogsPolling();
      return;
    }

    if (!logsPollRef.current) {
      startLogsPollingInterval(activeVideoId, activeTaskLogType);
    }
  }, [activeVideoId, activeTaskLogType, activeVideo?.isTranscribing, isRendering]);

  // Fetch final logs when transcription or rendering completes
  useEffect(() => {
    if (
      activeVideoId &&
      activeTaskLogType === "transcription" &&
      activeVideo?.isTranscribing === false
    ) {
      // Transcription just finished - fetch final logs
      void pollTaskLogs(activeVideoId, "transcription");
    }
  }, [activeVideo?.isTranscribing, activeVideoId, activeTaskLogType]);

  // Fetch final logs when rendering completes
  useEffect(() => {
    if (activeVideoId && activeTaskLogType === "render" && isRendering === false) {
      // Rendering just finished - fetch final logs
      void pollTaskLogs(activeVideoId, "render");
    }
  }, [isRendering, activeVideoId, activeTaskLogType]);

  useEffect(() => {
    if (!ingestJobId || !isIngesting || uploadMode !== "url") {
      stopIngestLogsPolling();
      return;
    }

    if (!ingestLogsPollRef.current) {
      startIngestLogsPolling(ingestJobId);
    }
  }, [ingestJobId, isIngesting, uploadMode]);

  // Load render outputs when active video changes
  useEffect(() => {
    if (activeVideo?.job?.job_id) {
      renderOutputsKeyRef.current = "";
      setRenderOutputs([]);
      setIsLoadingRenderOutputs(true);
      console.log(`[UI] Set isLoadingRenderOutputs to true`);

      const startLoadTime = Date.now();

      pollRenderOutputs(activeVideo.job.job_id).finally(() => {
        // Ensure spinner shows for at least 500ms
        const elapsedTime = Date.now() - startLoadTime;
        const remainingTime = Math.max(0, 500 - elapsedTime);

        setTimeout(() => {
          console.log(
            `[UI] Set isLoadingRenderOutputs to false after ${elapsedTime + remainingTime}ms`,
          );
          setIsLoadingRenderOutputs(false);
        }, remainingTime);
      });
    }
  }, [activeVideo?.job?.job_id]);

  // Load cuts when active video changes
  useEffect(() => {
    if (activeVideo?.job?.job_id) {
      // Clear previous cuts immediately to avoid flashing old data
      console.log(`[UI] Loading cuts for video ${activeVideo.job.job_id}`);
      setCuts([]);
      setSuggestedCuts([]);
      setRenderOutputs([]);

      // Start loading new cuts
      setIsLoadingCuts(true);
      console.log(`[UI] Set isLoadingCuts to true`);

      const startLoadTime = Date.now();

      listCuts(activeVideo.job.job_id)
        .then((loadedCuts) => {
          console.log(`[UI] Loaded ${loadedCuts.length} cuts for video ${activeVideo.job.job_id}`);
          setCuts(loadedCuts);
          setSuggestedCuts(loadedCuts);
        })
        .catch((error) => {
          console.error("Failed to load cuts:", error);
          setCuts([]);
          setSuggestedCuts([]);
        })
        .finally(() => {
          // Ensure spinner shows for at least 500ms
          const elapsedTime = Date.now() - startLoadTime;
          const remainingTime = Math.max(0, 500 - elapsedTime);

          setTimeout(() => {
            console.log(`[UI] Set isLoadingCuts to false after ${elapsedTime + remainingTime}ms`);
            setIsLoadingCuts(false);
          }, remainingTime);
        });
    }
  }, [activeVideo?.job?.job_id]);

  function normalizeCutIds(existing: Cut[], incoming: Cut[]): Cut[] {
    const idSet = new Set(existing.map((cut) => cut.cut_id));
    let maxId = existing.reduce((max, cut) => {
      const match = /^c(\d+)$/.exec(cut.cut_id);
      if (!match) return max;
      return Math.max(max, Number(match[1]));
    }, 0);

    return incoming.map((cut) => {
      let nextId = cut.cut_id;
      if (idSet.has(nextId)) {
        maxId += 1;
        nextId = `c${maxId}`;
      }
      idSet.add(nextId);
      return { ...cut, cut_id: nextId };
    });
  }

  function handleAnalyzeResult(value: unknown, keptCuts: Cut[] = []) {
    const payload = Array.isArray(value)
      ? { cuts: value as Cut[] }
      : (value as { cuts: Cut[]; raw_response?: string });
    const nextCuts = payload.cuts || [];
    const rawResponse = typeof payload.raw_response === "string" ? payload.raw_response : null;
    const normalizedNewCuts = keptCuts.length > 0 ? normalizeCutIds(keptCuts, nextCuts) : nextCuts;
    const finalCuts = keptCuts.length > 0 ? [...keptCuts, ...normalizedNewCuts] : normalizedNewCuts;

    console.log(`[UI] Análise completada, ${finalCuts.length} cortes encontrados`);
    setCuts(finalCuts);
    setSuggestedCuts(finalCuts);
    setSelectedSuggestedCutId(null);
    setAiResponseRaw(rawResponse);
    if (showAiResponseOnAnalyze && rawResponse) {
      setShowAiResponseDialog(true);
    }
    // Sync with backend immediately
    if (activeVideo) {
      void updateCuts(activeVideo.job.job_id, finalCuts).catch((error) => {
        console.error("Failed to sync cuts:", error);
      });
    }
    refreshVideo(activeVideo!.job.job_id);
  }

  async function hydrateTranscriptions(
    items: VideoItem[],
    updater: (jobId: string, updates: Partial<VideoItem>) => void,
  ) {
    await Promise.all(
      items.map(async (item) => {
        try {
          const result = await getTranscription(item.job.job_id);
          if (result?.transcription) {
            updater(item.job.job_id, {
              transcription: result.transcription,
              transcriptionSegments: result.segments as unknown as Segment[],
              transcriptionFormats: result.available_formats,
            });
          }
        } catch (error: any) {
          const message = error?.message || "";
          if (!String(message).includes("Transcription not found")) {
            console.warn(`[UI] Não foi possível carregar transcrição: ${message}`);
          }
        }
      }),
    );
  }

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

  function startTranscriptionFlow() {
    if (!activeVideo) {
      return;
    }

    console.log(`[UI] Iniciando transcrição do video ${activeVideo.job.job_id}`);
    setShowTranscriptionFormatListDialog(false);
    setShowTranscriptionContentDialog(false);
    setShowTranscriptionDeleteDialog(false);
    setShowTranscriptionRegenerateConfirmDialog(false);
    setShowBlocksDialog(false);
    setSelectedTranscriptionFormat(null);
    setPendingDeleteFormat(null);
    setSelectedSuggestedCutId(null);
    setBlocks([]);
    setSuggestedCuts([]);
    setActiveTaskLogType("transcription");
    setActiveTaskLogs([]);
    setExpandTaskLogs(false);
    stopLogsPolling();
    updateVideo(activeVideo.job.job_id, {
      isTranscribing: true,
      transcriptionLogs: [],
      transcription: "",
      transcriptionSegments: [],
      transcriptionFormats: undefined,
    });

    return runAction(
      async () => {
        if (hasAnyTranscription) {
          await deleteTranscription(activeVideo.job.job_id, "all");
        }
        return transcribeJob(activeVideo.job.job_id);
      },
      (result: any) => {
        console.log(`[UI] Transcrição completada`);
        updateVideo(activeVideo.job.job_id, {
          transcription: result.transcription,
          transcriptionSegments: result.segments,
          transcriptionFormats: result.available_formats,
          isTranscribing: false,
        });
        refreshVideo(activeVideo.job.job_id);
      },
    );
  }

  async function deleteSuggestedCut(cutId: string) {
    const newSuggestedCuts = suggestedCuts.filter((item) => item.cut_id !== cutId);
    const newCuts = cuts.filter((item) => item.cut_id !== cutId);

    setSuggestedCuts(newSuggestedCuts);
    setCuts(newCuts);

    if (activeVideo) {
      try {
        await updateCuts(activeVideo.job.job_id, newCuts);
      } catch (error) {
        console.error("Failed to update cuts:", error);
      }
    }

    if (selectedSuggestedCutId === cutId) {
      setSelectedSuggestedCutId(null);
      videoRef.current?.pause();
    }

    setHoveredCutId(null);
  }

  function requestDeleteSuggestedCut(cutId: string) {
    const shouldAsk = appSettings?.preferences?.ask_delete_cut_confirm ?? true;
    if (!shouldAsk) {
      void deleteSuggestedCut(cutId);
      return;
    }

    setPendingDeleteCutId(cutId);
    setDontAskDeleteCutAgain(false);
    setShowDeleteCutConfirmDialog(true);
  }

  async function confirmDeleteSuggestedCut() {
    if (!pendingDeleteCutId) {
      setShowDeleteCutConfirmDialog(false);
      return;
    }

    if (dontAskDeleteCutAgain) {
      try {
        const updated = await saveSettings({
          preferences: {
            ask_move_on_upload: appSettings?.preferences?.ask_move_on_upload ?? true,
            move_uploads: appSettings?.preferences?.move_uploads ?? false,
            ask_delete_cut_confirm: false,
          },
        });
        setAppSettings(updated);
      } catch (error) {
        console.error("Failed to update delete-cut confirmation preference:", error);
      }
    }

    const cutId = pendingDeleteCutId;
    setPendingDeleteCutId(null);
    setShowDeleteCutConfirmDialog(false);
    setDontAskDeleteCutAgain(false);
    await deleteSuggestedCut(cutId);
  }

  function loadCutsForVideo(jobId: string) {
    return runAction(
      () => listCuts(jobId),
      (value) => {
        setCuts(value);
        setSuggestedCuts(value);
      },
    );
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
    setSuggestedCuts([]);
    setSelectedSuggestedCutId(null);
    setAiResponseRaw(null);
    setShowAiResponseDialog(false);
    setHoveredCutId(null);
    setActiveTaskLogs([]);
    setActiveTaskLogType(null);
    setExpandTaskLogs(false);
    stopLogsPolling();
    if (activeVideoId) {
      loadCutsForVideo(activeVideoId);
    } else {
      setCuts([]);
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
    setLlmModel(configuredModel);
    setOllamaModels((prev) => mergeModelOptions(prev, [configuredModel]));
    if (configuredModel) {
      setOllamaModelCatalog((prev) =>
        mergeOllamaCatalog(prev, [
          {
            name: configuredModel,
            source: "local",
            installed: true,
            running: false,
            needsDownload: false,
          },
        ]),
      );
    }
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

  async function saveLLMConfig(model: string, prompt: string) {
    try {
      const response = await saveToolConfigs({
        llm: {
          model,
          system_prompt: prompt,
        },
      });
      applyToolConfigs(response);
      console.log("[UI] Configurações do LLM salvas");
      setShowLLMConfigDialog(false);
    } catch (error) {
      console.error("[UI] Erro ao salvar configurações do LLM:", error);
    }
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
        await refreshOllamaModelOptions(toolConfigs.active.llm.model, false);
      } catch (error) {
        console.error("Failed to load tool configs:", error);
      }

      try {
        const depsData = await getDependencies();
        setDependencies(depsData.dependencies);
      } catch (error) {
        console.error("Failed to load dependencies:", error);
      }

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
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">YouTube Shorts MVP</p>
          <h1>Pipeline local</h1>
          <p className="sub">
            Interface leve para orquestrar ingestão, transcrição, análise e renderização.
          </p>
        </div>
      </header>

      {/* Configurações */}
      <ConfigurationSection
        onConfigureApp={() => setShowConfigureAppDialog(true)}
        onManageDependencies={async () => {
          setShowDependenciesDialog(true);
          setDependencyOperationFeedback(null);
          setDependencies(null);
          setRefreshingDependencies(false);
          setLoadingDependencies(new Set());
          stopDependencyInstallPolling();
          setDependencyInstallSessionId(null);
          setDependencyInstallLogs([]);
          setDependencyInstallLogDependency(null);
          setDependencyLogOperation(null);
          setDependencyInstallLogStatus("idle");
          setShowDependencyInstallLogs(false);
          setInstallingDependency(null);
          setUninstallingDependency(null);
          const loaded = await refreshDependencies(false);

          if (!loaded) {
            setDependencies({
              python: { installed: false, version: null },
              whisper: { installed: false, version: null },
              ffmpeg: { installed: false, version: null },
              cuda: { installed: false, version: null },
              pytorch: { installed: false, version: null },
              ollama: { installed: false, version: null },
            });
          }

          setLoadingDependencies(new Set());
        }}
        onConfigureLLM={() => {
          setShowLLMConfigDialog(true);
          void refreshOllamaModelOptions(llmModel, false);
        }}
        onConfigureWhisper={() => setShowWhisperConfigDialog(true)}
        onConfigureFFmpeg={() => setShowFFmpegConfigDialog(true)}
      />

      {/* 1. Upload Section */}
      <UploadSection
        action={action}
        onVideoAdded={(video) => {
          upsertVideoIntoList(video);
        }}
        onLoadVideos={loadVideos}
        appSettings={appSettings}
        onShowMoveUploadDialog={() => {
          setDontAskMoveUpload(false);
          setShowMoveUploadDialog(true);
        }}
        isExpanded={expandUploadSection}
        onToggle={() => setExpandUploadSection((current) => !current)}
      />

      {/* 2. Video List */}
      <VideoListSection
        videos={videos}
        archivedVideos={archivedVideos}
        activeVideoId={activeVideoId}
        videoView={videoView}
        action={action}
        onSelectVideo={(videoId) => {
          if (videoId === null) {
            console.log(`[UI] Vídeo desmarcado`);
            setActiveVideoId(null);
          } else {
            const validation = canStartOperation(videoId);
            if (!validation.allowed) {
              console.warn(`[UI] ${validation.message}`);
              alert(validation.message);
              return;
            }
            const video = videos.find((v) => v.job.job_id === videoId);
            console.log(`\n[UI] Vídeo selecionado:`);
            console.log(`[UI]   Job ID: ${videoId}`);
            console.log(`[UI]   Video Path: ${video?.videoPath}`);
            console.log(`[UI]   Status: ${video?.job.status}`);
            console.log(`[UI]   URL completa: ${apiBaseUrl}${video?.videoPath}`);
            setActiveVideoId(videoId);
          }
        }}
        onSetView={setView}
        onLoadVideos={loadVideos}
        onShowRenameDialog={(videoId, currentName) => {
          setRenameVideoId(videoId);
          setRenameVideoNewName(currentName);
        }}
        onRunAction={runAction}
        isExpanded={expandVideoListSection}
        onToggle={() => setExpandVideoListSection((current) => !current)}
      />
      {/* 3. Video Player */}
      {activeVideo && (
        <div className="panel" style={{ marginBottom: "24px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "16px",
            }}
          >
            <h2 style={{ margin: 0, flex: 1 }}>3. Vídeo selecionado</h2>
            <button
              onClick={() => setExpandVideoPlayerSection(!expandVideoPlayerSection)}
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "0",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--muted)",
              }}
              title={expandVideoPlayerSection ? "Recolher" : "Expandir"}
            >
              <i
                className="material-icons"
                style={{
                  transform: expandVideoPlayerSection ? "rotate(0deg)" : "rotate(180deg)",
                  transition: "transform 0.3s ease",
                }}
              >
                keyboard_arrow_down
              </i>
            </button>
          </div>
          {expandVideoPlayerSection && (
            <>
              <div className="video-player-container">
                {activeVideo.videoPath ? (
                  <>
                    <div className="video-player-wrapper">
                      <video
                        key={`video-${activeVideo.job.job_id}`}
                        ref={videoRef}
                        controls
                        width="100%"
                        src={`${apiBaseUrl}${activeVideo.videoPath}`}
                        className="video-player"
                        onLoadStart={() => {
                          console.log(`\n[video] Iniciando carregamento do vídeo:`);
                          console.log(`[video]   Job ID: ${activeVideo.job.job_id}`);
                          console.log(`[video]   Video Path: ${activeVideo.videoPath}`);
                          console.log(
                            `[video]   URL completa: ${apiBaseUrl}${activeVideo.videoPath}`,
                          );
                        }}
                        onError={(e) => {
                          console.error(`\n[video] ERRO ao carregar vídeo:`);
                          console.error(`[video]   Job ID: ${activeVideo.job.job_id}`);
                          console.error(`[video]   Video Path: ${activeVideo.videoPath}`);
                          console.error(
                            `[video]   URL tentada: ${apiBaseUrl}${activeVideo.videoPath}`,
                          );
                          console.error(`[video]   Erro completo:`, e);
                          console.error(`[video]   Event type: ${e.type}`);
                          if (e.target instanceof HTMLVideoElement) {
                            console.error(`[video]   Video networkState: ${e.target.networkState}`);
                            console.error(`[video]   Video readyState: ${e.target.readyState}`);
                            console.error(`[video]   Video error code: ${e.target.error?.code}`);
                            console.error(
                              `[video]   Video error message: ${e.target.error?.message}`,
                            );
                          }
                        }}
                        onLoadedMetadata={() => {
                          console.log(`[video] Metadados carregados com sucesso`);
                        }}
                        onCanPlay={() => {
                          console.log(`[video] Vídeo pronto para reproduzir`);
                        }}
                      />
                    </div>

                    {/* Batch Processing Logs */}
                    {isBatchProcessing && batchProcessingLogs.length > 0 && (
                      <div className="batch-logs">
                        <h4 className="batch-logs-title">Logs do Pipeline em Lote</h4>
                        <div className="batch-logs-content">
                          {batchProcessingLogs.map((log, idx) => (
                            <div key={idx}>{log}</div>
                          ))}
                        </div>
                      </div>
                    )}

                    {activeTaskLogType && (
                      <div className="log-container">
                        <div className="log-header">
                          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <span>
                              {activeTaskLogType === "transcription"
                                ? "Logs da transcrição"
                                : "Logs da renderização"}
                            </span>
                            {activeTaskLogType === "transcription" &&
                              activeVideo?.isTranscribing && (
                                <button
                                  className="cancel-button"
                                  onClick={async () => {
                                    console.log(
                                      `[UI] Cancelando transcrição: ${activeVideo.job.job_id}`,
                                    );
                                    try {
                                      await cancelTranscription(activeVideo.job.job_id);
                                      updateVideo(activeVideo.job.job_id, {
                                        isTranscribing: false,
                                      });
                                      stopLogsPolling();
                                      console.log(`[UI] Transcrição cancelada`);
                                    } catch (error) {
                                      console.error("[UI] Erro ao cancelar transcrição:", error);
                                    }
                                  }}
                                >
                                  ⊗ Cancelar
                                </button>
                              )}
                            {activeTaskLogType === "render" && isRendering && (
                              <button
                                className="cancel-button"
                                onClick={async () => {
                                  console.log(
                                    `[UI] Cancelando renderização: ${activeVideo.job.job_id}`,
                                  );
                                  try {
                                    await cancelRendering(activeVideo.job.job_id);
                                    setIsRendering(false);
                                    stopRenderPolling();
                                    stopLogsPolling();
                                    console.log(`[UI] Renderização cancelada`);
                                  } catch (error) {
                                    console.error("[UI] Erro ao cancelar renderização:", error);
                                  }
                                }}
                              >
                                ⊗ Cancelar
                              </button>
                            )}
                          </div>
                          <button
                            className="secondary log-toggle-button"
                            onClick={() => setExpandTaskLogs((current) => !current)}
                          >
                            {expandTaskLogs ? "Mostrar menos" : "Mostrar mais"}
                          </button>
                        </div>
                        <div
                          ref={taskLogsContainerRef}
                          className={expandTaskLogs ? "log-content expanded" : "log-content"}
                        >
                          {(expandTaskLogs ? activeTaskLogs : activeTaskLogs.slice(-2)).length === 0
                            ? "Aguardando logs..."
                            : (expandTaskLogs ? activeTaskLogs : activeTaskLogs.slice(-2)).map(
                                (line, index) => <div key={`${index}-${line}`}>{line}</div>,
                              )}
                        </div>
                      </div>
                    )}
                    <div className="action-cards-grid">
                      <ActionCard description="Abre a transcrição nos formatos disponíveis.">
                        <button
                          disabled={!hasAnyTranscription}
                          onClick={() => setShowTranscriptionFormatListDialog(true)}
                          className="config-card-button blue"
                          style={{
                            cursor: hasAnyTranscription ? "pointer" : "not-allowed",
                            opacity: hasAnyTranscription ? 1 : 0.5,
                          }}
                        >
                          Visualizar transcrição
                        </button>
                      </ActionCard>
                      <ActionCard description="Gera ou recria a transcrição do vídeo.">
                        <button
                          disabled={action.busy}
                          className="config-card-button green"
                          style={{
                            cursor: action.busy ? "not-allowed" : "pointer",
                            opacity: action.busy ? 0.5 : 1,
                          }}
                          onClick={() => {
                            // Check if another video is being transcribed/rendered
                            const validation = canStartOperation(activeVideo.job.job_id);
                            if (!validation.allowed) {
                              console.warn(`[UI] ${validation.message}`);
                              alert(validation.message);
                              return;
                            }

                            if (hasAnyTranscription) {
                              setShowTranscriptionRegenerateConfirmDialog(true);
                              return;
                            }

                            return startTranscriptionFlow();
                          }}
                        >
                          {activeVideo.isTranscribing
                            ? "Transcrevendo..."
                            : hasAnyTranscription
                              ? "Gerar nova transcrição"
                              : "Transcrever"}
                        </button>
                      </ActionCard>
                      <ActionCard description="Agrupa a transcrição em blocos semânticos.">
                        <button
                          disabled={!hasAnyTranscription}
                          className="config-card-button purple"
                          onClick={() =>
                            runAction(
                              () => buildBlocks(activeVideo.job.job_id),
                              (value) => {
                                setBlocks(value);
                                setShowBlocksDialog(true);
                                refreshVideo(activeVideo.job.job_id);
                              },
                            )
                          }
                        >
                          Blocos
                        </button>
                      </ActionCard>
                      <div className="action-card">
                        <button
                          disabled={
                            isAnalyzing ||
                            (!hasAnyTranscription && !hasAnyBlocks && suggestedCuts.length === 0)
                          }
                          className="config-card-button orange"
                          onClick={() => {
                            if (suggestedCuts.length > 0) {
                              setShowRegenerateAnalyzeDialog(true);
                              return;
                            }

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
                        >
                          {isAnalyzing
                            ? "Analisando..."
                            : suggestedCuts.length > 0
                              ? "Gerar nova análise"
                              : "Análise"}
                        </button>
                        <p className="config-card-description">
                          Analisa com IA para encontrar hooks.
                        </p>
                        <div className="checkbox-container">
                          <input
                            type="checkbox"
                            checked={showAiResponseOnAnalyze}
                            onChange={(event) => setShowAiResponseOnAnalyze(event.target.checked)}
                          />
                          <span style={{ fontSize: "0.85rem" }}>exibir resultado da IA</span>
                        </div>
                      </div>
                      <div className="action-card">
                        <button
                          disabled={cuts.length === 0 || isRendering}
                          className="config-card-button pink"
                          onClick={() => {
                            // Check if another video is being transcribed/rendered
                            const validation = canStartOperation(activeVideo.job.job_id);
                            if (!validation.allowed) {
                              console.warn(`[UI] ${validation.message}`);
                              alert(validation.message);
                              return;
                            }

                            return runAction(
                              async () => {
                                // Sync cuts with backend before rendering
                                await updateCuts(activeVideo.job.job_id, cuts);
                                return renderJob(activeVideo.job.job_id);
                              },
                              () => {
                                console.log(`[UI] Renderização iniciada`);
                                setActiveTaskLogType("render");
                                setActiveTaskLogs([]);
                                setExpandTaskLogs(false);
                                stopLogsPolling();
                                setRenderOutputs([]);
                                startRenderPolling(activeVideo.job.job_id, suggestedCuts.length);
                              },
                            );
                          }}
                        >
                          {isRendering ? "Renderizando..." : "Renderizar"}
                        </button>
                        {isRendering && (
                          <p
                            className="muted"
                            style={{ marginTop: "8px", fontSize: "0.8rem", textAlign: "center" }}
                          >
                            Gerando cortes: {renderOutputs.length}/{expectedRenderCount || "?"}
                          </p>
                        )}
                        <p className="config-card-description">
                          Renderiza os cortes em vídeos verticals.
                        </p>
                      </div>
                      <div className="action-card">
                        <button
                          className="config-card-button green"
                          onClick={() => {
                            setNewCutStartMinutes("");
                            setNewCutStartSeconds("");
                            setNewCutEndMinutes("");
                            setNewCutEndSeconds("");
                            setShowAddManualCutDialog(true);
                          }}
                        >
                          Adicionar Corte Manual
                        </button>
                        <p className="config-card-description">
                          Cria um corte com timestamps específicos.
                        </p>
                      </div>
                      <div className="action-card">
                        <button
                          className="config-card-button indigo"
                          onClick={() => {
                            setSelectedVideosForBatch([]);
                            setBatchPipelineOptions({
                              transcription: true,
                              analysis: false,
                              render: false,
                              preApprove: false,
                            });
                            setBatchProcessingLogs([]);
                            setShowBatchPipelineDialog(true);
                          }}
                        >
                          Pipeline em Lote
                        </button>
                        <p className="config-card-description">
                          Processa múltiplos vídeos sequencialmente.
                        </p>
                      </div>
                    </div>
                    {isLoadingCuts && (
                      <div className="loading-container">
                        <div className="spinner" />
                        <span style={{ fontSize: "0.9rem" }}>Carregando cortes...</span>
                      </div>
                    )}
                    {suggestedCuts.length > 0 && (
                      <div style={{ marginTop: "20px" }}>
                        <p style={{ marginBottom: "12px", fontWeight: "600" }}>
                          Cortes sugeridos ({suggestedCuts.length}):
                        </p>

                        {/* Botão Continuar Pipeline (aparece se estiver aguardando aprovação) */}
                        {batchWaitingForApproval && activeBatchId && (
                          <div style={{ marginBottom: "16px", textAlign: "center" }}>
                            <button
                              className="secondary"
                              onClick={async () => {
                                try {
                                  await continueBatchPipeline(activeBatchId);
                                  setBatchWaitingForApproval(false);
                                  setBatchPendingCuts([]);
                                  setBatchProcessingLogs((prev) => [
                                    ...prev,
                                    "Cortes aprovados, continuando pipeline...",
                                  ]);
                                } catch (error: any) {
                                  console.error("[UI] Error continuing batch pipeline:", error);
                                  setBatchProcessingLogs((prev) => [
                                    ...prev,
                                    `Erro ao continuar: ${error.message}`,
                                  ]);
                                }
                              }}
                            >
                              Continuar Pipeline
                            </button>
                          </div>
                        )}

                        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                          {suggestedCuts.map((cut) => (
                            <div
                              key={cut.cut_id}
                              style={{ position: "relative", display: "inline-flex" }}
                            >
                              <button
                                className="cut-timestamp-btn"
                                onClick={() => {
                                  setSelectedSuggestedCutId(cut.cut_id);
                                  if (videoRef.current) {
                                    videoRef.current.currentTime = cut.start;
                                    videoRef.current.play();
                                  }
                                }}
                                style={{
                                  padding: "8px 12px",
                                  backgroundColor:
                                    selectedSuggestedCutId === cut.cut_id
                                      ? "var(--bg-3)"
                                      : "var(--bg-contrast)",
                                  color:
                                    selectedSuggestedCutId === cut.cut_id
                                      ? "var(--ink)"
                                      : "var(--muted)",
                                  border: "none",
                                  borderRadius: "8px",
                                  cursor: "pointer",
                                  fontSize: "0.85em",
                                  fontWeight: selectedSuggestedCutId === cut.cut_id ? "600" : "400",
                                  paddingRight: "56px",
                                }}
                              >
                                {formatTimestamp(cut.start)} - {formatTimestamp(cut.end)}
                              </button>
                              <div
                                style={{
                                  position: "absolute",
                                  right: "6px",
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  display: "flex",
                                  alignItems: "center",
                                  gap: "6px",
                                }}
                              >
                                <button
                                  className="icon-btn"
                                  onClick={() => {
                                    const startMin = Math.floor(cut.start / 60);
                                    const startSec = Math.round(cut.start % 60);
                                    const endMin = Math.floor(cut.end / 60);
                                    const endSec = Math.round(cut.end % 60);

                                    setEditingCutId(cut.cut_id);
                                    setEditCutStart(formatTimestamp(cut.start));
                                    setEditCutEnd(formatTimestamp(cut.end));
                                    setEditCutStartMinutes(String(startMin).padStart(2, "0"));
                                    setEditCutStartSeconds(String(startSec).padStart(2, "0"));
                                    setEditCutEndMinutes(String(endMin).padStart(2, "0"));
                                    setEditCutEndSeconds(String(endSec).padStart(2, "0"));
                                    setShowCutEditDialog(true);
                                  }}
                                  onMouseEnter={() => {
                                    setHoveredCutId(cut.cut_id);
                                    setHoveredCutAction("edit");
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredCutId(null);
                                    setHoveredCutAction(null);
                                  }}
                                  style={{
                                    width: "14px",
                                    height: "14px",
                                    borderRadius: "4px",
                                    background: "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                    padding: 0,
                                    fontSize: "12px",
                                    lineHeight: "14px",
                                    color:
                                      hoveredCutId === cut.cut_id && hoveredCutAction === "edit"
                                        ? "var(--accent-2)"
                                        : "var(--muted)",
                                  }}
                                  aria-label="Editar timestamp"
                                >
                                  <span
                                    className="material-icons"
                                    aria-hidden="true"
                                    style={{ fontSize: "12px", lineHeight: 1 }}
                                  >
                                    edit
                                  </span>
                                </button>
                                <button
                                  className="icon-btn"
                                  onClick={() => requestDeleteSuggestedCut(cut.cut_id)}
                                  onMouseEnter={() => {
                                    setHoveredCutId(cut.cut_id);
                                    setHoveredCutAction("delete");
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredCutId(null);
                                    setHoveredCutAction(null);
                                  }}
                                  style={{
                                    width: "14px",
                                    height: "14px",
                                    borderRadius: "4px",
                                    background: "transparent",
                                    border: "none",
                                    cursor: "pointer",
                                    padding: 0,
                                    fontSize: "12px",
                                    lineHeight: "14px",
                                    color:
                                      hoveredCutId === cut.cut_id && hoveredCutAction === "delete"
                                        ? "var(--danger)"
                                        : "var(--muted)",
                                  }}
                                  aria-label="Deletar timestamp"
                                >
                                  <span
                                    className="material-icons"
                                    aria-hidden="true"
                                    style={{ fontSize: "12px", lineHeight: 1 }}
                                  >
                                    delete
                                  </span>
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="loading-placeholder">
                    <p>Aguardando download do vídeo...</p>
                    <progress />
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Transcription Format List */}
      {showTranscriptionRegenerateConfirmDialog && (
        <AppDialog
          title="Confirmar nova transcrição"
          onClose={() => setShowTranscriptionRegenerateConfirmDialog(false)}
          showHeaderClose={false}
          footer={
            <div className="ds-dialog-actions">
              <AppButton
                variant="primary"
                onClick={() => setShowTranscriptionRegenerateConfirmDialog(false)}
              >
                Cancelar
              </AppButton>
              <AppButton variant="secondary" onClick={() => void startTranscriptionFlow()}>
                Continuar
              </AppButton>
            </div>
          }
        >
          <p>Isso irá apagar sua transcrição atual, deseja continuar?</p>
        </AppDialog>
      )}

      {showDeleteCutConfirmDialog && (
        <AppDialog
          title="Confirmar exclusão"
          onClose={() => {
            setShowDeleteCutConfirmDialog(false);
            setPendingDeleteCutId(null);
            setDontAskDeleteCutAgain(false);
          }}
          showHeaderClose={false}
          footer={
            <div className="ds-dialog-actions">
              <AppButton
                variant="primary"
                onClick={() => {
                  setShowDeleteCutConfirmDialog(false);
                  setPendingDeleteCutId(null);
                  setDontAskDeleteCutAgain(false);
                }}
              >
                Cancelar
              </AppButton>
              <AppButton variant="secondary" onClick={() => void confirmDeleteSuggestedCut()}>
                Apagar
              </AppButton>
            </div>
          }
        >
          <p>Deseja realmente apagar o corte?</p>
          <AppCheckboxField
            label="Não exibir essa mensagem novamente"
            checked={dontAskDeleteCutAgain}
            onChange={setDontAskDeleteCutAgain}
            compact
            marginTop="12px"
          />
        </AppDialog>
      )}

      {/* Transcription Format List */}
      {showTranscriptionFormatListDialog && activeVideo && (
        <TranscriptionFormatListDialog
          activeVideoHasText={Boolean(activeVideo.transcription)}
          activeVideoHasVtt={Boolean(activeVideo.transcriptionFormats?.vtt)}
          activeVideoHasSegments={Boolean(activeVideo.transcriptionSegments?.length)}
          onSelectFormat={(format) => {
            setSelectedTranscriptionFormat(format);
            setShowTranscriptionContentDialog(true);
          }}
          onClose={() => setShowTranscriptionFormatListDialog(false)}
        />
      )}

      {/* Transcription Content Dialog */}
      {showTranscriptionContentDialog && transcriptionContent && (
        <TranscriptionContentDialog
          title={transcriptionContent.title}
          content={transcriptionContent.content}
          selectedFormat={selectedTranscriptionFormat || "text"}
          onClose={() => setShowTranscriptionContentDialog(false)}
          onDelete={(format) => {
            setPendingDeleteFormat(format);
            setShowTranscriptionDeleteDialog(true);
          }}
        />
      )}

      {showTranscriptionDeleteDialog && pendingDeleteFormat && activeVideo && (
        <TranscriptionDeleteDialog
          pendingDeleteFormat={pendingDeleteFormat}
          action={action}
          onCancel={() => {
            setShowTranscriptionDeleteDialog(false);
            setPendingDeleteFormat(null);
          }}
          onConfirm={(format) =>
            runAction(
              () => deleteTranscription(activeVideo.job.job_id, format),
              (result: any) => {
                const formats = result?.available_formats;
                const nextFormats = formats
                  ? {
                      segments: Boolean(formats.segments),
                      text: Boolean(formats.text),
                      vtt: Boolean(formats.vtt),
                    }
                  : undefined;
                const nextTranscription =
                  nextFormats && nextFormats.text === false ? "" : activeVideo.transcription;

                updateVideo(activeVideo.job.job_id, {
                  transcription: nextTranscription,
                  transcriptionSegments:
                    format === "segments" && nextFormats?.segments === false
                      ? []
                      : activeVideo.transcriptionSegments,
                  transcriptionFormats: nextFormats,
                });
                if (format === selectedTranscriptionFormat) {
                  setShowTranscriptionContentDialog(false);
                }
                setShowTranscriptionDeleteDialog(false);
                setPendingDeleteFormat(null);
              },
            )
          }
        />
      )}

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

      {/* Edit Cut Dialog */}
      {showCutEditDialog && editingCutId && (
        <TimestampDialog
          mode="edit"
          initialStartMinutes={editCutStartMinutes}
          initialStartSeconds={editCutStartSeconds}
          initialEndMinutes={editCutEndMinutes}
          initialEndSeconds={editCutEndSeconds}
          onClose={() => {
            setShowCutEditDialog(false);
            setEditingCutId(null);
            setEditCutStartMinutes("");
            setEditCutStartSeconds("");
            setEditCutEndMinutes("");
            setEditCutEndSeconds("");
          }}
          onSave={async (startValue, endValue) => {
            const newSuggestedCuts = suggestedCuts.map((item) =>
              item.cut_id === editingCutId ? { ...item, start: startValue, end: endValue } : item,
            );
            const newCuts = cuts.map((item) =>
              item.cut_id === editingCutId ? { ...item, start: startValue, end: endValue } : item,
            );

            setSuggestedCuts(newSuggestedCuts);
            setCuts(newCuts);

            if (activeVideo) {
              try {
                await updateCuts(activeVideo.job.job_id, newCuts);
              } catch (error) {
                console.error("Failed to update cuts:", error);
              }
            }

            setSelectedSuggestedCutId(editingCutId);
            if (videoRef.current) {
              videoRef.current.currentTime = startValue;
              videoRef.current.play();
            }
            setShowCutEditDialog(false);
            setEditingCutId(null);
            setEditCutStartMinutes("");
            setEditCutStartSeconds("");
            setEditCutEndMinutes("");
            setEditCutEndSeconds("");
          }}
        />
      )}

      {/* Add Manual Cut Dialog */}
      {showAddManualCutDialog && (
        <TimestampDialog
          mode="add"
          onClose={() => {
            setShowAddManualCutDialog(false);
            setNewCutStartMinutes("");
            setNewCutStartSeconds("");
            setNewCutEndMinutes("");
            setNewCutEndSeconds("");
          }}
          onSave={async (startValue, endValue) => {
            const newCutId = `manual_${Date.now()}`;
            const newCut: Cut = {
              cut_id: newCutId,
              block_ids: [],
              start: startValue,
              end: endValue,
              status: "approved",
              hook_reason: "Corte adicionado manualmente",
              content_reason: "Corte adicionado manualmente",
            };

            const newSuggestedCuts = [...suggestedCuts, newCut];
            const newCuts = [...cuts, newCut];

            setSuggestedCuts(newSuggestedCuts);
            setCuts(newCuts);

            if (activeVideo) {
              try {
                await updateCuts(activeVideo.job.job_id, newCuts);
              } catch (error) {
                console.error("Failed to update cuts:", error);
              }
            }

            setSelectedSuggestedCutId(newCutId);
            if (videoRef.current) {
              videoRef.current.currentTime = startValue;
              videoRef.current.play();
            }
            setShowAddManualCutDialog(false);
            setNewCutStartMinutes("");
            setNewCutStartSeconds("");
            setNewCutEndMinutes("");
            setNewCutEndSeconds("");
          }}
        />
      )}

      {/* 4. Rendering Section */}
      <RenderingSection
        isLoadingRenderOutputs={isLoadingRenderOutputs}
        isRendering={isRendering}
        renderOutputs={renderOutputs}
        buildRenderUrl={buildRenderUrl}
        onOpenRenderFolder={async (fileName) => {
          if (!activeVideo) {
            throw new Error("Nenhum vídeo selecionado");
          }
          await runAction(() => openRenderFolder(activeVideo.job.job_id, fileName));
        }}
        onDeleteRender={async (fileName) => {
          if (activeVideo) {
            await deleteRenderOutput(activeVideo.job.job_id, fileName);
            setRenderOutputs((current) => current.filter((path) => !path.endsWith(fileName)));
          }
        }}
        isExpanded={expandRenderingSection}
        onToggle={() => setExpandRenderingSection((current) => !current)}
      />

      {/* LLM Config Dialog */}
      {showLLMConfigDialog && (
        <LLMConfigDialog
          llmModel={llmModel}
          availableModels={ollamaModels}
          modelCatalog={ollamaModelCatalog}
          localAvailable={ollamaLocalAvailable}
          remoteAvailable={ollamaRemoteAvailable}
          llmSystemPrompt={llmSystemPrompt}
          action={action}
          onSave={(model, prompt) => {
            setLlmModel(model);
            setLlmSystemPrompt(prompt);
            void saveLLMConfig(model, prompt);
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

      {showBatchPipelineDialog && (
        <BatchPipelineDialog
          videos={videos as any}
          selectedVideosForBatch={selectedVideosForBatch}
          batchPipelineOptions={batchPipelineOptions}
          isBatchProcessing={isBatchProcessing}
          activeBatchId={activeBatchId}
          onClose={() => setShowBatchPipelineDialog(false)}
          onVideoToggle={(videoId) => {
            setSelectedVideosForBatch((prev) =>
              prev.includes(videoId) ? prev.filter((id) => id !== videoId) : [...prev, videoId],
            );
          }}
          onOptionChange={(changes) => {
            setBatchPipelineOptions((prev) => ({ ...prev, ...changes }));
          }}
          onCancel={async () => {
            if (isBatchProcessing && activeBatchId) {
              try {
                setBatchProcessingLogs((prev) => [...prev, "Cancelamento solicitado..."]);
                await cancelBatchPipeline(activeBatchId);
                stopBatchPolling();
                setIsBatchProcessing(false);
                setBatchProcessingLogs((prev) => [...prev, "Processamento cancelado"]);
              } catch (error: any) {
                console.error("[UI] Error cancelling batch:", error);
                setBatchProcessingLogs((prev) => [...prev, `Erro ao cancelar: ${error.message}`]);
              }
            } else {
              setShowBatchPipelineDialog(false);
            }
          }}
          onStart={async () => {
            if (selectedVideosForBatch.length === 0) {
              alert("Selecione pelo menos um vídeo");
              return;
            }

            try {
              setIsBatchProcessing(true);
              setBatchProcessingLogs([
                `Iniciando processamento de ${selectedVideosForBatch.length} vídeo(s)...`,
              ]);

              setShowBatchPipelineDialog(false);

              const result = await startBatchPipeline(selectedVideosForBatch, batchPipelineOptions);

              setActiveBatchId(result.batch_id);
              setBatchProcessingLogs((prev) => [
                ...prev,
                `Pipeline iniciado (ID: ${result.batch_id})`,
              ]);

              startBatchPolling(result.batch_id);
            } catch (error: any) {
              console.error("[UI] Error starting batch pipeline:", error);
              setBatchProcessingLogs((prev) => [
                ...prev,
                `Erro ao iniciar pipeline: ${error.message}`,
              ]);
              setIsBatchProcessing(false);
            }
          }}
        />
      )}

      {/* Batch Completion Notification */}
      {showBatchCompletionNotification && (
        <div
          className="dialog-overlay"
          style={{ zIndex: 10000 }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "400px" }}
          >
            <div className="dialog-header">
              <h3>Pipeline Concluído</h3>
            </div>
            <div className="dialog-content" style={{ padding: "20px" }}>
              <p style={{ whiteSpace: "pre-line", lineHeight: "1.8" }}>{batchCompletionMessage}</p>
              <div style={{ display: "flex", justifyContent: "center", marginTop: "20px" }}>
                <button
                  className="secondary"
                  onClick={() => {
                    setShowBatchCompletionNotification(false);
                    setBatchCompletionMessage("");
                  }}
                >
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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
        onBatchCompletionClose={() => {
          setShowBatchCompletionNotification(false);
          setBatchCompletionMessage("");
        }}
      />

      {action.error && <div className="toast error">{action.error}</div>}
    </div>
  );
}
