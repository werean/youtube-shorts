# AGENTS.md

Operational guide for future AI agents and incremental refactoring work in `C:\Users\lucas\code\youtube-shorts`.

This document is based on static repository inspection from earlier phases. Use it as a baseline, not as absolute truth. Verify current code before editing.

## Agent Working Rules

- Read relevant files first.
- Prefer minimal changes.
- Preserve current behavior unless explicitly asked otherwise.
- Use this document as a baseline, not absolute truth.
- Verify assumptions in code before editing.
- Keep refactors incremental and low risk.

## Recommended Reading Order

For a fast understanding of the project, read in this order:

1. `package.json`
   - Root workspace scripts and Bun workspace layout.
2. `backend/src/main.ts`
   - Backend entrypoint.
3. `backend/src/app/startServer.ts`
   - Server startup, port behavior, route/plugin registration.
4. `backend/src/app/registerRoutes.ts`
   - Top-level backend route map.
5. `backend/src/routes/jobs/index.ts`
   - Job route aggregation.
6. `backend/src/pipeline/orchestrator.ts`
   - Full backend pipeline sequence.
7. `backend/src/storage/files.ts`
   - Artifact paths and source video lookup behavior.
8. `backend/src/storage/metadata.ts`
   - JSON-backed job persistence.
9. `backend/src/core/settings.ts`
   - Media base directory and local settings behavior.
10. `backend/src/core/toolConfigs.ts`
    - Whisper, FFmpeg, LLM, and embedding config behavior.
11. `frontend/src/api/client.ts`
    - Frontend backend base URL and request wrapper.
12. `frontend/src/components/UploadSection.tsx`
    - YouTube URL and local upload entry flow.
13. `frontend/src/App.tsx`
    - Main UI coordinator and workflow state.

For specific workflows:

- Ingest: `backend/src/pipeline/ingest.ts`
- Transcription: `backend/src/pipeline/transcription.ts`
- Semantic blocks: `backend/src/pipeline/semantic_blocks.ts`
- Topic segmentation: `backend/src/pipeline/topic_segmentation.ts`
- LLM analysis: `backend/src/pipeline/analysis.ts`
- Rendering: `backend/src/pipeline/rendering.ts`, `backend/src/video/vertical.ts`
- Dependency configuration: `backend/src/routes/config/registerDependenciesRoutes.ts`

## Critical Invariants

Do not break these during refactors unless the task explicitly asks for a behavior change:

- Route URLs:
  - `/health`
  - `/jobs`
  - `/jobs/upload`
  - `/jobs/:job_id`
  - `/jobs/:job_id/ingest`
  - `/jobs/:job_id/transcribe`
  - `/jobs/:job_id/blocks`
  - `/jobs/:job_id/analyze`
  - `/jobs/:job_id/cuts`
  - `/jobs/:job_id/render`
  - `/jobs/:job_id/renders`
  - `/jobs/:job_id/run`
  - `/jobs/batch/run`
  - `/videos`
  - `/videos/archived`
  - `/media/videos/:job_id`
  - `/media/shorts/:job_id/:file`
  - `/config/...`
- Response shapes:
  - Frontend API wrappers depend on current JSON shapes from job, transcription, cuts, render, logs, batch, and config routes.
- Job status compatibility:
  - Backend statuses are defined in `backend/src/models/job.ts`.
  - Frontend statuses are defined separately in `frontend/src/types.ts`.
  - Keep frontend/backend status values compatible.
- Artifact filenames:
  - `job.json`
  - `source.info.json`
  - `transcription.segments.json`
  - `transcription.txt`
  - `transcription.vtt`
  - `semantic.blocks.json`
  - `topic.segments.json`
  - `cuts.suggested.json`
- Source video path behavior:
  - `Job.source_video_path` is an absolute path.
  - It is consumed by media streaming, transcription, rendering, archive/delete/open-folder flows, and source-video cache logic.
- File-backed persistence:
  - Jobs, settings, tool configs, transcription artifacts, blocks, topics, cuts, and rendered output listings are filesystem-backed.
- External command behavior:
  - Do not change child-process commands, environment variables, artifact paths, or polling intervals as part of structural extraction.

## Verified Facts

### Stack

- Root package is a Bun workspace with `backend` and `frontend`.
- Backend is TypeScript ESM using Fastify.
- Backend tests use Vitest.
- Frontend is React 18 + TypeScript + Vite.
- Tailwind/PostCSS config exists in the frontend.
- Installed/generated directories are present in the working tree:
  - `node_modules`
  - `backend/node_modules`
  - `backend/dist/main.js`
  - `frontend/node_modules`
  - `frontend/dist`

### Entrypoints

- Root scripts are defined in `package.json`.
- Backend starts from `backend/src/main.ts`.
- `backend/src/app/startServer.ts` listens on `process.env.PORT` or `8000`.
- Frontend mounts from `frontend/src/main.tsx`.
- Frontend API base URL is `http://localhost:8000` in `frontend/src/api/client.ts`.
- Vite dev server port is `5173`.

### Backend Layout

- `backend/src/app/`: Fastify creation, plugins, routes, startup.
- `backend/src/routes/jobs/`: job lifecycle, upload, ingest, transcription, blocks, analysis, cuts, render, pipeline, batch, rename, logs.
- `backend/src/routes/config/`: settings, tool config, dependency detection/install, prompts, folder picker, Ollama models.
- `backend/src/pipeline/`: processing steps and orchestration.
- `backend/src/storage/`: JSON metadata and artifact/file path helpers.
- `backend/src/core/`: config, paths, settings, tool configs, task logs.
- `backend/src/llm/`: Ollama client and prompts.
- `backend/src/video/`: FFmpeg helpers and vertical render command construction.

### Frontend Layout

- `frontend/src/App.tsx` is the main UI coordinator.
- `frontend/src/components/UploadSection.tsx` handles YouTube URL and local file upload UI.
- `frontend/src/api/` contains feature API wrappers.
- `frontend/src/hooks/` contains existing hooks for app actions, cuts, logs, polling, rendering, settings, transcription, upload, and video management.
- `frontend/src/components/ui/` contains UI primitives and older/parallel UI components.

### Scripts And Tests

- Root scripts include `install:all`, `dev`, `build`, and `start`.
- Backend scripts include `build`, `dev`, `type-check`, `test`, and `test:watch`.
- Frontend scripts include `dev`, `build`, and `preview`.
- `scripts/dev-backend.ts` checks port `8000` on Windows and starts the backend watcher.
- `scripts/ensure-port-free.ts` frees a Windows listening port, default `8000`.
- `scripts/create-dummy-video.ps1` writes a minimal MP4 header.
- Backend tests exist under `backend/tests`.
- No frontend test configuration was identified in inspected manifests.

## System Flow

### Startup

- `backend/src/main.ts` calls `startServer()`.
- `startServer()` creates Fastify, registers plugins/routes, then listens on `8000` by default.
- Frontend mounts `App` and calls the backend through `frontend/src/api/client.ts`.

### YouTube URL Ingest

- `UploadSection` calls `createJob(youtubeUrl)`.
- `registerCreateJob.ts` creates a UUID-like `job_id` with `status: CREATED`.
- `UploadSection` calls `ingestJob(job_id)`.
- `registerIngestJob.ts` loads the job and calls `ingestVideo(job)`.
- `ingest.ts` runs `python -m yt_dlp`.
- `ingest.ts` writes video/info files, updates `source_video_path` and `video_name`, and falls back to a dummy MP4 on download failure.

### Local File Upload

- `UploadSection` calls `uploadVideoFile(file)`.
- `frontend/src/api/videos.ts` posts multipart form data to `/jobs/upload`.
- `registerUploadJob.ts` writes the uploaded video under the configured media base directory.
- `registerUploadJob.ts` creates a `Job` with `status: DOWNLOADED`.

### Manual UI Processing

- Transcribe: `App.tsx` -> `transcribeJob()` -> `POST /jobs/:job_id/transcribe`.
- Build blocks: `App.tsx` -> `buildBlocks()` -> `POST /jobs/:job_id/blocks`.
- Analyze: `App.tsx` -> `analyzeJob()` -> `POST /jobs/:job_id/analyze`.
- Render: `App.tsx` -> `updateCuts()` -> `renderJob()` -> poll render outputs/job status.

### Full Backend Pipeline

- `POST /jobs/:job_id/run` calls `orchestrator.runPipeline(jobId, { includeRender })`.
- Ordered steps:
  - ingest
  - transcription
  - semantic blocks
  - topic segmentation
  - analysis
  - optional rendering
- `orchestrator.ts` uses job status ordering to skip already-completed steps.

### Batch Pipeline

- Frontend calls:
  - `/jobs/batch/run`
  - `/jobs/batch/:batch_id/status`
  - `/jobs/batch/:batch_id/cancel`
  - `/jobs/batch/:batch_id/continue`
- `registerBatchPipelineRoutes.ts` stores progress in an in-memory `activeBatchProcesses` map.
- Batch can run transcription, semantic blocks, analysis, optional approval wait, and rendering.

### Media Output

- Source videos are served by `/media/videos/:job_id`.
- Rendered shorts are served by `/media/shorts/:job_id/:file`.
- `mediaRoutes.ts` supports HTTP range requests and streams files from disk.

## Data And Artifacts

### Job Metadata

- `backend/src/models/job.ts` defines `Job` and `JobStatus`.
- `metadata.ts` persists jobs as `data/jobs/<job_id>/job.json`.

### Source Video

- `Job.source_video_path` stores the absolute source video path.
- YouTube ingest and local upload both converge on a local source video path.

### Transcription

- `transcription.ts` finds source video with `files.findSourceVideo(jobId)`.
- It builds a Whisper CLI command from `loadActiveToolConfigs().whisper`.
- It writes:
  - `transcription.segments.json`
  - `transcription.txt` when configured
  - `transcription.vtt` when configured

### Semantic Blocks

- `semantic_blocks.ts` reads `transcription.segments.json`.
- It groups segments by duration, punctuation, and pause thresholds.
- It writes `semantic.blocks.json`.

### Topic Segments

- `topic_segmentation.ts` reads `semantic.blocks.json`.
- It uses heuristic boundaries and optional embedding boundaries.
- It writes `topic.segments.json`.

### Analysis And Cuts

- `analysis.ts` reads semantic blocks.
- For medium/long strategies, `analysis.ts` reads topic segments.
- It calls Ollama through `OllamaClient`.
- It parses LLM JSON, filters incoherent cuts, deduplicates overlaps, and writes cuts through `files.cutsPath(jobId)`.
- `files.cutsPath(jobId)` resolves to `data/jobs/<job_id>/cuts.suggested.json`.
- `curation.ts` reads/writes the same cuts file for approve/reject status changes.
- `App.tsx` can edit, delete, manually add, normalize IDs, and sync the whole cuts array with `PUT /jobs/:job_id/cuts`.

### Rendered Shorts

- `rendering.ts` reads source video and cuts.
- `video/vertical.ts` builds FFmpeg commands.
- Rendered MP4 files are written into the video's `shorts` folder.
- `files.buildCutFilename(start, end)` names rendered files from timestamp ranges.

### Settings And Tool Config

- `settings.ts` persists `data/settings.json`.
- `toolConfigs.ts` persists:
  - `data/default_configs.json`
  - `data/custom_settings.json`

### Logs And Progress

- `taskLogs.ts` stores ingest/transcription/render logs in memory.
- Logs are capped at 400 lines per task.
- `registerLogsRoutes.ts` exposes `/jobs/:job_id/logs/:task`.
- `App.tsx` polls task logs every 1500ms.
- `App.tsx` polls render outputs every 2000ms.
- `App.tsx` polls batch status every 2000ms.

## External Integrations

### Ollama

- Defaults live in `backend/src/core/config.ts`.
- `OLLAMA_BASE_URL`: `http://localhost:11434`.
- Default model: `gpt-oss:120b-cloud`.
- `OLLAMA_API_KEY` is read from the environment.
- `llm/client.ts` calls `/api/chat` and `/api/tags`.
- `pipeline/embedding.ts` calls `/api/embed`.

### Whisper

- `pipeline/transcription.ts` runs `whisper` through `child_process.spawn`.
- Default model: `large-v3`.

### yt-dlp

- `pipeline/ingest.ts` runs `python -m yt_dlp`.

### FFmpeg

- `video/ffmpeg.ts` wraps sync and async FFmpeg execution.
- `video/vertical.ts` builds vertical render commands.
- Default render config includes `h264_nvenc`, `aac`, and preset `p5`.

### Dependency Management

- `routes/config/registerDependenciesRoutes.ts` probes/manages:
  - Python
  - Whisper
  - yt-dlp
  - FFmpeg
  - CUDA
  - PyTorch
  - Ollama

### Windows / OS Integration

- `scripts/dev-backend.ts` and `scripts/ensure-port-free.ts` use `netstat`, `findstr`, and `taskkill`.
- `utils/openFolder.ts` supports opening folders from backend flows.

## Large Files

### Large Source Files

- `frontend/src/App.tsx`: 120945 bytes, 2893 lines.
- `backend/src/routes/config/registerDependenciesRoutes.ts`: 62407 bytes, 1860 lines.
- `frontend/src/components/LLMConfigDialog.tsx`: 48427 bytes, 1253 lines.
- `frontend/src/components/WhisperConfigDialog.tsx`: 36161 bytes, 819 lines.
- `frontend/src/components/DependenciesDialog.tsx`: 27295 bytes, 714 lines.
- `backend/src/core/toolConfigs.ts`: 20000 bytes, 538 lines.
- `frontend/src/components/VideoPlayerSection.tsx`: 17785 bytes, 430 lines.
- `frontend/src/types/whisper.ts`: 17698 bytes, 642 lines.
- `frontend/src/components/FFmpegConfigDialog.tsx`: 16594 bytes, 412 lines.
- `backend/src/pipeline/transcription.ts`: 16467 bytes, 407 lines.
- `frontend/src/components/UploadSection.tsx`: 15767 bytes, 382 lines.

### Large Runtime / Generated Files

- `bun.lock`: 90249 bytes.
- `data/jobs/7ca821c3e9594946b2f3131309baaac2/semantic.blocks.json`: 31942 bytes.
- `data/jobs/659068ec935346d4ab4d22d82ebdc1bd/semantic.blocks.json`: 29483 bytes.
- Generated/dependency directories are present:
  - `node_modules`
  - `backend/node_modules`
  - `backend/dist`
  - `frontend/node_modules`
  - `frontend/dist`

## Observed Risks

### Pipeline Step Consistency

- `orchestrator.ts` runs `buildTopicSegments()` before `analyzeBlocks()`.
- `registerAnalysisRoutes.ts` only ensures semantic blocks before analysis.
- `registerBatchPipelineRoutes.ts` builds semantic blocks but does not call `buildTopicSegments()`.
- Risk: direct analysis or batch analysis may depend on `topic.segments.json` already existing for medium/long videos.

### Cuts Artifact Naming

- Most code uses `cuts.suggested.json` through `files.cutsPath(jobId)`.
- Batch `preApprove` code looks for `cuts.json`.
- Risk: batch approval may not load pending cuts from the artifact used elsewhere.

### Status Enum Drift

- Backend `JobStatus` includes `BUILDING_TOPICS`.
- Frontend `JobStatus` in `frontend/src/types.ts` does not include `BUILDING_TOPICS`.
- Risk: frontend type/status handling may lag backend pipeline states.

### Absolute Source Paths

- `Job.source_video_path` is shared by many modules.
- Rename/archive/delete operations move or remove folders.
- Caches exist in `metadata.ts`, `storage/files.ts`, and `mediaRoutes.ts`.
- Risk: moved or deleted files can conflict with cached paths if invalidation is incomplete.

### In-Memory Runtime State

- Task logs, batch progress, active transcriptions, and active renderings are module-level maps.
- Risk: state is lost on process restart and is not durable.

### Shared Cuts Mutation

- `analysis.ts`, `curation.ts`, `registerCutsRoutes.ts`, and `App.tsx` can all write the cuts artifact.
- Risk: full-array writes from the UI can overwrite status changes or generated cut data.

### Upload State Duplication

- Upload-related state or logic exists in:
  - `frontend/src/hooks/useUIState.ts`
  - `frontend/src/App.tsx`
  - `frontend/src/components/UploadSection.tsx`
- Risk: duplicate state makes it unclear which path is authoritative.

### Route Literal Duplication

- Frontend wrappers and backend route registration define matching string paths independently.
- Risk: route changes can silently break frontend/backend compatibility.

## Hypotheses

These are plausible interpretations, not verified requirements:

- `POST /jobs/:job_id/run` may be the intended safe path for medium/long analysis because it includes topic segmentation before analysis.
- `POST /jobs/:job_id/analyze` may have been written first for shorter/direct workflows and later became incomplete for topic-aware strategies.
- Batch `preApprove` may be unfinished or stale because it reads `cuts.json` instead of `cuts.suggested.json`.
- `UploadSection` may be the intended current upload owner, while leftover upload state remains in `App.tsx`/`useUIState.ts`.

## Immediate Wins

Small, low-risk improvements to consider first:

- Add `BUILDING_TOPICS` to `frontend/src/types.ts`.
- Replace batch `cuts.json` lookup with `files.cutsPath(jobId)`.
- Add a focused test for batch `preApprove` loading cuts.
- Add a focused test for direct analysis when topic segmentation is required.
- Add a small helper for "ensure semantic blocks exist" before analysis.
- Document or correct the backend port mismatch between README (`3000`) and code (`8000`).
- Confirm whether `SEMANTIC_ANALYSIS_PIPELINE.md` deletion is intentional before staging or committing.
- Confirm whether `node_modules` and `dist` directories are tracked or only present locally.

## Refactoring Roadmap

### Priority 1 = Low Risk / High Impact

- Align clear contract mismatches:
  - Add frontend `BUILDING_TOPICS`.
  - Use `files.cutsPath(jobId)` in batch approval.
  - Correct backend port docs if documentation work is in scope.
- Add regression coverage:
  - Direct analysis route for medium/long videos.
  - Batch `preApprove` pending cuts.
  - Topic segmentation status values.
- Extract small helpers only where behavior is clear:
  - Shared "ensure blocks exist" helper.
  - Path-safe render file lookup/open-folder helper if tests cover current responses.
- Tighten frontend API wrapper types without changing routes.

### Priority 2 = Medium Effort

- Add a backend analysis preparation helper:
  - Load job.
  - Ensure semantic blocks.
  - Select strategy using `video_duration_seconds`.
  - Ensure topic segments when required.
  - Reuse from direct analysis, batch, and eventually orchestrator.
- Split `registerDependenciesRoutes.ts` by responsibility while preserving route URLs and payloads:
  - Fastify route registration.
  - Command/session execution.
  - Individual dependency detectors.
- Reduce `App.tsx` by workflow:
  - Render polling and task-log polling.
  - Batch polling.
  - Dependency install session polling.
- Consolidate upload state ownership after confirming the active rendered path.
- Add storage/path mutation tests:
  - Rename.
  - Archive.
  - Delete.
  - Cache invalidation.
  - Render listing.

### Priority 3 = Structural Changes

- Introduce service boundaries around current file-backed behavior:
  - `jobService` for lifecycle and metadata updates.
  - `artifactService` or storage facade for paths/read/write operations.
  - `operationService` for active transcription/render/batch state and logs.
- Establish shared frontend/backend contracts after route behavior stabilizes:
  - `JobStatus`
  - `Job`
  - `Cut`
  - transcription responses
  - batch progress
  - config responses
- Wrap long-running execution behind a runner abstraction only after tests cover current behavior.
- Keep JSON file persistence initially.
- Do not introduce a queue/database as an early refactor.

## Safe Change Strategy

- Preserve current behavior first.
- Work in thin vertical slices.
- Move code before changing behavior.
- Prefer wrappers before rewrites.
- Replace call sites incrementally.
- Keep generated/runtime data separate from refactors.
- Add tests before touching high-risk files:
  - `backend/src/pipeline/transcription.ts`
  - `backend/src/pipeline/rendering.ts`
  - `backend/src/routes/config/registerDependenciesRoutes.ts`
  - major `frontend/src/App.tsx` extraction
- Avoid changing these during structural extraction:
  - child-process commands
  - environment variables
  - artifact paths
  - polling intervals
  - route URLs
  - response shapes

Validation commands for future code changes:

- Backend type check: `cd backend && bun run type-check`
- Backend tests: `cd backend && bun run test`
- Frontend build: `cd frontend && bun run build`

## Open Questions

- `README.md` says backend port `3000`; current code uses `8000`.
- `README.md` references `backend/README.md` and `frontend/README.md`; those files were not observed during file listing.
- `README.md` mentions an `upload/` folder; `core/paths.ts` references `upload/`, but no root `upload/` directory was observed.
- It is unknown whether `node_modules` and `dist` directories are tracked by Git.
- It is unclear which upload state path is intended as primary.
- It is unclear whether direct `POST /jobs/:job_id/analyze` is expected to support medium/long videos without first using `POST /jobs/:job_id/run`.
- It is unclear whether batch `preApprove` is actively used.
- It is unclear whether caches in `metadata.ts`, `storage/files.ts`, and `mediaRoutes.ts` are invalidated in every rename/archive/delete scenario.
