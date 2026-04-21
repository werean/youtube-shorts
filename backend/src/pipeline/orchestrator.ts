/**
 * Pipeline orchestration utilities with failure handling.
 */

import { Job, JobStatus } from "../models/job";
import * as metadata from "../storage/metadata";
import { ingestVideo } from "./ingest";
import { transcribeJob } from "./transcription";
import { buildSemanticBlocks } from "./semantic_blocks";
import { buildTopicSegments } from "./topic_segmentation";
import { analyzeBlocks } from "./analysis";
import { renderSuggestedCuts } from "./rendering";
import { selectStrategy } from "./strategy";
import { loadActiveToolConfigs } from "../core/toolConfigs";

type Step = [JobStatus, (job: Job) => Promise<any> | any];

/**
 * Run the full processing pipeline for a job, starting from the earliest
 * incomplete step.
 *
 * Steps in order:
 * 1. DOWNLOADING  — ingest video from YouTube
 * 2. TRANSCRIBING — run Whisper transcription
 * 3. BUILDING_BLOCKS — group segments into semantic blocks
 * 4. BUILDING_TOPICS — group semantic blocks into topic segments
 * 5. ANALYZING    — LLM analysis, produces suggested cuts
 * 6. RENDERING    — (optional) render approved cuts with FFmpeg
 *
 * @param jobId - The job identifier.
 * @param options - Optional flags, e.g. `{ includeRender: true }`.
 * @returns The updated Job after pipeline completion (or failure).
 */
export async function runPipeline(
  jobId: string,
  options: { includeRender?: boolean } = {},
): Promise<Job> {
  const steps: Step[] = [
    [JobStatus.DOWNLOADING, async (job: Job) => ingestVideo(job)],
    [JobStatus.TRANSCRIBING, (job: Job) => transcribeJob(job.job_id)],
    [JobStatus.BUILDING_BLOCKS, (job: Job) => buildSemanticBlocks(job.job_id)],
    [
      JobStatus.BUILDING_TOPICS,
      (job: Job) => {
        const strategy = selectStrategy(job.video_duration_seconds ?? 0);
        const configs = loadActiveToolConfigs();
        const embeddingModel =
          String(configs.llm.embedding_model || "nomic-embed-text").trim() || "nomic-embed-text";
        return buildTopicSegments(job.job_id, strategy.useEmbeddings, embeddingModel);
      },
    ],
    [JobStatus.ANALYZING, (job: Job) => analyzeBlocks(job.job_id, job.video_duration_seconds ?? 0)],
  ];

  if (options.includeRender) {
    steps.push([JobStatus.RENDERING, (job: Job) => renderSuggestedCuts(job.job_id)]);
  }

  let job = metadata.loadJob(jobId);

  try {
    for (const [status, action] of steps) {
      if (job.status === JobStatus.ERROR || job.status === JobStatus.DONE) {
        break;
      }

      // Skip steps that already completed based on current status
      if (isStatusBefore(job.status, status)) {
        await action(job);
        job = metadata.loadJob(jobId);
      }
    }
  } catch (error) {
    metadata.updateJobStatus(jobId, JobStatus.ERROR);
    throw error;
  }

  return metadata.loadJob(jobId);
}

/**
 * Returns true if `current` status is at or before `target` in the pipeline order,
 * meaning the step for `target` has not yet been executed.
 *
 * @param current - Current job status.
 * @param target - Target step status.
 * @returns true if the step should be executed.
 */
function isStatusBefore(current: JobStatus, target: JobStatus): boolean {
  const order = [
    JobStatus.CREATED,
    JobStatus.DOWNLOADING,
    JobStatus.TRANSCRIBING,
    JobStatus.BUILDING_BLOCKS,
    JobStatus.BUILDING_TOPICS,
    JobStatus.ANALYZING,
    JobStatus.WAITING_APPROVAL,
    JobStatus.RENDERING,
    JobStatus.DONE,
    JobStatus.ERROR,
  ];

  const currentIndex = order.indexOf(current);
  const targetIndex = order.indexOf(target);

  return currentIndex <= targetIndex;
}
