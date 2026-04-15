import { useCallback, useEffect, useRef, useState } from "react";

export type UploadStatus = "idle" | "uploading" | "success" | "error";

export interface UploadState {
  status: UploadStatus;
  progress: number;
  filename?: string;
  error?: string;
}

const initialUploadState: UploadState = {
  status: "idle",
  progress: 0,
};

export function useUpload() {
  const timerRef = useRef<number | null>(null);
  const [state, setState] = useState<UploadState>(initialUploadState);

  const stopProgressTimer = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopProgressTimer();
    };
  }, [stopProgressTimer]);

  const startUpload = useCallback(
    async <T>(file: File, task: (file: File) => Promise<T>): Promise<T> => {
      setState({ status: "uploading", progress: 4, filename: file.name });
      stopProgressTimer();

      timerRef.current = window.setInterval(() => {
        setState((current) => {
          if (current.progress >= 90) {
            return current;
          }
          return { ...current, progress: current.progress + 5 };
        });
      }, 120);

      try {
        const result = await task(file);
        stopProgressTimer();
        setState({ status: "success", progress: 100, filename: file.name });
        return result;
      } catch (error) {
        stopProgressTimer();
        const message = error instanceof Error ? error.message : "Upload failed";
        setState({ status: "error", progress: 0, filename: file.name, error: message });
        throw error;
      }
    },
    [stopProgressTimer],
  );

  const resetUpload = useCallback(() => {
    stopProgressTimer();
    setState(initialUploadState);
  }, [stopProgressTimer]);

  return {
    state,
    startUpload,
    resetUpload,
  };
}
