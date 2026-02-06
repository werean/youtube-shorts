/**
 * Data model for transcription segments.
 */

export interface Segment {
  /** Explicit segment identifier */
  segment_id: string;
  /** Segment start time in seconds */
  start: number;
  /** Segment end time in seconds */
  end: number;
  /** Transcribed text for the segment */
  text: string;
}
