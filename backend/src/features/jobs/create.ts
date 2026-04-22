import { v4 as uuidv4 } from "uuid";

import type { Job } from "../../models/job";
import { JobStatus } from "../../models/job";
import * as jobLifecycleService from "../../services/jobLifecycleService";

export function createJobForYoutubeUrl(youtubeUrl: string): Job {
  const jobId = uuidv4().replace(/-/g, "");
  console.log(`[POST /jobs] Job ID gerado: ${jobId}`);

  const job: Job = {
    job_id: jobId,
    youtube_url: youtubeUrl,
    status: JobStatus.CREATED,
    created_at: new Date().toISOString(),
  };

  console.log(`[POST /jobs] Salvando job...`);
  jobLifecycleService.saveJob(job);
  return job;
}
