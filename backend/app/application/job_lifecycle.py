"""Job status state machine, atomic job/artifact store, and downstream cache invalidation."""

from __future__ import annotations

import os
import shutil
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from app.core.paths import (
    cuts_path as _cuts_path,
    ensure_job_dir,
    job_dir,
    job_metadata_path,
    jobs_dir,
    semantic_blocks_path as _semantic_blocks_path,
    source_video_info_path as _source_video_info_path,
    topic_segments_path as _topic_segments_path,
)
from app.core.settings import (
    get_shorts_dir,
    get_transcriptions_dir,
    get_video_dir,
    get_video_file_path,
    load_settings,
)
from app.infrastructure.storage.atomic_store import AtomicJsonArtifactStore
from app.models.domain import (
    AttemptSummary,
    Cut,
    Job,
    JobStatus,
    Segment,
    SemanticBlock,
    TopicSegment,
    WordTiming,
)
from app.models.schemas import AvailableTranscriptionFormats


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


class JobNotFoundError(LookupError):
    """Raised when a job_id does not exist on disk."""

    def __init__(self, job_id: str) -> None:
        super().__init__(f"Job not found: {job_id}")
        self.job_id = job_id


class AttemptNotFoundError(LookupError):
    """Raised when an attempt_id does not exist on disk."""

    def __init__(self, job_id: str, attempt_id: str) -> None:
        super().__init__(f"Attempt not found: {job_id}/{attempt_id}")
        self.job_id = job_id
        self.attempt_id = attempt_id


class JobActivelyProcessingError(RuntimeError):
    """Raised when attempting to archive a job that is actively processing."""

    def __init__(self, job_id: str, status: str) -> None:
        super().__init__(f"Job {job_id} is actively processing ({status})")
        self.job_id = job_id
        self.status = status


class EmptyAttemptError(ValueError):
    """Raised when archiving a job that has no transcription, no cuts, and no renders."""


ACTIVE_PROCESSING_STATUSES: frozenset[JobStatus] = frozenset(
    {
        JobStatus.DOWNLOADING,
        JobStatus.TRANSCRIBING,
        JobStatus.BUILDING_BLOCKS,
        JobStatus.BUILDING_TOPICS,
        JobStatus.ANALYZING,
        JobStatus.RENDERING,
    }
)


def _validate_safe_segment(value: str, label: str = "segment") -> str:
    """Validate a single path segment against empty strings and path traversal."""
    cleaned = (value or "").strip()
    if (
        not cleaned
        or cleaned in {".", ".."}
        or "/" in cleaned
        or "\\" in cleaned
        or "\x00" in cleaned
    ):
        raise ValueError(f"Invalid {label}")
    return cleaned


VALID_STATUS_TRANSITIONS: dict[JobStatus, set[JobStatus]] = {
    JobStatus.CREATED: {
        JobStatus.DOWNLOADING,
        JobStatus.DOWNLOADED,
        JobStatus.ERROR,
    },
    JobStatus.DOWNLOADING: {
        JobStatus.DOWNLOADED,
        JobStatus.CREATED,
        JobStatus.ERROR,
    },
    JobStatus.DOWNLOADED: {
        JobStatus.DOWNLOADING,
        JobStatus.TRANSCRIBING,
        JobStatus.BUILDING_BLOCKS,
        JobStatus.BUILDING_TOPICS,
        JobStatus.ANALYZING,
        JobStatus.WAITING_APPROVAL,
        JobStatus.RENDERING,
        JobStatus.DONE,
        JobStatus.ERROR,
    },
    JobStatus.TRANSCRIBING: {
        JobStatus.BUILDING_BLOCKS,
        JobStatus.DOWNLOADED,
        JobStatus.ERROR,
    },
    JobStatus.BUILDING_BLOCKS: {
        JobStatus.BUILDING_TOPICS,
        JobStatus.ANALYZING,
        JobStatus.DOWNLOADED,
        JobStatus.ERROR,
    },
    JobStatus.BUILDING_TOPICS: {
        JobStatus.ANALYZING,
        JobStatus.WAITING_APPROVAL,
        JobStatus.DOWNLOADED,
        JobStatus.ERROR,
    },
    JobStatus.ANALYZING: {
        JobStatus.WAITING_APPROVAL,
        JobStatus.DOWNLOADED,
        JobStatus.ERROR,
    },
    JobStatus.WAITING_APPROVAL: {
        JobStatus.RENDERING,
        JobStatus.ANALYZING,
        JobStatus.BUILDING_BLOCKS,
        JobStatus.DOWNLOADED,
        JobStatus.DONE,
        JobStatus.ERROR,
    },
    JobStatus.RENDERING: {
        JobStatus.DONE,
        JobStatus.WAITING_APPROVAL,
        JobStatus.DOWNLOADED,
        JobStatus.ERROR,
    },
    JobStatus.DONE: {
        JobStatus.RENDERING,
        JobStatus.WAITING_APPROVAL,
        JobStatus.ANALYZING,
        JobStatus.TRANSCRIBING,
        JobStatus.DOWNLOADED,
        JobStatus.ERROR,
    },
    JobStatus.ERROR: {
        JobStatus.CREATED,
        JobStatus.DOWNLOADING,
        JobStatus.DOWNLOADED,
        JobStatus.TRANSCRIBING,
        JobStatus.BUILDING_BLOCKS,
        JobStatus.BUILDING_TOPICS,
        JobStatus.ANALYZING,
        JobStatus.WAITING_APPROVAL,
        JobStatus.RENDERING,
    },
}


def can_transition(from_status: JobStatus | str, to_status: JobStatus | str) -> bool:
    s_from = JobStatus(from_status)
    s_to = JobStatus(to_status)
    if s_from == s_to:
        return True
    return s_to in VALID_STATUS_TRANSITIONS.get(s_from, set())


class JobLifecycleService:
    """Manages Job persistence, artifact paths, and downstream invalidation."""

    def __init__(self, store: AtomicJsonArtifactStore | None = None) -> None:
        self.store = store or AtomicJsonArtifactStore(on_invalidate=self.invalidate_caches)
        if self.store._on_invalidate is None:
            self.store.set_invalidation_hook(self.invalidate_caches)
        self._job_cache: dict[str, tuple[Job, float, Path]] = {}
        self._source_video_cache: dict[str, tuple[Path, float]] = {}
        self._job_cache_ttl = 2.0
        self._video_cache_ttl = 5.0

    def invalidate_caches(self, job_id: str | None = None) -> None:
        self.invalidate_job_cache(job_id)
        self.invalidate_source_video_cache(job_id)

    def invalidate_job_cache(self, job_id: str | None = None) -> None:
        if job_id:
            self._job_cache.pop(job_id, None)
        else:
            self._job_cache.clear()

    def invalidate_source_video_cache(self, job_id: str | None = None) -> None:
        if job_id:
            self._source_video_cache.pop(job_id, None)
        else:
            self._source_video_cache.clear()

    def set_cached_source_video(self, job_id: str, file_path: str | Path) -> None:
        self._source_video_cache[job_id] = (
            Path(file_path),
            time.monotonic() + self._video_cache_ttl,
        )

    # --- Job CRUD ---

    def create_job(
        self,
        youtube_url: str,
        *,
        status: JobStatus = JobStatus.CREATED,
        job_id: str | None = None,
        source_video_path: str | None = None,
        source_file_name: str | None = None,
        video_name: str | None = None,
        video_duration_seconds: float | None = None,
    ) -> Job:
        jid = job_id or uuid.uuid4().hex
        job = Job(
            job_id=jid,
            youtube_url=youtube_url,
            status=status,
            created_at=utc_now_iso(),
            updated_at=None,
            source_video_path=source_video_path,
            source_file_name=source_file_name,
            video_name=video_name,
            video_duration_seconds=video_duration_seconds,
        )
        self.save_job(job)
        return job

    def save_job(self, job: Job) -> Path:
        meta_path = job_metadata_path(job.job_id)
        self.store.write_json(meta_path, job, job_id=job.job_id)
        self._job_cache[job.job_id] = (
            job.model_copy(deep=True),
            time.monotonic() + self._job_cache_ttl,
            meta_path,
        )
        return meta_path

    def load_job(self, job_id: str) -> Job:
        meta_path = job_metadata_path(job_id)
        now = time.monotonic()
        cached = self._job_cache.get(job_id)
        if cached is not None and cached[2] == meta_path and cached[1] > now:
            return cached[0].model_copy(deep=True)

        if not meta_path.exists():
            raise JobNotFoundError(job_id)

        raw = self.store.read_json(meta_path)
        job = Job.model_validate(raw)
        self._job_cache[job_id] = (
            job.model_copy(deep=True),
            now + self._job_cache_ttl,
            meta_path,
        )
        return job

    def list_jobs(self) -> list[Job]:
        base = jobs_dir()
        if not base.exists():
            return []
        result: list[Job] = []
        for entry in sorted(base.iterdir(), key=lambda p: p.name):
            if not entry.is_dir():
                continue
            try:
                result.append(self.load_job(entry.name))
            except Exception:
                continue
        return result

    def update_job(
        self,
        job_id: str,
        updater: Callable[[Job], None] | dict[str, Any],
    ) -> Job:
        job = self.load_job(job_id)
        if callable(updater):
            updater(job)
        else:
            for k, v in updater.items():
                setattr(job, k, v)
        if job.updated_at is None:
            job.updated_at = utc_now_iso()
        else:
            job.updated_at = utc_now_iso()
        self.save_job(job)
        return job

    def update_job_status(self, job_id: str, status: JobStatus | str) -> Job:
        next_status = JobStatus(status)
        job = self.load_job(job_id)
        job.status = next_status
        job.updated_at = utc_now_iso()
        self.save_job(job)
        return job

    # --- Path helpers ---

    def resolve_video_name(self, job_id: str) -> str:
        try:
            job = self.load_job(job_id)
            return job.video_name or job_id
        except Exception:
            return job_id

    def job_dir_path(self, job_id: str, *, create: bool = True) -> Path:
        return ensure_job_dir(job_id) if create else job_dir(job_id)

    def video_dir_path(self, job_id: str, video_name: str | None = None) -> Path:
        vname = video_name or self.resolve_video_name(job_id)
        return get_video_dir(job_id, vname)

    def transcriptions_dir_path(
        self,
        job_id: str,
        video_name: str | None = None,
        *,
        create: bool = True,
    ) -> Path:
        vname = video_name or self.resolve_video_name(job_id)
        return get_transcriptions_dir(job_id, vname, create=create)

    def shorts_dir_path(
        self,
        job_id: str,
        video_name: str | None = None,
        *,
        create: bool = True,
    ) -> Path:
        vname = video_name or self.resolve_video_name(job_id)
        return get_shorts_dir(job_id, vname, create=create)

    def source_info_path(self, job_id: str) -> Path:
        return _source_video_info_path(job_id)

    def semantic_blocks_path(self, job_id: str) -> Path:
        return _semantic_blocks_path(job_id)

    def topic_segments_path(self, job_id: str) -> Path:
        return _topic_segments_path(job_id)

    def cuts_path(self, job_id: str) -> Path:
        return _cuts_path(job_id)

    def audio_16k_path(self, job_id: str) -> Path:
        return self.transcriptions_dir_path(job_id, create=True) / "audio_16k.wav"

    def resolve_transcription_artifact_path(
        self,
        job_id: str,
        filename: str,
        *,
        for_write: bool = False,
    ) -> Path:
        """Resolve transcription artifact in {video_dir}/transcrições/ with read fallback to data/jobs/<id>/."""
        primary_dir = self.transcriptions_dir_path(job_id, create=for_write)
        primary = primary_dir / filename
        if for_write or primary.exists():
            return primary
        fallback = job_dir(job_id) / filename
        if fallback.exists():
            return fallback
        return primary

    def transcription_segments_path(self, job_id: str, *, for_write: bool = False) -> Path:
        return self.resolve_transcription_artifact_path(
            job_id, "transcription.segments.json", for_write=for_write
        )

    def transcription_words_path(self, job_id: str, *, for_write: bool = False) -> Path:
        return self.resolve_transcription_artifact_path(
            job_id, "transcription.words.json", for_write=for_write
        )

    def transcription_text_path(self, job_id: str, *, for_write: bool = False) -> Path:
        return self.resolve_transcription_artifact_path(
            job_id, "transcription.txt", for_write=for_write
        )

    def transcription_vtt_path(self, job_id: str, *, for_write: bool = False) -> Path:
        return self.resolve_transcription_artifact_path(
            job_id, "transcription.vtt", for_write=for_write
        )

    # --- Artifact Read/Write Helpers ---

    def save_source_info(self, job_id: str, info: dict[str, Any] | Any) -> Path:
        return self.store.write_json(self.source_info_path(job_id), info, job_id=job_id)

    def load_source_info(self, job_id: str) -> dict[str, Any] | None:
        p = self.source_info_path(job_id)
        if not p.exists():
            return None
        return self.store.read_json(p)

    def save_semantic_blocks(self, job_id: str, blocks: list[SemanticBlock] | list[dict[str, Any]]) -> Path:
        return self.store.write_json(self.semantic_blocks_path(job_id), blocks, job_id=job_id)

    def load_semantic_blocks(self, job_id: str) -> list[SemanticBlock]:
        p = self.semantic_blocks_path(job_id)
        if not p.exists():
            return []
        raw = self.store.read_json(p)
        return [SemanticBlock.model_validate(item) for item in (raw or [])]

    def save_topic_segments(self, job_id: str, topics: list[TopicSegment] | list[dict[str, Any]]) -> Path:
        return self.store.write_json(self.topic_segments_path(job_id), topics, job_id=job_id)

    def load_topic_segments(self, job_id: str) -> list[TopicSegment]:
        p = self.topic_segments_path(job_id)
        if not p.exists():
            return []
        raw = self.store.read_json(p)
        return [TopicSegment.model_validate(item) for item in (raw or [])]

    def save_cuts(self, job_id: str, cuts: list[Cut] | list[dict[str, Any]]) -> Path:
        return self.store.write_json(self.cuts_path(job_id), cuts, job_id=job_id)

    def load_cuts(self, job_id: str) -> list[Cut]:
        p = self.cuts_path(job_id)
        if not p.exists():
            return []
        raw = self.store.read_json(p)
        return [Cut.model_validate(item) for item in (raw or [])]

    def save_transcription_segments(
        self, job_id: str, segments: list[Segment] | list[dict[str, Any]]
    ) -> Path:
        target = self.transcription_segments_path(job_id, for_write=True)
        return self.store.write_json(target, segments, job_id=job_id)

    def load_transcription_segments(self, job_id: str) -> list[Segment]:
        p = self.transcription_segments_path(job_id, for_write=False)
        if not p.exists():
            return []
        raw = self.store.read_json(p)
        return [Segment.model_validate(item) for item in (raw or [])]

    def save_transcription_words(
        self, job_id: str, words: list[WordTiming] | list[dict[str, Any]]
    ) -> Path:
        target = self.transcription_words_path(job_id, for_write=True)
        return self.store.write_json(target, words, job_id=job_id)

    def load_transcription_words(self, job_id: str) -> list[WordTiming]:
        p = self.transcription_words_path(job_id, for_write=False)
        if not p.exists():
            return []
        raw = self.store.read_json(p)
        return [WordTiming.model_validate(item) for item in (raw or [])]

    def save_transcription_text(self, job_id: str, text: str) -> Path:
        target = self.transcription_text_path(job_id, for_write=True)
        return self.store.write_text(target, text, job_id=job_id)

    def load_transcription_text(self, job_id: str) -> str | None:
        p = self.transcription_text_path(job_id, for_write=False)
        if not p.exists():
            return None
        return self.store.read_text(p)

    def save_transcription_vtt(self, job_id: str, vtt: str) -> Path:
        target = self.transcription_vtt_path(job_id, for_write=True)
        return self.store.write_text(target, vtt, job_id=job_id)

    def load_transcription_vtt(self, job_id: str) -> str | None:
        p = self.transcription_vtt_path(job_id, for_write=False)
        if not p.exists():
            return None
        return self.store.read_text(p)

    def get_available_transcription_formats(
        self, job_id: str
    ) -> AvailableTranscriptionFormats:
        return AvailableTranscriptionFormats(
            segments=self.transcription_segments_path(job_id, for_write=False).exists(),
            text=self.transcription_text_path(job_id, for_write=False).exists(),
            vtt=self.transcription_vtt_path(job_id, for_write=False).exists(),
        )

    def has_transcription(self, job_id: str) -> bool:
        try:
            return self.transcription_segments_path(job_id, for_write=False).exists()
        except Exception:
            return False

    def has_analysis(self, job_id: str) -> bool:
        try:
            return self.cuts_path(job_id).exists()
        except Exception:
            return False

    # --- Downstream Invalidation ---

    def invalidate_downstream_from_transcription(
        self,
        job_id: str,
        *,
        remove_analysis_artifacts: bool = True,
        reset_status: bool = True,
    ) -> Job:
        """Invalidate blocks/topics/cuts and reset job.status to DOWNLOADED."""
        if remove_analysis_artifacts:
            for path in (
                self.semantic_blocks_path(job_id),
                self.topic_segments_path(job_id),
                self.cuts_path(job_id),
            ):
                if path.exists():
                    path.unlink(missing_ok=True)
        if reset_status:
            return self.update_job_status(job_id, JobStatus.DOWNLOADED)
        return self.load_job(job_id)

    def delete_transcription_artifacts(
        self,
        job_id: str,
        fmt: str | None = None,
    ) -> tuple[bool, AvailableTranscriptionFormats]:
        """Delete all or a specific transcription format (`segments|text|vtt` or `json|txt|vtt`).

        Returns `(any_deleted, available_formats)`.
        When `fmt` is None or `segments`/`json`, resets `job.status = "DOWNLOADED"`.
        """
        # Ensure job exists
        self.load_job(job_id)

        def _unlink_both(filename: str) -> bool:
            removed = False
            primary = self.transcriptions_dir_path(job_id, create=False) / filename
            fallback = job_dir(job_id) / filename
            for candidate in (primary, fallback):
                if candidate.exists():
                    candidate.unlink(missing_ok=True)
                    removed = True
            return removed

        if fmt is None:
            r1 = _unlink_both("transcription.segments.json")
            r2 = _unlink_both("transcription.words.json")
            r3 = _unlink_both("transcription.txt")
            r4 = _unlink_both("transcription.vtt")
            any_deleted = r1 or r2 or r3 or r4
            if any_deleted:
                self.invalidate_downstream_from_transcription(
                    job_id, remove_analysis_artifacts=False, reset_status=True
                )
            return any_deleted, self.get_available_transcription_formats(job_id)

        normalized = fmt.strip().lower()
        if normalized in ("segments", "json"):
            r1 = _unlink_both("transcription.segments.json")
            r2 = _unlink_both("transcription.words.json")
            any_deleted = r1 or r2
            if any_deleted:
                self.invalidate_downstream_from_transcription(
                    job_id, remove_analysis_artifacts=False, reset_status=True
                )
            return any_deleted, self.get_available_transcription_formats(job_id)
        if normalized in ("text", "txt"):
            any_deleted = _unlink_both("transcription.txt")
            return any_deleted, self.get_available_transcription_formats(job_id)
        if normalized == "vtt":
            any_deleted = _unlink_both("transcription.vtt")
            return any_deleted, self.get_available_transcription_formats(job_id)

        raise ValueError("Invalid format")

    # --- Source Video & Rename ---

    def find_source_video(self, job_id: str) -> Path | None:
        now = time.monotonic()
        cached = self._source_video_cache.get(job_id)
        if cached is not None and cached[1] > now:
            if cached[0].exists():
                return cached[0]
            self._source_video_cache.pop(job_id, None)

        video_name = job_id
        try:
            job = self.load_job(job_id)
            video_name = job.video_name or job_id
            if job.source_video_path:
                svp = Path(job.source_video_path)
                if svp.exists():
                    self.set_cached_source_video(job_id, svp)
                    return svp
        except Exception:
            pass

        vdir = get_video_dir(job_id, video_name)
        if vdir.exists():
            for entry in sorted(vdir.iterdir(), key=lambda p: p.name):
                if entry.is_file() and entry.name.startswith("video."):
                    self.set_cached_source_video(job_id, entry)
                    return entry
            for entry in sorted(vdir.iterdir(), key=lambda p: p.name):
                if entry.is_file() and entry.suffix.lower() in {".mp4", ".webm", ".mkv", ".mov", ".avi", ".m4v", ".flv"}:
                    self.set_cached_source_video(job_id, entry)
                    return entry

        base_dir = Path(load_settings().media.base_dir)
        if base_dir.exists():
            for entry in sorted(base_dir.iterdir(), key=lambda p: p.name):
                if entry.is_file() and entry.name.startswith(f"{job_id}."):
                    self.set_cached_source_video(job_id, entry)
                    return entry

        legacy_dir = job_dir(job_id)
        if legacy_dir.exists():
            for entry in sorted(legacy_dir.iterdir(), key=lambda p: p.name):
                if entry.is_file() and entry.stem == "source" and entry.suffix != ".json":
                    self.set_cached_source_video(job_id, entry)
                    return entry

        return None

    def rename_video(self, job_id: str, new_video_name: str) -> Job:
        cleaned = (new_video_name or "").strip()
        if not cleaned:
            raise ValueError("New name is required")

        job = self.load_job(job_id)
        old_video_name = job.video_name or job_id

        if old_video_name != cleaned:
            old_dir = get_video_dir(job_id, old_video_name)
            new_dir = get_video_dir(job_id, cleaned)
            if old_dir.exists() and old_dir != new_dir:
                new_dir.parent.mkdir(parents=True, exist_ok=True)
                shutil.move(str(old_dir), str(new_dir))

            old_video_path = Path(job.source_video_path) if job.source_video_path else None
            ext = old_video_path.suffix if old_video_path and old_video_path.suffix else ".mp4"
            candidate_new = get_video_file_path(job_id, cleaned, ext)
            if candidate_new.exists() or job.source_video_path:
                job.source_video_path = str(candidate_new)

        job.video_name = cleaned
        job.updated_at = utc_now_iso()
        self.save_job(job)

        if job.source_video_path:
            self.set_cached_source_video(job_id, job.source_video_path)
        else:
            self.invalidate_source_video_cache(job_id)
        return job

    def delete_render_outputs(self, job_id: str) -> None:
        sdir = self.shorts_dir_path(job_id, create=False)
        if sdir.exists():
            shutil.rmtree(sdir, ignore_errors=True)

    # --- Archived Attempts ---

    def attempts_dir_path(self, job_id: str, *, create: bool = False) -> Path:
        _validate_safe_segment(job_id, "job_id")
        d = job_dir(job_id) / "attempts"
        if create:
            d.mkdir(parents=True, exist_ok=True)
        return d

    def attempt_dir_path(
        self,
        job_id: str,
        attempt_id: str,
        *,
        create: bool = False,
    ) -> Path:
        safe_attempt = _validate_safe_segment(attempt_id, "attempt_id")
        base = self.attempts_dir_path(job_id, create=create)
        target = base / safe_attempt
        try:
            target.resolve().relative_to(base.resolve())
        except ValueError as exc:
            raise ValueError("Invalid attempt_id") from exc
        if create:
            target.mkdir(parents=True, exist_ok=True)
        return target

    def attempt_shorts_dir_path(
        self,
        job_id: str,
        attempt_id: str,
        *,
        create: bool = False,
    ) -> Path:
        d = self.attempt_dir_path(job_id, attempt_id, create=create) / "shorts"
        if create:
            d.mkdir(parents=True, exist_ok=True)
        return d

    def attempt_transcription_dir_path(
        self,
        job_id: str,
        attempt_id: str,
        *,
        create: bool = False,
    ) -> Path:
        d = self.attempt_dir_path(job_id, attempt_id, create=create) / "transcription"
        if create:
            d.mkdir(parents=True, exist_ok=True)
        return d

    def count_attempts(self, job_id: str) -> int:
        try:
            adir = self.attempts_dir_path(job_id, create=False)
        except ValueError:
            return 0
        if not adir.exists():
            return 0
        count = 0
        for entry in adir.iterdir():
            if entry.is_dir() and not entry.name.startswith(".") and (entry / "attempt.json").exists():
                count += 1
        return count

    def list_attempts(self, job_id: str) -> list[AttemptSummary]:
        self.load_job(job_id)
        adir = self.attempts_dir_path(job_id, create=False)
        if not adir.exists():
            return []

        attempts: list[AttemptSummary] = []
        for entry in adir.iterdir():
            if not entry.is_dir() or entry.name.startswith("."):
                continue
            meta_path = entry / "attempt.json"
            if not meta_path.exists():
                continue
            try:
                raw = self.store.read_json(meta_path)
                attempts.append(AttemptSummary.model_validate(raw))
            except Exception:
                continue

        attempts.sort(
            key=lambda a: (a.archived_at or "", a.created_at or "", a.attempt_id),
            reverse=True,
        )
        return attempts

    def archive_attempt(
        self,
        job_id: str,
        *,
        label: str | None = None,
        reset_active: bool = True,
    ) -> tuple[AttemptSummary, Job, list[AttemptSummary]]:
        job = self.load_job(job_id)
        current_status = JobStatus(job.status)
        if current_status in ACTIVE_PROCESSING_STATUSES:
            raise JobActivelyProcessingError(job_id, current_status.value)

        # Inspect active transcription artifacts
        transcription_files: dict[str, Path] = {
            "transcription.segments.json": self.transcription_segments_path(job_id, for_write=False),
            "transcription.words.json": self.transcription_words_path(job_id, for_write=False),
            "transcription.txt": self.transcription_text_path(job_id, for_write=False),
            "transcription.vtt": self.transcription_vtt_path(job_id, for_write=False),
        }
        existing_transcription = {
            name: path for name, path in transcription_files.items() if path.exists() and path.is_file()
        }
        has_transcription = bool(existing_transcription)

        # Inspect active cuts & analysis artifacts
        cuts = self.load_cuts(job_id)
        cuts_count = len(cuts)
        approved_count = sum(1 for c in cuts if c.approved or c.status == "approved")

        # Inspect active rendered .mp4 shorts
        shorts_dir = self.shorts_dir_path(job_id, create=False)
        mp4_files = (
            sorted(
                [f for f in shorts_dir.iterdir() if f.is_file() and f.name.lower().endswith(".mp4")],
                key=lambda p: p.name,
            )
            if shorts_dir.exists()
            else []
        )

        if not has_transcription and cuts_count == 0 and len(mp4_files) == 0:
            raise EmptyAttemptError(
                "Cannot archive empty run: no transcription, cuts, or renders found"
            )

        now_dt = datetime.now(timezone.utc)
        archived_at = now_dt.isoformat().replace("+00:00", "Z")
        attempt_id = f"{now_dt.strftime('%Y%m%d-%H%M%S')}-{uuid.uuid4().hex[:6]}"
        existing_attempts = self.list_attempts(job_id)
        resolved_label = (label or "").strip() or f"Tentativa {len(existing_attempts) + 1}"

        att_dir = self.attempt_dir_path(job_id, attempt_id, create=True)

        # Copy analysis JSON artifacts
        for artifact_path in (
            self.semantic_blocks_path(job_id),
            self.topic_segments_path(job_id),
            self.cuts_path(job_id),
        ):
            if artifact_path.exists() and artifact_path.is_file():
                shutil.copy2(str(artifact_path), str(att_dir / artifact_path.name))

        # Copy transcription artifacts (never touch audio_16k.wav)
        if existing_transcription:
            att_trans_dir = self.attempt_transcription_dir_path(job_id, attempt_id, create=True)
            for fname, src_path in existing_transcription.items():
                shutil.copy2(str(src_path), str(att_trans_dir / fname))

        # Copy or move rendered .mp4 shorts
        rendered_files: list[str] = []
        if mp4_files:
            att_shorts_dir = self.attempt_shorts_dir_path(job_id, attempt_id, create=True)
            for mp4_path in mp4_files:
                dest_path = att_shorts_dir / mp4_path.name
                if reset_active:
                    shutil.move(str(mp4_path), str(dest_path))
                else:
                    shutil.copy2(str(mp4_path), str(dest_path))
                rendered_files.append(mp4_path.name)

        rendered_urls = [
            f"/media/shorts/{job_id}/attempts/{attempt_id}/{fname}"
            for fname in rendered_files
        ]

        summary = AttemptSummary(
            attempt_id=attempt_id,
            job_id=job_id,
            label=resolved_label,
            created_at=job.created_at,
            archived_at=archived_at,
            status=current_status.value,
            video_duration_seconds=job.video_duration_seconds,
            cuts_count=cuts_count,
            approved_count=approved_count,
            rendered_count=len(rendered_files),
            rendered_files=rendered_files,
            rendered_urls=rendered_urls,
            has_transcription=has_transcription,
        )
        self.store.write_json(att_dir / "attempt.json", summary, job_id=job_id)

        if reset_active:
            self.invalidate_downstream_from_transcription(
                job_id,
                remove_analysis_artifacts=True,
                reset_status=False,
            )
            self.delete_transcription_artifacts(job_id, fmt=None)
            job = self.load_job(job_id)
            if job.model_extra and "rendered_files" in job.model_extra:
                job.model_extra["rendered_files"] = []
            job.status = JobStatus.DOWNLOADED
            job.updated_at = utc_now_iso()
            self.save_job(job)

        return summary, job, self.list_attempts(job_id)

    def get_attempt_detail(self, job_id: str, attempt_id: str) -> dict[str, Any]:
        self.load_job(job_id)
        att_dir = self.attempt_dir_path(job_id, attempt_id, create=False)
        meta_path = att_dir / "attempt.json"
        if not meta_path.exists():
            raise AttemptNotFoundError(job_id, attempt_id)

        attempt = AttemptSummary.model_validate(self.store.read_json(meta_path))

        cuts_file = att_dir / "cuts.suggested.json"
        cuts: list[dict[str, Any]] = []
        if cuts_file.exists():
            raw_cuts = self.store.read_json(cuts_file) or []
            cuts = [Cut.model_validate(item).model_dump() for item in raw_cuts]

        t_dir = att_dir / "transcription"
        seg_path = t_dir / "transcription.segments.json"
        words_path = t_dir / "transcription.words.json"
        txt_path = t_dir / "transcription.txt"
        vtt_path = t_dir / "transcription.vtt"

        has_seg = seg_path.exists()
        has_words = words_path.exists()
        has_txt = txt_path.exists()
        has_vtt = vtt_path.exists()

        transcription: dict[str, Any] | None = None
        if has_seg or has_words or has_txt or has_vtt:
            segments = (
                [Segment.model_validate(item).model_dump() for item in (self.store.read_json(seg_path) or [])]
                if has_seg
                else []
            )
            words = (
                [WordTiming.model_validate(item).model_dump() for item in (self.store.read_json(words_path) or [])]
                if has_words
                else []
            )
            text = (
                self.store.read_text(txt_path)
                if has_txt
                else "\n".join(s["text"].strip() for s in segments if str(s.get("text", "")).strip())
            )
            vtt = self.store.read_text(vtt_path) if has_vtt else None
            transcription = {
                "text": text,
                "segments": segments,
                "words": words,
                "vtt": vtt,
                "available_formats": {
                    "segments": has_seg,
                    "text": has_txt,
                    "vtt": has_vtt,
                },
            }

        att_shorts_dir = att_dir / "shorts"
        mp4_names = (
            sorted(
                f.name
                for f in att_shorts_dir.iterdir()
                if f.is_file() and f.name.lower().endswith(".mp4")
            )
            if att_shorts_dir.exists()
            else []
        )
        renders = [f"/media/shorts/{job_id}/attempts/{attempt_id}/{name}" for name in mp4_names]

        return {
            "attempt": attempt.model_dump(),
            "cuts": cuts,
            "transcription": transcription,
            "renders": renders,
        }

    def delete_attempt(self, job_id: str, attempt_id: str) -> list[AttemptSummary]:
        self.load_job(job_id)
        att_dir = self.attempt_dir_path(job_id, attempt_id, create=False)
        meta_path = att_dir / "attempt.json"
        if not att_dir.exists() or not meta_path.exists():
            raise AttemptNotFoundError(job_id, attempt_id)

        tombstone = att_dir.parent / f".deleting_{attempt_id}_{uuid.uuid4().hex}"
        os.replace(att_dir, tombstone)
        shutil.rmtree(tombstone, ignore_errors=True)
        self.invalidate_caches(job_id)
        return self.list_attempts(job_id)
