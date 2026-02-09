import { useState, useCallback } from "react";
import type { Cut } from "../types";
import { listCuts } from "../api";

/**
 * Hook for managing cuts state
 */
export function useCutsState() {
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [suggestedCuts, setSuggestedCuts] = useState<Cut[]>([]);
  const [selectedSuggestedCutId, setSelectedSuggestedCutId] = useState<string | null>(null);
  const [isLoadingCuts, setIsLoadingCuts] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const loadCuts = useCallback(async (jobId: string) => {
    console.log(`[UI] Loading cuts for video ${jobId}`);
    setCuts([]);
    setSuggestedCuts([]);
    setIsLoadingCuts(true);

    const startLoadTime = Date.now();

    try {
      const loadedCuts = await listCuts(jobId);
      console.log(`[UI] Loaded ${loadedCuts.length} cuts for video ${jobId}`);
      setCuts(loadedCuts);
      setSuggestedCuts(loadedCuts);
    } catch (error) {
      console.error("Failed to load cuts:", error);
      setCuts([]);
      setSuggestedCuts([]);
    } finally {
      const elapsedTime = Date.now() - startLoadTime;
      const remainingTime = Math.max(0, 500 - elapsedTime);

      setTimeout(() => {
        console.log(`[UI] Set isLoadingCuts to false after ${elapsedTime + remainingTime}ms`);
        setIsLoadingCuts(false);
      }, remainingTime);
    }
  }, []);

  return {
    cuts,
    setCuts,
    suggestedCuts,
    setSuggestedCuts,
    selectedSuggestedCutId,
    setSelectedSuggestedCutId,
    isLoadingCuts,
    isAnalyzing,
    setIsAnalyzing,
    loadCuts,
  };
}
