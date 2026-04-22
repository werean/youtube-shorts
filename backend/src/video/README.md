# Video

FFmpeg-specific command construction and execution helpers.

## Responsibilities

- Build vertical 9:16 render command arguments.
- Apply configured FFmpeg codecs, presets, bitrate, frame rate, filters, audio options, and metadata.
- Wrap synchronous/asynchronous FFmpeg execution for pipeline callers.

## Important Files

- `vertical.ts` builds the vertical render filter graph and FFmpeg command arguments.
- `ffmpeg.ts` executes FFmpeg commands.

## Interactions

- `src/pipeline/rendering.ts` prepares render inputs and delegates command construction/execution here.
- `src/core/config.ts` provides render defaults.
- `src/core/toolConfigs.ts` provides user-selected FFmpeg options.

## Invariants

- Preserve command argument order and defaults unless intentionally changing render behavior.
- Keep generated output compatible with `/media/shorts/:job_id/:file` streaming.
- Be careful with user-configured filters and file paths; callers depend on safe output path construction.

