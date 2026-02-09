import { useEffect, useMemo, useRef, useState } from "react";
import type { Cut, Job, Segment, VideoRecord } from "./types";
import type { FFmpegConfig } from "./types/ffmpeg";
import type { WhisperConfig } from "./types/whisper";
import type { ToolConfigs } from "./types/toolConfigs";
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
  uploadVideoFile,
  getDependencies,
  getInstallationGuide,
  installDependency,
  getSettings,
  saveSettings,
  getToolConfigs,
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
import { CurationSection } from "./components/CurationSection";
import { RenderingSection } from "./components/RenderingSection";
import { UploadSection } from "./components/UploadSection";
import { VideoListSection } from "./components/VideoListSection";
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

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const toolConfigsInputRef = useRef<HTMLInputElement>(null);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [uploadMode, setUploadMode] = useState<"url" | "file">("url");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
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
  const [showTranscriptionFormatListDialog, setShowTranscriptionFormatListDialog] = useState(false);
  const [showTranscriptionContentDialog, setShowTranscriptionContentDialog] = useState(false);
  const [showTranscriptionDeleteDialog, setShowTranscriptionDeleteDialog] = useState(false);
  const [selectedTranscriptionFormat, setSelectedTranscriptionFormat] = useState<
    "text" | "vtt" | "segments" | null
  >(null);
  const [pendingDeleteFormat, setPendingDeleteFormat] = useState<
    "text" | "vtt" | "segments" | null
  >(null);
  const [showBlocksDialog, setShowBlocksDialog] = useState(false);
  const [blocks, setBlocks] = useState<Record<string, unknown>[]>([]);
  const [showAiResponseDialog, setShowAiResponseDialog] = useState(false);
  const [showAiResponseOnAnalyze, setShowAiResponseOnAnalyze] = useState(false);
  const [aiResponseRaw, setAiResponseRaw] = useState<string | null>(null);
  const [showRegenerateAnalyzeDialog, setShowRegenerateAnalyzeDialog] = useState(false);
  const [keepCutIds, setKeepCutIds] = useState<string[]>([]);
  const [hoveredCutId, setHoveredCutId] = useState<string | null>(null);
  const [hoveredCutAction, setHoveredCutAction] = useState<"edit" | "delete" | null>(null);
  const [showCutEditDialog, setShowCutEditDialog] = useState(false);
  const [editingCutId, setEditingCutId] = useState<string | null>(null);
  const [editCutStart, setEditCutStart] = useState<string>("");
  const [editCutEnd, setEditCutEnd] = useState<string>("");
  const [editCutStartMinutes, setEditCutStartMinutes] = useState<string>("");
  const [editCutStartSeconds, setEditCutStartSeconds] = useState<string>("");
  const [editCutEndMinutes, setEditCutEndMinutes] = useState<string>("");
  const [editCutEndSeconds, setEditCutEndSeconds] = useState<string>("");
  const [showAddManualCutDialog, setShowAddManualCutDialog] = useState(false);
  const [newCutStartMinutes, setNewCutStartMinutes] = useState<string>("");
  const [newCutStartSeconds, setNewCutStartSeconds] = useState<string>("");
  const [newCutEndMinutes, setNewCutEndMinutes] = useState<string>("");
  const [newCutEndSeconds, setNewCutEndSeconds] = useState<string>("");
  const [videoView, setVideoView] = useState<"active" | "archived">("active");
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [renameVideoId, setRenameVideoId] = useState<string | null>(null);
  const [renameVideoNewName, setRenameVideoNewName] = useState<string>("");
  const [showLLMConfigDialog, setShowLLMConfigDialog] = useState(false);
  const [showWhisperConfigDialog, setShowWhisperConfigDialog] = useState(false);
  const [showFFmpegConfigDialog, setShowFFmpegConfigDialog] = useState(false);
  const [showDependenciesDialog, setShowDependenciesDialog] = useState(false);
  const [showInstallationDialog, setShowInstallationDialog] = useState(false);
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
  const [showConfigureAppDialog, setShowConfigureAppDialog] = useState(false);
  const [selectedDependencyForInstall, setSelectedDependencyForInstall] = useState<string | null>(
    null,
  );
  const [installingDependency, setInstallingDependency] = useState<string | null>(null);
  const [llmSystemPrompt, setLlmSystemPrompt] = useState<string>("");
  const [whisperDevice, setWhisperDevice] = useState<"cpu" | "cuda">("cuda");
  const [whisperFormats, setWhisperFormats] = useState<string[]>(["json", "vtt", "txt"]);
  const [whisperConfig, setWhisperConfig] = useState<Partial<WhisperConfig>>({});
  const [ffmpegConfig, setFfmpegConfig] = useState<FFmpegConfig | null>(null);
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
  const [showMoveUploadDialog, setShowMoveUploadDialog] = useState(false);
  const [dontAskMoveUpload, setDontAskMoveUpload] = useState(false);
  const [dependencies, setDependencies] = useState<{
    python: { installed: boolean; version: string | null };
    whisper: { installed: boolean; version: string | null };
    ffmpeg: { installed: boolean; version: string | null };
    cuda: { installed: boolean; version: string | null };
    pytorch: { installed: boolean; version: string | null };
    ollama: { installed: boolean; version: string | null };
  } | null>(null);
  const [loadingDependencies, setLoadingDependencies] = useState<Set<string>>(new Set());

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
      console.log(`[App] ✓ Ação completada com sucesso`);
      onSuccess?.(result);
      setAction({ busy: false });
    } catch (error: any) {
      console.error(`[App] ✗ Erro na ação:`, error);
      console.error(`[App] ✗ Mensagem:`, error.message);
      console.error(`[App] ✗ Stack:`, error.stack);
      const errorMessage = error instanceof Error ? error.message : "Erro inesperado";
      console.error(`[App] ✗ Será exibido ao usuário:`, errorMessage);
      setAction({ busy: false, error: errorMessage });
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

          const approvalLog = `⏸️ Aguardando aprovação dos cortes do vídeo ${progress.current_job_index + 1}`;
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

        const newLog = `📌 Vídeo ${progress.current_job_index + 1} - ${stepLabels[progress.current_step] || progress.current_step}`;

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
            `✅ Processamento concluído!`,
            `   Sucesso: ${progress.completed_jobs.length}`,
            `   Falhas: ${progress.failed_jobs.length}`,
          ]);

          // List failed jobs if any
          if (progress.failed_jobs.length > 0) {
            setBatchProcessingLogs((prev) => [
              ...prev,
              "",
              "❌ Jobs com falha:",
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
        setBatchProcessingLogs((prev) => [...prev, `❌ Erro ao buscar status: ${error.message}`]);
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

  function getTranscriptionFormatLabel(format: "text" | "vtt" | "segments"): string {
    if (format === "segments") return "JSON";
    return format.toUpperCase();
  }

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
      console.log("[UI] ✓ Configurações do Whisper salvas");
      setShowWhisperConfigDialog(false);
    } catch (error) {
      console.error("[UI] ✗ Erro ao salvar configurações do Whisper:", error);
    }
  }

  async function saveLLMConfig() {
    try {
      const response = await saveToolConfigs({
        llm: {
          system_prompt: llmSystemPrompt,
        },
      });
      applyToolConfigs(response);
      console.log("[UI] ✓ Configurações do LLM salvas");
      setShowLLMConfigDialog(false);
    } catch (error) {
      console.error("[UI] ✗ Erro ao salvar configurações do LLM:", error);
    }
  }

  async function saveFFmpegConfig(config: FFmpegConfig) {
    try {
      const response = await saveToolConfigs({ ffmpeg: config });
      applyToolConfigs(response);
      console.log("[UI] ✓ Configurações do FFmpeg salvas");
      setShowFFmpegConfigDialog(false);
    } catch (error) {
      console.error("[UI] ✗ Erro ao salvar configurações do FFmpeg:", error);
    }
  }

  async function resetAllConfigs() {
    try {
      const response = await resetAllToolConfigs();
      applyToolConfigs(response);
      console.log("[UI] ✓ Configurações resetadas");
    } catch (error) {
      console.error("[UI] ✗ Erro ao resetar configurações:", error);
    }
  }

  async function resetConfigSection(section: "whisper" | "ffmpeg" | "llm") {
    try {
      const response = await resetToolConfigSection(section);
      applyToolConfigs(response);
      console.log(`[UI] ✓ Configuração resetada: ${section}`);
    } catch (error) {
      console.error(`[UI] ✗ Erro ao resetar ${section}:`, error);
    }
  }

  async function handleImportToolConfigs(file: File) {
    try {
      const content = await file.text();
      const parsed = JSON.parse(content) as ToolConfigs;
      const response = await importToolConfigs(parsed);
      applyToolConfigs(response);
      console.log("[UI] ✓ Configurações importadas");
    } catch (error) {
      console.error("[UI] ✗ Erro ao importar configurações:", error);
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
          setDependencies(null);
          setLoadingDependencies(new Set());

          try {
            console.log("[UI] Carregando dependências...");
            const depsData = await getDependencies();
            console.log("[UI] Dependências carregadas:", depsData.dependencies);
            setDependencies(depsData.dependencies);
            setLoadingDependencies(new Set());
          } catch (error) {
            console.error("Failed to load dependencies:", error);
            setDependencies({
              python: { installed: false, version: null },
              whisper: { installed: false, version: null },
              ffmpeg: { installed: false, version: null },
              cuda: { installed: false, version: null },
              pytorch: { installed: false, version: null },
              ollama: { installed: false, version: null },
            });
            setLoadingDependencies(new Set());
          }
        }}
        onConfigureLLM={() => setShowLLMConfigDialog(true)}
        onConfigureWhisper={() => setShowWhisperConfigDialog(true)}
        onConfigureFFmpeg={() => setShowFFmpegConfigDialog(true)}
        onBatchPipeline={() => {
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
      />

      <UploadSection
        action={action}
        onVideoAdded={(video) => {
          setVideos((current) => [video, ...current]);
          setActiveVideoId(video.job.job_id);
        }}
        onLoadVideos={loadVideos}
        appSettings={appSettings}
        onShowMoveUploadDialog={() => {
          setDontAskMoveUpload(false);
          setShowMoveUploadDialog(true);
        }}
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
            console.log(`[UI] ✗ Vídeo desmarcado`);
            setActiveVideoId(null);
          } else {
            const validation = canStartOperation(videoId);
            if (!validation.allowed) {
              console.warn(`[UI] ⚠️  ${validation.message}`);
              alert(`⚠️ ${validation.message}`);
              return;
            }
            const video = videos.find((v) => v.job.job_id === videoId);
            console.log(`\n[UI] ✓ Vídeo selecionado:`);
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
      />
      {/* 3. Video Player */}
      {activeVideo && (
        <section className="panel">
          <h2>3. Vídeo selecionado</h2>
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
                      console.log(`\n[video] 🎬 Iniciando carregamento do vídeo:`);
                      console.log(`[video]   Job ID: ${activeVideo.job.job_id}`);
                      console.log(`[video]   Video Path: ${activeVideo.videoPath}`);
                      console.log(`[video]   URL completa: ${apiBaseUrl}${activeVideo.videoPath}`);
                    }}
                    onError={(e) => {
                      console.error(`\n[video] ❌ ERRO ao carregar vídeo:`);
                      console.error(`[video]   Job ID: ${activeVideo.job.job_id}`);
                      console.error(`[video]   Video Path: ${activeVideo.videoPath}`);
                      console.error(`[video]   URL tentada: ${apiBaseUrl}${activeVideo.videoPath}`);
                      console.error(`[video]   Erro completo:`, e);
                      console.error(`[video]   Event type: ${e.type}`);
                      if (e.target instanceof HTMLVideoElement) {
                        console.error(`[video]   Video networkState: ${e.target.networkState}`);
                        console.error(`[video]   Video readyState: ${e.target.readyState}`);
                        console.error(`[video]   Video error code: ${e.target.error?.code}`);
                        console.error(`[video]   Video error message: ${e.target.error?.message}`);
                      }
                    }}
                    onLoadedMetadata={() => {
                      console.log(`[video] ✓ Metadados carregados com sucesso`);
                    }}
                    onCanPlay={() => {
                      console.log(`[video] ✓ Vídeo pronto para reproduzir`);
                    }}
                  />
                </div>

                {/* Batch Processing Logs */}
                {isBatchProcessing && batchProcessingLogs.length > 0 && (
                  <div className="batch-logs">
                    <h4 className="batch-logs-title">📋 Logs do Pipeline em Lote</h4>
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
                            ? "📝 Logs da transcrição"
                            : "🎬 Logs da renderização"}
                        </span>
                        {activeTaskLogType === "transcription" && activeVideo?.isTranscribing && (
                          <button
                            className="cancel-button"
                            onClick={async () => {
                              console.log(`[UI] Cancelando transcrição: ${activeVideo.job.job_id}`);
                              try {
                                await cancelTranscription(activeVideo.job.job_id);
                                updateVideo(activeVideo.job.job_id, { isTranscribing: false });
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
                      📄 Visualizar transcrição
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
                          console.warn(`[UI] ⚠️  ${validation.message}`);
                          alert(`⚠️ ${validation.message}`);
                          return;
                        }

                        console.log(
                          `[UI] Iniciando transcrição do video ${activeVideo.job.job_id}`,
                        );
                        setShowTranscriptionFormatListDialog(false);
                        setShowTranscriptionContentDialog(false);
                        setShowTranscriptionDeleteDialog(false);
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
                      }}
                    >
                      {activeVideo.isTranscribing
                        ? "⏳ Transcrevendo..."
                        : hasAnyTranscription
                          ? "Gerar nova transcrição"
                          : "🎙️ Transcrever"}
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
                      🔗 Blocos
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
                          setKeepCutIds([]);
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
                        ? "⏳ Analisando..."
                        : suggestedCuts.length > 0
                          ? "Gerar nova análise"
                          : "🤖 Análise"}
                    </button>
                    <p className="config-card-description">Analisa com IA para encontrar hooks.</p>
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
                          console.warn(`[UI] ⚠️  ${validation.message}`);
                          alert(`⚠️ ${validation.message}`);
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
                      {isRendering ? "⏳ Renderizando..." : "🎬 Renderizar"}
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
                      ➕ Adicionar Corte Manual
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
                      🚀 Pipeline em Lote
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
                          className="primary"
                          onClick={async () => {
                            try {
                              await continueBatchPipeline(activeBatchId);
                              setBatchWaitingForApproval(false);
                              setBatchPendingCuts([]);
                              setBatchProcessingLogs((prev) => [
                                ...prev,
                                "✅ Cortes aprovados, continuando pipeline...",
                              ]);
                            } catch (error: any) {
                              console.error("[UI] Error continuing batch pipeline:", error);
                              setBatchProcessingLogs((prev) => [
                                ...prev,
                                `❌ Erro ao continuar: ${error.message}`,
                              ]);
                            }
                          }}
                          style={{
                            padding: "12px 24px",
                            fontSize: "16px",
                            fontWeight: "600",
                            borderRadius: "8px",
                            background: "#10b981",
                          }}
                        >
                          ▶️ Continuar Pipeline
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
                            className="secondary"
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
                                selectedSuggestedCutId === cut.cut_id ? "#0066cc" : "#e5e5e5",
                              color: selectedSuggestedCutId === cut.cut_id ? "white" : "black",
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
                              top: "4px",
                              display: "flex",
                              gap: "4px",
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
                                width: "16px",
                                height: "16px",
                                borderRadius: "4px",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                padding: 0,
                                fontSize: "12px",
                                lineHeight: "16px",
                                color:
                                  hoveredCutId === cut.cut_id && hoveredCutAction === "edit"
                                    ? "#1d4ed8"
                                    : "#666",
                              }}
                              aria-label="Editar timestamp"
                            >
                              ✎
                            </button>
                            <button
                              className="icon-btn"
                              onClick={async () => {
                                const newSuggestedCuts = suggestedCuts.filter(
                                  (item) => item.cut_id !== cut.cut_id,
                                );
                                const newCuts = cuts.filter((item) => item.cut_id !== cut.cut_id);

                                setSuggestedCuts(newSuggestedCuts);
                                setCuts(newCuts);

                                if (activeVideo) {
                                  try {
                                    await updateCuts(activeVideo.job.job_id, newCuts);
                                  } catch (error) {
                                    console.error("Failed to update cuts:", error);
                                  }
                                }

                                if (selectedSuggestedCutId === cut.cut_id) {
                                  setSelectedSuggestedCutId(null);
                                  videoRef.current?.pause();
                                }
                                setHoveredCutId(null);
                              }}
                              onMouseEnter={() => {
                                setHoveredCutId(cut.cut_id);
                                setHoveredCutAction("delete");
                              }}
                              onMouseLeave={() => {
                                setHoveredCutId(null);
                                setHoveredCutAction(null);
                              }}
                              style={{
                                width: "16px",
                                height: "16px",
                                borderRadius: "4px",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                padding: 0,
                                fontSize: "12px",
                                lineHeight: "16px",
                                color:
                                  hoveredCutId === cut.cut_id && hoveredCutAction === "delete"
                                    ? "#dc2626"
                                    : "#666",
                              }}
                              aria-label="Deletar timestamp"
                            >
                              ✕
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
        </section>
      )}

      {/* Transcription Format List */}
      {showTranscriptionFormatListDialog && activeVideo && (
        <div className="dialog-overlay" onClick={() => setShowTranscriptionFormatListDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Transcrição</h3>
              <div className="dialog-actions">
                <button
                  className="icon-btn close-btn"
                  onClick={() => setShowTranscriptionFormatListDialog(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <p>Escolha um formato para visualizar:</p>
              <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
                {activeVideo.transcription && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setSelectedTranscriptionFormat("text");
                      setShowTranscriptionFormatListDialog(false);
                      setShowTranscriptionContentDialog(true);
                    }}
                  >
                    TXT
                  </button>
                )}
                {activeVideo.transcriptionFormats?.vtt && (
                  <button
                    className="secondary"
                    onClick={() => {
                      setSelectedTranscriptionFormat("vtt");
                      setShowTranscriptionFormatListDialog(false);
                      setShowTranscriptionContentDialog(true);
                    }}
                  >
                    VTT
                  </button>
                )}
                {activeVideo.transcriptionSegments?.length ? (
                  <button
                    className="secondary"
                    onClick={() => {
                      setSelectedTranscriptionFormat("segments");
                      setShowTranscriptionFormatListDialog(false);
                      setShowTranscriptionContentDialog(true);
                    }}
                  >
                    JSON
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Transcription Content Dialog */}
      {showTranscriptionContentDialog && transcriptionContent && (
        <div className="dialog-overlay" onClick={() => setShowTranscriptionContentDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>{transcriptionContent.title}</h3>
              {selectedTranscriptionFormat && (
                <button
                  className="danger"
                  onClick={() => {
                    setPendingDeleteFormat(selectedTranscriptionFormat);
                    setShowTranscriptionDeleteDialog(true);
                  }}
                >
                  Deletar transcrição
                </button>
              )}
              <div className="dialog-actions">
                <button
                  className="icon-btn close-btn"
                  onClick={() => setShowTranscriptionContentDialog(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <pre className="transcription-text">{transcriptionContent.content}</pre>
            </div>
          </div>
        </div>
      )}

      {showTranscriptionDeleteDialog && pendingDeleteFormat && activeVideo && (
        <div
          className="dialog-overlay"
          onClick={() => {
            setShowTranscriptionDeleteDialog(false);
            setPendingDeleteFormat(null);
          }}
        >
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Confirmar exclusão</h3>
              <div className="dialog-actions">
                <button
                  className="icon-btn close-btn"
                  onClick={() => {
                    setShowTranscriptionDeleteDialog(false);
                    setPendingDeleteFormat(null);
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <p>
                Tem certeza que deseja deletar a transcrição em formato{" "}
                <strong>{getTranscriptionFormatLabel(pendingDeleteFormat)}</strong>?
              </p>
              <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
                <button
                  className="danger"
                  onClick={() =>
                    runAction(
                      () => deleteTranscription(activeVideo.job.job_id, pendingDeleteFormat),
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
                          nextFormats && nextFormats.text === false
                            ? ""
                            : activeVideo.transcription;

                        updateVideo(activeVideo.job.job_id, {
                          transcription: nextTranscription,
                          transcriptionSegments:
                            pendingDeleteFormat === "segments" && nextFormats?.segments === false
                              ? []
                              : activeVideo.transcriptionSegments,
                          transcriptionFormats: nextFormats,
                        });
                        if (pendingDeleteFormat === selectedTranscriptionFormat) {
                          setShowTranscriptionContentDialog(false);
                        }
                        setShowTranscriptionDeleteDialog(false);
                        setPendingDeleteFormat(null);
                      },
                    )
                  }
                >
                  Confirmar
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setShowTranscriptionDeleteDialog(false);
                    setPendingDeleteFormat(null);
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Blocks Dialog */}
      {showBlocksDialog && blocks.length > 0 && (
        <div className="dialog-overlay" onClick={() => setShowBlocksDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Blocos Semânticos ({blocks.length})</h3>
              <div className="dialog-actions">
                <button className="icon-btn close-btn" onClick={() => setShowBlocksDialog(false)}>
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <div style={{ overflowY: "auto", maxHeight: "500px" }}>
                {blocks.map((block: any, index: number) => (
                  <div
                    key={index}
                    style={{
                      marginBottom: "16px",
                      padding: "12px",
                      backgroundColor: "#f5f5f5",
                      borderRadius: "8px",
                      borderLeft: "4px solid #0066cc",
                    }}
                  >
                    <div style={{ marginBottom: "8px" }}>
                      <strong>Bloco {index + 1}</strong>
                      {block.block_id && <span> ({block.block_id})</span>}
                    </div>
                    <div style={{ marginBottom: "8px", fontSize: "0.9em", color: "#666" }}>
                      {block.start?.toFixed(2)}s - {block.end?.toFixed(2)}s
                    </div>
                    <div style={{ lineHeight: "1.6" }}>{block.text}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* AI Response Dialog */}
      {showAiResponseDialog && aiResponseRaw && (
        <div className="dialog-overlay" onClick={() => setShowAiResponseDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Resposta original da IA</h3>
              <div className="dialog-actions">
                <button
                  className="icon-btn close-btn"
                  onClick={() => setShowAiResponseDialog(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <pre className="transcription-text">{aiResponseRaw}</pre>
            </div>
          </div>
        </div>
      )}

      {/* Regenerate Analyze Dialog */}
      {showRegenerateAnalyzeDialog && suggestedCuts.length > 0 && activeVideo && (
        <div
          className="dialog-overlay"
          onClick={() => {
            setShowRegenerateAnalyzeDialog(false);
            setKeepCutIds([]);
          }}
        >
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Gerar nova análise</h3>
              <div className="dialog-actions">
                <button
                  className="icon-btn close-btn"
                  onClick={() => {
                    setShowRegenerateAnalyzeDialog(false);
                    setKeepCutIds([]);
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <p>Selecione os cortes que deseja manter:</p>
              <div style={{ display: "grid", gap: "8px", marginBottom: "16px" }}>
                {suggestedCuts.map((cut) => (
                  <label
                    key={cut.cut_id}
                    style={{ display: "flex", gap: "8px", alignItems: "center" }}
                  >
                    <input
                      type="checkbox"
                      checked={keepCutIds.includes(cut.cut_id)}
                      onChange={(event) => {
                        if (event.target.checked) {
                          setKeepCutIds((current) => [...current, cut.cut_id]);
                        } else {
                          setKeepCutIds((current) => current.filter((item) => item !== cut.cut_id));
                        }
                      }}
                    />
                    <span>
                      {formatTimestamp(cut.start)} - {formatTimestamp(cut.end)}
                    </span>
                  </label>
                ))}
              </div>
              <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
                <button
                  className="primary"
                  disabled={keepCutIds.length === 0 || isAnalyzing}
                  onClick={() => {
                    const keptCuts = suggestedCuts.filter((cut) => keepCutIds.includes(cut.cut_id));
                    setShowRegenerateAnalyzeDialog(false);
                    setKeepCutIds([]);
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
                >
                  {isAnalyzing ? "⏳ Analisando..." : "Manter os cortes selecionados e gerar novos"}
                </button>
                <button
                  className="secondary"
                  disabled={isAnalyzing}
                  onClick={() => {
                    setShowRegenerateAnalyzeDialog(false);
                    setKeepCutIds([]);
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
                  {isAnalyzing ? "⏳ Analisando..." : "Apagar cortes e gerar novos cortes"}
                </button>
              </div>
            </div>
          </div>
        </div>
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
      <CurationSection isLoadingCuts={isLoadingCuts} cuts={cuts} />

      <RenderingSection
        isLoadingRenderOutputs={isLoadingRenderOutputs}
        isRendering={isRendering}
        renderOutputs={renderOutputs}
        buildRenderUrl={buildRenderUrl}
        onDeleteRender={async (fileName) => {
          if (activeVideo) {
            await deleteRenderOutput(activeVideo.job.job_id, fileName);
            setRenderOutputs((current) => current.filter((path) => !path.endsWith(fileName)));
          }
        }}
      />

      {/* LLM Config Dialog */}
      {showLLMConfigDialog && (
        <LLMConfigDialog
          llmSystemPrompt={llmSystemPrompt}
          action={action}
          onSave={(prompt) => {
            setLlmSystemPrompt(prompt);
            saveLLMConfig();
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
          onClose={() => setShowDependenciesDialog(false)}
          onRefresh={async () => {
            try {
              const depsData = await getDependencies();
              setDependencies(depsData.dependencies);
            } catch (error) {
              console.error("Failed to refresh dependencies:", error);
            }
          }}
          onShowInstallInstructions={(name) => {
            setSelectedDependencyForInstall(name);
            setShowInstallationDialog(true);
          }}
          onInstallDependency={async (name) => {
            console.log(`[UI] Iniciando instalação de ${name}`);
            setInstallingDependency(name);
            setLoadingDependencies((prev) => {
              const next = new Set(prev);
              next.add(name);
              console.log(`[UI] Loading ${name} marcado como true:`, next);
              return next;
            });
            try {
              const result = await installDependency(name);
              if (result.success) {
                alert(`${name} instalado com sucesso!`);
                try {
                  console.log(`[UI] Atualizando lista de dependências para ${name}`);
                  const depsData = await getDependencies();
                  setDependencies(depsData.dependencies);
                  setLoadingDependencies((prev) => {
                    const next = new Set(prev);
                    next.delete(name);
                    console.log(`[UI] Loading ${name} marcado como false:`, next);
                    return next;
                  });
                } catch (error) {
                  console.error("Failed to refresh dependencies:", error);
                  setLoadingDependencies((prev) => {
                    const next = new Set(prev);
                    next.delete(name);
                    return next;
                  });
                }
              } else {
                alert(`Erro ao instalar ${name}: ${result.error || result.message}`);
                setLoadingDependencies((prev) => {
                  const next = new Set(prev);
                  next.delete(name);
                  return next;
                });
              }
            } catch (error) {
              console.error(`Failed to install ${name}:`, error);
              alert(`Erro ao instalar ${name}`);
              setLoadingDependencies((prev) => {
                const next = new Set(prev);
                next.delete(name);
                return next;
              });
            } finally {
              console.log(`[UI] Finalizando instalação de ${name}`);
              setInstallingDependency(null);
            }
          }}
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
          onSave={(baseDir, resolution) => {
            runAction(
              () =>
                saveSettings({
                  media: {
                    base_dir: baseDir,
                    download_resolution: resolution,
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
          videos={videos}
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
                setBatchProcessingLogs((prev) => [...prev, "⚠️ Cancelamento solicitado..."]);
                await cancelBatchPipeline(activeBatchId);
                stopBatchPolling();
                setIsBatchProcessing(false);
                setBatchProcessingLogs((prev) => [...prev, "❌ Processamento cancelado"]);
              } catch (error: any) {
                console.error("[UI] Error cancelling batch:", error);
                setBatchProcessingLogs((prev) => [
                  ...prev,
                  `❌ Erro ao cancelar: ${error.message}`,
                ]);
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
                `🚀 Iniciando processamento de ${selectedVideosForBatch.length} vídeo(s)...`,
              ]);

              setShowBatchPipelineDialog(false);

              const result = await startBatchPipeline(selectedVideosForBatch, batchPipelineOptions);

              setActiveBatchId(result.batch_id);
              setBatchProcessingLogs((prev) => [
                ...prev,
                `✅ Pipeline iniciado (ID: ${result.batch_id})`,
              ]);

              startBatchPolling(result.batch_id);
            } catch (error: any) {
              console.error("[UI] Error starting batch pipeline:", error);
              setBatchProcessingLogs((prev) => [
                ...prev,
                `❌ Erro ao iniciar pipeline: ${error.message}`,
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
              <h3>✅ Pipeline Concluído</h3>
            </div>
            <div className="dialog-content" style={{ padding: "20px" }}>
              <p style={{ whiteSpace: "pre-line", lineHeight: "1.8" }}>{batchCompletionMessage}</p>
              <div style={{ display: "flex", justifyContent: "center", marginTop: "20px" }}>
                <button
                  className="primary"
                  onClick={() => {
                    setShowBatchCompletionNotification(false);
                    setBatchCompletionMessage("");
                  }}
                  style={{
                    padding: "10px 30px",
                    borderRadius: "8px",
                    fontSize: "16px",
                    fontWeight: "600",
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
