export interface BatchPipelineRequest {
  job_ids: string[];
  options: BatchPipelineOptions;
}

export interface BatchPipelineOptions {
  transcription: boolean;
  analysis: boolean;
  render: boolean;
  preApprove: boolean;
}

export interface BatchPipelineProgress {
  current_job_index: number;
  current_job_id: string;
  current_step: string;
  completed_jobs: string[];
  failed_jobs: { job_id: string; error: string }[];
  is_running: boolean;
  waiting_for_approval?: boolean;
  pending_cuts?: any[];
}
