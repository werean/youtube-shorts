# Storage

Filesystem-backed storage surface for jobs, artifacts, media folders, source video discovery, and rendered output listings.

## Responsibilities

- Resolve job directories and artifact paths.
- Persist and load `job.json` metadata with a short-lived cache.
- Locate source videos from job metadata and filesystem state.
- Manage active/archived video folders.
- List rendered short files and build output URLs.

## Important Files

- `files.ts` re-exports the public storage surface.
- `artifactPaths.ts` defines paths for transcripts, blocks, topics, cuts, info, and shorts.
- `fileDirs.ts` ensures job/artifact directories.
- `metadata.ts` reads/writes job metadata.
- `sourceVideo.ts` locates and caches source video paths.
- `videoFolders.ts` handles active/archive folder operations.
- `renderOutputs.ts` lists rendered MP4 outputs.

## Interactions

- Pipeline modules read/write artifacts through storage paths.
- Routes and features use storage for jobs, cuts, render outputs, source media, and folder lifecycle operations.
- Core path/settings modules define the base directories storage resolves against.

## Invariants

- Artifact filenames are stable public contracts inside the backend.
- `Job.source_video_path` should remain an absolute source video path.
- Cache invalidation matters after rename, archive, delete, upload, or metadata writes.
- Keep path handling defensive around user-provided filenames.

