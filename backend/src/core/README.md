# Core

Shared runtime configuration and process-local state used across backend features.

## Responsibilities

- Define static defaults for Ollama, render dimensions/codecs, and other runtime constants.
- Resolve project, data, jobs, and upload paths.
- Load and persist application settings.
- Load and persist tool configurations for Whisper, FFmpeg, LLM, and embeddings.
- Store short-lived in-memory task logs.

## Important Files

- `config.ts` contains static runtime defaults.
- `paths.ts` resolves project and data directory paths.
- `settings.ts` persists `data/settings.json` and media directory preferences.
- `toolConfigs.ts` persists default/custom tool configuration.
- `taskLogs.ts` stores capped in-memory logs for long-running tasks.

## Interactions

- Pipeline modules read tool configs and append logs while running external processes.
- Storage modules depend on path helpers for job metadata and artifact locations.
- Config routes expose and update settings/tool configs for the frontend.

## Invariants

- Preserve persisted file names and JSON shapes unless intentionally migrating them.
- Settings/tool config caches must be invalidated when writes occur.
- Task logs are intentionally in-memory and capped; do not treat them as durable persistence.

