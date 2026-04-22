# Config Feature

User-facing configuration workflows used by the `/config` route group.

## Responsibilities

- Apply app settings updates while delegating persistence to `src/core/settings.ts`.
- Build tool configuration route payloads while delegating persistence to `src/core/toolConfigs.ts`.
- Persist saved LLM prompts.
- Provide common-folder and system folder-picker behavior.
- Manage Ollama model catalog, registration, deletion, local command execution, and model verification.

## Boundaries

- `src/core/` owns foundational runtime defaults, paths, settings persistence, tool config persistence, and in-memory primitives.
- `src/features/config/` owns route-adjacent config workflows and user-facing behavior.
- `src/features/dependencies/` owns dependency detection, installation guide data, install/uninstall execution, sessions, and terminal commands.

## Invariants

- Preserve `/config` route response shapes and status codes.
- Do not change settings, tool config, or saved prompt file names or JSON shapes.
- Do not change Ollama command arguments, test request semantics, or model registration/deletion behavior.
