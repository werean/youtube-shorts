import { SemanticBlock } from "../../models/semantic_block";

/** Pause gap in seconds sufficient to signal a topic boundary. */
const TOPIC_PAUSE_THRESHOLD_SECONDS = 2.5;

/** Pause gap required when the previous block ends with ? or ! to trigger a boundary. */
const QUESTION_EXCLAMATION_PAUSE_SECONDS = 1.0;

/** Force-close a topic after it accumulates this many seconds regardless of other signals. */
const TOPIC_MAX_DURATION_SECONDS = 360; // 6 minutes

/**
 * Returns true if `text` ends with `?` or `!`.
 */
function endsWithQuestionOrExclamation(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.endsWith("?") || trimmed.endsWith("!");
}

/**
 * Returns true if `text` starts with a lowercase letter, indicating a sentence
 * continuation that should not open a new topic.
 */
function startsWithLowercase(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return (
    /^[a-záéíóúãõâêîôûàèìòùäëïöüýçñ]/i.test(trimmed) &&
    trimmed[0] === trimmed[0].toLowerCase() &&
    trimmed[0] !== trimmed[0].toUpperCase()
  );
}

/**
 * Detects topic boundaries using the existing deterministic heuristics.
 *
 * @param blocks - Ordered semantic blocks.
 * @returns Set of block IDs where a new topic should start.
 */
export function detectHeuristicBoundaries(blocks: SemanticBlock[]): Set<string> {
  const boundaries = new Set<string>();

  if (blocks.length === 0) {
    return boundaries;
  }

  let currentBlocks: SemanticBlock[] = [blocks[0]];

  for (let i = 1; i < blocks.length; i += 1) {
    const prev = blocks[i - 1];
    const curr = blocks[i];

    const pause = Math.max(0, curr.start - prev.end);
    const accumulatedStart = currentBlocks[0].start;
    const accumulatedDuration = prev.end - accumulatedStart;

    // Rule: never open a new topic if next block is a sentence continuation
    if (startsWithLowercase(curr.text)) {
      currentBlocks.push(curr);
      continue;
    }

    let shouldSplit = false;

    // Rule 1: large gap between blocks
    if (pause >= TOPIC_PAUSE_THRESHOLD_SECONDS) {
      shouldSplit = true;
    }

    // Rule 2: force-close after max duration
    if (accumulatedDuration >= TOPIC_MAX_DURATION_SECONDS) {
      shouldSplit = true;
    }

    // Rule 3: question/exclamation + moderate pause
    if (
      !shouldSplit &&
      endsWithQuestionOrExclamation(prev.text) &&
      pause >= QUESTION_EXCLAMATION_PAUSE_SECONDS
    ) {
      shouldSplit = true;
    }

    if (shouldSplit) {
      boundaries.add(curr.block_id);
      currentBlocks = [curr];
    } else {
      currentBlocks.push(curr);
    }
  }

  return boundaries;
}
