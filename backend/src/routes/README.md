# Routes

Fastify route layer for the backend HTTP API. Route files translate requests into feature, storage, pipeline, or config operations and preserve response contracts for the frontend.

## Responsibilities

- Register public API routes and prefixes.
- Validate request shape enough to preserve stable HTTP errors.
- Call feature/pipeline/storage/config modules for actual work.
- Return the JSON shapes expected by frontend API wrappers.

## Important Areas

- `healthRoutes.ts` exposes `/health`.
- `jobs/` registers `/jobs` lifecycle, processing, curation, render, pipeline, batch, rename, and log endpoints.
- `videosRoutes.ts` exposes video library and archive/lifecycle operations.
- `mediaRoutes.ts` serves source videos and rendered shorts.
- `configRoutes.ts` mounts config subroutes under `/config`.
- `config/` contains settings, tool config, dependency, prompt, folder, and Ollama-related route handlers.

## Interactions

- Registered from `src/app/registerRoutes.ts`.
- Calls `src/features/` for route-adjacent business operations.
- Calls `src/pipeline/` for processing actions.
- Calls `src/storage/` for artifact reads/writes and media path lookup.

## Invariants

- Route URLs are frontend contracts; do not change them during structural cleanup.
- Response shapes for jobs, cuts, render outputs, logs, batch, and config are frontend contracts.
- Keep HTTP handlers thin; avoid embedding pipeline or storage logic directly in routes when it can live in features/pipeline/storage.

