import { useEffect, useMemo, useRef, useState } from "react";
import { cancelRendering } from "../api/cancel";
import { updateCuts } from "../api/cuts";
import { getJob } from "../api/jobs";
import {
  deleteRenderOutput,
  listRenderOutputs,
  openRenderFolder,
  renderJob,
} from "../api/rendering";
import type { Cut } from "../types";
import { buildRenderUrl as buildRenderUrlUtil } from "../utils/formatters";
import type { VideoItem } from "../utils/videoHelpers";

type RunAction = <T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) => Promise<void>;
type UpdateVideo = (jobId: string, updates: Partial<VideoItem>) => void;

interface UseRenderingWorkflowOptions {
  activeJobId: string | null;
  cuts: Cut[];
  runAction: RunAction;
  updateVideo: UpdateVideo;
  prepareRenderTaskLog: () => void;
  stopTaskLogsPolling: () => void;
  onRenderTimeout: () => void;
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

function isCutApproved(cut: Cut): boolean {
  return cut.approved === true || cut.status === "approved";
}

function isCutRejected(cut: Cut): boolean {
  return cut.rejected === true || cut.status === "rejected";
}

function getExpectedRenderCutCount(cuts: Cut[]): number {
  const approvedCount = cuts.filter(isCutApproved).length;
  if (approvedCount > 0) {
    return approvedCount;
  }
  return cuts.filter((cut) => !isCutRejected(cut)).length;
}

export function useRenderingWorkflow({
  activeJobId,
  cuts,
  runAction,
  updateVideo,
  prepareRenderTaskLog,
  stopTaskLogsPolling,
  onRenderTimeout,
}: UseRenderingWorkflowOptions) {
  const [renderOutputs, setRenderOutputs] = useState<string[]>([]);
  const [renderOutputsVersion, setRenderOutputsVersion] = useState(0);
  const [isRendering, setIsRendering] = useState(false);
  const [isLoadingRenderOutputs, setIsLoadingRenderOutputs] = useState(false);
  const [expectedRenderCount, setExpectedRenderCount] = useState(0);
  const renderPollRef = useRef<number | null>(null);
  const renderPollStartTimeRef = useRef<number | null>(null);
  const renderOutputsKeyRef = useRef<string>("");
  const expectedRenderCountRef = useRef<number>(0);

  const renderTitlesByFileName = useMemo(() => {
    const next: Record<string, string> = {};

    for (const cut of cuts) {
      const filename = buildCutFilenameFromRange(cut.start, cut.end);
      next[filename] = toCatchyTitle(cut);
    }

    return next;
  }, [cuts]);

  function applyRenderOutputs(outputs: string[], forceVersionBump = false) {
    const outputsKey = outputs.join("|");
    if (outputsKey !== renderOutputsKeyRef.current) {
      renderOutputsKeyRef.current = outputsKey;
      setRenderOutputs(outputs);
      setRenderOutputsVersion((value) => value + 1);
      return;
    }
    if (forceVersionBump) {
      setRenderOutputsVersion((value) => value + 1);
    }
  }

  function clearRenderOutputs() {
    renderOutputsKeyRef.current = "";
    setRenderOutputs([]);
  }

  function stopRenderPolling() {
    if (renderPollRef.current) {
      window.clearInterval(renderPollRef.current);
      renderPollRef.current = null;
    }
    renderPollStartTimeRef.current = null;
    setIsRendering(false);
  }

  async function refreshRenderOutputs(jobId?: string) {
    const targetJobId = jobId ?? activeJobId;
    if (!targetJobId) return;
    try {
      const outputs = await listRenderOutputs(targetJobId);
      applyRenderOutputs(outputs);
    } catch (error) {
      console.error("[render] Failed to refresh outputs:", error);
    }
  }

  async function pollRenderOutputs(jobId: string) {
    try {
      const outputs = await listRenderOutputs(jobId);
      applyRenderOutputs(outputs);

      const job = await getJob(jobId);
      updateVideo(jobId, { job });

      const currentExpectedCount = expectedRenderCountRef.current;
      if (currentExpectedCount > 0 && outputs.length >= currentExpectedCount) {
        console.log(
          `[render] All expected renders completed (${outputs.length}/${currentExpectedCount})`,
        );
        stopRenderPolling();
        return;
      }

      if (job.status === "DONE") {
        const finalOutputs = await listRenderOutputs(jobId);
        applyRenderOutputs(finalOutputs, true);
        console.log(`[render] Job status is DONE, stopping polling`);
        stopRenderPolling();
        return;
      }

      if (job.status === "ERROR") {
        console.log(`[render] Job status is ${job.status}, stopping polling`);
        setRenderOutputsVersion((value) => value + 1);
        stopRenderPolling();
        return;
      }

      if (job.status !== "RENDERING") {
        const startupGraceMs = 30 * 1000;
        const startedAt = renderPollStartTimeRef.current;
        const elapsedMs = startedAt ? Date.now() - startedAt : 0;

        if (elapsedMs < startupGraceMs) {
          return;
        }

        console.log(`[render] Job status is ${job.status} after startup grace, stopping polling`);
        setRenderOutputsVersion((value) => value + 1);
        stopRenderPolling();
        return;
      }

      if (renderPollStartTimeRef.current) {
        const elapsedMs = Date.now() - renderPollStartTimeRef.current;
        const maxTimeMs = 2 * 60 * 60 * 1000;
        if (elapsedMs > maxTimeMs) {
          console.error(`[render] Render polling timeout after ${elapsedMs}ms`);
          onRenderTimeout();
          stopRenderPolling();
        }
      }
    } catch (error) {
      console.error("[render] Failed to poll outputs:", error);
    }
  }

  function startRenderPolling(jobId: string, totalCuts: number) {
    expectedRenderCountRef.current = totalCuts;
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

  function buildRenderUrl(renderPath: string): string {
    return buildRenderUrlUtil(renderPath, renderOutputsVersion);
  }

  function startRenderFlow() {
    if (!activeJobId) return undefined;
    const expectedCutsToRender = getExpectedRenderCutCount(cuts);

    return runAction(async () => {
      console.log(`[UI] Renderização iniciada`);
      prepareRenderTaskLog();
      stopTaskLogsPolling();
      clearRenderOutputs();
      startRenderPolling(activeJobId, expectedCutsToRender);

      await updateCuts(activeJobId, cuts);
      try {
        return await renderJob(activeJobId);
      } catch (error) {
        stopRenderPolling();
        throw error;
      }
    });
  }

  async function cancelActiveRendering() {
    if (!activeJobId) return;

    console.log(`[UI] Cancelando renderização: ${activeJobId}`);
    try {
      await cancelRendering(activeJobId);
      setIsRendering(false);
      stopRenderPolling();
      stopTaskLogsPolling();
      console.log(`[UI] Renderização cancelada`);
    } catch (error) {
      console.error("[UI] Erro ao cancelar renderização:", error);
    }
  }

  async function openRenderOutputFolder(fileName: string) {
    if (!activeJobId) {
      throw new Error("Nenhum vídeo selecionado");
    }
    await runAction(() => openRenderFolder(activeJobId, fileName));
  }

  async function deleteRenderOutputFile(fileName: string) {
    if (activeJobId) {
      await deleteRenderOutput(activeJobId, fileName);
      setRenderOutputs((current) => current.filter((path) => !path.endsWith(fileName)));
    }
  }

  useEffect(() => {
    return () => {
      if (renderPollRef.current) {
        window.clearInterval(renderPollRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!activeJobId) {
      stopRenderPolling();
      return;
    }
  }, [activeJobId]);

  useEffect(() => {
    if (isRendering === false && renderPollRef.current !== null) {
      console.log("[render] isRendering false but poll still running, stopping...");
      stopRenderPolling();
    }
  }, [isRendering]);

  useEffect(() => {
    if (activeJobId) {
      renderOutputsKeyRef.current = "";
      clearRenderOutputs();
      setIsLoadingRenderOutputs(true);
      console.log(`[UI] Set isLoadingRenderOutputs to true`);

      const startLoadTime = Date.now();

      pollRenderOutputs(activeJobId).finally(() => {
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
  }, [activeJobId]);

  return {
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
  };
}
