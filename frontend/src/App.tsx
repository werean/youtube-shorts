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
  type AppSettings,
} from "./api";
import { getJobLogs } from "./api/logs";
import { WhisperConfigDialog } from "./components/WhisperConfigDialog";
import { FFmpegConfigDialog } from "./components/FFmpegConfigDialog";

interface ActionState {
  busy: boolean;
  error?: string;
}

interface VideoItem {
  job: Job;
  videoPath?: string;
  transcription?: string;
  transcriptionSegments?: Segment[];
  transcriptionFormats?: { segments?: boolean; text?: boolean; vtt?: boolean };
  isTranscribing?: boolean;
  transcriptionLogs?: string[];
}

const initialAction: ActionState = { busy: false };

interface InstallationGuideData {
  name: string;
  manual: {
    title: string;
    description: string;
    steps: string[];
    links?: { text: string; url: string }[];
  };
  automatic?: {
    command: string;
    description: string;
  };
}

function InstallationInstructionsDialog({
  dependencyName,
  onClose,
}: {
  dependencyName: string;
  onClose: () => void;
}) {
  const [guide, setGuide] = useState<InstallationGuideData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const data = await getInstallationGuide(dependencyName);
        setGuide(data as InstallationGuideData);
      } catch (error) {
        console.error("Failed to load installation guide:", error);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [dependencyName]);

  if (isLoading) {
    return (
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "600px" }}
      >
        <p style={{ textAlign: "center", color: "#666" }}>Carregando instruções...</p>
      </div>
    );
  }

  if (!guide) {
    return (
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "600px" }}
      >
        <p style={{ textAlign: "center", color: "#666" }}>Erro ao carregar instruções</p>
      </div>
    );
  }

  return (
    <div
      className="dialog"
      onClick={(e) => e.stopPropagation()}
      style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "600px" }}
    >
      <div className="dialog-header">
        <h3>{guide.manual.title}</h3>
        <div className="dialog-actions">
          <button className="icon-btn close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
      </div>
      <div className="dialog-content" style={{ padding: "20px" }}>
        <p style={{ marginBottom: "16px", color: "#666" }}>{guide.manual.description}</p>

        <div style={{ marginBottom: "20px" }}>
          <h4 style={{ marginBottom: "12px", fontSize: "14px", fontWeight: "600" }}>Passos:</h4>
          <ol style={{ marginLeft: "20px", lineHeight: "1.8", fontSize: "14px", color: "#333" }}>
            {guide.manual.steps.map((step, idx) => (
              <li key={idx} style={{ marginBottom: "8px" }}>
                {step}
              </li>
            ))}
          </ol>
        </div>

        {guide.manual.links && guide.manual.links.length > 0 && (
          <div
            style={{
              marginBottom: "20px",
              padding: "12px",
              background: "#f9fafb",
              borderRadius: "8px",
            }}
          >
            <h4 style={{ marginBottom: "8px", fontSize: "14px", fontWeight: "600" }}>
              Links úteis:
            </h4>
            <ul style={{ marginLeft: "20px", lineHeight: "1.8", fontSize: "14px" }}>
              {guide.manual.links.map((link, idx) => (
                <li key={idx}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#3b82f6" }}
                  >
                    {link.text}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}

        {guide.automatic && (
          <div
            style={{
              marginBottom: "20px",
              padding: "12px",
              background: "#f0fdf4",
              borderRadius: "8px",
              borderLeft: "4px solid #10b981",
            }}
          >
            <h4 style={{ marginBottom: "8px", fontSize: "14px", fontWeight: "600" }}>
              Instalação Automática:
            </h4>
            <p style={{ fontSize: "12px", color: "#666", marginBottom: "8px" }}>
              {guide.automatic.description}
            </p>
            <code
              style={{
                display: "block",
                padding: "8px",
                background: "#f5f5f5",
                borderRadius: "4px",
                fontSize: "11px",
                wordBreak: "break-all",
                fontFamily: "monospace",
              }}
            >
              {guide.automatic.command}
            </code>
          </div>
        )}

        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "20px" }}>
          <button
            onClick={onClose}
            className="primary"
            style={{
              padding: "10px 20px",
              borderRadius: "8px",
            }}
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

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

  function recordToVideoItem(record: VideoRecord): VideoItem {
    const job =
      record.job ||
      ({
        job_id: record.job_id,
        youtube_url: "Video sem metadata",
        status: "CREATED",
        created_at: new Date().toISOString(),
      } as Job);

    return {
      job,
      videoPath: record.video_path,
      transcriptionLogs: [],
    };
  }

  function formatVttTimestamp(seconds: number): string {
    const totalMs = Math.max(0, Math.floor(seconds * 1000));
    const ms = totalMs % 1000;
    const totalSeconds = Math.floor(totalMs / 1000);
    const s = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const m = totalMinutes % 60;
    const h = Math.floor(totalMinutes / 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(3, "0")}`;
  }

  function formatTimestamp(seconds: number): string {
    const total = Math.max(0, Math.round(seconds));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    if (h > 0) {
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    }
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function buildRenderUrl(renderPath: string): string {
    if (!renderPath) return "";
    if (renderPath.startsWith("http://") || renderPath.startsWith("https://")) {
      return renderPath;
    }
    const normalized = renderPath.startsWith("/") ? renderPath : `/${renderPath}`;
    const separator = normalized.includes("?") ? "&" : "?";
    return `${apiBaseUrl}${normalized}${separator}v=${renderOutputsVersion}`;
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

  function parseTimestampInput(input: string): number | null {
    const trimmed = input.trim();

    // Try parsing as mm:ss or hh:mm:ss or just seconds
    const colonParts = trimmed.split(":");

    if (colonParts.length === 1) {
      // Try parsing as plain seconds
      const seconds = Number(trimmed);
      return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
    }

    if (colonParts.length === 2) {
      // Format: mm:ss
      const minutes = Number(colonParts[0]);
      const seconds = Number(colonParts[1]);
      if (
        Number.isFinite(minutes) &&
        Number.isFinite(seconds) &&
        minutes >= 0 &&
        seconds >= 0 &&
        seconds < 60
      ) {
        return minutes * 60 + seconds;
      }
    }

    if (colonParts.length === 3) {
      // Format: hh:mm:ss
      const hours = Number(colonParts[0]);
      const minutes = Number(colonParts[1]);
      const seconds = Number(colonParts[2]);
      if (
        Number.isFinite(hours) &&
        Number.isFinite(minutes) &&
        Number.isFinite(seconds) &&
        hours >= 0 &&
        minutes >= 0 &&
        minutes < 60 &&
        seconds >= 0 &&
        seconds < 60
      ) {
        return hours * 3600 + minutes * 60 + seconds;
      }
    }

    return null;
  }

  function buildVtt(segments: Segment[] = []): string {
    const cues = segments
      .map((segment, index) => {
        const start = formatVttTimestamp(segment.start);
        const end = formatVttTimestamp(segment.end);
        return `${index + 1}\n${start} --> ${end}\n${segment.text}\n`;
      })
      .join("\n");
    return `WEBVTT\n\n${cues}`.trimEnd() + "\n";
  }

  function getTranscriptionContent(
    video: VideoItem,
    format: "text" | "vtt" | "segments",
  ): { title: string; content: string } {
    if (format === "vtt") {
      return {
        title: "Transcrição (VTT)",
        content: buildVtt(video.transcriptionSegments || []),
      };
    }

    if (format === "segments") {
      return {
        title: "Transcrição (JSON)",
        content: JSON.stringify(video.transcriptionSegments || [], null, 2),
      };
    }

    return {
      title: "Transcrição (TXT)",
      content: video.transcription || "",
    };
  }

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
      <section className="panel">
        <h2>Configurações</h2>
        <div className="grid" style={{ gridTemplateColumns: "1fr 1fr 1fr", gap: "12px" }}>
          {/* Card Configurar Aplicação */}
          <div
            style={{
              border: "1px solid #e5e5e5",
              borderRadius: "10px",
              padding: "12px",
              background: "#fff",
            }}
          >
            <button
              onClick={() => setShowConfigureAppDialog(true)}
              style={{
                width: "100%",
                borderRadius: "8px",
                background: "#8b5cf6",
                color: "white",
                border: "none",
                padding: "10px",
                cursor: "pointer",
                fontWeight: "600",
              }}
            >
              ⚙️ Configurar aplicação
            </button>
            <p
              className="muted"
              style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
            >
              Define onde os vídeos, shorts e transcrições serão armazenados.
            </p>
          </div>

          {/* Card Dependências */}
          <div
            style={{
              border: "1px solid #e5e5e5",
              borderRadius: "10px",
              padding: "12px",
              background: "#fff",
            }}
          >
            <button
              onClick={async () => {
                setShowDependenciesDialog(true);
                // Deixa como null para mostrar spinner global enquanto carrega
                setDependencies(null);
                setLoadingDependencies(new Set());

                // Carrega as dependências
                try {
                  console.log("[UI] Carregando dependências...");
                  const depsData = await getDependencies();
                  console.log("[UI] Dependências carregadas:", depsData.dependencies);
                  setDependencies(depsData.dependencies);
                  setLoadingDependencies(new Set());
                } catch (error) {
                  console.error("Failed to load dependencies:", error);
                  // Inicializa com empty state em caso de erro
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
              style={{
                width: "100%",
                borderRadius: "8px",
                background: "#06b6d4",
                color: "white",
                border: "none",
                padding: "10px",
                cursor: "pointer",
                fontWeight: "600",
              }}
            >
              📦 Gerenciar dependências
            </button>
            <p
              className="muted"
              style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
            >
              Verifica se as ferramentas necessárias estão instaladas.
            </p>
          </div>

          {/* Card LLM */}
          <div
            style={{
              border: "1px solid #e5e5e5",
              borderRadius: "10px",
              padding: "12px",
              background: "#fff",
            }}
          >
            <button
              onClick={() => setShowLLMConfigDialog(true)}
              style={{
                width: "100%",
                borderRadius: "8px",
                background: "#f59e0b",
                color: "white",
                border: "none",
                padding: "10px",
                cursor: "pointer",
                fontWeight: "600",
              }}
            >
              🤖 Configurar LLM
            </button>
            <p
              className="muted"
              style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
            >
              Edita o prompt do sistema para análise com IA.
            </p>
          </div>

          {/* Card Whisper */}
          <div
            style={{
              border: "1px solid #e5e5e5",
              borderRadius: "10px",
              padding: "12px",
              background: "#fff",
            }}
          >
            <button
              onClick={() => setShowWhisperConfigDialog(true)}
              style={{
                width: "100%",
                borderRadius: "8px",
                background: "#8b5cf6",
                color: "white",
                border: "none",
                padding: "10px",
                cursor: "pointer",
                fontWeight: "600",
              }}
            >
              🎙️ Configurar Whisper
            </button>
            <p
              className="muted"
              style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
            >
              Personaliza o dispositivo e formatos de transcrição.
            </p>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              border: "1px solid #e5e5e5",
              borderRadius: "10px",
              padding: "12px",
              background: "#fff",
            }}
          >
            <button
              onClick={() => setShowFFmpegConfigDialog(true)}
              style={{
                width: "100%",
                borderRadius: "8px",
                background: "#ec4899",
                color: "white",
                border: "none",
                padding: "10px",
                cursor: "pointer",
                fontWeight: "600",
              }}
            >
              🎬 Configurar FFmpeg
            </button>
            <p
              className="muted"
              style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
            >
              Personaliza o formato, codecs e filtros de vídeo.
            </p>
          </div>
        </div>

        <div style={{ marginTop: "16px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
          <button className="secondary" onClick={resetAllConfigs}>
            ♻️ Resetar tudo
          </button>
          <button className="secondary" onClick={() => resetConfigSection("whisper")}>
            Resetar Whisper
          </button>
          <button className="secondary" onClick={() => resetConfigSection("ffmpeg")}>
            Resetar FFmpeg
          </button>
          <button className="secondary" onClick={() => resetConfigSection("llm")}>
            Resetar LLM
          </button>
          <button className="secondary" onClick={() => toolConfigsInputRef.current?.click()}>
            📥 Importar configurações
          </button>
          <input
            ref={toolConfigsInputRef}
            type="file"
            accept="application/json"
            style={{ display: "none" }}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) {
                void handleImportToolConfigs(file);
                event.currentTarget.value = "";
              }
            }}
          />
        </div>
      </section>

      {/* 1. Upload Section */}
      <section className="grid">
        <div className="panel">
          <h2>1. Faça upload de um vídeo</h2>

          <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
            <button
              className={uploadMode === "url" ? "primary" : "secondary"}
              onClick={() => {
                setUploadMode("url");
                setSelectedFiles([]);
              }}
              style={{ borderRadius: "8px" }}
            >
              📎 URL do YouTube
            </button>
            <button
              className={uploadMode === "file" ? "primary" : "secondary"}
              onClick={() => {
                setUploadMode("file");
                setYoutubeUrl("");
              }}
              style={{ borderRadius: "8px" }}
            >
              📁 Arquivo local
            </button>
          </div>

          {uploadMode === "url" ? (
            <>
              <label className="field">
                Link do YouTube
                <input
                  value={youtubeUrl}
                  onChange={(event) => setYoutubeUrl(event.target.value)}
                  placeholder="https://www.youtube.com/watch?v=..."
                />
              </label>
              <button
                className="primary"
                disabled={action.busy || youtubeUrl.length === 0}
                style={{ borderRadius: "8px" }}
                onClick={() => {
                  console.log(`\n[UI] Botão "Faça upload de um vídeo" clicado`);
                  console.log(`[UI] URL: ${youtubeUrl}`);
                  return runAction(
                    () => createJob(youtubeUrl),
                    (jobResult) => {
                      console.log(`[UI] Job criado: ${jobResult.job_id}`);
                      const newVideo: VideoItem = {
                        job: jobResult,
                        transcriptionLogs: [],
                      };
                      setVideos((current) => [newVideo, ...current]);
                      setActiveVideoId(jobResult.job_id);
                      setYoutubeUrl("");
                      setIsIngesting(true);
                      setIngestJobId(jobResult.job_id);
                      setIngestLogs([]);
                      setExpandIngestLogs(false);
                      stopIngestLogsPolling();
                      startIngestLogsPolling(jobResult.job_id);

                      // Auto-ingest
                      console.log(`[UI] Iniciando ingestão automática...`);
                      runAction(
                        () => ingestJob(jobResult.job_id),
                        (ingestResult) => {
                          console.log(
                            `[UI] Ingestão completada, vídeo: ${ingestResult.video_path}`,
                          );
                          setIsIngesting(false);
                          stopIngestLogsPolling();
                          updateVideo(jobResult.job_id, {
                            videoPath: ingestResult.video_path,
                          });
                          refreshVideo(jobResult.job_id);
                          loadVideos();
                        },
                      );
                    },
                  );
                }}
              >
                🎥 Fazer upload
              </button>
              {(isIngesting || ingestLogs.length > 0) && (
                <div
                  style={{
                    marginTop: "12px",
                    padding: "12px",
                    borderRadius: "10px",
                    border: "1px solid #e5e7eb",
                    background: "#0f172a",
                    color: "#e2e8f0",
                    fontFamily: "monospace",
                    fontSize: "12px",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      marginBottom: "8px",
                      color: "#93c5fd",
                      fontWeight: 600,
                    }}
                  >
                    <span>⬇️ Logs do download</span>
                    <button
                      className="secondary"
                      onClick={() => setExpandIngestLogs((current) => !current)}
                      style={{
                        padding: "4px 8px",
                        fontSize: "11px",
                        borderRadius: "6px",
                      }}
                    >
                      {expandIngestLogs ? "Mostrar menos" : "Mostrar mais"}
                    </button>
                  </div>
                  <div
                    ref={ingestLogsContainerRef}
                    style={{
                      height: expandIngestLogs ? "220px" : "52px",
                      maxHeight: "320px",
                      minHeight: "52px",
                      overflowY: "auto",
                      whiteSpace: "pre-wrap",
                      resize: "vertical",
                    }}
                  >
                    {(expandIngestLogs ? ingestLogs : ingestLogs.slice(-2)).length === 0
                      ? "Aguardando logs..."
                      : (expandIngestLogs ? ingestLogs : ingestLogs.slice(-2)).map(
                          (line, index) => <div key={`${index}-${line}`}>{line}</div>,
                        )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <div
                style={{
                  background: selectedFiles.length > 0 ? "var(--panel)" : "var(--bg-contrast)",
                  border:
                    selectedFiles.length > 0
                      ? "1px solid var(--border)"
                      : "2px dashed var(--border)",
                  borderRadius: "8px",
                  padding: "32px 24px",
                  marginBottom: "12px",
                  textAlign: "center",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  opacity: isDraggingFile ? 0.7 : 1,
                  transform: isDraggingFile ? "scale(1.02)" : "scale(1)",
                }}
                onClick={() => {
                  const fileInput = document.getElementById("video-file-input") as HTMLInputElement;
                  fileInput?.click();
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingFile(true);
                }}
                onDragLeave={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingFile(false);
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsDraggingFile(false);

                  const files = e.dataTransfer.files;
                  if (files && files.length > 0) {
                    const videoFiles = Array.from(files).filter((file) =>
                      file.type.startsWith("video/"),
                    );
                    if (videoFiles.length > 0) {
                      setSelectedFiles((current) => [...current, ...videoFiles]);
                    } else {
                      alert("Por favor, selecione arquivo(s) de vídeo válido(s)");
                    }
                  }
                }}
              >
                {selectedFiles.length > 0 ? (
                  <div>
                    <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>🎬</div>
                    <div style={{ fontWeight: 600, marginBottom: "16px", color: "var(--ink)" }}>
                      {selectedFiles.length} arquivo(s) selecionado(s)
                    </div>
                    <div
                      style={{
                        display: "grid",
                        gap: "8px",
                        marginBottom: "16px",
                        maxHeight: "200px",
                        overflowY: "auto",
                      }}
                    >
                      {selectedFiles.map((file, index) => (
                        <div
                          key={index}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                            padding: "8px",
                            background: "var(--bg-contrast)",
                            borderRadius: "4px",
                          }}
                        >
                          <div style={{ flex: 1, textAlign: "left" }}>
                            <div
                              style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "2px" }}
                            >
                              {file.name}
                            </div>
                            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                              {(file.size / 1024 / 1024).toFixed(2)} MB
                            </div>
                          </div>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedFiles((current) => current.filter((_, i) => i !== index));
                            }}
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "#dc2626",
                              cursor: "pointer",
                              fontSize: "1rem",
                              padding: "4px 8px",
                              borderRadius: "4px",
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.background = "#fee";
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.background = "transparent";
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFiles([]);
                        const fileInput = document.getElementById(
                          "video-file-input",
                        ) as HTMLInputElement;
                        if (fileInput) fileInput.value = "";
                      }}
                      style={{
                        background: "#fee",
                        border: "1px solid #fcc",
                        color: "#dc2626",
                        padding: "6px 12px",
                        borderRadius: "4px",
                        cursor: "pointer",
                        fontSize: "0.85rem",
                        fontWeight: 600,
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = "#fdd";
                        e.currentTarget.style.borderColor = "#f99";
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = "#fee";
                        e.currentTarget.style.borderColor = "#fcc";
                      }}
                    >
                      ✕ Remover todos
                    </button>
                  </div>
                ) : (
                  <div>
                    <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>📹</div>
                    <div style={{ fontWeight: 600, marginBottom: "4px", color: "var(--ink)" }}>
                      Nenhum arquivo selecionado
                    </div>
                    <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "4px" }}>
                      Clique ou arraste vídeos aqui
                    </div>
                  </div>
                )}
              </div>

              <input
                id="video-file-input"
                type="file"
                accept="video/*"
                multiple
                style={{ display: "none" }}
                onChange={(event) => {
                  const files = event.target.files;
                  if (files) {
                    const videoFiles = Array.from(files).filter((file) =>
                      file.type.startsWith("video/"),
                    );
                    if (videoFiles.length > 0) {
                      setSelectedFiles((current) => [...current, ...videoFiles]);
                    } else {
                      alert("Por favor, selecione arquivo(s) de vídeo válido(s)");
                    }
                  }
                }}
              />

              <button
                className="primary"
                disabled={action.busy || selectedFiles.length === 0}
                style={{ borderRadius: "8px", width: "100%" }}
                onClick={() => {
                  if (selectedFiles.length === 0) return;

                  const shouldAsk = appSettings?.preferences?.ask_move_on_upload ?? true;
                  if (shouldAsk) {
                    setDontAskMoveUpload(false);
                    setShowMoveUploadDialog(true);
                    return;
                  }

                  startUploadSelectedFiles();
                }}
              >
                🎥 Fazer upload ({selectedFiles.length})
              </button>
            </>
          )}
        </div>
      </section>

      {/* 2. Video List */}
      <section className="panel">
        <div className="panel-header">
          <h2>2. Seus vídeos</h2>
          <div className="view-tabs">
            <button
              className={`tab ${videoView === "active" ? "active" : ""}`}
              onClick={() => setView("active")}
            >
              Seus vídeos
            </button>
            <button
              className={`tab ${videoView === "archived" ? "active" : ""}`}
              onClick={() => setView("archived")}
            >
              Arquivados
            </button>
          </div>
        </div>

        {(videoView === "active" ? videos : archivedVideos).length === 0 ? (
          <p className="muted">
            {videoView === "active"
              ? "Nenhum vídeo ainda. Faça upload de um para começar."
              : "Nenhum vídeo arquivado."}
          </p>
        ) : (
          <div className="video-list">
            {(videoView === "active" ? videos : archivedVideos).slice().map((video, index) => (
              <div key={video.job.job_id} className="video-item">
                <div
                  className="video-row"
                  onClick={() => {
                    if (videoView === "active") {
                      if (activeVideoId === video.job.job_id) {
                        // Desmarcar se já estiver selecionado
                        console.log(`[UI] ✗ Vídeo desmarcado`);
                        setActiveVideoId(null);
                      } else {
                        // Check if can switch to another video
                        const validation = canStartOperation(video.job.job_id);
                        if (!validation.allowed) {
                          console.warn(`[UI] ⚠️  ${validation.message}`);
                          alert(`⚠️ ${validation.message}`);
                          return;
                        }
                        // Marcar novo vídeo
                        console.log(`\n[UI] ✓ Vídeo selecionado:`);
                        console.log(`[UI]   Job ID: ${video.job.job_id}`);
                        console.log(`[UI]   Video Path: ${video.videoPath}`);
                        console.log(`[UI]   Status: ${video.job.status}`);
                        console.log(`[UI]   URL completa: ${apiBaseUrl}${video.videoPath}`);
                        setActiveVideoId(video.job.job_id);
                      }
                    }
                  }}
                  style={{
                    cursor: videoView === "active" ? "pointer" : "default",
                  }}
                >
                  {videoView === "active" ? (
                    <label
                      className="video-checkbox"
                      style={{ cursor: "pointer", pointerEvents: "none" }}
                    >
                      <input
                        type="checkbox"
                        checked={activeVideoId === video.job.job_id}
                        readOnly
                        style={{ pointerEvents: "none" }}
                      />
                      <span>
                        {index + 1} - {video.job.video_name || "Sem nome"}
                      </span>
                    </label>
                  ) : (
                    <div className="video-label">
                      <span>
                        {index + 1} - {video.job.video_name || "Sem nome"}
                      </span>
                    </div>
                  )}

                  <button
                    className="menu-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId((current) =>
                        current === video.job.job_id ? null : video.job.job_id,
                      );
                    }}
                  >
                    ...
                  </button>
                </div>

                {menuOpenId === video.job.job_id && (
                  <div className="menu-popover">
                    {videoView === "active" && (
                      <>
                        <button
                          onClick={() => {
                            setRenameVideoId(video.job.job_id);
                            setRenameVideoNewName(video.job.video_name || "");
                            setMenuOpenId(null);
                          }}
                        >
                          Renomear
                        </button>
                        <button
                          onClick={() =>
                            runAction(
                              () => archiveVideo(video.job.job_id),
                              () => {
                                if (activeVideoId === video.job.job_id) {
                                  setActiveVideoId(null);
                                }
                                setMenuOpenId(null);
                                loadVideos();
                              },
                            )
                          }
                        >
                          Arquivar
                        </button>
                      </>
                    )}
                    <button
                      className="danger"
                      onClick={() =>
                        runAction(
                          () => deleteVideo(video.job.job_id),
                          () => {
                            if (activeVideoId === video.job.job_id) {
                              setActiveVideoId(null);
                            }
                            setMenuOpenId(null);
                            loadVideos();
                          },
                        )
                      }
                    >
                      Excluir
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
      {/* 3. Video Player */}
      {activeVideo && (
        <section className="panel">
          <h2>3. Vídeo selecionado</h2>
          <div className="video-player-container">
            {activeVideo.videoPath ? (
              <>
                <div
                  className="video-player-wrapper"
                  style={{
                    width: "100%",
                    background: "#000",
                    borderRadius: "12px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: "400px",
                    position: "relative",
                  }}
                >
                  <video
                    key={`video-${activeVideo.job.job_id}`}
                    ref={videoRef}
                    controls
                    width="100%"
                    src={`${apiBaseUrl}${activeVideo.videoPath}`}
                    className="video-player"
                    style={{ maxHeight: "400px" }}
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

                {activeTaskLogType && (
                  <div
                    style={{
                      marginTop: "12px",
                      padding: "12px",
                      borderRadius: "10px",
                      border: "1px solid #e5e7eb",
                      background: "#0f172a",
                      color: "#e2e8f0",
                      fontFamily: "monospace",
                      fontSize: "12px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        marginBottom: "8px",
                        color: "#93c5fd",
                        fontWeight: 600,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span>
                          {activeTaskLogType === "transcription"
                            ? "📝 Logs da transcrição"
                            : "🎬 Logs da renderização"}
                        </span>
                        {activeTaskLogType === "transcription" && activeVideo?.isTranscribing && (
                          <button
                            style={{
                              borderRadius: "6px",
                              background: "#ef4444",
                              color: "white",
                              border: "none",
                              padding: "4px 8px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "600",
                              whiteSpace: "nowrap",
                            }}
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
                            style={{
                              borderRadius: "6px",
                              background: "#ef4444",
                              color: "white",
                              border: "none",
                              padding: "4px 8px",
                              cursor: "pointer",
                              fontSize: "11px",
                              fontWeight: "600",
                              whiteSpace: "nowrap",
                            }}
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
                        className="secondary"
                        onClick={() => setExpandTaskLogs((current) => !current)}
                        style={{
                          padding: "4px 8px",
                          fontSize: "11px",
                          borderRadius: "6px",
                        }}
                      >
                        {expandTaskLogs ? "Mostrar menos" : "Mostrar mais"}
                      </button>
                    </div>
                    <div
                      ref={taskLogsContainerRef}
                      style={{
                        height: expandTaskLogs ? "220px" : "52px",
                        maxHeight: "320px",
                        minHeight: "52px",
                        overflowY: "auto",
                        whiteSpace: "pre-wrap",
                        resize: "vertical",
                      }}
                    >
                      {(expandTaskLogs ? activeTaskLogs : activeTaskLogs.slice(-2)).length === 0
                        ? "Aguardando logs..."
                        : (expandTaskLogs ? activeTaskLogs : activeTaskLogs.slice(-2)).map(
                            (line, index) => <div key={`${index}-${line}`}>{line}</div>,
                          )}
                    </div>
                  </div>
                )}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                    gap: "12px",
                    marginTop: "12px",
                  }}
                >
                  <div
                    style={{
                      border: "1px solid #e5e5e5",
                      borderRadius: "10px",
                      padding: "12px",
                      background: "#fff",
                    }}
                  >
                    <button
                      disabled={!hasAnyTranscription}
                      onClick={() => setShowTranscriptionFormatListDialog(true)}
                      style={{
                        width: "100%",
                        borderRadius: "8px",
                        background: "#3b82f6",
                        color: "white",
                        border: "none",
                        padding: "10px",
                        cursor: hasAnyTranscription ? "pointer" : "not-allowed",
                        opacity: hasAnyTranscription ? 1 : 0.5,
                      }}
                    >
                      📄 Visualizar transcrição
                    </button>
                    <p
                      className="muted"
                      style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                    >
                      Abre a transcrição nos formatos disponíveis.
                    </p>
                  </div>
                  <div
                    style={{
                      border: "1px solid #e5e5e5",
                      borderRadius: "10px",
                      padding: "12px",
                      background: "#fff",
                    }}
                  >
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        disabled={action.busy}
                        style={{
                          flex: 1,
                          borderRadius: "8px",
                          background: "#10b981",
                          color: "white",
                          border: "none",
                          padding: "10px",
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
                    </div>
                    <p
                      className="muted"
                      style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                    >
                      Gera ou recria a transcrição do vídeo.
                    </p>
                  </div>
                  <div
                    style={{
                      border: "1px solid #e5e5e5",
                      borderRadius: "10px",
                      padding: "12px",
                      background: "#fff",
                    }}
                  >
                    <button
                      disabled={!hasAnyTranscription}
                      style={{
                        width: "100%",
                        borderRadius: "8px",
                        background: "#8b5cf6",
                        color: "white",
                        border: "none",
                        padding: "10px",
                        cursor: !hasAnyTranscription ? "not-allowed" : "pointer",
                        opacity: !hasAnyTranscription ? 0.5 : 1,
                      }}
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
                    <p
                      className="muted"
                      style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                    >
                      Agrupa a transcrição em blocos semânticos.
                    </p>
                  </div>
                  <div
                    style={{
                      border: "1px solid #e5e5e5",
                      borderRadius: "10px",
                      padding: "12px",
                      background: "#fff",
                    }}
                  >
                    <button
                      disabled={
                        isAnalyzing ||
                        (!hasAnyTranscription && !hasAnyBlocks && suggestedCuts.length === 0)
                      }
                      style={{
                        width: "100%",
                        borderRadius: "8px",
                        background:
                          isAnalyzing ||
                          (!hasAnyTranscription && !hasAnyBlocks && suggestedCuts.length === 0)
                            ? "#ccc"
                            : "#f59e0b",
                        color: "white",
                        border: "none",
                        padding: "10px",
                        cursor:
                          isAnalyzing ||
                          (!hasAnyTranscription && !hasAnyBlocks && suggestedCuts.length === 0)
                            ? "not-allowed"
                            : "pointer",
                      }}
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
                    <p
                      className="muted"
                      style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                    >
                      Analisa com IA para encontrar hooks.
                    </p>
                    <div
                      style={{
                        display: "flex",
                        gap: "8px",
                        alignItems: "center",
                        marginTop: "10px",
                        justifyContent: "center",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={showAiResponseOnAnalyze}
                        onChange={(event) => setShowAiResponseOnAnalyze(event.target.checked)}
                      />
                      <span style={{ fontSize: "0.85rem" }}>exibir resultado da IA</span>
                    </div>
                  </div>
                  <div
                    style={{
                      border: "1px solid #e5e5e5",
                      borderRadius: "10px",
                      padding: "12px",
                      background: "#fff",
                    }}
                  >
                    <button
                      disabled={cuts.length === 0 || isRendering}
                      style={{
                        width: "100%",
                        borderRadius: "8px",
                        background: "#ec4899",
                        color: "white",
                        border: "none",
                        padding: "10px",
                        cursor: cuts.length === 0 || isRendering ? "not-allowed" : "pointer",
                        opacity: cuts.length === 0 || isRendering ? 0.5 : 1,
                      }}
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
                    <p
                      className="muted"
                      style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                    >
                      Renderiza os cortes em vídeos verticals.
                    </p>
                  </div>
                  <div
                    style={{
                      border: "1px solid #e5e5e5",
                      borderRadius: "10px",
                      padding: "12px",
                      background: "#fff",
                    }}
                  >
                    <button
                      style={{
                        width: "100%",
                        borderRadius: "8px",
                        background: "#10b981",
                        color: "white",
                        border: "none",
                        padding: "10px",
                        cursor: "pointer",
                      }}
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
                    <p
                      className="muted"
                      style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                    >
                      Cria um corte com timestamps específicos.
                    </p>
                  </div>
                </div>
                {isLoadingCuts && (
                  <div
                    style={{ marginTop: "20px", display: "flex", alignItems: "center", gap: "8px" }}
                  >
                    <div
                      style={{
                        width: "16px",
                        height: "16px",
                        border: "2px solid #f0f0f0",
                        borderTop: "2px solid #666",
                        borderRadius: "50%",
                        animation: "spin 1s linear infinite",
                      }}
                    />
                    <span style={{ fontSize: "0.9rem" }}>Carregando cortes...</span>
                  </div>
                )}
                {suggestedCuts.length > 0 && (
                  <div style={{ marginTop: "20px" }}>
                    <p style={{ marginBottom: "12px", fontWeight: "600" }}>
                      Cortes sugeridos ({suggestedCuts.length}):
                    </p>
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
                              onMouseEnter={() => setHoveredCutAction("edit")}
                              onMouseLeave={() => setHoveredCutAction(null)}
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
                                color: hoveredCutAction === "edit" ? "#1d4ed8" : "#666",
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
                              onMouseEnter={() => setHoveredCutAction("delete")}
                              onMouseLeave={() => setHoveredCutAction(null)}
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
                                color: hoveredCutAction === "delete" ? "#dc2626" : "#666",
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
        <div
          className="dialog-overlay"
          onClick={() => {
            setShowCutEditDialog(false);
            setEditingCutId(null);
            setEditCutStartMinutes("");
            setEditCutStartSeconds("");
            setEditCutEndMinutes("");
            setEditCutEndSeconds("");
          }}
        >
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Editar timestamp</h3>
              <div className="dialog-actions">
                <button
                  className="icon-btn close-btn"
                  onClick={() => {
                    setShowCutEditDialog(false);
                    setEditingCutId(null);
                    setEditCutStartMinutes("");
                    setEditCutStartSeconds("");
                    setEditCutEndMinutes("");
                    setEditCutEndSeconds("");
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <label className="field">
                  Início - Minutos
                  <input
                    type="number"
                    min="0"
                    value={editCutStartMinutes}
                    onChange={(event) => setEditCutStartMinutes(event.target.value)}
                  />
                </label>
                <label className="field">
                  Início - Segundos
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={editCutStartSeconds}
                    onChange={(event) => setEditCutStartSeconds(event.target.value)}
                  />
                </label>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <label className="field">
                  Fim - Minutos
                  <input
                    type="number"
                    min="0"
                    value={editCutEndMinutes}
                    onChange={(event) => setEditCutEndMinutes(event.target.value)}
                  />
                </label>
                <label className="field">
                  Fim - Segundos
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={editCutEndSeconds}
                    onChange={(event) => setEditCutEndSeconds(event.target.value)}
                  />
                </label>
              </div>

              <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
                <button
                  className="primary"
                  onClick={async () => {
                    const startMin = Number(editCutStartMinutes);
                    const startSec = Number(editCutStartSeconds);
                    const endMin = Number(editCutEndMinutes);
                    const endSec = Number(editCutEndSeconds);

                    if (
                      !Number.isFinite(startMin) ||
                      !Number.isFinite(startSec) ||
                      !Number.isFinite(endMin) ||
                      !Number.isFinite(endSec)
                    ) {
                      setAction({ busy: false, error: "Todos os campos devem ser números." });
                      return;
                    }

                    if (
                      startMin < 0 ||
                      startSec < 0 ||
                      startSec > 59 ||
                      endMin < 0 ||
                      endSec < 0 ||
                      endSec > 59
                    ) {
                      setAction({ busy: false, error: "Minutos devem ser >= 0, segundos 0-59." });
                      return;
                    }

                    const startValue = startMin * 60 + startSec;
                    const endValue = endMin * 60 + endSec;

                    if (endValue <= startValue) {
                      setAction({ busy: false, error: "O fim precisa ser maior que o início." });
                      return;
                    }

                    const newSuggestedCuts = suggestedCuts.map((item) =>
                      item.cut_id === editingCutId
                        ? { ...item, start: startValue, end: endValue }
                        : item,
                    );
                    const newCuts = cuts.map((item) =>
                      item.cut_id === editingCutId
                        ? { ...item, start: startValue, end: endValue }
                        : item,
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
                  }}
                >
                  Salvar
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setShowCutEditDialog(false);
                    setEditingCutId(null);
                    setEditCutStartMinutes("");
                    setEditCutStartSeconds("");
                    setEditCutEndMinutes("");
                    setEditCutEndSeconds("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Manual Cut Dialog */}
      {showAddManualCutDialog && (
        <div
          className="dialog-overlay"
          onClick={() => {
            setShowAddManualCutDialog(false);
            setNewCutStartMinutes("");
            setNewCutStartSeconds("");
            setNewCutEndMinutes("");
            setNewCutEndSeconds("");
          }}
        >
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Adicionar Corte Manual</h3>
              <div className="dialog-actions">
                <button
                  className="icon-btn close-btn"
                  onClick={() => {
                    setShowAddManualCutDialog(false);
                    setNewCutStartMinutes("");
                    setNewCutStartSeconds("");
                    setNewCutEndMinutes("");
                    setNewCutEndSeconds("");
                  }}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <label className="field">
                  Início - Minutos
                  <input
                    type="number"
                    min="0"
                    value={newCutStartMinutes}
                    onChange={(event) => setNewCutStartMinutes(event.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="field">
                  Início - Segundos
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={newCutStartSeconds}
                    onChange={(event) => setNewCutStartSeconds(event.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: "12px",
                  marginBottom: "16px",
                }}
              >
                <label className="field">
                  Fim - Minutos
                  <input
                    type="number"
                    min="0"
                    value={newCutEndMinutes}
                    onChange={(event) => setNewCutEndMinutes(event.target.value)}
                    placeholder="0"
                  />
                </label>
                <label className="field">
                  Fim - Segundos
                  <input
                    type="number"
                    min="0"
                    max="59"
                    value={newCutEndSeconds}
                    onChange={(event) => setNewCutEndSeconds(event.target.value)}
                    placeholder="0"
                  />
                </label>
              </div>

              <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
                <button
                  className="primary"
                  onClick={async () => {
                    const startMin = Number(newCutStartMinutes) || 0;
                    const startSec = Number(newCutStartSeconds) || 0;
                    const endMin = Number(newCutEndMinutes) || 0;
                    const endSec = Number(newCutEndSeconds) || 0;

                    if (
                      !Number.isFinite(startMin) ||
                      !Number.isFinite(startSec) ||
                      !Number.isFinite(endMin) ||
                      !Number.isFinite(endSec)
                    ) {
                      setAction({ busy: false, error: "Todos os campos devem ser números." });
                      return;
                    }

                    if (
                      startMin < 0 ||
                      startSec < 0 ||
                      startSec > 59 ||
                      endMin < 0 ||
                      endSec < 0 ||
                      endSec > 59
                    ) {
                      setAction({ busy: false, error: "Minutos devem ser >= 0, segundos 0-59." });
                      return;
                    }

                    const startValue = startMin * 60 + startSec;
                    const endValue = endMin * 60 + endSec;

                    if (endValue <= startValue) {
                      setAction({ busy: false, error: "O fim precisa ser maior que o início." });
                      return;
                    }

                    // Create new cut
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
                >
                  Adicionar
                </button>
                <button
                  className="secondary"
                  onClick={() => {
                    setShowAddManualCutDialog(false);
                    setNewCutStartMinutes("");
                    setNewCutStartSeconds("");
                    setNewCutEndMinutes("");
                    setNewCutEndSeconds("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 5. Curation */}
      <section className="panel">
        <h2>5. Curadoria</h2>
        {isLoadingCuts ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "20px",
                height: "20px",
                border: "3px solid #f0f0f0",
                borderTop: "3px solid #666",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <span>Carregando cortes...</span>
          </div>
        ) : cuts.length === 0 ? (
          <p className="muted">Execute a análise para ver os cortes.</p>
        ) : (
          <div className="cuts">
            {cuts.map((cut) => (
              <article key={cut.cut_id} className="cut-card">
                <header>
                  <div>
                    <h3>{cut.cut_id}</h3>
                    <p>
                      {formatTimestamp(cut.start)} - {formatTimestamp(cut.end)}
                    </p>
                    <p className="muted">Status: {cut.status}</p>
                  </div>
                  {cut.score !== undefined && cut.score !== null && (
                    <div className="score">{cut.score}</div>
                  )}
                </header>
                <div className="reason">
                  <strong>🎣 Hook:</strong> {cut.hook_reason || "-"}
                </div>
                <div className="reason">
                  <strong>📢 Conteúdo:</strong> {cut.content_reason || "-"}
                </div>
                <div className="actions">
                  <button
                    className="primary"
                    disabled={action.busy}
                    onClick={() =>
                      runAction(
                        () => approveCut(activeVideo!.job.job_id, cut.cut_id),
                        (value) => {
                          setCuts((current) =>
                            current.map((item) => (item.cut_id === value.cut_id ? value : item)),
                          );
                        },
                      )
                    }
                  >
                    ✓ Aprovar
                  </button>
                  <button
                    className="secondary"
                    disabled={action.busy}
                    onClick={() =>
                      runAction(
                        () => rejectCut(activeVideo!.job.job_id, cut.cut_id),
                        (value) => {
                          setCuts((current) =>
                            current.map((item) => (item.cut_id === value.cut_id ? value : item)),
                          );
                        },
                      )
                    }
                  >
                    ✗ Reprovar
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {/* 6. Output */}
      <section className="panel">
        <h2>6. Saída final</h2>
        {isLoadingRenderOutputs ? (
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div
              style={{
                width: "20px",
                height: "20px",
                border: "3px solid #f0f0f0",
                borderTop: "3px solid #666",
                borderRadius: "50%",
                animation: "spin 1s linear infinite",
              }}
            />
            <span>Carregando renderizações...</span>
          </div>
        ) : renderOutputs.length === 0 ? (
          <p className="muted">{isRendering ? "Gerando cortes..." : "Nenhum render finalizado."}</p>
        ) : (
          <div className="shorts-grid">
            {renderOutputs.map((path) => {
              const url = buildRenderUrl(path);
              const fileName = path.split("/").pop() || "render.mp4";
              console.log(`[UI] Render output path: ${path}, URL: ${url}`);
              return (
                <article key={path} className="short-card">
                  <header>
                    <h3>{fileName}</h3>
                  </header>
                  <div style={{ overflow: "hidden", borderRadius: "12px", marginBottom: "12px" }}>
                    <video
                      controls
                      preload="metadata"
                      src={url}
                      style={{
                        width: "100%",
                        height: "280px",
                        objectFit: "cover",
                        display: "block",
                      }}
                      onError={(e) => {
                        console.error(`[UI] Error loading video: ${url}`, e);
                      }}
                      onLoadedMetadata={() => {
                        console.log(`[UI] Video metadata loaded: ${url}`);
                      }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      className="primary"
                      style={{ flex: 1 }}
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = url;
                        a.target = "_blank";
                        a.rel = "noreferrer";
                        a.click();
                      }}
                    >
                      👁️ Abrir vídeo
                    </button>
                    <button
                      className="secondary"
                      onClick={async () => {
                        try {
                          await deleteRenderOutput(activeVideo!.job.job_id, fileName);
                          setRenderOutputs((current) => current.filter((item) => item !== path));
                        } catch (error) {
                          console.error("Failed to delete render:", error);
                        }
                      }}
                    >
                      🗑️ Deletar
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* LLM Config Dialog */}
      {showLLMConfigDialog && (
        <div className="dialog-overlay" onClick={() => setShowLLMConfigDialog(false)}>
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "600px" }}
          >
            <div className="dialog-header">
              <h3>🤖 Configurar LLM</h3>
              <div className="dialog-actions">
                <button
                  className="icon-btn close-btn"
                  onClick={() => setShowLLMConfigDialog(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content" style={{ padding: "20px" }}>
              <div style={{ marginBottom: "12px" }}>
                <label
                  style={{
                    display: "block",
                    fontSize: "14px",
                    fontWeight: "500",
                    marginBottom: "8px",
                  }}
                >
                  System Prompt
                </label>
                <textarea
                  value={llmSystemPrompt}
                  onChange={(e) => setLlmSystemPrompt(e.target.value)}
                  style={{
                    width: "100%",
                    minHeight: "400px",
                    padding: "12px",
                    borderRadius: "8px",
                    border: "1px solid #ccc",
                    fontFamily: "monospace",
                    fontSize: "12px",
                    resize: "vertical",
                    boxSizing: "border-box",
                  }}
                  placeholder="Cole o system prompt aqui..."
                />
              </div>
              <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                <button
                  onClick={saveLLMConfig}
                  className="primary"
                  style={{
                    padding: "10px 20px",
                    borderRadius: "8px",
                  }}
                >
                  ✓ Salvar
                </button>
                <button
                  onClick={() => setShowLLMConfigDialog(false)}
                  className="secondary"
                  style={{
                    padding: "10px 20px",
                    borderRadius: "8px",
                  }}
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        </div>
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
        <div className="dialog-overlay" onClick={() => setShowDependenciesDialog(false)}>
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxHeight: "90vh", overflowY: "auto", maxWidth: "500px" }}
          >
            <div className="dialog-header">
              <h3>📦 Gerenciar dependências</h3>
              <div className="dialog-actions">
                <button
                  className="icon-btn close-btn"
                  onClick={() => setShowDependenciesDialog(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content" style={{ padding: "20px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {Object.entries(
                  dependencies || {
                    python: { installed: false, version: null },
                    whisper: { installed: false, version: null },
                    ffmpeg: { installed: false, version: null },
                    cuda: { installed: false, version: null },
                    pytorch: { installed: false, version: null },
                    ollama: { installed: false, version: null },
                  },
                ).map(([name, status]) => {
                  const isLoading = loadingDependencies.has(name);
                  const isLoadingInitial = !dependencies;
                  const displayName =
                    name === "pytorch" ? "PyTorch" : name.charAt(0).toUpperCase() + name.slice(1);
                  if (isLoading) {
                    console.log(`[UI] ${displayName} está em loading`);
                  }
                  return (
                    <div
                      key={name}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        padding: "14px 16px",
                        borderRadius: "8px",
                        border: "1px solid #e5e5e5",
                        background:
                          isLoading || isLoadingInitial
                            ? "#f3f4f6"
                            : status.installed
                              ? "#f0fdf4"
                              : "#fef2f2",
                        gap: "12px",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          width: "100%",
                        }}
                      >
                        <div style={{ flex: 1 }}></div>
                        {isLoadingInitial ? (
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "8px",
                            }}
                          >
                            <div
                              style={{
                                width: "14px",
                                height: "14px",
                                border: "2px solid #e5e7eb",
                                borderTop: "2px solid #3b82f6",
                                borderRadius: "50%",
                                animation: "spin 1s linear infinite",
                              }}
                            />
                            <span
                              style={{
                                fontWeight: "600",
                                fontSize: "14px",
                                color: "#9ca3af",
                              }}
                            >
                              {displayName}
                            </span>
                          </div>
                        ) : (
                          <span
                            style={{ fontWeight: "600", fontSize: "14px", textAlign: "center" }}
                          >
                            {displayName}
                            {!isLoading && status.version && (
                              <span
                                style={{ fontWeight: "normal", color: "#666", marginLeft: "6px" }}
                              >
                                — {status.version}
                              </span>
                            )}
                          </span>
                        )}
                        <div style={{ flex: 1, display: "flex", justifyContent: "flex-end" }}>
                          {isLoading || isLoadingInitial ? (
                            <div
                              style={{
                                width: "16px",
                                height: "16px",
                                border: "2px solid #e5e7eb",
                                borderTop: "2px solid #3b82f6",
                                borderRadius: "50%",
                                animation: "spin 1s linear infinite",
                              }}
                            />
                          ) : (
                            <div
                              style={{
                                width: "24px",
                                height: "24px",
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                fontSize: "14px",
                                fontWeight: "bold",
                                background: status.installed ? "#10b981" : "#ef4444",
                                color: "white",
                              }}
                            >
                              {status.installed ? "✓" : "✗"}
                            </div>
                          )}
                        </div>
                      </div>
                      <div
                        style={{
                          display: "flex",
                          gap: "8px",
                          justifyContent: "center",
                          width: "100%",
                        }}
                      >
                        <button
                          onClick={() => {
                            setSelectedDependencyForInstall(name);
                            setShowInstallationDialog(true);
                          }}
                          disabled={isLoading || isLoadingInitial}
                          style={{
                            padding: "4px 8px",
                            background: "transparent",
                            color: isLoading || isLoadingInitial ? "#9ca3af" : "#3b82f6",
                            border: "1px solid transparent",
                            borderRadius: "4px",
                            cursor: isLoading || isLoadingInitial ? "not-allowed" : "pointer",
                            fontSize: "12px",
                            fontWeight: "700",
                            opacity: isLoading || isLoadingInitial ? 0.6 : 1,
                            transition: "border-color 0.15s ease",
                          }}
                          onMouseEnter={(e) => {
                            if (!isLoading && !isLoadingInitial)
                              e.currentTarget.style.borderColor = "#3b82f6";
                          }}
                          onMouseLeave={(e) => {
                            if (!isLoading && !isLoadingInitial)
                              e.currentTarget.style.borderColor = "transparent";
                          }}
                        >
                          📋 Manual
                        </button>
                        {name !== "ollama" && (
                          <button
                            disabled={
                              installingDependency === name || isLoading || isLoadingInitial
                            }
                            onClick={async () => {
                              console.log(`[UI] Iniciando instalação de ${name}`);
                              setInstallingDependency(name);
                              // Adiciona ao set de loading
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
                                    // Marca como carregando enquanto atualiza
                                    console.log(
                                      `[UI] Atualizando lista de dependências para ${name}`,
                                    );
                                    const depsData = await getDependencies();
                                    setDependencies(depsData.dependencies);
                                    // Remove do loading após sucesso
                                    setLoadingDependencies((prev) => {
                                      const next = new Set(prev);
                                      next.delete(name);
                                      console.log(`[UI] Loading ${name} marcado como false:`, next);
                                      return next;
                                    });
                                  } catch (error) {
                                    console.error("Failed to refresh dependencies:", error);
                                    // Remove do loading em caso de erro
                                    setLoadingDependencies((prev) => {
                                      const next = new Set(prev);
                                      next.delete(name);
                                      return next;
                                    });
                                  }
                                } else {
                                  alert(
                                    `Erro ao instalar ${name}: ${result.error || result.message}`,
                                  );
                                  // Remove do loading em caso de erro
                                  setLoadingDependencies((prev) => {
                                    const next = new Set(prev);
                                    next.delete(name);
                                    return next;
                                  });
                                }
                              } catch (error) {
                                console.error(`Failed to install ${name}:`, error);
                                alert(`Erro ao instalar ${name}`);
                                // Remove do loading em caso de erro
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
                            style={{
                              padding: "4px 8px",
                              background: "transparent",
                              color:
                                installingDependency === name || isLoading || isLoadingInitial
                                  ? "#9ca3af"
                                  : "#10b981",
                              border: "1px solid transparent",
                              borderRadius: "4px",
                              cursor:
                                installingDependency === name || isLoading || isLoadingInitial
                                  ? "not-allowed"
                                  : "pointer",
                              fontSize: "12px",
                              fontWeight: "700",
                              opacity:
                                installingDependency === name || isLoading || isLoadingInitial
                                  ? 0.6
                                  : 1,
                              transition: "border-color 0.15s ease",
                            }}
                            onMouseEnter={(e) => {
                              if (
                                installingDependency !== name &&
                                !isLoading &&
                                !isLoadingInitial
                              ) {
                                e.currentTarget.style.borderColor = "#10b981";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (
                                installingDependency !== name &&
                                !isLoading &&
                                !isLoadingInitial
                              ) {
                                e.currentTarget.style.borderColor = "transparent";
                              }
                            }}
                          >
                            {installingDependency === name ? "⏳ Instalando..." : "⚡ Automático"}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              <div
                style={{
                  marginTop: "20px",
                  padding: "12px",
                  background: "#f9fafb",
                  borderRadius: "8px",
                }}
              >
                <p style={{ fontSize: "12px", color: "#666", margin: 0, lineHeight: "1.5" }}>
                  <strong>Nota:</strong> Dependências marcadas com ✗ precisam ser instaladas
                  manualmente. Consulte a documentação do projeto para instruções de instalação.
                </p>
              </div>

              <div
                style={{
                  display: "flex",
                  gap: "8px",
                  justifyContent: "flex-end",
                  marginTop: "16px",
                }}
              >
                <button
                  onClick={async () => {
                    try {
                      const depsData = await getDependencies();
                      setDependencies(depsData.dependencies);
                    } catch (error) {
                      console.error("Failed to refresh dependencies:", error);
                    }
                  }}
                  className="secondary"
                  style={{
                    padding: "10px 20px",
                    borderRadius: "8px",
                  }}
                >
                  🔄 Atualizar
                </button>
                <button
                  onClick={() => setShowDependenciesDialog(false)}
                  className="primary"
                  style={{
                    padding: "10px 20px",
                    borderRadius: "8px",
                  }}
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {showInstallationDialog && selectedDependencyForInstall && (
        <div className="dialog-overlay" onClick={() => setShowInstallationDialog(false)}>
          <InstallationInstructionsDialog
            dependencyName={selectedDependencyForInstall}
            onClose={() => setShowInstallationDialog(false)}
          />
        </div>
      )}

      {renameVideoId && (
        <div className="dialog-overlay" onClick={() => setRenameVideoId(null)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <h3>Renomear Vídeo</h3>
            <p style={{ color: "#666", marginBottom: "15px" }}>
              ⚠️ <strong>Importante:</strong> Não renomeie os arquivos no seu computador. Use apenas
              esta interface para manter a associação entre o vídeo, transcrições e shorts gerados.
            </p>
            <input
              type="text"
              value={renameVideoNewName}
              onChange={(e) => setRenameVideoNewName(e.target.value)}
              placeholder="Digite o novo nome do vídeo"
              style={{
                width: "100%",
                padding: "10px",
                border: "1px solid #ddd",
                borderRadius: "4px",
                marginBottom: "15px",
                boxSizing: "border-box",
              }}
              onKeyUp={(e) => {
                if (e.key === "Enter") {
                  if (renameVideoNewName.trim()) {
                    runAction(
                      () => renameVideo(renameVideoId, renameVideoNewName),
                      () => {
                        setRenameVideoId(null);
                        setRenameVideoNewName("");
                        loadVideos();
                      },
                    );
                  }
                }
              }}
            />
            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button
                onClick={() => {
                  setRenameVideoId(null);
                  setRenameVideoNewName("");
                }}
              >
                Cancelar
              </button>
              <button
                className="primary"
                onClick={() => {
                  if (renameVideoNewName.trim()) {
                    runAction(
                      () => renameVideo(renameVideoId, renameVideoNewName),
                      () => {
                        setRenameVideoId(null);
                        setRenameVideoNewName("");
                        loadVideos();
                      },
                    );
                  }
                }}
              >
                Renomear
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfigureAppDialog && (
        <div className="dialog-overlay" onClick={() => setShowConfigureAppDialog(false)}>
          <div
            className="dialog"
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "600px", maxHeight: "90vh", overflowY: "auto", padding: "24px" }}
          >
            <h3>Configurar Aplicação</h3>
            <p style={{ color: "#666", marginBottom: "20px" }}>
              Escolha onde os arquivos (vídeos, shorts e transcrições) serão armazenados no seu
              computador.
            </p>

            {/* Native Folder Picker */}
            <button
              onClick={async () => {
                try {
                  console.log("[UI] Abrindo seletor de pasta...");
                  const result = await selectFolder();
                  if (result.selected && result.path) {
                    console.log("[UI] Pasta selecionada:", result.path);
                    setConfigBaseDir(result.path);
                  } else {
                    console.log("[UI] Nenhuma pasta selecionada");
                  }
                } catch (error) {
                  console.error("Erro ao abrir seletor de pasta:", error);
                }
              }}
              style={{
                width: "100%",
                padding: "16px",
                marginBottom: "25px",
                background: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)",
                color: "white",
                border: "none",
                borderRadius: "10px",
                cursor: "pointer",
                fontWeight: "700",
                fontSize: "1.1rem",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                boxShadow: "0 4px 6px rgba(0, 0, 0, 0.1)",
                transition: "all 0.3s",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = "translateY(-2px)";
                e.currentTarget.style.boxShadow = "0 6px 12px rgba(0, 0, 0, 0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = "translateY(0)";
                e.currentTarget.style.boxShadow = "0 4px 6px rgba(0, 0, 0, 0.1)";
              }}
            >
              📂 Selecionar Pasta
            </button>

            {/* Manual Path Input */}
            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>
                📝 Ou digite o caminho manualmente
              </label>
              <input
                type="text"
                value={configBaseDir}
                onChange={(e) => setConfigBaseDir(e.target.value)}
                placeholder="Ex: C:\\Users\\seu_usuario\\Documents\\YouTubeShorts"
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  boxSizing: "border-box",
                  marginBottom: "8px",
                  fontFamily: "monospace",
                  fontSize: "0.9rem",
                }}
              />
              <p style={{ color: "#999", fontSize: "0.8rem" }}>
                📍 Caminho atual: {appSettings?.media.base_dir}
              </p>
            </div>

            <div style={{ marginBottom: "20px" }}>
              <label style={{ display: "block", marginBottom: "8px", fontWeight: "600" }}>
                🎞️ Resolução de download
              </label>
              <select
                value={configDownloadResolution}
                onChange={(e) =>
                  setConfigDownloadResolution(e.target.value as "1080p" | "1440p" | "4k")
                }
                style={{
                  width: "100%",
                  padding: "10px",
                  border: "1px solid #ddd",
                  borderRadius: "4px",
                  boxSizing: "border-box",
                  fontSize: "0.9rem",
                }}
              >
                <option value="1080p">1080p (padrao)</option>
                <option value="1440p">1440p</option>
                <option value="4k">4k</option>
              </select>
              <p style={{ color: "#999", fontSize: "0.8rem", marginTop: "6px" }}>
                📍 Resolução atual: {appSettings?.media.download_resolution || "1080p"}
              </p>
            </div>

            {/* Structure Preview */}
            <div
              style={{
                marginBottom: "20px",
                padding: "12px",
                background: "#f0f4ff",
                borderRadius: "6px",
              }}
            >
              <p style={{ color: "#333", fontSize: "0.9rem", margin: "0 0 8px 0" }}>
                <strong>📂 Estrutura que será criada:</strong>
              </p>
              <p
                style={{
                  color: "#666",
                  fontSize: "0.8rem",
                  margin: "0",
                  fontFamily: "monospace",
                  lineHeight: "1.6",
                }}
              >
                {configBaseDir || "pasta_base"}/<br />
                ├── 🎬 videos/
                <br />
                ├── 🎞️ shorts/
                <br />
                └── 📄 transcrições/
              </p>
            </div>

            <div style={{ display: "flex", gap: "10px", justifyContent: "flex-end" }}>
              <button onClick={() => setShowConfigureAppDialog(false)}>Cancelar</button>
              <button
                className="primary"
                onClick={() => {
                  if (configBaseDir.trim()) {
                    runAction(
                      () =>
                        saveSettings({
                          media: {
                            base_dir: configBaseDir,
                            download_resolution: configDownloadResolution,
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
                  }
                }}
              >
                Salvar Configurações
              </button>
            </div>
          </div>
        </div>
      )}

      {showMoveUploadDialog && (
        <div className="dialog-overlay" onClick={() => setShowMoveUploadDialog(false)}>
          <div className="dialog" onClick={(e) => e.stopPropagation()}>
            <div className="dialog-header">
              <h3>Mover video para a pasta configurada?</h3>
              <div className="dialog-actions">
                <button
                  className="icon-btn close-btn"
                  onClick={() => setShowMoveUploadDialog(false)}
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="dialog-content">
              <p>
                Deseja mover o video selecionado para a pasta configurada para evitar uma copia
                extra em disco?
              </p>
              <label style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={dontAskMoveUpload}
                  onChange={(event) => setDontAskMoveUpload(event.target.checked)}
                />
                <span>Nao perguntar novamente</span>
              </label>
              <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
                <button className="primary" onClick={() => handleMoveUploadDecision(true)}>
                  Mover e enviar
                </button>
                <button className="secondary" onClick={() => handleMoveUploadDecision(false)}>
                  Manter copia
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {action.error && <div className="toast error">{action.error}</div>}
    </div>
  );
}
