import { useState, useCallback } from "react";
import { analyzeJob, listCuts, approveCut, rejectCut } from "../api";
import type { Cut } from "../types";

export function useCuts() {
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [suggestedCuts, setSuggestedCuts] = useState<Cut[]>([]);
  const [selectedSuggestedCutId, setSelectedSuggestedCutId] = useState<string | null>(null);
  const [keepCutIds, setKeepCutIds] = useState<string[]>([]);
  const [aiResponseRaw, setAiResponseRaw] = useState<string | null>(null);

  const loadCuts = useCallback(async (jobId: string) => {
    try {
      const data = await listCuts(jobId);
      setCuts(data);
      return data;
    } catch (error) {
      console.error("Failed to load cuts:", error);
      return [];
    }
  }, []);

  const analyzeAndGenerateCuts = useCallback(async (jobId: string) => {
    try {
      const result = await analyzeJob(jobId);
      setSuggestedCuts(result.cuts);
      if (result.raw_response) {
        setAiResponseRaw(result.raw_response);
      }
      return result.cuts;
    } catch (error) {
      console.error("Analysis error:", error);
      return [];
    }
  }, []);

  const approveCutSelection = useCallback(async (jobId: string, cutId: string) => {
    try {
      const approved = await approveCut(jobId, cutId);
      setCuts((current) => current.map((c) => (c.cut_id === cutId ? approved : c)));
      return approved;
    } catch (error) {
      console.error("Failed to approve cut:", error);
      throw error;
    }
  }, []);

  const rejectCutSelection = useCallback(async (jobId: string, cutId: string) => {
    try {
      const rejected = await rejectCut(jobId, cutId);
      setCuts((current) => current.map((c) => (c.cut_id === cutId ? rejected : c)));
      return rejected;
    } catch (error) {
      console.error("Failed to reject cut:", error);
      throw error;
    }
  }, []);

  return {
    cuts,
    suggestedCuts,
    selectedSuggestedCutId,
    keepCutIds,
    aiResponseRaw,
    loadCuts,
    analyzeAndGenerateCuts,
    approveCutSelection,
    rejectCutSelection,
    setSelectedSuggestedCutId,
    setKeepCutIds,
    setSuggestedCuts,
    setAiResponseRaw,
  };
}
