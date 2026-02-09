import { useState, useCallback } from "react";
import { transcribeJob, getTranscription, deleteTranscription, buildBlocks } from "../api";

export function useTranscription() {
  const [transcription, setTranscription] = useState<string>("");
  const [transcriptionSegments, setTranscriptionSegments] = useState<any[]>([]);
  const [transcriptionFormats, setTranscriptionFormats] = useState<{
    segments?: boolean;
    text?: boolean;
    vtt?: boolean;
  }>({});
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [transcriptionLogs, setTranscriptionLogs] = useState<string[]>([]);
  const [blocks, setBlocks] = useState<Record<string, unknown>[]>([]);

  const startTranscription = useCallback(async (jobId: string) => {
    setIsTranscribing(true);
    setTranscriptionLogs([]);
    try {
      await transcribeJob(jobId);
      await loadTranscription(jobId);
    } catch (error) {
      console.error("Transcription error:", error);
    } finally {
      setIsTranscribing(false);
    }
  }, []);

  const loadTranscription = useCallback(async (jobId: string) => {
    try {
      const data = await getTranscription(jobId);
      setTranscription(data.transcription);
      setTranscriptionSegments(data.segments);
      setTranscriptionFormats(data.available_formats || {});
    } catch (error) {
      console.error("Failed to load transcription:", error);
    }
  }, []);

  const buildBlocksForJob = useCallback(async (jobId: string) => {
    try {
      const result = await buildBlocks(jobId);
      setBlocks(result);
      return result;
    } catch (error) {
      console.error("Failed to build blocks:", error);
      return [];
    }
  }, []);

  const deleteFormat = useCallback(
    async (jobId: string, format: "all" | "text" | "vtt" | "segments") => {
      try {
        const result = await deleteTranscription(jobId, format);
        if (result.available_formats) {
          setTranscriptionFormats(result.available_formats);
        }
        if (format === "all") {
          setTranscription("");
          setTranscriptionSegments([]);
          setBlocks([]);
        }
      } catch (error) {
        console.error("Failed to delete transcription format:", error);
      }
    },
    [],
  );

  return {
    transcription,
    transcriptionSegments,
    transcriptionFormats,
    isTranscribing,
    transcriptionLogs,
    blocks,
    startTranscription,
    loadTranscription,
    buildBlocksForJob,
    deleteFormat,
    setTranscription,
    setTranscriptionSegments,
    setBlocks,
  };
}
