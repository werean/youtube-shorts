/** Raw cut item as returned by the LLM before validation. */
export interface RawLLMCut {
  blocks: string[];
  start: number;
  end: number;
  score?: number;
  hook_reason?: string;
  content_reason?: string;
  title?: string;
}
