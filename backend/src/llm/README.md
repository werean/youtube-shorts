# LLM

Ollama integration and prompt templates used by analysis.

## Responsibilities

- Build and send non-streaming `/api/chat` requests to Ollama.
- Attach optional API key authorization.
- Convert Ollama/network failures into user-facing error messages.
- Fall back from unauthorized cloud models to an available local model when possible.
- Provide system prompt templates used by analysis/tool configuration.

## Important Files

- `client.ts` contains `OllamaClient`.
- `prompts.ts` contains prompt templates and prompt-related constants.

## Interactions

- `src/pipeline/analysis.ts` uses `OllamaClient` to generate candidate cuts.
- `src/pipeline/embedding.ts` calls Ollama embedding endpoints directly.
- `src/core/toolConfigs.ts` persists selected LLM and embedding model configuration.

## Invariants

- Keep analysis callers receiving plain text content from `chat()`.
- Preserve cloud-auth fallback/error messaging unless deliberately changing model selection behavior.
- Do not assume Ollama is always local; base URL and API key are configurable.

