# Config

User-facing configuration helpers for folders, settings updates, prompt persistence, Ollama model metadata, and dependency installation support.

## Responsibilities

- Provide folder picker and common-folder helpers used by config routes.
- Normalize and persist selected prompt/settings changes through focused helpers.
- Expose Ollama model catalog, registry, command, and verification helpers.
- Coordinate dependency installer behavior used by dependency routes.

## Important Areas

- `folders/` contains common folder discovery and folder picker helpers.
- `ollama/` contains model catalog, registry, normalization, commands, and verification helpers.
- `prompts/` persists saved prompt configuration.
- `settings/` applies settings update behavior.
- `installer.ts` supports dependency install session behavior.

## Interactions

- `src/routes/config/` exposes these operations as HTTP endpoints.
- `src/core/settings.ts` and `src/core/toolConfigs.ts` remain the source of persisted application/tool configuration.
- `src/features/dependencies/` owns lower-level dependency detection, execution, runtime sessions, and terminal operations.

## Invariants

- Keep config route response shapes stable for the frontend dialogs.
- Do not move persisted config files or change default config semantics without a migration plan.
- Dependency install actions can affect local tools; keep command behavior explicit and test-covered.

