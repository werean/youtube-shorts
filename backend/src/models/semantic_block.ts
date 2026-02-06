/**
 * Data model for semantic blocks built from segments.
 */

export interface SemanticBlock {
  /** Explicit block identifier */
  block_id: string;
  /** Block start time in seconds */
  start: number;
  /** Block end time in seconds */
  end: number;
  /** Consolidated text for the block */
  text: string;
  /** Ordered segment identifiers included in the block */
  segment_ids: string[];
}
