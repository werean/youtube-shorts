import { useState, useCallback, useRef, useEffect } from "react";
import { renderJob, listRenderOutputs } from "../api";

export function useRendering() {
  const [renderOutputs, setRenderOutputs] = useState<string[]>([]);
  const [isRendering, setIsRendering] = useState(false);
  const [expectedRenderCount, setExpectedRenderCount] = useState(0);
  const renderPollRef = useRef<number | null>(null);

  const pollRenderOutputs = useCallback(
    async (jobId: string, onUpdate?: (outputs: string[]) => void) => {
      try {
        const outputs = await listRenderOutputs(jobId);
        setRenderOutputs(outputs);
        onUpdate?.(outputs);
        return outputs.length >= expectedRenderCount;
      } catch (error) {
        console.error("Failed to poll outputs:", error);
        return false;
      }
    },
    [expectedRenderCount],
  );

  const startRenderPolling = useCallback(
    (jobId: string, totalCuts: number) => {
      setExpectedRenderCount(totalCuts);
      setIsRendering(true);

      if (renderPollRef.current) {
        window.clearInterval(renderPollRef.current);
      }

      void pollRenderOutputs(jobId);
      renderPollRef.current = window.setInterval(() => {
        void pollRenderOutputs(jobId);
      }, 2000);
    },
    [pollRenderOutputs],
  );

  const stopRenderPolling = useCallback(() => {
    if (renderPollRef.current) {
      window.clearInterval(renderPollRef.current);
      renderPollRef.current = null;
    }
    setIsRendering(false);
  }, []);

  const startRender = useCallback(async (jobId: string) => {
    try {
      const result = await renderJob(jobId);
      return result.started;
    } catch (error) {
      console.error("Failed to start render:", error);
      return false;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (renderPollRef.current) {
        window.clearInterval(renderPollRef.current);
      }
    };
  }, []);

  return {
    renderOutputs,
    isRendering,
    expectedRenderCount,
    pollRenderOutputs,
    startRenderPolling,
    stopRenderPolling,
    startRender,
    setRenderOutputs,
  };
}
