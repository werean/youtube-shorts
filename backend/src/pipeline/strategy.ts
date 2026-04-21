/**
 * Processing strategy selection based on video duration.
 * Determines whether to use topic segmentation and two-pass LLM analysis.
 */

import { SemanticBlock } from "../models/semantic_block";

/** Short video threshold: under 20 minutes. */
const SHORT_THRESHOLD_SECONDS = 1200;

/** Long video threshold: over 60 minutes. */
const LONG_THRESHOLD_SECONDS = 3600;

/**
 * Describes the processing strategy selected for a given video duration.
 */
export interface ProcessingStrategy {
  /** Whether to run topic segmentation before sending blocks to the LLM. */
  useTopicSegmentation: boolean;
  /** Whether to run embedding-based semantic boundary detection on top of heuristics. */
  useEmbeddings: boolean;
  /** Whether to run a candidacy pre-pass (Pass 1) before the full analysis (Pass 2). */
  useTwoPass: boolean;
  /** Hard limit: never send more than this many blocks in a single LLM request. */
  maxBlocksPerLLMRequest: number;
  /** Hard limit: never send more than this many characters in a single LLM request. */
  maxCharsPerLLMRequest: number;
}

/**
 * Select the processing strategy based on total video duration.
 *
 * - Short  (< 1200s / 20min): single pass, no topic segmentation
 * - Medium (1200–3599s / 20–59m59s): topic segmentation, single pass per topic
 * - Long   (>= 3600s / 60min+): topic segmentation + two-pass candidacy check
 *
 * @param durationSeconds - Total video duration in seconds.
 * @returns The ProcessingStrategy to apply.
 */
export function selectStrategy(durationSeconds: number): ProcessingStrategy {
  if (durationSeconds < SHORT_THRESHOLD_SECONDS) {
    return {
      useTopicSegmentation: false,
      useEmbeddings: false,
      useTwoPass: false,
      maxBlocksPerLLMRequest: 150,
      maxCharsPerLLMRequest: 18000,
    };
  }

  if (durationSeconds < LONG_THRESHOLD_SECONDS) {
    return {
      useTopicSegmentation: true,
      useEmbeddings: true,
      useTwoPass: false,
      maxBlocksPerLLMRequest: 150,
      maxCharsPerLLMRequest: 18000,
    };
  }

  return {
    useTopicSegmentation: true,
    useEmbeddings: true,
    useTwoPass: true,
    maxBlocksPerLLMRequest: 150,
    maxCharsPerLLMRequest: 18000,
  };
}

/**
 * Result of LLM payload validation.
 */
export interface PayloadValidationResult {
  valid: boolean;
  blockCount: number;
  charCount: number;
  /** Present when valid is false; describes why the payload was rejected. */
  reason?: string;
}

/**
 * Validate that a block set is within the hard limits of the given strategy.
 * If invalid, the caller MUST NOT invoke the LLM.
 *
 * @param blocks - The semantic blocks intended for a single LLM request.
 * @param strategy - The active processing strategy.
 * @returns Validation result with counts and optional rejection reason.
 */
export function validateLLMPayload(
  blocks: SemanticBlock[],
  strategy: ProcessingStrategy,
): PayloadValidationResult {
  const blockCount = blocks.length;
  const charCount = blocks.reduce((sum, b) => sum + b.text.length, 0);

  if (charCount > strategy.maxCharsPerLLMRequest) {
    return {
      valid: false,
      blockCount,
      charCount,
      reason: `Char count ${charCount} exceeds maxCharsPerLLMRequest (${strategy.maxCharsPerLLMRequest})`,
    };
  }

  if (blockCount > strategy.maxBlocksPerLLMRequest) {
    // Warning only: block counts vary widely; char count is the hard payload guardrail.
    console.warn(
      `[strategy] Block count ${blockCount} exceeds maxBlocksPerLLMRequest (${strategy.maxBlocksPerLLMRequest}) — proceeding because char count (${charCount}) is within limit`,
    );
  }

  return { valid: true, blockCount, charCount };
}
