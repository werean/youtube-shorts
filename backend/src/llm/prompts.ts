/**
 * Prompt templates and output schema guidance for the LLM.
 */

import { SemanticBlock } from "../models/semantic_block";
import { TopicSegment } from "../models/topic_segment";

export const PROMPT_VERSION = "v3";

export const SYSTEM_PROMPT_TEMPLATE = `You are selecting highlight cuts for long-form vertical videos.

Input consists of semantic blocks with timestamps. Each block is a coherent unit.
You must propose MULTIPLE cuts that form complete mini-stories (beginning, middle, end) focused on a single topic.

Each cut MUST be at least 5 minutes (300 seconds) long.

The first block of each cut MUST be a strong hook.

IMPORTANT: Scan through ALL blocks and identify ALL potential cuts that meet the minimum duration requirement.
Depending on total content length and quality, a good output may contain 1–3 cuts or more.

Each cut should be a standalone piece with:

* Its own hook
* A clear narrative arc
* A natural conclusion

Hook criteria (first 1–3 seconds of the cut):

* Immediate impact
* Strong claim
* Clear opinion
* Surprise or tension

Avoid introductions or context-dependent openings.

Rules:

* Use only the provided blocks.
* Use consecutive blocks only; do not skip around.
* Start at the first block of a topic (never start mid-thought).
* End at a natural conclusion (never cut off a thought).
* The cut start time must match the first block start.
* The cut end time must match the last block end.
* Cuts must be ≥ 300 seconds in duration.
* Do NOT edit or rewrite text.
* Do NOT include any extra commentary.
* Output JSON only, no markdown.
* Cuts must not overlap (each block can appear in only one cut).
* Sort cuts by score (best first).

Output format (JSON array):

[
{
"blocks": ["b12", "b13", "b14", "b15"],
"start": 42.1,
"end": 372.4,
"score": 94,
"hook_reason": "...",
"content_reason": "..."
}
]
`;

export function buildCutSelectionPrompt(blocks: SemanticBlock[]): string {
  const blocksText = blocks
    .map(
      (block) =>
        `- ${block.block_id} [${block.start.toFixed(2)}-${block.end.toFixed(2)}]: ${block.text}`,
    )
    .join("\n");

  return `Runtime context for this analysis:

Semantic blocks:
${blocksText}`;
}

/**
 * Build the Pass 1 candidacy prompt for a topic segment.
 *
 * Sends only topic metadata and the first/last block texts to the LLM —
 * no full block list is included. The model must reply with JSON only:
 * `{ "is_candidate": true }` or `{ "is_candidate": false }`.
 *
 * @param topic - The topic segment to evaluate.
 * @param blocks - Full semantic block list for the job (used to resolve first/last blocks).
 * @returns Prompt string ready to send as the user message.
 */
export function buildTopicCandidacyPrompt(topic: TopicSegment, blocks: SemanticBlock[]): string {
  const blockMap = new Map(blocks.map((b) => [b.block_id, b]));
  const firstBlock = blockMap.get(topic.block_ids[0]);
  const lastBlock = blockMap.get(topic.block_ids[topic.block_ids.length - 1]);

  const firstText = firstBlock?.text ?? "(unavailable)";
  const lastText = lastBlock?.text ?? "(unavailable)";

  return `You are evaluating whether a video segment is worth cutting into a highlight.
Topic: ${topic.topic_id}
Duration: ${topic.durationSeconds.toFixed(1)}s
Block count: ${topic.blockCount}
First block text: "${firstText}"
Last block text: "${lastText}"
Reply with JSON only: { "is_candidate": true } or { "is_candidate": false }`;
}
