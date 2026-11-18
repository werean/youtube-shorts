"""Generation runner of the evaluation harness.

    python -m evals.run --split dev --variant v1-baseline --seeds 3
    python -m evals.run --split dev --variant v2 --pipeline v2 --seeds 3

For every (video, seed) it builds an ISOLATED temporary workspace, seeds a job
there with the corpus transcription artifacts, runs the app's analysis entry
point (``analyze_job``) and writes ``cuts.json`` + ``trace.json`` under
``backend/evals/runs/<YYYYMMDD-HHMMSS>-<variant>/<slug>/<seed>/``.

Nothing here touches the repository's real ``data/`` directory nor the user's
media folder, and nothing under ``backend/app`` is modified.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import copy
import hashlib
import json
import os
import re
import shutil
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Awaitable, Callable, Iterator

from app.domain.analysis.v2.audience import has_heatmap
from app.infrastructure.storage.atomic_store import atomic_write_json

from evals import corpus, variants

HttpFetcher = Callable[[str, str, "dict[str, Any] | None"], Awaitable["tuple[int, Any]"]]
AnalyzeFn = Callable[..., Awaitable[dict[str, Any]]]

DEFAULT_BASE_SEED = 42
_CHARS_PER_TOKEN = 3.0  # same rough ratio the adapter uses for its own estimates
_ENV_KEYS = ("YTS_DATA_DIR", "YTS_MEDIA_BASE_DIR", "YTS_PROJECT_ROOT")
_REAL_TRANSPORT_TIMEOUT_SECONDS = 600.0


class IsolationError(RuntimeError):
    """Raised when the isolated workspace would touch real project data."""


# ---------------------------------------------------------------------------
# Isolation
# ---------------------------------------------------------------------------


def _real_data_dir() -> Path:
    """The repository's real data/ directory, computed WITHOUT consulting any override."""
    from app.core import paths

    return (Path(paths.__file__).resolve().parents[3] / "data").resolve()


def _is_inside(child: Path, parent: Path) -> bool:
    try:
        child.resolve().relative_to(parent.resolve())
        return True
    except ValueError:
        return False


@dataclass
class IsolatedWorkspace:
    root: Path
    data: Path
    media: Path
    project: Path


def _assert_isolated(ws: IsolatedWorkspace) -> None:
    """Refuse to run if anything resolves outside the temp workspace or into the real data/."""
    from app.core import paths, settings

    real = _real_data_dir()
    jobs = paths.jobs_dir()
    for label, p in (
        ("jobs dir", jobs),
        ("data dir", paths.data_dir()),
        ("media base dir", Path(settings.load_settings().media.base_dir)),
    ):
        if _is_inside(p, real) or p.resolve() == real:
            raise IsolationError(f"{label} {p} resolves inside the repository data/ directory {real}")
        if not _is_inside(p, ws.root):
            raise IsolationError(f"{label} {p} is outside the temporary workspace {ws.root}")


@contextlib.contextmanager
def isolated_workspace(*, keep: bool = False) -> Iterator[IsolatedWorkspace]:
    """Redirect every piece of global app state into a fresh temp dir, restoring it on exit.

    Redirected (and restored in ``finally``):
      * env vars YTS_DATA_DIR, YTS_MEDIA_BASE_DIR, YTS_PROJECT_ROOT
      * app.core.paths._override_data_dir / _override_project_root
      * app.core.settings._default_base_dir_override
      * app.application.runtime_service._override_container
      * settings and tool-config caches (invalidated on enter and on exit)

    These globals have no public "get" accessor, so the previous values are read from the
    module attributes. This is the only place where harness code reaches into app internals.
    """
    from app.application import runtime_service
    from app.core import paths, settings, tool_configs

    root = Path(tempfile.mkdtemp(prefix="evalrun-")).resolve()
    ws = IsolatedWorkspace(root=root, data=root / "data", media=root / "media", project=root / "project")
    for d in (ws.data, ws.media, ws.project):
        d.mkdir(parents=True, exist_ok=True)

    saved_env = {k: os.environ.get(k) for k in _ENV_KEYS}
    saved_data = getattr(paths, "_override_data_dir", None)
    saved_root = getattr(paths, "_override_project_root", None)
    saved_base = getattr(settings, "_default_base_dir_override", None)
    saved_container = getattr(runtime_service, "_override_container", None)
    try:
        os.environ["YTS_DATA_DIR"] = str(ws.data)
        os.environ["YTS_MEDIA_BASE_DIR"] = str(ws.media)
        os.environ["YTS_PROJECT_ROOT"] = str(ws.project)
        paths.set_data_dir_override(ws.data)
        paths.set_project_root_override(ws.project)
        settings.set_default_base_dir_override(ws.media)
        settings.invalidate_settings_cache()
        tool_configs.invalidate_tool_configs_cache()
        _assert_isolated(ws)  # before any write
        # Pin media.base_dir explicitly in the (temporary) settings.json.
        settings.update_settings({"media": {"base_dir": str(ws.media)}})
        _assert_isolated(ws)
        yield ws
    finally:
        for k, v in saved_env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        paths.set_data_dir_override(saved_data)
        paths.set_project_root_override(saved_root)
        settings.set_default_base_dir_override(saved_base)
        runtime_service.set_container_override(saved_container)
        settings.invalidate_settings_cache()
        tool_configs.invalidate_tool_configs_cache()
        if not keep:
            shutil.rmtree(root, ignore_errors=True)


# ---------------------------------------------------------------------------
# Observation of the LLM traffic (from the outside, via the HTTP layer)
# ---------------------------------------------------------------------------


def history_corpus_conflicts(history: Any, slugs: list[str]) -> list[str]:
    """Job ids of the history entries that belong to a corpus video (phase-7.md: the corpus must not be in it).

    An entry belongs to a corpus video when its job id is the slug, or contains it (harness jobs are named
    ``eval-<slug>-<seed>``). Conservative on purpose: a false positive only asks the owner to rebuild the file.
    """
    entries = history.get("entries") if isinstance(history, dict) else None
    found: set[str] = set()
    for entry in entries if isinstance(entries, list) else []:
        jid = str(entry.get("job_id") or "") if isinstance(entry, dict) else ""
        if jid and any(slug and slug.lower() in jid.lower() for slug in slugs):
            found.add(jid)
    return sorted(found)


def load_history_file(path: Path, slugs: list[str]) -> dict[str, Any]:
    """Read a history file given with --history and refuse it when it holds a corpus video's job."""
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        raise ValueError(f"{path} is not a history file (no 'entries' list)")
    conflicts = history_corpus_conflicts(data, slugs)
    if conflicts:
        raise ValueError(
            f"{path} contains cuts of corpus video(s) (jobs {conflicts[:5]}); the measurement would be "
            "contaminated. Rebuild the history without the corpus videos."
        )
    return data


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


def _message_texts(body: dict[str, Any] | None) -> tuple[str, str]:
    """Return (system_text, user_text) of a chat request body (LM Studio and Ollama share 'messages')."""
    system, user = [], []
    for m in (body or {}).get("messages") or []:
        if not isinstance(m, dict):
            continue
        content = m.get("content")
        if isinstance(content, list):
            content = "".join(str(p.get("text", "")) if isinstance(p, dict) else str(p) for p in content)
        (system if m.get("role") == "system" else user).append(str(content or ""))
    return "\n".join(system), "\n".join(user)


def _classify(url: str) -> str:
    u = url.lower().split("?")[0]
    if u.endswith("/chat/completions") or u.endswith("/api/chat") or u.endswith("/api/generate"):
        return "chat"
    if "embed" in u:
        return "embedding"
    return "other"


def _extract_usage(payload: Any) -> tuple[int | None, int | None]:
    if not isinstance(payload, dict):
        return None, None
    usage = payload.get("usage")
    if isinstance(usage, dict) and (usage.get("prompt_tokens") is not None or usage.get("completion_tokens") is not None):
        return usage.get("prompt_tokens"), usage.get("completion_tokens")
    if payload.get("prompt_eval_count") is not None or payload.get("eval_count") is not None:
        return payload.get("prompt_eval_count"), payload.get("eval_count")
    return None, None


def _response_text(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    try:
        choices = payload.get("choices")
        if choices:
            return str((choices[0].get("message") or {}).get("content") or "")
        msg = payload.get("message")
        if isinstance(msg, dict):
            return str(msg.get("content") or "")
        return str(payload.get("response") or "")
    except Exception:  # noqa: BLE001
        return ""


@dataclass
class CallRecorder:
    """Wraps an HTTP fetcher and records what is observable about the LLM traffic."""

    inner: HttpFetcher
    stage: str = "analysis"
    calls: list[dict[str, Any]] = field(default_factory=list)

    async def __call__(self, method: str, url: str, body: dict[str, Any] | None) -> tuple[int, Any]:
        t0 = time.perf_counter()
        status, payload = await self.inner(method, url, body)
        seconds = time.perf_counter() - t0
        kind = _classify(url)
        system, user = _message_texts(body)
        tin, tout = _extract_usage(payload)
        estimated = False
        if kind == "chat":
            if tin is None:
                tin, estimated = int(len(system + user) / _CHARS_PER_TOKEN), True
            if tout is None:
                tout, estimated = int(len(_response_text(payload)) / _CHARS_PER_TOKEN), True
        self.calls.append(
            {
                "stage": self.stage,
                "kind": kind,
                "status": status,
                "seconds": seconds,
                "model": (body or {}).get("model"),
                "system_hash": _sha(system) if kind == "chat" else None,
                "user_hash": _sha(user) if kind == "chat" else None,
                "prompt_chars": len(system) + len(user) if kind == "chat" else None,
                "tokens_in": tin,
                "tokens_out": tout,
                "tokens_estimated": estimated,
            }
        )
        return status, payload

    def summarize(self) -> dict[str, Any]:
        chats = [c for c in self.calls if c["kind"] == "chat"]
        stages: dict[str, dict[str, Any]] = {}
        for c in chats:
            s = stages.setdefault(c["stage"], {"llm_calls": 0, "tokens_in": 0, "tokens_out": 0, "llm_seconds": 0.0})
            s["llm_calls"] += 1
            s["tokens_in"] += int(c["tokens_in"] or 0)
            s["tokens_out"] += int(c["tokens_out"] or 0)
            s["llm_seconds"] += c["seconds"]
        return {
            "llm_calls": len(chats),
            "embedding_calls": sum(1 for c in self.calls if c["kind"] == "embedding"),
            "other_http_calls": sum(1 for c in self.calls if c["kind"] == "other"),
            "tokens_in": sum(int(c["tokens_in"] or 0) for c in chats),
            "tokens_out": sum(int(c["tokens_out"] or 0) for c in chats),
            "tokens_estimated": any(c["tokens_estimated"] for c in chats),
            "models": sorted({str(c["model"]) for c in chats if c["model"]}),
            "prompt_hashes": {
                "system": sorted({c["system_hash"] for c in chats if c["system_hash"]}),
                "user": [c["user_hash"] for c in chats if c["user_hash"]],
            },
            "stage_llm": stages,
        }


async def real_http_fetcher(method: str, url: str, body: dict[str, Any] | None) -> tuple[int, Any]:
    """Default transport: plain httpx, the same thing the adapter does when no fetcher is injected."""
    import httpx

    async with httpx.AsyncClient(timeout=_REAL_TRANSPORT_TIMEOUT_SECONDS) as client:
        resp = await client.request(method, url, json=body)
        try:
            return resp.status_code, resp.json()
        except Exception:  # noqa: BLE001
            return resp.status_code, resp.text


async def _fake_ollama_runner(_args: list[str]) -> dict[str, Any]:
    return {"ok": True, "code": 0, "stdout": "", "stderr": ""}


# ---------------------------------------------------------------------------
# One (video, seed)
# ---------------------------------------------------------------------------


def _spoken_end(slug: str, root: Path | None) -> float:
    items = corpus.load_words(slug, root) or corpus.load_segments(slug, root)
    return max((float(i.get("end", 0.0)) for i in items), default=0.0)


def _cut_to_dict(c: Any) -> dict[str, Any]:
    if hasattr(c, "model_dump"):
        return c.model_dump(mode="json")
    return dict(c)


async def run_one(
    entry: corpus.VideoEntry,
    analysis_seed: int,
    *,
    variant: str,
    pipeline: str | None,
    run_dir: Path,
    corpus_root: Path | None = None,
    model: str | None = None,
    llm_overrides: dict[str, Any] | None = None,
    preset: str | None = None,
    history_path: Path | None = None,
    analyze: AnalyzeFn | None = None,
    http_fetcher: HttpFetcher | None = None,
    adapter_factory: Callable[[Any, HttpFetcher], Any] | None = None,
    prebuild_segmentation: bool | None = None,
    keep_tmp: bool = False,
) -> dict[str, Any]:
    """Run the analysis of one video with one seed in an isolated workspace.

    Injection points (all optional; defaults use the real app and the real LLM):
      analyze            async (job_id, *, llm_adapter, container) -> {"cuts": [...]} (default: analyze_job)
      http_fetcher       async (method, url, body) -> (status, payload); when given it also replaces
                         container.llm_http_fetcher, which keeps the LM Studio CLI disabled (no hardware)
      adapter_factory    (container, recorder) -> adapter object passed to ``analyze`` as llm_adapter
      prebuild_segmentation  build blocks/topics before ``analyze`` so their LLM calls are attributed to the
                         "segmentation" stage; default: only when the default ``analyze`` is used
      history_path       history file for analysis_v2.scoring_examples (--history). It is validated and COPIED into
                         the temporary data dir; the real data/analysis_history.json is never read. Required when
                         the overrides turn scoring_examples on.
    Writes <run_dir>/<slug>/<analysis_seed>/{cuts.json,trace.json} and returns the trace.
    """
    from app.application import runtime_service
    from app.core import tool_configs

    injected = http_fetcher is not None
    use_default_analyze = analyze is None
    if prebuild_segmentation is None:
        prebuild_segmentation = use_default_analyze
    history_data: dict[str, Any] | None = None
    if variants.overrides_need_history(llm_overrides):
        if history_path is None:
            raise IsolationError(
                "scoring_examples is on but no --history file was given (the real history is never read)"
            )
        history_data = load_history_file(history_path, [entry.slug, *(e.slug for e in corpus.load_manifest())])
    out_dir = Path(run_dir) / entry.slug / str(analysis_seed)
    out_dir.mkdir(parents=True, exist_ok=True)

    trace: dict[str, Any] = {
        "slug": entry.slug,
        "seed": analysis_seed,
        "variant": variant,
        "pipeline": pipeline,
        "preset": preset,
        "llm_overrides": copy.deepcopy(llm_overrides) if llm_overrides else None,
        "model": model,
        "seconds_per_stage": {},
        "error": None,
        "has_heatmap": False,
    }
    t_total = time.perf_counter()
    recorder: CallRecorder | None = None
    try:
        with isolated_workspace(keep=keep_tmp) as ws:
            container = runtime_service.ServiceContainer()
            recorder = CallRecorder(inner=http_fetcher or real_http_fetcher)
            if injected:
                # Keeps LMStudioCLIManager.cli_enabled() False: no lms binary can be launched.
                container.llm_http_fetcher = recorder
                container.ollama_command_runner = _fake_ollama_runner
                if container.lmstudio.cli_enabled():
                    raise IsolationError("LM Studio CLI would be enabled in injected (no-hardware) mode")
            runtime_service.set_container_override(container)
            if history_data is not None:
                # The pipeline reads data_dir()/analysis_history.json: inside the isolated workspace, never the real one.
                target = container.jobs.analysis_history_path()
                if not _is_inside(target, ws.data):
                    raise IsolationError(f"history target {target} is outside the temporary data dir")
                atomic_write_json(target, history_data)
                trace["history_entries"] = len(history_data["entries"])

            job_id = f"eval-{entry.slug}-{analysis_seed}"
            segments = corpus.load_segments(entry.slug, corpus_root)
            words = corpus.load_words(entry.slug, corpus_root)
            if not segments and not words:
                raise FileNotFoundError(f"corpus/{entry.slug} has no transcription artifacts")
            duration = entry.duration_seconds or _spoken_end(entry.slug, corpus_root)
            container.jobs.create_job(
                f"corpus://{entry.slug}", job_id=job_id, video_duration_seconds=duration or None
            )
            if segments:
                container.jobs.save_transcription_segments(job_id, segments)
            if words:
                container.jobs.save_transcription_words(job_id, words)
            info_path = corpus.corpus_dir(entry.slug, corpus_root) / "source.info.json"
            if info_path.exists():
                info = json.loads(info_path.read_text(encoding="utf-8"))
                container.jobs.save_source_info(job_id, info)
                trace["has_heatmap"] = has_heatmap(info)

            # Configuration lives ONLY in the temporary data dir (custom_settings.json there).
            cfg = copy.deepcopy(container.load_active_tool_configs())
            llm_cfg = dict(cfg.get("llm") or {})
            llm_cfg["analysis_seed"] = int(analysis_seed)
            if pipeline:
                llm_cfg["analysis_pipeline"] = pipeline
            if model:
                llm_cfg["model"] = model
            llm_cfg.update(llm_overrides or {})
            cfg["llm"] = llm_cfg
            tool_configs.import_tool_configs(cfg)
            tool_configs.invalidate_tool_configs_cache()
            trace["model"] = model or llm_cfg.get("model")
            trace["analysis_pipeline_config"] = pipeline
            trace["config_source"] = (
                "app code defaults + overrides (the user's custom_settings.json is NOT applied)"
            )
            trace["system_prompt_sha256"] = hashlib.sha256(
                str(llm_cfg.get("system_prompt") or "").encode("utf-8")
            ).hexdigest()

            if adapter_factory is not None:
                adapter = adapter_factory(container, recorder)
            elif use_default_analyze:
                from app.infrastructure.llm.unified_adapter import UnifiedLocalLLMAdapter

                adapter = UnifiedLocalLLMAdapter(container=container, http_fetcher=recorder)
            else:
                adapter = None

            if prebuild_segmentation:
                from app.domain.segmentation.semantic_blocks import build_semantic_blocks
                from app.domain.segmentation.topic_segmentation import build_topic_segments

                recorder.stage = "segmentation"
                t0 = time.perf_counter()
                build_semantic_blocks(job_id, container=container)
                # The v2 ablation (preset v2-noemb) must not embed here either.
                v2_cfg = llm_cfg.get("analysis_v2")
                no_embeddings = (
                    llm_cfg.get("analysis_pipeline") == "v2"
                    and isinstance(v2_cfg, dict)
                    and v2_cfg.get("topic_embeddings") is False
                )
                await build_topic_segments(
                    job_id, use_embeddings=not no_embeddings, llm_adapter=adapter, container=container
                )
                trace["seconds_per_stage"]["segmentation"] = time.perf_counter() - t0

            if analyze is None:
                from app.domain.analysis.narrative_miner import analyze_job as analyze

            recorder.stage = "analysis"
            t0 = time.perf_counter()
            result = await analyze(job_id, llm_adapter=adapter, container=container)
            trace["seconds_per_stage"]["analysis"] = time.perf_counter() - t0
            cuts = [_cut_to_dict(c) for c in (result or {}).get("cuts", [])]
    except Exception as exc:  # noqa: BLE001
        trace["error"] = f"{type(exc).__name__}: {exc}"
        trace["seconds_total"] = time.perf_counter() - t_total
        if recorder is not None:
            trace.update(recorder.summarize())
        atomic_write_json(out_dir / "trace.json", trace)
        raise

    trace.update(recorder.summarize())
    trace["seconds_total"] = time.perf_counter() - t_total
    trace["seconds_per_video_minute"] = (
        trace["seconds_total"] / (duration / 60.0) if duration else None
    )
    atomic_write_json(
        out_dir / "cuts.json",
        {
            "slug": entry.slug,
            "seed": analysis_seed,
            "variant": variant,
            "pipeline": pipeline,
            "preset": preset,
            "cuts": cuts,
        },
    )
    atomic_write_json(out_dir / "trace.json", trace)
    return trace


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def make_run_dir(variant: str, root: Path | None = None) -> Path:
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", variant).strip("-") or "variant"
    base = Path(root) if root else corpus.RUNS_ROOT
    base.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    d = base / f"{stamp}-{safe}"
    n = 1
    while d.exists():  # same-second collision: unique suffix
        n += 1
        d = base / f"{stamp}-{safe}-{n}"
    d.mkdir(parents=True, exist_ok=False)  # never share/overwrite a run directory
    return d


def select_videos(split: str, only: list[str] | None, manifest_path: Path | None = None) -> list[corpus.VideoEntry]:
    vids = [v for v in corpus.load_manifest(manifest_path) if v.split == split]
    if only:
        wanted = set(only)
        vids = [v for v in vids if v.slug in wanted]
        missing = wanted - {v.slug for v in vids}
        if missing:
            raise ValueError(f"slugs not in split {split!r}: {sorted(missing)}")
    return vids


async def run_all(
    videos: list[corpus.VideoEntry],
    *,
    variant: str,
    pipeline: str | None,
    seeds: int,
    base_seed: int,
    run_dir: Path,
    model: str | None = None,
    corpus_root: Path | None = None,
    keep_tmp: bool = False,
    preset: str | None = None,
    llm_overrides: dict[str, Any] | None = None,
    history_path: Path | None = None,
    **injected: Any,
) -> list[tuple[str, int, str]]:
    """Run every video and seed sequentially. Returns the list of (slug, seed, error) failures."""
    failures: list[tuple[str, int, str]] = []
    for v in videos:
        for i in range(seeds):
            analysis_seed = base_seed + i
            print(f"[run] {v.slug} seed={analysis_seed} ...", flush=True)
            try:
                await run_one(
                    v,
                    analysis_seed,
                    variant=variant,
                    pipeline=pipeline,
                    run_dir=run_dir,
                    corpus_root=corpus_root,
                    model=model,
                    preset=preset,
                    llm_overrides=llm_overrides,
                    history_path=history_path,
                    keep_tmp=keep_tmp,
                    **injected,
                )
            except IsolationError:
                raise  # never continue after an isolation problem
            except Exception as exc:  # noqa: BLE001
                failures.append((v.slug, analysis_seed, f"{type(exc).__name__}: {exc}"))
                print(f"[run] FAILED {v.slug} seed={analysis_seed}: {exc}", file=sys.stderr, flush=True)
    return failures


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="python -m evals.run")
    ap.add_argument("--split", required=True, choices=corpus.VALID_SPLITS)
    ap.add_argument("--variant", required=True)
    ap.add_argument("--pipeline", choices=("v1", "v2"))
    ap.add_argument(
        "--preset",
        help="named llm overrides for the temporary configuration (evals/variants.py): "
        + ", ".join(variants.preset_names()),
    )
    ap.add_argument(
        "--history",
        type=Path,
        help="history file for the presets that use scoring examples (v2-examples); must not contain any corpus "
        "video's job. It is copied into the temporary data dir; the real data/analysis_history.json is never read.",
    )
    ap.add_argument("--seeds", type=int, default=3, help="seeds per video (stability needs >= 2)")
    ap.add_argument("--base-seed", type=int, default=DEFAULT_BASE_SEED)
    ap.add_argument("--only", nargs="+")
    ap.add_argument("--model", help="llm.model written into the temporary configuration only")
    ap.add_argument("--keep-tmp", action="store_true", help="keep the temporary workspaces (debugging)")
    ap.add_argument("--i-am-at-a-phase-gate", action="store_true", dest="phase_gate")
    return ap


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    # Must fail before doing anything else.
    if args.split == "holdout" and not args.phase_gate:
        print("refusing to run the holdout split without --i-am-at-a-phase-gate", file=sys.stderr)
        return 2
    if args.seeds < 1:
        print("--seeds must be >= 1", file=sys.stderr)
        return 2
    llm_overrides: dict[str, Any] | None = None
    if args.preset:
        try:
            llm_overrides = variants.resolve_preset(args.preset)
        except ValueError as exc:
            print(str(exc), file=sys.stderr)
            return 2
    if variants.overrides_need_history(llm_overrides):
        if args.history is None:
            print(
                f"preset {args.preset!r} uses scoring examples and needs --history <file> (a history that does not "
                "contain any corpus video); the real data/analysis_history.json is never read by the harness.",
                file=sys.stderr,
            )
            return 2
        try:
            load_history_file(args.history, [e.slug for e in corpus.load_manifest()])
        except (OSError, ValueError) as exc:
            print(str(exc), file=sys.stderr)
            return 2
    try:
        videos = select_videos(args.split, args.only)
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    if not videos:
        print(f"no videos in split {args.split!r}; import some with evals.import_job", file=sys.stderr)
        return 2
    if not args.model:
        print(
            "warning: --model not given; the generator is the app's code default, which may differ "
            "from the model you actually use (decisions.md D15). Pass --model.",
            file=sys.stderr,
        )
    run_dir = make_run_dir(args.variant)
    atomic_write_json(
        run_dir / "run.json",
        {
            "variant": args.variant,
            "pipeline": args.pipeline,
            "preset": args.preset,
            "llm_overrides": llm_overrides,
            "history": str(args.history) if args.history else None,
            "split": args.split,
            "seeds": args.seeds,
            "base_seed": args.base_seed,
            "model": args.model,
            "config_source": "app code defaults + overrides (user custom_settings.json NOT applied)",
            "slugs": [v.slug for v in videos],
        },
    )
    try:
        failures = asyncio.run(
            run_all(
                videos,
                variant=args.variant,
                pipeline=args.pipeline,
                seeds=args.seeds,
                base_seed=args.base_seed,
                run_dir=run_dir,
                model=args.model,
                preset=args.preset,
                llm_overrides=llm_overrides,
                history_path=args.history,
                keep_tmp=args.keep_tmp,
            )
        )
    except IsolationError as exc:
        print(f"isolation check failed: {exc}", file=sys.stderr)
        return 3
    print(f"run directory: {run_dir}")
    if failures:
        print(f"{len(failures)} run(s) failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
