"""Import the transcription artifacts of an existing job into the eval corpus.

    python -m evals.import_job <job_id> --slug <slug> --format <label> --split dev|holdout

Never modifies the source job (data/jobs/ is only read). Writes the corpus under backend/evals/.
Caveat: resolving paths builds the app's real default container, and the app's normal settings
loading may itself rewrite data/settings.json or data/default_configs.json.
"""

from __future__ import annotations

import argparse
import shutil
import sys
from pathlib import Path
from typing import Any

from evals import corpus


def import_job(
    job_id: str,
    *,
    slug: str,
    format_label: str,
    split: str,
    language: str | None = None,
    source: str | None = None,
    segments_path: Path | None = None,
    words_path: Path | None = None,
    source_info_path: Path | None = None,
    duration_seconds: float | None = None,
    corpus_root: Path | None = None,
    manifest_path: Path | None = None,
) -> dict[str, Any]:
    """Copy artifacts into corpus/<slug>/ and upsert the manifest. Paths may be injected (tests)."""
    corpus.validate_slug(slug)
    if split not in corpus.VALID_SPLITS:
        raise ValueError(f"split must be one of {corpus.VALID_SPLITS}")

    if segments_path is None or words_path is None or source_info_path is None or duration_seconds is None:
        # Resolve through the app (the job lives in the real data dir; job files are only read).
        from app.application.runtime_service import get_container

        c = get_container()
        job = c.jobs.load_job(job_id)
        segments_path = segments_path or c.jobs.transcription_segments_path(job_id)
        words_path = words_path or c.jobs.transcription_words_path(job_id)
        source_info_path = source_info_path or c.jobs.source_info_path(job_id)
        if duration_seconds is None:
            duration_seconds = job.video_duration_seconds
        if source is None:
            source = job.youtube_url

    if not Path(segments_path).exists() and not (words_path and Path(words_path).exists()):
        raise FileNotFoundError("Job has neither transcription.segments.json nor transcription.words.json")

    dest = corpus.corpus_dir(slug, corpus_root)
    dest.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    for src, name in (
        (segments_path, "transcription.segments.json"),
        (words_path, "transcription.words.json"),
        (source_info_path, "source.info.json"),
    ):
        if src and Path(src).exists():
            shutil.copyfile(src, dest / name)
            copied.append(name)

    entry = {
        "slug": slug,
        "format": format_label,
        "language": language,
        "duration_seconds": duration_seconds,
        "split": split,
        "source": source,
    }
    corpus.upsert_manifest_entry(entry, manifest_path)
    return {"entry": entry, "copied": copied, "dest": str(dest)}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m evals.import_job")
    ap.add_argument("job_id")
    ap.add_argument("--slug", required=True)
    ap.add_argument("--format", required=True, dest="format_label")
    ap.add_argument("--split", required=True, choices=corpus.VALID_SPLITS)
    ap.add_argument("--language")
    ap.add_argument("--source")
    a = ap.parse_args(argv)
    try:
        res = import_job(
            a.job_id,
            slug=a.slug,
            format_label=a.format_label,
            split=a.split,
            language=a.language,
            source=a.source,
        )
    except Exception as exc:  # noqa: BLE001
        print(f"import failed: {exc}", file=sys.stderr)
        return 1
    print(f"imported {res['copied']} into {res['dest']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
