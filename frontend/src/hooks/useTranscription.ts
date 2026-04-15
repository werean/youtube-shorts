import { useCallback, useState } from "react";
import type { TranscriptLine } from "../components/ui/TranscriptViewer";

export type TranscriptionStatus = "idle" | "processing" | "success" | "error";

export interface TranscriptionState {
  status: TranscriptionStatus;
  lines: TranscriptLine[];
  error?: string;
}

const initialState: TranscriptionState = {
  status: "idle",
  lines: [],
};

export function useTranscription() {
  const [state, setState] = useState<TranscriptionState>(initialState);

  const runTranscription = useCallback(async (task: () => Promise<TranscriptLine[]>) => {
    setState({ status: "processing", lines: [] });

    try {
      const result = await task();
      setState({ status: "success", lines: result });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transcription failed";
      setState({ status: "error", lines: [], error: message });
      throw error;
    }
  }, []);

  const resetTranscription = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    state,
    runTranscription,
    resetTranscription,
  };
}
