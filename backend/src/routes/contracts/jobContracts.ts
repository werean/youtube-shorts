import type { Cut } from "../../models/cut";
import type { Job } from "../../models/job";
import type {
  BatchPipelineOptions,
  BatchPipelineProgress,
  BatchPipelineRequest,
} from "../../features/jobs/batch/types";

export type ErrorDetailResponseDto = {
  detail: string;
};

export type JobIdParamsDto = {
  job_id: string;
};

export type CutIdParamsDto = JobIdParamsDto & {
  cut_id: string;
};

export type BatchIdParamsDto = {
  batch_id: string;
};

export type CreateJobRequestDto = {
  youtube_url: string;
};

export type CreateJobResponseDto = {
  job: Job;
};

export type RenameJobRequestDto = {
  new_name: string;
};

export type RunPipelineRequestDto = {
  include_render?: boolean;
};

export type UpdateCutsRequestDto = {
  cuts: Cut[];
};

export type UpdateCutsResponseDto = {
  ok: boolean;
  cuts: Cut[];
};

export type BatchRunRequestDto = BatchPipelineRequest;

export type BatchRunResponseDto = {
  batch_id: string;
  status: "started";
};

export type BatchActionResponseDto = {
  status: "cancelled" | "continued";
};

export type BatchStatusResponseDto = BatchPipelineProgress;

export function parseRenameJobRequest(body: RenameJobRequestDto): { newName: string | null } {
  const { new_name } = body;

  if (!new_name || typeof new_name !== "string" || !new_name.trim()) {
    return { newName: null };
  }

  return { newName: new_name.trim() };
}

export function getPipelineIncludeRender(body: RunPipelineRequestDto | undefined): boolean {
  return body?.include_render ?? false;
}

export function isCutsArray(cuts: unknown): cuts is Cut[] {
  return Boolean(cuts) && Array.isArray(cuts);
}

export function hasBatchJobIds(jobIds: BatchRunRequestDto["job_ids"] | undefined): boolean {
  return Boolean(jobIds && jobIds.length > 0);
}

export function getBatchOptions(options: BatchPipelineOptions): BatchPipelineOptions {
  return options;
}
