import { useState, useCallback, useEffect } from "react";
import { listVideos, listArchivedVideos, getJob, archiveVideo, deleteVideo } from "../api";
import type { Job, VideoRecord } from "../types";

export interface VideoItem {
  job: Job;
  videoPath?: string;
  transcription?: string;
  transcriptionSegments?: any[];
  transcriptionFormats?: { segments?: boolean; text?: boolean; vtt?: boolean };
  isTranscribing?: boolean;
  transcriptionLogs?: string[];
}

export function useVideoManagement() {
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [archivedVideos, setArchivedVideos] = useState<VideoItem[]>([]);
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);

  const loadVideos = useCallback(async () => {
    try {
      const active = await listVideos();
      setVideos(active.map((record) => ({ job: record.job! })));
    } catch (error) {
      console.error("Failed to load videos:", error);
    }
  }, []);

  const loadArchivedVideos = useCallback(async () => {
    try {
      const archived = await listArchivedVideos();
      setArchivedVideos(archived.map((record) => ({ job: record.job! })));
    } catch (error) {
      console.error("Failed to load archived videos:", error);
    }
  }, []);

  const updateVideo = useCallback((jobId: string, updates: Partial<VideoItem>) => {
    setVideos((current) => current.map((v) => (v.job.job_id === jobId ? { ...v, ...updates } : v)));
  }, []);

  const archiveCurrentVideo = useCallback(
    async (jobId: string) => {
      await archiveVideo(jobId);
      setVideos((current) => current.filter((v) => v.job.job_id !== jobId));
      setActiveVideoId(null);
      await loadArchivedVideos();
    },
    [loadArchivedVideos],
  );

  const deleteCurrentVideo = useCallback(async (jobId: string) => {
    await deleteVideo(jobId);
    setVideos((current) => current.filter((v) => v.job.job_id !== jobId));
    setArchivedVideos((current) => current.filter((v) => v.job.job_id !== jobId));
    setActiveVideoId(null);
  }, []);

  const getActiveVideo = useCallback(() => {
    return videos.find((v) => v.job.job_id === activeVideoId);
  }, [videos, activeVideoId]);

  useEffect(() => {
    loadVideos();
    loadArchivedVideos();
  }, [loadVideos, loadArchivedVideos]);

  return {
    videos,
    archivedVideos,
    activeVideoId,
    setActiveVideoId,
    loadVideos,
    loadArchivedVideos,
    updateVideo,
    archiveCurrentVideo,
    deleteCurrentVideo,
    getActiveVideo,
  };
}
