# Features

Route-adjacent business logic that sits between HTTP handlers and lower-level pipeline, storage, config, and utility modules.

## Responsibilities

- Keep route handlers thin by extracting reusable operations.
- Coordinate job lifecycle actions such as create, upload, rename, cuts replacement, direct analysis, transcription artifacts, render tasks, and batch state.
- Provide video library/lifecycle operations.
- Provide media streaming helpers.
- Own dependency detection/execution/session operations used by config routes.
- Own route-facing config workflows that sit above persisted core settings and tool config stores.

## Important Areas

- `jobs/` contains job feature operations. Small operations live as direct files; multi-file areas such as `batch/` and `render/` remain grouped.
- `videos/` contains library listing and video folder lifecycle behavior.
- `media/` contains source/render streaming helpers.
- `config/` contains route-facing config operations such as settings updates, tool config payloads, saved prompts, folder selection helpers, and Ollama model workflows.
- `dependencies/` contains detection, installation guide data, execution, policy, runtime session, shared type, and terminal helpers.

## Interactions

- Called primarily by `src/routes/`.
- Uses `src/storage/` for metadata/artifact paths and media folder operations.
- Calls `src/pipeline/` for processing steps and `src/utils/` for local OS helpers where needed.

## Invariants

- Preserve public route behavior when moving logic between routes and features.
- Do not introduce generic dumping-ground helpers; keep operations near their feature area.
- Batch and render state is process-local unless explicitly moved to durable storage.
