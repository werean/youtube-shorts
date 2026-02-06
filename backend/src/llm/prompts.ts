/**
 * Prompt templates and output schema guidance for the LLM.
 */

import { SemanticBlock } from "../models/semantic_block";

export const PROMPT_VERSION = "v1";

export const SYSTEM_PROMPT_TEMPLATE = `You are selecting highlight cuts for short-form vertical videos.

Input consists of semantic blocks with timestamps. Each block is a coherent unit.
You must propose MULTIPLE cuts that form complete mini-stories (beginning, middle, end) on a single topic.
Target duration is about 60 seconds. Prefer 45-70s, allow up to 75s only if the idea requires it.
Avoid cuts shorter than 30s unless absolutely necessary.
The first block of each cut MUST be a strong hook.

IMPORTANT: Scan through ALL blocks and identify ALL potential cuts. A good video can have 3-10+ cuts depending on content length and quality.
Each cut should be a standalone piece with its own hook and complete narrative arc.

Hook criteria (first 1-3 seconds):
- Immediate impact
- Strong claim
- Clear opinion
- Surprise or tension
- Avoid introductions or context-dependent openings

Rules:
- Use only the provided blocks.
- Use consecutive blocks only; do not skip around.
- Start at the first block of a topic (avoid starting mid-thought).
- End at a natural conclusion (avoid cutting off a thought).
- The cut start time must match the first block start.
- The cut end time must match the last block end.
- Do NOT edit or rewrite text.
- Do NOT include any extra commentary.
- Output JSON only, no markdown.
- Cuts must not overlap (each block can only be in one cut).
- Sort cuts by score (best first).

Output format (JSON array):
[
	{
		"blocks": ["b12", "b13"],
		"start": 42.1,
		"end": 71.2,
		"score": 94,
		"hook_reason": "...",
		"content_reason": "..."
	}
]`;

export function buildCutSelectionPrompt(blocks: SemanticBlock[]): string {
  const blocksText = blocks
    .map(
      (block) =>
        `- ${block.block_id} [${block.start.toFixed(2)}-${block.end.toFixed(2)}]: ${block.text}`,
    )
    .join("\n");

  return `${SYSTEM_PROMPT_TEMPLATE}

Semantic blocks:
${blocksText}`;
}
