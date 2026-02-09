/**
 * Helpers e utilidades da aplicação - extrai lógica complexa do App.tsx
 */

import type { Cut } from "../types";
import type { ActionState, VideoItem } from "../types/app";
import { deleteTranscription, transcribeJob, renderJob, renameVideo } from "../api";

export interface VideoOperations {
  onTranscribe: (
    activeVideo: VideoItem,
    hasAnyTranscription: boolean,
    onComplete: () => void,
  ) => Promise<void>;
  onRender: (activeVideo: VideoItem, cutsCount: number) => Promise<void>;
  onRename: (videoId: string, newName: string, onComplete: () => void) => Promise<void>;
}

export interface CutOperations {
  onEditCut: (cut: Cut) => {
    startMinutes: string;
    startSeconds: string;
    endMinutes: string;
    endSeconds: string;
  };
  onDeleteCut: (
    cutId: string,
    suggestedCuts: Cut[],
    selectedSuggestedCutId: string | null,
  ) => {
    suggestedCuts: Cut[];
    selectedSuggestedCutId: string | null;
  };
}

export const createVideoOperations = (): VideoOperations => ({
  onTranscribe: async (activeVideo, hasAnyTranscription, onComplete) => {
    if (hasAnyTranscription) {
      await deleteTranscription(activeVideo.job.job_id, "all");
    }
    await transcribeJob(activeVideo.job.job_id);
    onComplete();
  },

  onRender: async (activeVideo, cutsCount) => {
    await renderJob(activeVideo.job.job_id);
  },

  onRename: async (videoId, newName, onComplete) => {
    await renameVideo(videoId, newName);
    onComplete();
  },
});

export const createCutOperations = (): CutOperations => ({
  onEditCut: (cut) => ({
    startMinutes: String(Math.floor(cut.start / 60)).padStart(2, "0"),
    startSeconds: String(Math.round(cut.start % 60)).padStart(2, "0"),
    endMinutes: String(Math.floor(cut.end / 60)).padStart(2, "0"),
    endSeconds: String(Math.round(cut.end % 60)).padStart(2, "0"),
  }),

  onDeleteCut: (cutId, suggestedCuts, selectedSuggestedCutId) => ({
    suggestedCuts: suggestedCuts.filter((c) => c.cut_id !== cutId),
    selectedSuggestedCutId: selectedSuggestedCutId === cutId ? null : selectedSuggestedCutId,
  }),
});
