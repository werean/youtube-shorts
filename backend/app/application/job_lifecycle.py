"""Job status state machine, atomic job/artifact store, and downstream cache invalidation."""

from __future__ import annotations

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
