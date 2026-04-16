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
  /** Suggested title for this specific cut */
  title?: string;
  /** Curation status (e.g., pending/approved) */
  status: string;
}
