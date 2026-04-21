## Pre-task context: Frontend feature for embedding model selection

This task adds a new UI section to the existing "Configurar LLM" settings page/component.
Implement this BEFORE the backend embedding changes described below.

---

## Feature: Embedding Model Selector

Add a new field below the existing "Modelo do Ollama" select in the "Configurar LLM" section.

### Layout
[ Modelo do Ollama        ▼ ]
[ Modelo de Embedding     ▼ ]  ⚠ Modelo não baixado
[ Baixar modelo selecionado ]  [ Adicionar modelo ]

The download button row only renders when the selected embedding model is not available locally.

---

### Data requirements

The component needs to know which models are currently available in Ollama.
Reuse the existing mechanism used by "Modelo do Ollama" to fetch available models from Ollama.
The same `GET http://localhost:11434/api/tags` response contains all downloaded models.

To check if an embedding model is downloaded:
- Fetch `GET http://localhost:11434/api/tags`
- Response contains `models: [{ name: string, ... }]`
- A model is considered downloaded if any entry in `models` has a `name` that starts with the selected model name (e.g. `"nomic-embed-text"` matches `"nomic-embed-text:latest"`)

---

### Default model list

```typescript
const DEFAULT_EMBEDDING_MODELS = [
  "embeddinggemma",
  "qwen3-embedding",
  "all-minilm",
];
```

User-added models are persisted alongside the LLM settings (same storage mechanism used by the rest of "Configurar LLM").

---

### Component behavior

**Embedding model select:**
- Shows all models from `DEFAULT_EMBEDDING_MODELS` + any user-added models
- Currently selected model is highlighted/checked
- When user changes selection: re-check if the new model is downloaded → update warning and button visibility immediately

**Warning indicator (right side of select):**
- Only visible when selected model is NOT downloaded
- Text: "Modelo não baixado"
- Style: match the existing warning/error pattern used elsewhere in the UI (amber/yellow tone)
- Disappears immediately when user selects a model that IS downloaded

**Download button:**
- Label: "Baixar modelo"
- Only renders when selected embedding model is NOT downloaded
- On click: call `POST http://localhost:11434/api/pull` with body `{ "name": selectedEmbeddingModel, "stream": false }`
- While downloading: show loading state on the button, disable it, update label to "Baixando..."
- On success: hide the button and warning, mark model as downloaded in local state
- On error: show error toast/notification using the existing notification pattern in the UI

**"Adicionar modelo" button:**
- Always visible, positioned to the right of the download button row (or alone in that row if model is already downloaded)
- Behavior: identical to the existing "Adicionar modelo" button for Ollama models, but appends to the embedding models list instead of the LLM models list
- After adding: new model is selected automatically and download check runs immediately

---

### Settings persistence

The selected embedding model must be saved and loaded with the other LLM settings.
Add `embeddingModel: string` to whatever settings object/store/API payload "Configurar LLM" already uses.
Default value: `"nomic-embed-text"` (if nothing is saved yet, but this model may not exist in DEFAULT_EMBEDDING_MODELS — add it to the list if not present, or change the default to `"all-minilm"` which is lighter).

---

### Rules
- Match the existing component style, spacing, and interaction patterns exactly — do not introduce new design patterns
- Do not create new utility functions if equivalents already exist (reuse the Ollama tags fetch)
- Do not add new dependencies
- TypeScript strict mode
- If the existing "Adicionar modelo" button has a modal/dialog, reuse that same component for embedding model addition


---


You are a senior backend engineer working on a TypeScript/Node.js video processing pipeline.

## Context
The pipeline already has topic segmentation implemented via heuristics (pause gap + punctuation + duration).
This task adds embedding-based semantic similarity as a second detection layer on top of the existing heuristic logic.

## Ollama Embedding API

Endpoint: POST http://localhost:11434/api/embed
Batch support: yes — send all texts in a single request

```typescript
// Request
{
  model: "nomic-embed-text", // configurable
  input: string[]            // array of block texts
}

// Response
{
  embeddings: number[][]     // one vector per input string, L2-normalized
}
```

Vectors are L2-normalized, so cosine similarity = dot product.

---

## What to implement

### 1. Create `backend/src/pipeline/embedding.ts`

Export:

```typescript
/**
 * Fetches embeddings for an array of texts from Ollama.
 * Sends all texts in a single batch request.
 * @param texts - Array of strings to embed
 * @param model - Ollama embedding model name (default: "nomic-embed-text")
 * @returns Array of embedding vectors, same order as input
 */
export async function fetchEmbeddings(
  texts: string[],
  model: string = "nomic-embed-text"
): Promise<number[][]>

/**
 * Computes cosine similarity between two L2-normalized vectors.
 * Since vectors are L2-normalized, this is equivalent to dot product.
 * @param a - First vector
 * @param b - Second vector
 * @returns Similarity score between -1 and 1
 */
export function cosineSimilarity(a: number[], b: number[]): number

/**
 * Detects topic boundaries using semantic similarity between consecutive blocks.
 * A boundary is detected when similarity drops below the threshold.
 * @param blocks - SemanticBlock array in order
 * @param embeddings - Embedding vectors in same order as blocks
 * @param threshold - Similarity threshold (default: 0.75). Below this = boundary.
 * @returns Set of block_ids where a new topic starts
 */
export function detectEmbeddingBoundaries(
  blocks: SemanticBlock[],
  embeddings: number[][],
  threshold: number = 0.75
): Set<string>
```

Error handling in `fetchEmbeddings`:
- If Ollama returns non-200: throw descriptive error with status code and model name
- If response `embeddings` length !== `texts` length: throw with mismatch details
- If `texts` is empty: return `[]` immediately without calling Ollama

---

### 2. Update `topic_segmentation.ts`

Update `buildTopicSegments` signature:

```typescript
export async function buildTopicSegments(
  jobId: string,
  useEmbeddings: boolean = false,
  embeddingModel: string = "nomic-embed-text",
  similarityThreshold: number = 0.75
): Promise<TopicSegment[]>
```

New internal logic:

```
1. Load SemanticBlock[] from disk
2. Run existing heuristic boundary detection → Set<block_id> heuristicBoundaries
3. if useEmbeddings:
     fetch embeddings for all block texts in a single batch call
     run detectEmbeddingBoundaries → Set<block_id> embeddingBoundaries
     finalBoundaries = union of heuristicBoundaries and embeddingBoundaries
   else:
     finalBoundaries = heuristicBoundaries
4. Build TopicSegment[] using finalBoundaries (existing merging logic)
5. Save and return
```

The existing heuristic logic must remain completely unchanged. Embeddings are additive only — they add boundary candidates, never remove heuristic ones.

---

### 3. Update `strategy.ts`

Add `useEmbeddings` to `ProcessingStrategy`:

```typescript
export interface ProcessingStrategy {
  useTopicSegmentation: boolean;
  useEmbeddings: boolean        // NEW
  useTwoPass: boolean;
  maxBlocksPerLLMRequest: number;
  maxCharsPerLLMRequest: number;
}
```

Update `selectStrategy`:
- Short (< 900s): `useEmbeddings: false`
- Medium (900–3600s): `useEmbeddings: true`
- Long (> 3600s): `useEmbeddings: true`

Reasoning: short videos don't need it — heuristic is sufficient and adds latency for little gain.

---

### 4. Update `orchestrator.ts`

In the `BUILDING_TOPICS` step, pass strategy flags to `buildTopicSegments`:

```typescript
[JobStatus.BUILDING_TOPICS, async (job: Job) => {
  const strategy = selectStrategy(job.video_duration_seconds);
  return buildTopicSegments(
    job.job_id,
    strategy.useEmbeddings
  );
}],
```

---

## File Summary

| File | Action |
|------|--------|
| `backend/src/pipeline/embedding.ts` | CREATE |
| `backend/src/pipeline/topic_segmentation.ts` | UPDATE (add embedding layer) |
| `backend/src/pipeline/strategy.ts` | UPDATE (add useEmbeddings flag) |
| `backend/src/pipeline/orchestrator.ts` | UPDATE (pass strategy to buildTopicSegments) |

---

## Rules
- TypeScript strict mode
- No new npm dependencies — use native `fetch` for the Ollama HTTP call
- Do NOT modify `semantic_blocks.ts`
- Do NOT modify `analysis.ts`, `prompts.ts`, or any model files
- Do NOT change the existing heuristic logic in `topic_segmentation.ts` — only extend it
- Every exported function must have JSDoc with `@param` and `@returns`
- No silent failures: throw descriptive errors with context (jobId, model, counts)


