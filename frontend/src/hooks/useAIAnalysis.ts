import { useCallback, useState } from "react";

export type AIAnalysisStatus = "idle" | "processing" | "success" | "error";

export interface AIAnalysisState {
  status: AIAnalysisStatus;
  modelName: string;
  response?: string;
  error?: string;
}

export interface RunAIAnalysisInput {
  modelName: string;
  prompt: string;
}

const initialState: AIAnalysisState = {
  status: "idle",
  modelName: "",
};

export function useAIAnalysis() {
  const [state, setState] = useState<AIAnalysisState>(initialState);

  const runAnalysis = useCallback(
    async (input: RunAIAnalysisInput, task: (input: RunAIAnalysisInput) => Promise<string>) => {
      setState({
        status: "processing",
        modelName: input.modelName,
        response: `Running ${input.modelName}...`,
      });

      try {
        const response = await task(input);
        setState({
          status: "success",
          modelName: input.modelName,
          response,
        });
        return response;
      } catch (error) {
        const message = error instanceof Error ? error.message : "AI analysis failed";
        setState({
          status: "error",
          modelName: input.modelName,
          error: message,
        });
        throw error;
      }
    },
    [],
  );

  const resetAnalysis = useCallback(() => {
    setState(initialState);
  }, []);

  return {
    state,
    runAnalysis,
    resetAnalysis,
  };
}
