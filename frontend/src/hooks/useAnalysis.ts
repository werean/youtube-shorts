/**
 * Hook para gerenciar estado de análise (cuts, blocks, AI response)
 */

import { useState, useCallback } from "react";
import type { Cut } from "../types";
import { buildBlocks, analyzeJob } from "../api";

export function useAnalysis() {
  const [blocks, setBlocks] = useState<Record<string, unknown>[]>([]);
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [suggestedCuts, setSuggestedCuts] = useState<Cut[]>([]);
  const [selectedSuggestedCutId, setSelectedSuggestedCutId] = useState<string | null>(null);
  const [aiResponseRaw, setAiResponseRaw] = useState<string | null>(null);

  const buildSemanticBlocks = useCallback(async (jobId: string) => {
    try {
      const result = await buildBlocks(jobId);
      const blockArray = Array.isArray(result) ? result : [];
      setBlocks(blockArray);
      return blockArray;
    } catch (error) {
      console.error("Failed to build blocks:", error);
      return [];
    }
  }, []);

  const runAnalysis = useCallback(async (jobId: string) => {
    try {
      const result = await analyzeJob(jobId);
      const resultCuts = Array.isArray(result) ? result : result.cuts || [];
      setSuggestedCuts(resultCuts);
      setCuts(resultCuts);
      if (result.raw_response) {
        setAiResponseRaw(result.raw_response);
      }
      return result;
    } catch (error) {
      console.error("Analysis error:", error);
      throw error;
    }
  }, []);

  const clearAnalysis = useCallback(() => {
    setBlocks([]);
    setSuggestedCuts([]);
    setCuts([]);
    setAiResponseRaw(null);
    setSelectedSuggestedCutId(null);
  }, []);

  return {
    blocks,
    cuts,
    suggestedCuts,
    selectedSuggestedCutId,
    aiResponseRaw,
    setBlocks,
    setCuts,
    setSuggestedCuts,
    setSelectedSuggestedCutId,
    setAiResponseRaw,
    buildSemanticBlocks,
    runAnalysis,
    clearAnalysis,
  };
}
