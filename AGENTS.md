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
2. `backend/README.md`
   - Backend overview and folder documentation map.
3. `backend/src/main.ts`
   - Backend entrypoint.
4. `backend/src/app/startServer.ts`
   - Server startup, port behavior, route/plugin registration.
5. `backend/src/app/registerRoutes.ts`
   - Top-level backend route map.
6. `backend/src/routes/README.md`
   - Route layer responsibilities and public contract boundaries.
7. `backend/src/routes/jobs/index.ts`
   - Job route aggregation.
8. `backend/src/features/README.md`
   - Feature-layer responsibilities after the recent routes/features split.
9. `backend/src/services/jobLifecycleService.ts`
   - Job metadata lifecycle boundary for loading, saving, updates, and status transitions.
10. `backend/src/services/artifactService.ts`
    - Backend-facing artifact/path boundary over storage helpers.
11. `backend/src/services/operationRuntimeService.ts`
    - Process-local runtime boundary for logs, active processes, cancellation, and batch progress.
12. `backend/src/features/jobs/directAnalysis.ts`
   - Direct analysis route behavior and current analysis prerequisites.
13. `backend/src/features/jobs/batch/runner.ts`
   - Batch pipeline sequence and analysis prerequisite behavior.
14. `backend/src/pipeline/analysis_prerequisites.ts`
   - Shared strategy-aware analysis preparation for direct, batch, and orchestrator paths.
15. `backend/src/pipeline/orchestrator.ts`
   - Full backend pipeline sequence.
16. `backend/src/storage/files.ts`
   - Low-level artifact paths and source video lookup implementation.
17. `backend/src/storage/metadata.ts`
   - JSON-backed job persistence.
18. `backend/src/core/settings.ts`
   - Media base directory and local settings behavior.
19. `backend/src/core/toolConfigs.ts`
    - Whisper, FFmpeg, LLM, and embedding config behavior.
20. `frontend/src/api/client.ts`
    - Frontend backend base URL and request wrapper.
21. `frontend/src/components/UploadSection.tsx`
    - YouTube URL and local upload entry flow.
22. `frontend/src/App.tsx`
    - Main UI coordinator and workflow state.

For specific workflows:

- Ingest: `backend/src/pipeline/ingest.ts`
- Transcription: `backend/src/pipeline/transcription.ts`
- Semantic blocks: `backend/src/pipeline/semantic_blocks.ts`
- Topic segmentation: `backend/src/pipeline/topic_segmentation.ts`
- Analysis prerequisites: `backend/src/pipeline/analysis_prerequisites.ts`
- LLM analysis: `backend/src/pipeline/analysis.ts`
- Rendering: `backend/src/pipeline/rendering.ts`, `backend/src/video/vertical.ts`
- Dependency configuration: `backend/src/routes/config/registerDependenciesRoutes.ts`, `backend/src/features/dependencies/`
- Job feature operations: `backend/src/features/jobs/`
- Service boundaries: `backend/src/services/`

## Backend Documentation Map

Use these folder-level docs for backend navigation. They are intentionally kept at parent-folder level; avoid adding low-value docs to small nested folders.

- `backend/README.md` - backend overview, entrypoints, folder guide, and core invariants.
- `backend/src/app/README.md` - server composition, plugin registration, route mounting, and startup behavior.
- `backend/src/config/README.md` - user-facing config helpers, folders, prompts, Ollama catalog, and installer support.
- `backend/src/core/README.md` - shared runtime defaults, paths, settings, tool configs, and task logs.
- `backend/src/features/README.md` - route-adjacent business logic for jobs, videos, media, and dependencies.
- `backend/src/llm/README.md` - Ollama chat client behavior and prompt templates.
- `backend/src/models/README.md` - backend domain types and persisted status/model contracts.
- `backend/src/pipeline/README.md` - ingest, transcription, semantic blocks, topics, analysis, rendering, and orchestration.
- `backend/src/routes/README.md` - Fastify route responsibilities, public route groups, and response contract boundaries.
- `backend/src/storage/README.md` - filesystem-backed metadata, artifacts, source video lookup, and render output listing.
- `backend/src/video/README.md` - FFmpeg command construction and execution boundaries.
- `backend/tests/README.md` - backend test layout, commands, and testing invariants.

## Critical Invariants

Do not break these during refactors unless the task explicitly asks for a behavior change:

- Route URLs:
  - `/health`
  - `/jobs`
  - `/jobs/upload`
  - `/jobs/:job_id`
  - `/jobs/:job_id/ingest`
  - `/jobs/:job_id/transcribe`
  - `/jobs/:job_id/transcribe/cancel`
  - `/jobs/:job_id/transcription`
  - `/jobs/:job_id/transcription/:format`
  - `/jobs/:job_id/blocks`
  - `/jobs/:job_id/analyze`
  - `/jobs/:job_id/cuts`
  - `/jobs/:job_id/render`
  - `/jobs/:job_id/render/cancel`
  - `/jobs/:job_id/renders`
  - `/jobs/:job_id/renders/:file`
  - `/jobs/:job_id/renders/:file/open-folder`
  - `/jobs/:job_id/run`
  - `/jobs/batch/run`
  - `/jobs/batch/:batch_id/status`
  - `/jobs/batch/:batch_id/cancel`
  - `/jobs/batch/:batch_id/continue`
  - `/videos`
  - `/videos/archived`
  - `/videos/:job_id/archive`
  - `/videos/:job_id`
  - `/videos/:job_id/open-folder`
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
- Backend tests use Vitest and a Bun-native behavior suite.
- Frontend is React 18 + TypeScript + Vite.
- Tailwind/PostCSS config exists in the frontend.
- Installed/generated directories are present locally and ignored by `.gitignore`:
  - `node_modules`
  - `backend/node_modules`
  - `backend/dist`
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

- Keep this section as a high-level pointer. Use the folder docs listed in **Backend Documentation Map** for responsibilities, interactions, and invariants.
- Route and response contracts live under `backend/src/routes/`; route behavior should remain compatible with frontend API wrappers.
- Route handlers now delegate much of the route-adjacent work to `backend/src/features/`; jobs feature modules are flattened for small operations and grouped only for multi-file areas like batch and render.
- `backend/src/services/` contains the current backend service boundaries:
  - `jobLifecycleService.ts` wraps job metadata load/save/update/status behavior.
  - `artifactService.ts` wraps canonical artifact paths, artifact reads/writes, source-video lookup, render listings, and storage-facing path helpers.
  - `operationRuntimeService.ts` owns process-local runtime state for task logs, active transcription/render processes, cancellation state, batch progress, and dependency install session access.
- Pipeline behavior lives under `backend/src/pipeline/`; low-level artifact implementation remains under `backend/src/storage/` behind `artifactService`.
- Runtime defaults, persisted settings, and persisted tool configs live under `backend/src/core/`; preserve persisted JSON shapes unless intentionally migrating them.
- `backend/src/config/` currently contains user-facing config route helpers. A future `backend/src/features/config/` boundary has been recommended but has not yet been implemented.

### Frontend Layout

- `frontend/src/App.tsx` is the main UI coordinator.
- `frontend/src/components/UploadSection.tsx` handles YouTube URL and local file upload UI.
- `frontend/src/api/` contains feature API wrappers.
- `frontend/src/hooks/` contains existing hooks for app actions, cuts, logs, polling, rendering, settings, transcription, upload, and video management.
- `frontend/src/components/ui/` contains UI primitives and older/parallel UI components.

### Scripts And Tests

- Root scripts include `install:all`, `dev`, `build`, and `start`.
- Backend scripts include `build`, `dev`, `type-check`, `test`, `test:bun`, and `test:watch`.
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
- `registerCreateJob.ts` delegates job creation to `features/jobs/create.ts`, which creates a UUID-like `job_id` with `status: CREATED`.
- `UploadSection` calls `ingestJob(job_id)`.
- `registerIngestJob.ts` loads the job and calls `ingestVideo(job)`.
- `ingest.ts` runs `python -m yt_dlp`.
- `ingest.ts` writes video/info files, updates `source_video_path` and `video_name`, and falls back to a dummy MP4 on download failure.

### Local File Upload

- `UploadSection` calls `uploadVideoFile(file)`.
- `frontend/src/api/videos.ts` posts multipart form data to `/jobs/upload`.
- `registerUploadJob.ts` delegates local upload persistence to `features/jobs/upload.ts`.
- `features/jobs/upload.ts` writes the uploaded video under the configured media base directory and creates a `Job` with `status: DOWNLOADED`.

### Manual UI Processing

- Transcribe: `App.tsx` -> `transcribeJob()` -> `POST /jobs/:job_id/transcribe`.
- Build blocks: `App.tsx` -> `buildBlocks()` -> `POST /jobs/:job_id/blocks`.
- Analyze: `App.tsx` -> `analyzeJob()` -> `POST /jobs/:job_id/analyze` -> `features/jobs/directAnalysis.ts`.
- Direct analysis uses `analysis_prerequisites.ts`:
  - short videos prepare semantic blocks only.
  - medium/long videos prepare semantic blocks and topic segments before `analyzeBlocks()`.
- Render: `App.tsx` -> `updateCuts()` -> `renderJob()` -> poll render outputs/job status.

### Full Backend Pipeline

- `POST /jobs/:job_id/run` calls `orchestrator.runPipeline(jobId, { includeRender })`.
- Ordered steps:
  - ingest
  - transcription
  - semantic blocks
  - strategy-aware topic segmentation for medium/long videos
  - analysis
  - optional rendering
- `orchestrator.ts` uses job status ordering to skip already-completed steps.
- `analysis_prerequisites.ts` is the shared source for analysis preparation behavior across orchestrator, direct analysis, and batch analysis.

### Batch Pipeline

- Frontend calls:
  - `/jobs/batch/run`
  - `/jobs/batch/:batch_id/status`
  - `/jobs/batch/:batch_id/cancel`
  - `/jobs/batch/:batch_id/continue`
- `registerBatchPipelineRoutes.ts` creates/reads in-memory batch progress through `operationRuntimeService`.
- `registerBatchPipelineRoutes.ts` delegates processing to `features/jobs/batch/runner.ts`.
- Batch can run transcription, semantic blocks, analysis, optional approval wait, and rendering.
- Batch analysis uses the same strategy-aware prerequisites as direct/orchestrator analysis:
  - short videos prepare semantic blocks only.
  - medium/long videos prepare semantic blocks and topic segments before `analyzeBlocks()`.

### Media Output

- Source videos are served by `/media/videos/:job_id`.
- Rendered shorts are served by `/media/shorts/:job_id/:file`.
- `mediaRoutes.ts` supports HTTP range requests and streams files from disk.

## Data And Artifacts

### Job Metadata

- `backend/src/models/job.ts` defines `Job` and `JobStatus`.
- `storage/metadata.ts` persists jobs as `data/jobs/<job_id>/job.json`.
- `services/jobLifecycleService.ts` is the backend-facing boundary for job load/save/update/status operations.

### Source Video

- `Job.source_video_path` stores the absolute source video path.
- YouTube ingest and local upload both converge on a local source video path.

### Transcription

- `transcription.ts` finds source video through `artifactService.findSourceVideo(jobId)`.
- It builds a Whisper CLI command from `loadActiveToolConfigs().whisper`.
- It writes:
  - `transcription.segments.json`
  - `transcription.txt` when configured
  - `transcription.vtt` when configured
- Active transcription process tracking and cancellation are owned by `operationRuntimeService`.

### Semantic Blocks

- `semantic_blocks.ts` reads `transcription.segments.json` through `artifactService`.
- It groups segments by duration, punctuation, and pause thresholds.
- It writes `semantic.blocks.json`.

### Topic Segments

- `topic_segmentation.ts` reads `semantic.blocks.json` through `artifactService`.
- It uses heuristic boundaries and optional embedding boundaries.
- It writes `topic.segments.json`.

### Analysis And Cuts

- `analysis.ts` reads semantic blocks.
- For medium/long strategies, `analysis.ts` reads topic segments.
- `analysis_prerequisites.ts` prepares semantic blocks for short videos and semantic blocks plus topic segments for medium/long videos across direct, batch, and orchestrator analysis entrypoints.
- It calls Ollama through `OllamaClient`.
- It parses LLM JSON, filters incoherent cuts, deduplicates overlaps, and writes cuts through `artifactService.cutsPath(jobId)`.
- `artifactService.cutsPath(jobId)` resolves to `data/jobs/<job_id>/cuts.suggested.json`.
- `curation.ts` reads/writes the same cuts file for approve/reject status changes.
- `App.tsx` can edit, delete, manually add, normalize IDs, and sync the whole cuts array with `PUT /jobs/:job_id/cuts`.

### Rendered Shorts

- `rendering.ts` reads source video and cuts.
- `video/vertical.ts` builds FFmpeg commands.
- Rendered MP4 files are written into the video's `shorts` folder.
- `artifactService.buildCutFilename(start, end)` names rendered files from timestamp ranges.
- Active rendering process tracking and cancellation are owned by `operationRuntimeService`.

### Settings And Tool Config

- `settings.ts` persists `data/settings.json`.
- `toolConfigs.ts` persists:
  - `data/default_configs.json`
  - `data/custom_settings.json`

### Logs And Progress

- `core/taskLogs.ts` stores ingest/transcription/render logs in memory.
- `operationRuntimeService.ts` is the backend-facing boundary for task logs, active transcription/render processes, cancellation state, batch progress, and dependency install session access.
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

- `routes/config/registerDependenciesRoutes.ts` exposes dependency endpoints.
- `features/dependencies/` contains detection, execution, policy, runtime session, terminal, and shared dependency types for:
  - Python
  - Whisper
  - yt-dlp
  - FFmpeg
  - CUDA
  - PyTorch
  - Ollama

### Windows / OS Integration

- `scripts/dev-backend.ts` and `scripts/ensure-port-free.ts` use `netstat`, `findstr`, and `taskkill`.
- `utils/openFolder.ts` supports opening folders from video and render output flows.

## Large Files

### Large Source Files

- `frontend/src/App.tsx`: 120945 bytes, 3125 lines.
- `frontend/src/components/LLMConfigDialog.tsx`: 48427 bytes, 1338 lines.
- `frontend/src/components/WhisperConfigDialog.tsx`: 36161 bytes, 866 lines.
- `frontend/src/components/DependenciesDialog.tsx`: 27295 bytes, 761 lines.
- `backend/src/core/toolConfigs.ts`: 20000 bytes, 606 lines.
- `frontend/src/components/VideoPlayerSection.tsx`: 17785 bytes, 441 lines.
- `frontend/src/types/whisper.ts`: 17698 bytes, 664 lines.
- `frontend/src/components/FFmpegConfigDialog.tsx`: 16594 bytes, 439 lines.
- `frontend/src/components/UploadSection.tsx`: 15767 bytes, 402 lines.
- `frontend/src/components/CreatePipelineDialog.tsx`: 11063 bytes, 304 lines.

### Backend Complexity Hotspots

- `backend/src/core/toolConfigs.ts`: 20000 bytes, 538 lines.
- `backend/src/features/dependencies/execution/install.ts`: 9942 bytes, 259 lines.
- `backend/src/core/settings.ts`: 8883 bytes, 263 lines.
- `backend/src/llm/client.ts`: 7046 bytes, 180 lines.
- `backend/src/config/installer.ts`: 6944 bytes, 178 lines.
- `backend/src/features/dependencies/runtime/dependencySessions.ts`: 6596 bytes, 207 lines.
- `backend/src/features/dependencies/detection/pythonRuntime.ts`: 5898 bytes, 178 lines.
- `backend/src/pipeline/analysis/cuts.ts`: 5880 bytes, 143 lines.
- `backend/src/services/operationRuntimeService.ts`: 5765 bytes, 162 lines.
- `backend/src/config/ollama/catalog.ts`: 5682 bytes, 162 lines.
- `backend/src/routes/config/registerDependenciesRoutes.ts`: 5537 bytes, 135 lines after dependency logic moved into `features/dependencies/`.

### Large Runtime / Generated Files

- `bun.lock`: 90249 bytes and is tracked even though `.gitignore` also lists it.
- `data/jobs/7ca821c3e9594946b2f3131309baaac2/semantic.blocks.json`: 31942 bytes.
- `data/jobs/659068ec935346d4ab4d22d82ebdc1bd/semantic.blocks.json`: 29483 bytes.
- `data/jobs/c2db447298144ff18df7408bd946b405/semantic.blocks.json`: 21775 bytes.
- Generated/dependency directories are present:
  - `node_modules`
  - `backend/node_modules`
  - `backend/dist`
  - `frontend/node_modules`
  - `frontend/dist`

## Observed Risks

### Absolute Source Paths

- `Job.source_video_path` is shared by many modules.
- Rename/archive/delete operations move or remove folders.
- Caches exist in `metadata.ts`, `storage/sourceVideo.ts`, and `features/media/streaming.ts`.
- Risk: moved or deleted files can conflict with cached paths if invalidation is incomplete.

### Process-Local Runtime State

- `operationRuntimeService.ts` owns task logs access, batch progress, active transcriptions, active renderings, render cancellation state, and dependency install session access.
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

### Root README Drift

- Root `README.md` still documents backend port `3000`, while current backend code and frontend API config use `8000`.
- Risk: setup/debugging instructions can mislead new contributors.

### Config Boundary Ambiguity

- `backend/src/config/` currently contains user-facing config route helpers, while `backend/src/core/` contains persisted settings/tool config stores.
- `backend/src/features/config/` has been recommended as the future route-adjacent config feature boundary but does not exist yet.
- Risk: future config refactors may continue ad hoc moves unless this boundary is implemented deliberately.

## Hypotheses

These are plausible interpretations, not verified requirements:

- `backend/src/features/config/` may be the right long-term home for user-facing config workflows currently under `backend/src/config/`, while `backend/src/core/` remains the persisted config store.
- `UploadSection` may be the intended current upload owner, while leftover upload state remains in `App.tsx`/`useUIState.ts`.

## Immediate Wins

Small, low-risk improvements to consider first:

- Correct the root `README.md` backend port references from `3000` to `8000`.
- Introduce `backend/src/features/config/` and move route-only config helpers from `backend/src/config/` in small slices.
- Move `backend/src/config/installer.ts` into the dependency feature area if dependency install guides remain dependency-domain data.
- Add a small shared route path/contract reference only if route literal duplication starts causing real churn.
- Confirm whether the existing `docs/ARCHITECTURE.md` deletion is intentional before staging or committing.
- Consider narrowing frontend upload state ownership after confirming which path is active in the UI.

## Refactoring Roadmap

### Recently Completed

- Added frontend `BUILDING_TOPICS` status compatibility.
- Switched batch pre-approval pending cuts to the canonical `artifactService.cutsPath(jobId)` / `cuts.suggested.json` artifact and added regression coverage.
- Added/kept focused tests around direct analysis prerequisites, batch analysis prerequisites, topic status transitions, cuts mutation, and artifact path lifecycle.
- Extracted dependency detection/execution/session/terminal logic from the large config route into `backend/src/features/dependencies/`.
- Flattened single-file job feature folders into direct files under `backend/src/features/jobs/`.
- Added parent-folder backend documentation and updated this `AGENTS.md` documentation map.
- Aligned direct, batch, and orchestrator analysis entrypoints on strategy-aware prerequisites:
  - short videos prepare semantic blocks only.
  - medium/long videos prepare semantic blocks and topic segments before analysis.
- Added shared analysis preparation helpers in `backend/src/pipeline/analysis_prerequisites.ts`.
- Introduced backend service boundaries:
  - `backend/src/services/jobLifecycleService.ts`
  - `backend/src/services/artifactService.ts`
  - `backend/src/services/operationRuntimeService.ts`

### Priority 1 = Low Risk / High Impact

- Correct stale root README references to backend port `3000`.
- Introduce `backend/src/features/config/` for route-adjacent config workflows while keeping persisted settings/tool config stores in `backend/src/core/`.
- Move route-only config helpers first:
  - `backend/src/config/settings/settingsUpdate.ts`
  - `backend/src/config/prompts/savedPrompts.ts`
  - `backend/src/config/folders/`
- Add route/path contract coverage only where route literals have caused or are likely to cause breakage.
- Tighten frontend API wrapper types without changing routes.

### Priority 2 = Medium Effort

- Continue reducing backend complexity hotspots where tests already cover behavior:
  - `backend/src/core/toolConfigs.ts`
  - `backend/src/core/settings.ts`
  - `backend/src/features/dependencies/execution/install.ts`
  - `backend/src/features/dependencies/runtime/dependencySessions.ts`
- Move `backend/src/config/ollama/` into the future `backend/src/features/config/ollama/` boundary if the config-feature structure is introduced.
- Move dependency installation guide data out of `backend/src/config/installer.ts` and into the dependency feature area.
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

- Refine existing service boundaries only where tests show a clear benefit:
  - `jobLifecycleService`
  - `artifactService`
  - `operationRuntimeService`
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
- Prefer routing new lifecycle, artifact/path, and process-local runtime access through the existing service boundaries.
- Keep generated/runtime data separate from refactors.
- Add tests before touching high-risk files:
  - `backend/src/pipeline/transcription.ts`
  - `backend/src/pipeline/rendering.ts`
  - `backend/src/pipeline/analysis_prerequisites.ts`
  - `backend/src/features/dependencies/`
  - `backend/src/services/`
  - `backend/src/routes/config/registerDependenciesRoutes.ts` when changing route contracts
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
- Backend Bun-native behavior tests: `cd backend && bun run test:bun`
- Frontend build: `cd frontend && bun run build`

## Open Questions

- `README.md` says backend port `3000`; current code uses `8000`.
- `README.md` references `frontend/README.md`; that file was not observed during file listing.
- `README.md` mentions an `upload/` folder; `core/paths.ts` references `upload/`, but no root `upload/` directory was observed.
- It is unclear which upload state path is intended as primary.
- `backend/src/features/config/` does not exist yet; the intended config/core/features-config boundary has been recommended but not implemented.
- `docs/ARCHITECTURE.md` is currently deleted in the working tree; confirm whether that deletion is intentional before staging or committing.
- It is unclear whether caches in `metadata.ts`, `storage/sourceVideo.ts`, and `features/media/streaming.ts` are invalidated in every rename/archive/delete scenario.
