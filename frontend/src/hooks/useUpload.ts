import { useCallback } from "react";
import { createJob, uploadVideoFile, ingestJob } from "../api";
import type { Job } from "../types";

export function useUpload() {
  const createJobFromURL = useCallback(async (youtubeUrl: string): Promise<Job> => {
    console.log(`\n[createJob] Criando job para URL: ${youtubeUrl}`);
    return createJob(youtubeUrl);
  }, []);

  const uploadVideo = useCallback(async (file: File): Promise<{ job: Job; video_path: string }> => {
    console.log(`\n[uploadVideoFile] Fazendo upload do arquivo: ${file.name}`);
    return uploadVideoFile(file);
  }, []);

  const ingestVideo = useCallback(async (jobId: string) => {
    return ingestJob(jobId);
  }, []);

  return {
    createJobFromURL,
    uploadVideo,
    ingestVideo,
  };
}
