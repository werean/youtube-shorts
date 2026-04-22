# Backend

TypeScript Fastify backend for the YouTube Shorts workflow. It owns job metadata, local media/artifact paths, dependency configuration, pipeline execution, and media streaming.

## Entry Points

- `src/main.ts` starts the server.
- `src/app/` creates Fastify, registers plugins/routes, and binds the listening port.
- `src/routes/` exposes the HTTP API consumed by the frontend.

## Folder Guide

- `src/app/` - server composition and startup.
- `src/core/` - shared runtime config, filesystem roots, persisted settings, tool configs, and task logs.
- `src/features/` - route-adjacent business operations for jobs, videos, media, config workflows, and dependency workflows.
- `src/llm/` - Ollama chat client and prompt templates.
- `src/models/` - shared backend domain types.
- `src/pipeline/` - ingest, transcription, semantic blocks, topics, analysis, rendering, and orchestration.
- `src/routes/` - Fastify route registration and HTTP response handling.
- `src/storage/` - JSON metadata, artifact paths, media folders, source video lookup, and render output listing.
- `src/video/` - FFmpeg command construction and execution wrappers.
- `tests/` - Bun and Vitest coverage for pipeline, route, integration, and utility behavior.

## Invariants

- Backend route URLs and response shapes are public contracts for the frontend.
- Job artifacts are file-backed and stored under the configured data/media roots.
- `Job.source_video_path` is an absolute path and is used across streaming, transcription, rendering, and folder lifecycle flows.
- Long-running external tools are invoked by pipeline/video modules; preserve command arguments, environment behavior, and artifact names unless intentionally changing behavior.
