# App

Server composition layer for the backend. This folder wires Fastify together without owning feature logic.

## Responsibilities

- Create the Fastify instance.
- Register cross-cutting plugins such as CORS, multipart handling, and static/media serving support.
- Register top-level route groups.
- Start the server on `process.env.PORT` or `8000`.

## Important Files

- `createServer.ts` creates the Fastify app instance.
- `registerPlugins.ts` installs shared Fastify plugins.
- `registerRoutes.ts` mounts health, jobs, videos, media, and config routes.
- `startServer.ts` performs startup, logs boot information, and returns the Fastify instance.

## Interactions

- Calls into `src/routes/` only for route registration.
- Reads paths from `src/core/paths.ts` for startup diagnostics.
- Does not implement job, pipeline, storage, or configuration behavior directly.

## Invariants

- Keep route prefixes stable: jobs are mounted at `/jobs`, config at `/config`, and health/media/videos remain at their registered top-level paths.
- Avoid feature-specific logic here; add behavior in routes/features/pipeline modules instead.

