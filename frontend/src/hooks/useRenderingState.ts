import { useState, useCallback, useRef } from "react";
import { listRenderOutputs, getJob } from "../api";
import { usePolling } from "./usePolling";
import type { VideoItem } from "../utils/videoHelpers";

/**
 * Hook for managing rendering state and polling render outputs
 */
export function useRendering() {
  const [isRendering, setIsRendering] = useState(false);
  const [renderOutputs, setRenderOutputs] = useState<string[]>([]);
  const [renderOutputsVersion, setRenderOutputsVersion] = useState(0);
  const [isLoadingRenderOutputs, setIsLoadingRenderOutputs] = useState(false);
  const [expectedRenderCount, setExpectedRenderCount] = useState(0);

  const renderOutputsKeyRef = useRef<string>("");
  const renderPollStartTimeRef = useRef<number | null>(null);

  const { startPolling, stopPolling } = usePolling();

  const pollRenderOutputs = useCallback(
    async (jobId: string, updateVideo: (jobId: string, updates: Partial<VideoItem>) => void) => {
      try {
        const outputs = await listRenderOutputs(jobId);
        const outputsKey = outputs.join("|");

        if (outputsKey !== renderOutputsKeyRef.current) {
          renderOutputsKeyRef.current = outputsKey;
          setRenderOutputs(outputs);
          setRenderOutputsVersion((v) => v + 1);
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

        if (job.status === "DONE" || job.status === "ERROR" || job.status !== "RENDERING") {
          console.log(`[render] Job status is ${job.status}, stopping polling`);
          setRenderOutputsVersion((v) => v + 1);
          stopRenderPolling();
          return;
        }

        // Check timeout (2 hours)
        if (renderPollStartTimeRef.current) {
          const elapsedMs = Date.now() - renderPollStartTimeRef.current;
          const maxTimeMs = 2 * 60 * 60 * 1000;
          if (elapsedMs > maxTimeMs) {
            console.error(`[render] Render polling timeout after ${elapsedMs}ms`);
            stopRenderPolling();
          }
        }
      } catch (error) {
        console.error("[render] Failed to poll outputs:", error);
      }
    },
    [expectedRenderCount, stopPolling],
  );

  const startRenderPolling = useCallback(
    (
      jobId: string,
      totalCuts: number,
      updateVideo: (jobId: string, updates: Partial<VideoItem>) => void,
    ) => {
      setExpectedRenderCount(totalCuts);
      setIsRendering(true);
      renderPollStartTimeRef.current = Date.now();
      startPolling(() => pollRenderOutputs(jobId, updateVideo), 2000);
    },
    [startPolling, pollRenderOutputs],
  );

  const stopRenderPolling = useCallback(() => {
    stopPolling();
    renderPollStartTimeRef.current = null;
    setIsRendering(false);
  }, [stopPolling]);

  const loadRenderOutputs = useCallback(async (jobId: string) => {
    renderOutputsKeyRef.current = "";
    setRenderOutputs([]);
    setIsLoadingRenderOutputs(true);

    const startLoadTime = Date.now();

    try {
      const outputs = await listRenderOutputs(jobId);
      setRenderOutputs(outputs);
      renderOutputsKeyRef.current = outputs.join("|");
    } catch (error) {
      console.error("Failed to load render outputs:", error);
    } finally {
      const elapsedTime = Date.now() - startLoadTime;
      const remainingTime = Math.max(0, 500 - elapsedTime);

      setTimeout(() => {
        setIsLoadingRenderOutputs(false);
      }, remainingTime);
    }
  }, []);

  return {
    isRendering,
    setIsRendering,
    renderOutputs,
    renderOutputsVersion,
    isLoadingRenderOutputs,
    startRenderPolling,
    stopRenderPolling,
    loadRenderOutputs,
    pollRenderOutputs,
  };
}
