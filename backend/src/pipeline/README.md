# Pipeline

Processing pipeline for turning an input video into transcriptions, semantic context, suggested cuts, and rendered shorts.

## Responsibilities

- Ingest YouTube videos with `yt-dlp` or reuse existing source files.
- Run Whisper transcription and write transcript artifacts.
- Build semantic blocks from transcription segments.
- Build topic segments from semantic blocks, optionally using embeddings.
- Analyze blocks/topics with an LLM and persist suggested cuts.
- Render cuts through FFmpeg.
- Orchestrate full job pipelines with status transitions and failure handling.

## Important Files

- `orchestrator.ts` runs the full backend pipeline.
- `ingest.ts` and `ingest/` handle YouTube download and fallback source creation.
- `transcription.ts` and `transcription/` handle Whisper execution and artifact normalization.
- `semantic_blocks.ts` creates `semantic.blocks.json`.
- `topic_segmentation.ts` and `topic_segmentation/` create `topic.segments.json`.
- `analysis.ts` and `analysis/` generate and filter cuts.
- `analysis_prerequisites.ts` prepares blocks/topics before analysis where callers require it.
- `rendering.ts` and `rendering/` run FFmpeg and list rendered output.
- `strategy.ts` selects analysis behavior by video duration.

## Interactions

- Reads and writes paths through `src/storage/`.
- Reads tool settings from `src/core/toolConfigs.ts`.
- Uses `src/llm/` and Ollama for analysis.
- Uses `src/video/` for FFmpeg command construction and execution.
- Called by job routes, feature helpers, and batch processing.

## Invariants

- Preserve artifact names: `transcription.segments.json`, `transcription.txt`, `transcription.vtt`, `semantic.blocks.json`, `topic.segments.json`, and `cuts.suggested.json`.
- Preserve external command semantics unless a behavior change is explicitly intended.
- Keep job status transitions compatible with `JobStatus` and frontend expectations.
- Direct analysis and batch analysis currently have their own prerequisite behavior; verify before changing topic-segmentation assumptions.

