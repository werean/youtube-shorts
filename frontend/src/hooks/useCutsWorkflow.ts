import { useState } from "react";
import { listCuts, updateCuts } from "../api/cuts";
import { saveSettings, type AppSettings } from "../api/config";
import type { Cut } from "../types";

type CutHoverAction = "edit" | "delete";
type RunAction = <T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) => Promise<void>;

interface UseCutsWorkflowOptions {
  activeJobId: string | null;
  appSettings: AppSettings | null;
  showAiResponseOnAnalyze: boolean;
  runAction: RunAction;
  onAppSettingsUpdated: (settings: AppSettings) => void;
  onAiResponseRawChange: (rawResponse: string | null) => void;
  onShowAiResponseDialogChange: (show: boolean) => void;
  onRefreshVideo: (jobId: string) => void;
  onPausePlayback: () => void;
  onSeekAndPlay: (seconds: number) => void;
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

export function useCutsWorkflow({
  activeJobId,
  appSettings,
  showAiResponseOnAnalyze,
  runAction,
  onAppSettingsUpdated,
  onAiResponseRawChange,
  onShowAiResponseDialogChange,
  onRefreshVideo,
  onPausePlayback,
  onSeekAndPlay,
}: UseCutsWorkflowOptions) {
  const [cuts, setCuts] = useState<Cut[]>([]);
  const [suggestedCuts, setSuggestedCuts] = useState<Cut[]>([]);
  const [selectedSuggestedCutId, setSelectedSuggestedCutId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoadingCuts, setIsLoadingCuts] = useState(false);
  const [hoveredCutId, setHoveredCutId] = useState<string | null>(null);
  const [hoveredCutAction, setHoveredCutAction] = useState<CutHoverAction | null>(null);
  const [showDeleteCutConfirmDialog, setShowDeleteCutConfirmDialog] = useState(false);
  const [pendingDeleteCutId, setPendingDeleteCutId] = useState<string | null>(null);
  const [dontAskDeleteCutAgain, setDontAskDeleteCutAgain] = useState(false);

  function applyCuts(nextCuts: Cut[]) {
    setCuts(nextCuts);
    setSuggestedCuts(nextCuts);
  }

  function clearCuts() {
    setCuts([]);
    setSuggestedCuts([]);
    setSelectedSuggestedCutId(null);
    setHoveredCutId(null);
    setHoveredCutAction(null);
  }

  function clearSuggestedCuts() {
    setSuggestedCuts([]);
  }

  function clearSelectedSuggestedCut() {
    setSelectedSuggestedCutId(null);
  }

  function resetForActiveVideoChange() {
    setSuggestedCuts([]);
    setSelectedSuggestedCutId(null);
    setHoveredCutId(null);
    setHoveredCutAction(null);
  }

  function loadCutsForActiveJob(jobId: string) {
    console.log(`[UI] Loading cuts for video ${jobId}`);
    setCuts([]);
    setSuggestedCuts([]);
    setIsLoadingCuts(true);
    console.log(`[UI] Set isLoadingCuts to true`);

    const startLoadTime = Date.now();

    listCuts(jobId)
      .then((loadedCuts) => {
        console.log(`[UI] Loaded ${loadedCuts.length} cuts for video ${jobId}`);
        applyCuts(loadedCuts);
      })
      .catch((error) => {
        console.error("Failed to load cuts:", error);
        setCuts([]);
        setSuggestedCuts([]);
      })
      .finally(() => {
        const elapsedTime = Date.now() - startLoadTime;
        const remainingTime = Math.max(0, 500 - elapsedTime);

        setTimeout(() => {
          console.log(`[UI] Set isLoadingCuts to false after ${elapsedTime + remainingTime}ms`);
          setIsLoadingCuts(false);
        }, remainingTime);
      });
  }

  function loadCutsForVideo(jobId: string) {
    return runAction(() => listCuts(jobId), applyCuts);
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
    applyCuts(finalCuts);
    setSelectedSuggestedCutId(null);
    onAiResponseRawChange(rawResponse);
    if (showAiResponseOnAnalyze && rawResponse) {
      onShowAiResponseDialogChange(true);
    }

    if (activeJobId) {
      void updateCuts(activeJobId, finalCuts).catch((error) => {
        console.error("Failed to sync cuts:", error);
      });
      onRefreshVideo(activeJobId);
    }
  }

  async function deleteSuggestedCut(cutId: string) {
    const newSuggestedCuts = suggestedCuts.filter((item) => item.cut_id !== cutId);
    const newCuts = cuts.filter((item) => item.cut_id !== cutId);

    setSuggestedCuts(newSuggestedCuts);
    setCuts(newCuts);

    if (activeJobId) {
      try {
        await updateCuts(activeJobId, newCuts);
      } catch (error) {
        console.error("Failed to update cuts:", error);
      }
    }

    if (selectedSuggestedCutId === cutId) {
      setSelectedSuggestedCutId(null);
      onPausePlayback();
    }

    setHoveredCutId(null);
    setHoveredCutAction(null);
  }

  function requestDeleteSuggestedCut(cutId: string) {
    const shouldAsk = appSettings?.preferences?.ask_delete_cut_confirm ?? true;
    if (!shouldAsk) {
      void deleteSuggestedCut(cutId);
      return;
    }

    setPendingDeleteCutId(cutId);
    setDontAskDeleteCutAgain(false);
    setShowDeleteCutConfirmDialog(true);
  }

  function closeDeleteCutConfirmDialog() {
    setShowDeleteCutConfirmDialog(false);
    setPendingDeleteCutId(null);
    setDontAskDeleteCutAgain(false);
  }

  async function confirmDeleteSuggestedCut() {
    if (!pendingDeleteCutId) {
      setShowDeleteCutConfirmDialog(false);
      return;
    }

    if (dontAskDeleteCutAgain) {
      try {
        const updated = await saveSettings({
          preferences: {
            ask_move_on_upload: appSettings?.preferences?.ask_move_on_upload ?? true,
            move_uploads: appSettings?.preferences?.move_uploads ?? false,
            ask_delete_cut_confirm: false,
          },
        });
        onAppSettingsUpdated(updated);
      } catch (error) {
        console.error("Failed to update delete-cut confirmation preference:", error);
      }
    }

    const cutId = pendingDeleteCutId;
    setPendingDeleteCutId(null);
    setShowDeleteCutConfirmDialog(false);
    setDontAskDeleteCutAgain(false);
    await deleteSuggestedCut(cutId);
  }

  function selectSuggestedCut(cut: Cut) {
    setSelectedSuggestedCutId(cut.cut_id);
    onSeekAndPlay(cut.start);
  }

  function setCutActionHover(cutId: string, nextAction: CutHoverAction) {
    setHoveredCutId(cutId);
    setHoveredCutAction(nextAction);
  }

  function clearCutActionHover() {
    setHoveredCutId(null);
    setHoveredCutAction(null);
  }

  return {
    cuts,
    setCuts,
    suggestedCuts,
    setSuggestedCuts,
    selectedSuggestedCutId,
    setSelectedSuggestedCutId,
    isAnalyzing,
    setIsAnalyzing,
    isLoadingCuts,
    hoveredCutId,
    hoveredCutAction,
    showDeleteCutConfirmDialog,
    dontAskDeleteCutAgain,
    setDontAskDeleteCutAgain,
    clearCuts,
    clearSuggestedCuts,
    clearSelectedSuggestedCut,
    resetForActiveVideoChange,
    loadCutsForActiveJob,
    loadCutsForVideo,
    handleAnalyzeResult,
    requestDeleteSuggestedCut,
    closeDeleteCutConfirmDialog,
    confirmDeleteSuggestedCut,
    selectSuggestedCut,
    setCutActionHover,
    clearCutActionHover,
  };
}
