/**
 * Prompt templates and output schema guidance for the LLM.
 */

import { SemanticBlock } from "../models/semantic_block";

export const PROMPT_VERSION = "v3";

export const SYSTEM_PROMPT_TEMPLATE = `You are an expert short-form video editor selecting highlight cuts from semantic transcript blocks.

Goal:
- Propose MULTIPLE candidate cuts suitable for vertical short videos.
- Each cut must be a complete mini-story with beginning, middle, and end.
- Narrative coherence is more important than hitting an exact duration target.

Process requirements:
- Review ALL blocks and find ALL good cut opportunities.
- Use only provided blocks.
- Use consecutive blocks only (no jumps).
- The cut start must equal the first selected block start.
- The cut end must equal the last selected block end.
- Start where the idea naturally begins, not mid-thought.
- Open with an engaging hook that still belongs to the same narrative thread.
- End only at a natural conclusion.
- Prefer complete context over arbitrary shortening.
- Cuts must not overlap (a block can belong to only one cut).
- Do not rewrite, summarize, or invent transcript content.

Title requirements:
- Each cut MUST include a "title".
- The title must be based only on the context inside that specific cut.
- Keep the title specific, clear, and compelling.
- Avoid generic titles.

Output requirements:
- Return JSON array only.
- No markdown, no commentary, no extra keys.
- Never include score, hook_reason, or content_reason.
- Each item must contain only:
  - "blocks": string[]
  - "start": number
  - "end": number
  - "title": string

Example:
[
	{
		"blocks": ["b12", "b13", "b14"],
		"start": 42.1,
		"end": 91.6,
		"title": "..."
	}
]`;

export function buildCutSelectionPrompt(
  blocks: SemanticBlock[],
  options: { averageCutMinutes: number; maxExtraMinutes: number },
): string {
  const averageCutMinutes = Number.isFinite(options.averageCutMinutes)
    ? Math.max(0.25, options.averageCutMinutes)
    : 1;
  const maxExtraMinutes = Number.isFinite(options.maxExtraMinutes)
    ? Math.max(0, options.maxExtraMinutes)
    : 0;

  const averageCutSeconds = Math.round(averageCutMinutes * 60);
  const maxExtraSeconds = Math.round(maxExtraMinutes * 60);
  const zeroToleranceGraceSeconds = 10;

  const blocksText = blocks
    .map(
      (block) =>
        `- ${block.block_id} [${block.start.toFixed(2)}-${block.end.toFixed(2)}]: ${block.text}`,
    )
    .join("\n");

  return `Runtime context for this analysis:

Duration guidance for this run:
- Requested average cut duration: ${averageCutMinutes.toFixed(2)} minutes (${averageCutSeconds}s).
- Additional contextual extension budget: ${maxExtraMinutes.toFixed(2)} minutes (${maxExtraSeconds}s).
- If extension budget is zero, maximum grace extension is ${zeroToleranceGraceSeconds}s only to conclude context.
- Prefer finishing inside average duration, but never break narrative coherence.

Semantic blocks:
${blocksText}`;
}
