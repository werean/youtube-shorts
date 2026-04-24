import { useMemo, useState } from "react";
import { cancelTranscription } from "../api/cancel";
import { deleteTranscription, getTranscription, transcribeJob } from "../api/transcription";
import type { Segment } from "../types";
import { getTranscriptionContent, type VideoItem } from "../utils/videoHelpers";

type TranscriptionFormat = "text" | "vtt" | "segments";
type RunAction = <T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) => Promise<void>;
type UpdateVideo = (jobId: string, updates: Partial<VideoItem>) => void;

interface UseTranscriptionWorkflowOptions {
  activeVideo: VideoItem | undefined;
  runAction: RunAction;
  updateVideo: UpdateVideo;
  refreshVideo: (jobId: string) => void | Promise<void>;
  closeBlocksDialog: () => void;
  clearBlocks: () => void;
  clearSelectedCut: () => void;
  clearSuggestedCuts: () => void;
  prepareTranscriptionTaskLog: () => void;
  stopTaskLogsPolling: () => void;
}

function normalizeAvailableFormats(formats: any) {
  return formats
    ? {
        segments: Boolean(formats.segments),
        text: Boolean(formats.text),
        vtt: Boolean(formats.vtt),
      }
    : undefined;
}

export function useTranscriptionWorkflow({
  activeVideo,
  runAction,
  updateVideo,
  refreshVideo,
  closeBlocksDialog,
  clearBlocks,
  clearSelectedCut,
  clearSuggestedCuts,
  prepareTranscriptionTaskLog,
  stopTaskLogsPolling,
}: UseTranscriptionWorkflowOptions) {
  const [showTranscriptionFormatListDialog, setShowTranscriptionFormatListDialog] =
    useState(false);
  const [showTranscriptionContentDialog, setShowTranscriptionContentDialog] = useState(false);
  const [showTranscriptionDeleteDialog, setShowTranscriptionDeleteDialog] = useState(false);
  const [selectedTranscriptionFormat, setSelectedTranscriptionFormat] =
    useState<TranscriptionFormat | null>(null);
  const [pendingDeleteFormat, setPendingDeleteFormat] = useState<TranscriptionFormat | null>(null);
  const [showTranscriptionRegenerateConfirmDialog, setShowTranscriptionRegenerateConfirmDialog] =
    useState(false);

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

  function closeTranscriptionDialogs() {
    setShowTranscriptionFormatListDialog(false);
    setShowTranscriptionContentDialog(false);
    setShowTranscriptionDeleteDialog(false);
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
    closeBlocksDialog();
    setSelectedTranscriptionFormat(null);
    setPendingDeleteFormat(null);
    clearSelectedCut();
    clearBlocks();
    clearSuggestedCuts();
    prepareTranscriptionTaskLog();
    stopTaskLogsPolling();
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

  function requestTranscriptionStart() {
    if (hasAnyTranscription) {
      setShowTranscriptionRegenerateConfirmDialog(true);
      return;
    }

    return startTranscriptionFlow();
  }

  async function cancelActiveTranscription() {
    if (!activeVideo) {
      return;
    }

    console.log(`[UI] Cancelando transcrição: ${activeVideo.job.job_id}`);
    try {
      await cancelTranscription(activeVideo.job.job_id);
      updateVideo(activeVideo.job.job_id, {
        isTranscribing: false,
      });
      stopTaskLogsPolling();
      console.log(`[UI] Transcrição cancelada`);
    } catch (error) {
      console.error("[UI] Erro ao cancelar transcrição:", error);
    }
  }

  function selectTranscriptionFormat(format: TranscriptionFormat) {
    setSelectedTranscriptionFormat(format);
    setShowTranscriptionContentDialog(true);
  }

  function deleteAllTranscriptionFormats() {
    if (!activeVideo) return;

    runAction(
      () => deleteTranscription(activeVideo.job.job_id, "all"),
      (result: any) => {
        const nextFormats = normalizeAvailableFormats(result?.available_formats);

        updateVideo(activeVideo.job.job_id, {
          transcription: "",
          transcriptionSegments: [],
          transcriptionFormats: nextFormats,
        });

        setShowTranscriptionContentDialog(false);
        setShowTranscriptionDeleteDialog(false);
        setSelectedTranscriptionFormat(null);
        setPendingDeleteFormat(null);
        setShowTranscriptionFormatListDialog(false);
      },
    );
  }

  function requestDeleteTranscriptionFormat(format: TranscriptionFormat) {
    setPendingDeleteFormat(format);
    setShowTranscriptionDeleteDialog(true);
  }

  function cancelDeleteTranscriptionFormat() {
    setShowTranscriptionDeleteDialog(false);
    setPendingDeleteFormat(null);
  }

  function confirmDeleteTranscriptionFormat(format: TranscriptionFormat) {
    if (!activeVideo) return;

    runAction(
      () => deleteTranscription(activeVideo.job.job_id, format),
      (result: any) => {
        const nextFormats = normalizeAvailableFormats(result?.available_formats);
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
    );
  }

  return {
    showTranscriptionFormatListDialog,
    showTranscriptionContentDialog,
    showTranscriptionDeleteDialog,
    showTranscriptionRegenerateConfirmDialog,
    selectedTranscriptionFormat,
    pendingDeleteFormat,
    transcriptionContent,
    hasAnyTranscription,
    activeVideoHasText: Boolean(activeVideo?.transcription),
    activeVideoHasVtt: Boolean(activeVideo?.transcriptionFormats?.vtt),
    activeVideoHasSegments: Boolean(activeVideo?.transcriptionSegments?.length),
    hydrateTranscriptions,
    startTranscriptionFlow,
    requestTranscriptionStart,
    cancelActiveTranscription,
    openTranscriptionFormatList: () => setShowTranscriptionFormatListDialog(true),
    closeTranscriptionFormatList: () => setShowTranscriptionFormatListDialog(false),
    closeTranscriptionContent: () => setShowTranscriptionContentDialog(false),
    requestDeleteTranscriptionFormat,
    cancelDeleteTranscriptionFormat,
    confirmDeleteTranscriptionFormat,
    selectTranscriptionFormat,
    deleteAllTranscriptionFormats,
    closeTranscriptionRegenerateConfirm: () => setShowTranscriptionRegenerateConfirmDialog(false),
    confirmTranscriptionRegenerate: startTranscriptionFlow,
    closeTranscriptionDialogs,
  };
}
