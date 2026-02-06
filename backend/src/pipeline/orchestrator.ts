/**
 * Pipeline orchestration utilities with failure handling.
 */

import { Job, JobStatus } from "../models/job";
import * as metadata from "../storage/metadata";
import { ingestVideo } from "./ingest";
import { transcribeJob } from "./transcription";
import { buildSemanticBlocks } from "./semantic_blocks";
import { analyzeBlocks } from "./analysis";
import { renderSuggestedCuts } from "./rendering";

type Step = [JobStatus, (jobId: string) => Promise<any> | any];

export async function runPipeline(
  jobId: string,
  options: { includeRender?: boolean } = {},
): Promise<Job> {
  const steps: Step[] = [
    [JobStatus.DOWNLOADING, async (jid: string) => ingestVideo(metadata.loadJob(jid))],
    [JobStatus.TRANSCRIBING, transcribeJob],
    [JobStatus.BUILDING_BLOCKS, buildSemanticBlocks],
    [JobStatus.ANALYZING, analyzeBlocks],
  ];

  if (options.includeRender) {
    steps.push([JobStatus.RENDERING, renderSuggestedCuts]);
  }

  let job = metadata.loadJob(jobId);

  try {
    for (const [status, action] of steps) {
      if (job.status === JobStatus.ERROR || job.status === JobStatus.DONE) {
        break;
      }

      // Skip steps that already completed based on current status
      if (isStatusBefore(job.status, status)) {
        await action(jobId);
        job = metadata.loadJob(jobId);
      }
    }
  } catch (error) {
    metadata.updateJobStatus(jobId, JobStatus.ERROR);
    throw error;
  }

  return metadata.loadJob(jobId);
}

function isStatusBefore(current: JobStatus, target: JobStatus): boolean {
  const order = [
    JobStatus.CREATED,
    JobStatus.DOWNLOADING,
    JobStatus.TRANSCRIBING,
    JobStatus.BUILDING_BLOCKS,
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
