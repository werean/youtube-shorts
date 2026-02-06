/**
 * Data model for suggested and approved cuts.
 */

export interface Cut {
  /** Explicit cut identifier */
  cut_id: string;
  /** Ordered block identifiers in the cut */
  block_ids: string[];
  /** Cut start time in seconds */
  start: number;
  /** Cut end time in seconds */
  end: number;
  /** Optional LLM score for the cut */
  score?: number;
  /** Reason the opening is a strong hook */
  hook_reason?: string;
  /** Reason the cut has strong content cohesion */
  content_reason?: string;
  /** Curation status (e.g., pending/approved) */
  status: string;
}
