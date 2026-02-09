import { useState, useCallback } from "react";
import type { VideoItem } from "../utils/videoHelpers";

/**
 * Hook for managing video list state
 */
export function useVideoList() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [archivedVideos, setArchivedVideos] = useState<VideoItem[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  const updateVideo = useCallback((jobId: string, updates: Partial<VideoItem>) => {
    setVideos((current) => current.map((v) => (v.job.job_id === jobId ? { ...v, ...updates } : v)));
  }, []);

  const updateArchivedVideo = useCallback((jobId: string, updates: Partial<VideoItem>) => {
    setArchivedVideos((current) =>
      current.map((v) => (v.job.job_id === jobId ? { ...v, ...updates } : v)),
    );
  }, []);

  const activeVideo = videos.find((v) => v.job.job_id === activeVideoId);

  const findActiveTranscriptionOrRendering = useCallback(
    (isRendering: boolean): string | null => {
      const transcribingVideo = videos.find((v) => v.isTranscribing);
      if (transcribingVideo) return transcribingVideo.job.job_id;

      if (isRendering && activeVideoId) return activeVideoId;

      return null;
    },
    [videos, activeVideoId],
  );

  const canStartOperation = useCallback(
    (targetJobId: string, isRendering: boolean): { allowed: boolean; message?: string } => {
      const activeJobId = findActiveTranscriptionOrRendering(isRendering);
      if (!activeJobId) return { allowed: true };
      if (activeJobId === targetJobId) return { allowed: true };
      return {
        allowed: false,
        message: `Transcrição ou renderização já em andamento. Cancele para iniciar outra operação.`,
      };
    },
    [findActiveTranscriptionOrRendering],
  );

  return {
    videos,
    setVideos,
    archivedVideos,
    setArchivedVideos,
    activeVideoId,
    setActiveVideoId,
    activeVideo,
    updateVideo,
    updateArchivedVideo,
    canStartOperation,
  };
}
