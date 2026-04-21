/**
 * Data model for topic segments built from semantic blocks.
 */

export interface TopicSegment {
  /** Explicit topic identifier, e.g. "t1", "t2" */
  topic_id: string;
  /** Topic start time in seconds (equals first block's start) */
  start: number;
  /** Topic end time in seconds (equals last block's end) */
  end: number;
  /** Ordered block identifiers included in this topic */
  block_ids: string[];
  /** Number of semantic blocks in this topic */
  blockCount: number;
  /** Total duration of this topic in seconds */
  durationSeconds: number;
}
