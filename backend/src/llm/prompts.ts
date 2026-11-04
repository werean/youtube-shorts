/**
 * Prompt templates and output schema guidance for the LLM.
 */

import { SemanticBlock } from "../models/semantic_block";
import { TopicSegment } from "../models/topic_segment";
import { continuesSentence, endsSentence } from "../pipeline/sentence";

export const PROMPT_VERSION = "v4";

export const SYSTEM_PROMPT_TEMPLATE = `You are selecting highlight cuts for long-form vertical videos, including news roundups.

Input consists of semantic blocks with timestamps. Each block is a coherent unit.
Return one cut for every finished item: a news story, a complete answer, or a self-contained point.
Do not stop after a few highlights. There is no quota.

Duration is a loose preference of about 15 to 90 seconds, not a target and not a filter.
Keep a finished item that is shorter or longer than that window.
Do not stretch, trim, or merge separate items to land inside the window.
Do not drop an item because it is outside the window.

The first block of each cut MUST be a strong hook.

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
* Start at a sentence start (never start mid-thought).
* End at a natural conclusion (never cut off a thought). A question mark is not a conclusion.
* The cut start time must match the first block start.
* The cut end time must match the last block end.
* About 15 to 90 seconds is a loose preference, not a quota.
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
"end": 98.4,
"score": 94,
"hook_reason": "...",
"content_reason": "..."
}
]
`;

export function buildCutSelectionPrompt(
  blocks: SemanticBlock[],
  topics: TopicSegment[] = [],
): string {
  const topicByBlock = new Map<string, string>();
  for (const topic of topics) {
    for (const blockId of topic.block_ids) {
      topicByBlock.set(blockId, topic.topic_id);
    }
  }

  const blocksText = blocks
    .map((block, index) => {
      const previous = index > 0 ? blocks[index - 1] : undefined;
      const sentenceStart = !previous || !continuesSentence(previous.text, block.text);
      const sentenceEnd = endsSentence(block.text);
      const topicId = topicByBlock.get(block.block_id) ?? "none";
      return `- ${block.block_id} topic=${topicId} sentence_start=${sentenceStart} sentence_end=${sentenceEnd} [${block.start.toFixed(2)}-${block.end.toFixed(2)}]: ${block.text}`;
    })
    .join("\n");

  return `Runtime context for this analysis:

The block list is authoritative. start and end in your JSON are rewritten to those block edges.
Each block is marked with topic_id (or none), sentence_start, and sentence_end.
Open on a sentence_start and close on a sentence_end. A question mark is not a conclusion.
About 15 to 90 seconds is a loose preference, not a quota.
Return every finished item, including a news story outside that window.
Do not merge separate stories to fill the window, and do not drop one for being outside it.

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
