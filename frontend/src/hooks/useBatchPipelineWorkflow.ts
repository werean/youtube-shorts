import { useEffect, useRef, useState } from "react";
import type { BatchPipelineOptions } from "@youtube-shorts/contracts";
import {
  cancelBatchPipeline,
  continueBatchPipeline,
  getBatchPipelineStatus,
  listVideos,
  startBatchPipeline,
} from "../api";
import { recordToVideoItem, type VideoItem } from "../utils/videoHelpers";
import type { WatermarkRenderDecision } from "./useWatermark";

const initialBatchPipelineOptions: BatchPipelineOptions = {
  transcription: true,
  analysis: false,
  render: false,
  preApprove: false,
};

interface BatchPipelineWorkflowOptions {
  onActiveVideosLoaded: (videos: VideoItem[]) => void;
  /** Decide o campo `watermark` quando o lote inclui renderização (pergunta no modo "ask"). */
  resolveWatermark?: () => Promise<WatermarkRenderDecision>;
}

export function useBatchPipelineWorkflow({
  onActiveVideosLoaded,
  resolveWatermark,
}: BatchPipelineWorkflowOptions) {
  const [showBatchPipelineDialog, setShowBatchPipelineDialog] = useState(false);
  const [selectedVideosForBatch, setSelectedVideosForBatch] = useState<string[]>([]);
  const [batchPipelineOptions, setBatchPipelineOptions] = useState(initialBatchPipelineOptions);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [batchProcessingLogs, setBatchProcessingLogs] = useState<string[]>([]);
  const [currentBatchVideoIndex, setCurrentBatchVideoIndex] = useState(0);
  const [activeBatchId, setActiveBatchId] = useState<string | null>(null);
  const [showBatchCompletionNotification, setShowBatchCompletionNotification] = useState(false);
  const [batchCompletionMessage, setBatchCompletionMessage] = useState("");
  const [batchWaitingForApproval, setBatchWaitingForApproval] = useState(false);
  const [batchPendingCuts, setBatchPendingCuts] = useState<any[]>([]);
  const batchPollRef = useRef<number | null>(null);

  function stopBatchPolling() {
    if (batchPollRef.current) {
      window.clearInterval(batchPollRef.current);
      batchPollRef.current = null;
    }
  }

  function startBatchPolling(batchId: string) {
    if (batchPollRef.current) {
      window.clearInterval(batchPollRef.current);
    }

    const pollBatch = async () => {
      try {
        const progress = await getBatchPipelineStatus(batchId);

        setCurrentBatchVideoIndex(progress.current_job_index);

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
          return;
        }

        setBatchWaitingForApproval(false);
        setBatchPendingCuts([]);

        const stepLabels: Record<string, string> = {
          starting: "Iniciando...",
          transcription: "Transcrição",
          semantic_blocks: "Blocos Semânticos",
          analysis: "Análise com IA",
          rendering: "Renderização",
          completed: "Concluído",
          waiting_approval: "Aguardando aprovação",
        };

        const newLog = `Vídeo ${progress.current_job_index + 1} - ${
          stepLabels[progress.current_step] || progress.current_step
        }`;

        setBatchProcessingLogs((prev) => {
          if (prev[prev.length - 1] !== newLog) {
            return [...prev, newLog];
          }
          return prev;
        });

        if (!progress.is_running) {
          stopBatchPolling();
          setIsBatchProcessing(false);
          setBatchWaitingForApproval(false);

          const completionMessage = `Pipeline em Lote Concluído!\n\nSucesso: ${progress.completed_jobs.length}\nFalhas: ${progress.failed_jobs.length}`;

          setBatchProcessingLogs((prev) => [
            ...prev,
            "",
            `Processamento concluído!`,
            `   Sucesso: ${progress.completed_jobs.length}`,
            `   Falhas: ${progress.failed_jobs.length}`,
          ]);

          if (progress.failed_jobs.length > 0) {
            setBatchProcessingLogs((prev) => [
              ...prev,
              "",
              "Jobs com falha:",
              ...progress.failed_jobs.map((f) => `   - ${f.job_id}: ${f.error}`),
            ]);
          }

          setBatchCompletionMessage(completionMessage);
          setShowBatchCompletionNotification(true);

          const activeVideos = await listVideos();
          onActiveVideosLoaded(activeVideos.map(recordToVideoItem));
        }
      } catch (error: any) {
        console.error("[UI] Error polling batch status:", error);
        stopBatchPolling();
        setBatchProcessingLogs((prev) => [...prev, `Erro ao buscar status: ${error.message}`]);
        setIsBatchProcessing(false);
      }
    };

    pollBatch();
    batchPollRef.current = window.setInterval(pollBatch, 2000);
  }

  function openBatchPipelineDialog() {
    setSelectedVideosForBatch([]);
    setBatchPipelineOptions(initialBatchPipelineOptions);
    setBatchProcessingLogs([]);
    setShowBatchPipelineDialog(true);
  }

  async function continueActiveBatchPipeline() {
    if (!activeBatchId) return;
    try {
      await continueBatchPipeline(activeBatchId);
      setBatchWaitingForApproval(false);
      setBatchPendingCuts([]);
      setBatchProcessingLogs((prev) => [...prev, "Cortes aprovados, continuando pipeline..."]);
    } catch (error: any) {
      console.error("[UI] Error continuing batch pipeline:", error);
      setBatchProcessingLogs((prev) => [...prev, `Erro ao continuar: ${error.message}`]);
    }
  }

  function toggleBatchVideo(videoId: string) {
    setSelectedVideosForBatch((prev) =>
      prev.includes(videoId) ? prev.filter((id) => id !== videoId) : [...prev, videoId],
    );
  }

  function updateBatchPipelineOptions(changes: Partial<BatchPipelineOptions>) {
    setBatchPipelineOptions((prev) => ({ ...prev, ...changes }));
  }

  async function cancelBatchPipelineDialog() {
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
  }

  async function startBatchPipelineDialog() {
    if (selectedVideosForBatch.length === 0) {
      alert("Selecione pelo menos um vídeo");
      return;
    }

    let pipelineOptions = batchPipelineOptions;
    if (batchPipelineOptions.render && resolveWatermark) {
      const decision = await resolveWatermark();
      if (!decision.proceed) return;
      if (decision.watermark !== undefined) {
        pipelineOptions = { ...batchPipelineOptions, watermark: decision.watermark };
      }
    }

    try {
      setIsBatchProcessing(true);
      setBatchProcessingLogs([
        `Iniciando processamento de ${selectedVideosForBatch.length} vídeo(s)...`,
      ]);

      setShowBatchPipelineDialog(false);

      const result = await startBatchPipeline(selectedVideosForBatch, pipelineOptions);

      setActiveBatchId(result.batch_id);
      setBatchProcessingLogs((prev) => [...prev, `Pipeline iniciado (ID: ${result.batch_id})`]);

      startBatchPolling(result.batch_id);
    } catch (error: any) {
      console.error("[UI] Error starting batch pipeline:", error);
      setBatchProcessingLogs((prev) => [...prev, `Erro ao iniciar pipeline: ${error.message}`]);
      setIsBatchProcessing(false);
    }
  }

  function closeBatchCompletionNotification() {
    setShowBatchCompletionNotification(false);
    setBatchCompletionMessage("");
  }

  async function startSingleJobPipeline(jobId: string, options: BatchPipelineOptions) {
    try {
      setIsBatchProcessing(true);
      setBatchWaitingForApproval(false);
      setBatchPendingCuts([]);
      setBatchProcessingLogs([`Iniciando processamento do vídeo...`]);
      const result = await startBatchPipeline([jobId], options);
      setActiveBatchId(result.batch_id);
      startBatchPolling(result.batch_id);
      return result.batch_id;
    } catch (error: any) {
      console.error("[UI] Error starting single job pipeline:", error);
      setBatchProcessingLogs((prev) => [...prev, `Erro ao iniciar pipeline: ${error.message}`]);
      setIsBatchProcessing(false);
      throw error;
    }
  }

  useEffect(() => {
    return () => {
      stopBatchPolling();
    };
  }, []);

  return {
    showBatchPipelineDialog,
    selectedVideosForBatch,
    batchPipelineOptions,
    isBatchProcessing,
    batchProcessingLogs,
    currentBatchVideoIndex,
    activeBatchId,
    showBatchCompletionNotification,
    batchCompletionMessage,
    batchWaitingForApproval,
    batchPendingCuts,
    setShowBatchPipelineDialog,
    openBatchPipelineDialog,
    continueActiveBatchPipeline,
    toggleBatchVideo,
    updateBatchPipelineOptions,
    cancelBatchPipelineDialog,
    startBatchPipelineDialog,
    startSingleJobPipeline,
    closeBatchCompletionNotification,
  };
}
