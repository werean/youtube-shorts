import type {
  BatchPipelineOptions as SharedBatchPipelineOptions,
  BatchPipelineProgress as SharedBatchPipelineProgress,
  BatchPipelineRequest as SharedBatchPipelineRequest,
} from "@youtube-shorts/contracts";

export interface BatchPipelineRequest extends SharedBatchPipelineRequest {}

export interface BatchPipelineOptions extends SharedBatchPipelineOptions {}

export interface BatchPipelineProgress extends SharedBatchPipelineProgress {}
