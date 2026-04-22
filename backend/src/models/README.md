# Models

Backend domain types shared across routes, features, storage, and pipeline modules.

## Responsibilities

- Define job metadata and status values.
- Define transcription segment, semantic block, topic segment, and cut shapes.
- Provide TypeScript contracts for persisted artifacts and route-adjacent operations.

## Important Files

- `job.ts` defines `Job` and `JobStatus`.
- `cut.ts` defines suggested/curated cut data.
- `segment.ts` defines transcription segment data.
- `semantic_block.ts` defines semantic block data.
- `topic_segment.ts` defines topic segmentation data.

## Interactions

- Storage persists `Job` metadata and artifact arrays using these shapes.
- Pipeline modules transform one model into the next: segments, blocks, topics, cuts.
- Frontend types are separate, so status/string changes must be synchronized manually.

## Invariants

- `JobStatus` values are persisted and consumed by the frontend; do not rename values casually.
- `Job.source_video_path` is absolute and is consumed by multiple workflows.
- Artifact model changes should be paired with tests for readers and writers.

