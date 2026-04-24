import { useState } from "react";
import type { Cut } from "../types";

interface UseCutTimestampWorkflowOptions {
  activeJobId: string | null;
  cuts: Cut[];
  suggestedCuts: Cut[];
  setCuts: (cuts: Cut[]) => void;
  setSuggestedCuts: (cuts: Cut[]) => void;
  setSelectedSuggestedCutId: (cutId: string) => void;
  persistCuts: (jobId: string, cuts: Cut[]) => Promise<void>;
  seekTo: (seconds: number) => void;
}

export function useCutTimestampWorkflow({
  activeJobId,
  cuts,
  suggestedCuts,
  setCuts,
  setSuggestedCuts,
  setSelectedSuggestedCutId,
  persistCuts,
  seekTo,
}: UseCutTimestampWorkflowOptions) {
  const [showCutEditDialog, setShowCutEditDialog] = useState(false);
  const [editingCutId, setEditingCutId] = useState<string | null>(null);
  const [editCutStartMinutes, setEditCutStartMinutes] = useState("");
  const [editCutStartSeconds, setEditCutStartSeconds] = useState("");
  const [editCutEndMinutes, setEditCutEndMinutes] = useState("");
  const [editCutEndSeconds, setEditCutEndSeconds] = useState("");
  const [showAddManualCutDialog, setShowAddManualCutDialog] = useState(false);
  const [newCutStartMinutes, setNewCutStartMinutes] = useState("");
  const [newCutStartSeconds, setNewCutStartSeconds] = useState("");
  const [newCutEndMinutes, setNewCutEndMinutes] = useState("");
  const [newCutEndSeconds, setNewCutEndSeconds] = useState("");

  function resetEditCutState() {
    setEditingCutId(null);
    setEditCutStartMinutes("");
    setEditCutStartSeconds("");
    setEditCutEndMinutes("");
    setEditCutEndSeconds("");
  }

  function resetNewCutState() {
    setNewCutStartMinutes("");
    setNewCutStartSeconds("");
    setNewCutEndMinutes("");
    setNewCutEndSeconds("");
  }

  function openEditCutDialog(cut: Cut) {
    const startMin = Math.floor(cut.start / 60);
    const startSec = Math.round(cut.start % 60);
    const endMin = Math.floor(cut.end / 60);
    const endSec = Math.round(cut.end % 60);

    setEditingCutId(cut.cut_id);
    setEditCutStartMinutes(String(startMin).padStart(2, "0"));
    setEditCutStartSeconds(String(startSec).padStart(2, "0"));
    setEditCutEndMinutes(String(endMin).padStart(2, "0"));
    setEditCutEndSeconds(String(endSec).padStart(2, "0"));
    setShowCutEditDialog(true);
  }

  function closeEditCutDialog() {
    setShowCutEditDialog(false);
    resetEditCutState();
  }

  function openAddManualCutDialog() {
    resetNewCutState();
    setShowAddManualCutDialog(true);
  }

  function closeAddManualCutDialog() {
    setShowAddManualCutDialog(false);
    resetNewCutState();
  }

  async function saveEditedCutTimestamps(startValue: number, endValue: number) {
    if (!editingCutId) {
      closeEditCutDialog();
      return;
    }

    const cutId = editingCutId;
    const newSuggestedCuts = suggestedCuts.map((item) =>
      item.cut_id === cutId ? { ...item, start: startValue, end: endValue } : item,
    );
    const newCuts = cuts.map((item) =>
      item.cut_id === cutId ? { ...item, start: startValue, end: endValue } : item,
    );

    setSuggestedCuts(newSuggestedCuts);
    setCuts(newCuts);

    if (activeJobId) {
      try {
        await persistCuts(activeJobId, newCuts);
      } catch (error) {
        console.error("Failed to update cuts:", error);
      }
    }

    setSelectedSuggestedCutId(cutId);
    seekTo(startValue);
    closeEditCutDialog();
  }

  async function saveManualCutTimestamps(startValue: number, endValue: number) {
    const newCutId = `manual_${Date.now()}`;
    const newCut: Cut = {
      cut_id: newCutId,
      block_ids: [],
      start: startValue,
      end: endValue,
      status: "approved",
      title: "Corte manual",
    };

    const newSuggestedCuts = [...suggestedCuts, newCut];
    const newCuts = [...cuts, newCut];

    setSuggestedCuts(newSuggestedCuts);
    setCuts(newCuts);

    if (activeJobId) {
      try {
        await persistCuts(activeJobId, newCuts);
      } catch (error) {
        console.error("Failed to update cuts:", error);
      }
    }

    setSelectedSuggestedCutId(newCutId);
    seekTo(startValue);
    closeAddManualCutDialog();
  }

  return {
    showCutEditDialog,
    editingCutId,
    editCutStartMinutes,
    editCutStartSeconds,
    editCutEndMinutes,
    editCutEndSeconds,
    showAddManualCutDialog,
    openEditCutDialog,
    closeEditCutDialog,
    saveEditedCutTimestamps,
    openAddManualCutDialog,
    closeAddManualCutDialog,
    saveManualCutTimestamps,
  };
}
