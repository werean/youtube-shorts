# Backend Tests

Backend tests cover the file-backed pipeline, route contracts, integration behavior, and low-level utilities.

## Responsibilities

- Protect pipeline status transitions and artifact behavior.
- Protect route response shapes used by the frontend.
- Cover dependency/config route behavior without requiring real external installs.
- Cover utility behavior such as opening folders and Ollama client fallback handling.

## Important Areas

- `bun/` contains Bun-native behavior tests for pipeline and route contracts.
- `integration/` contains Fastify integration tests.
- `unit/` contains focused Vitest unit tests.
- `tsconfig.json` scopes TypeScript settings for tests.

## Common Commands

- `cd backend && bun run test:bun` runs the Bun-native behavior suite.
- `cd backend && bun run test` runs Vitest.
- `cd backend && bun run type-check` validates TypeScript.

## Invariants

- Prefer focused regression tests before high-risk pipeline, storage, dependency, or route refactors.
- Keep tests isolated from the real `data/` directory by using temporary roots and mocks.
- Route tests should assert response shapes, not implementation details.

