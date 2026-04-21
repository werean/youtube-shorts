import { SemanticBlock } from "../../models/semantic_block";
import { TopicSegment } from "../../models/topic_segment";

/** Topics shorter than this are merged into the previous topic. */
const TOPIC_MIN_DURATION_SECONDS = 90;

/**
 * Finalizes the current open topic accumulator and pushes to `topics`.
 *
 * @param currentBlocks - Accumulated blocks for the topic being finalized.
 * @param topics - Destination array of completed topics.
 * @returns Nothing.
 */
function finalizeTopic(currentBlocks: SemanticBlock[], topics: TopicSegment[]): void {
  if (currentBlocks.length === 0) return;

  const topicId = `t${topics.length + 1}`;
  const start = currentBlocks[0].start;
  const end = currentBlocks[currentBlocks.length - 1].end;

  topics.push({
    topic_id: topicId,
    start,
    end,
    block_ids: currentBlocks.map((b) => b.block_id),
    blockCount: currentBlocks.length,
    durationSeconds: end - start,
  });
}

/**
 * Builds topic segments from an ordered block list and a set of boundary block IDs.
 *
 * @param blocks - Ordered semantic blocks.
 * @param boundaries - Set of block IDs where a new topic starts.
 * @returns Built and post-processed topic segments.
 */
export function buildTopicsFromBoundaries(
  blocks: SemanticBlock[],
  boundaries: Set<string>,
): TopicSegment[] {
  if (blocks.length === 0) {
    return [];
  }

  const rawTopics: TopicSegment[] = [];
  let currentBlocks: SemanticBlock[] = [blocks[0]];

  for (let i = 1; i < blocks.length; i += 1) {
    const curr = blocks[i];
    if (boundaries.has(curr.block_id)) {
      finalizeTopic(currentBlocks, rawTopics);
      currentBlocks = [curr];
    } else {
      currentBlocks.push(curr);
    }
  }

  finalizeTopic(currentBlocks, rawTopics);

  // Post-processing: merge topics shorter than TOPIC_MIN_DURATION_SECONDS into the previous
  const merged: TopicSegment[] = [];
  for (const topic of rawTopics) {
    if (topic.durationSeconds < TOPIC_MIN_DURATION_SECONDS && merged.length > 0) {
      const prev = merged[merged.length - 1];
      const newEnd = topic.end;
      merged[merged.length - 1] = {
        ...prev,
        end: newEnd,
        block_ids: [...prev.block_ids, ...topic.block_ids],
        blockCount: prev.blockCount + topic.blockCount,
        durationSeconds: newEnd - prev.start,
      };
    } else {
      merged.push(topic);
    }
  }

  // Re-number topic IDs after merges
  const final: TopicSegment[] = merged.map((t, idx) => ({
    ...t,
    topic_id: `t${idx + 1}`,
  }));

  return final;
}
