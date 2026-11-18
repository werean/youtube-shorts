"""End-to-end wiring of the eval harness (backend/evals) with a fake LLM. No hardware, no network."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

import pytest

from app.application import runtime_service
from app.core import paths, settings, tool_configs
from evals import corpus, import_job, judge, judge_prompt, report, run

REAL_DATA_DIR = (Path(paths.__file__).resolve().parents[3] / "data").resolve()
BASE_SEED = 100
SEEDS = 2
_BLOCK_RE = re.compile(r"^(b\d+) \[(\d+\.\d+)-(\d+\.\d+)\]", re.MULTILINE)


# ---------------------------------------------------------------------------
# synthetic corpus
# ---------------------------------------------------------------------------


def _make_transcription(words_per_segment: list[list[str]], seg_len: float = 6.0):
    segments, words = [], []
    t = 0.0
    for i, ws in enumerate(words_per_segment):
        step = seg_len / len(ws)
        for j, w in enumerate(ws):
            words.append(
                {"word": w, "start": round(t + j * step, 3), "end": round(t + (j + 1) * step - 0.05, 3),
                 "probability": 0.99, "segment_id": f"s{i}"}
            )
        segments.append({"segment_id": f"s{i}", "start": t, "end": t + seg_len, "text": " ".join(ws)})
        t += seg_len
    return segments, words


def _write_video(root: Path, slug: str, sentences: list[list[str]], labels: dict | None = None) -> float:
    segs, words = _make_transcription(sentences)
    d = root / slug
    d.mkdir(parents=True)
    (d / "transcription.segments.json").write_text(json.dumps(segs), encoding="utf-8")
    (d / "transcription.words.json").write_text(json.dumps(words), encoding="utf-8")
    if labels is not None:
        (d / "labels.json").write_text(json.dumps(labels), encoding="utf-8")
    return segs[-1]["end"]


@pytest.fixture
def synth(tmp_path: Path) -> dict[str, Any]:
    root = tmp_path / "corpus"
    en = [[f"alpha{i}", "beta", "gamma", "delta", f"end{i}."] for i in range(12)]
    # Neither Portuguese nor English (Turkish-like words; the harness has no language logic).
    tr = [[f"merhaba{i}", "dunya", "nasilsin", "iyiyim", f"tesekkur{i}."] for i in range(12)]
    d_en = _write_video(root, "talk-en", en, labels={"must": [{"start": 0.0, "end": 14.0}], "never": [{"start": 60.0, "end": 70.0}]})
    d_tr = _write_video(root, "story-tr", tr)
    manifest = tmp_path / "corpus.manifest.json"
    manifest.write_text(
        json.dumps(
            {
                "videos": [
                    {"slug": "talk-en", "format": "zzkindalpha", "language": "en", "duration_seconds": d_en, "split": "dev", "source": "synthetic"},
                    {"slug": "story-tr", "format": "zzkindbeta", "language": "tr", "duration_seconds": d_tr, "split": "dev", "source": "synthetic"},
                ]
            }
        ),
        encoding="utf-8",
    )
    return {"root": root, "manifest": manifest, "runs": tmp_path / "runs"}


# ---------------------------------------------------------------------------
# fake LLM
# ---------------------------------------------------------------------------


class FakeLLM:
    """HTTP-layer fake: returns deterministic valid cuts for the requested schema."""

    def __init__(self, *, vary_with_seed: bool = False) -> None:
        self.vary_with_seed = vary_with_seed
        self.chat_bodies: list[dict[str, Any]] = []
        self.formats_seen: list[str] = []

    async def __call__(self, method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
        if url.endswith("/models"):
            return 200, {"data": [{"id": "fake-model"}]}
        if url.endswith("/api/tags") or url.endswith("/api/ps"):
            return 200, {"models": [{"name": "fake-model"}]}
        if (url.endswith("/chat/completions") or url.endswith("/api/chat")) and body is not None:
            self.chat_bodies.append(body)
            text = "\n".join(str(m.get("content")) for m in body.get("messages", []))
            self.formats_seen.append(text)
            fmt = body.get("response_format") or {}
            name = (fmt.get("json_schema") or {}).get("name") if isinstance(fmt, dict) else None
            if name == "boundary_lookaround" or "preceding_blocks" in text:
                content: dict[str, Any] = {"adjustments": []}
            else:
                blocks = [(m.group(1), float(m.group(2)), float(m.group(3))) for m in _BLOCK_RE.finditer(text)]
                if self.vary_with_seed and blocks:
                    # even seed -> a cut on the first block, odd seed -> no cut: the runs disagree
                    blocks = blocks[:1] if int(body.get("seed", 0)) % 2 == 0 else []
                content = {"cuts": self._cuts(blocks)}
            payload = json.dumps(content)
            return 200, {"choices": [{"message": {"content": payload}}], "usage": {"prompt_tokens": 11, "completion_tokens": 7}}
        return 404, {}

    @staticmethod
    def _cuts(blocks: list[tuple[str, float, float]]) -> list[dict[str, Any]]:
        cuts, i = [], 0
        while i < len(blocks):
            j = i
            while j < len(blocks) - 1 and blocks[j][2] - blocks[i][1] < 14.0:
                j += 1
            if blocks[j][2] - blocks[i][1] >= 10.0:
                cuts.append(
                    {
                        "title": f"Cut {blocks[i][0]}",
                        "start_block_id": blocks[i][0],
                        "end_block_id": blocks[j][0],
                        "score": 80.0,
                        "cut_type": "tip",
                        "self_contained_start": True,
                        "complete_resolution": True,
                        "no_topic_drift": True,
                        "novel_punchline": False,
                    }
                )
            i = j + 1
        return cuts


def _snapshot(path: Path) -> dict[str, tuple[int, int]]:
    out: dict[str, tuple[int, int]] = {}
    if not path.exists():
        return out
    for p in sorted(path.rglob("*")):
        if p.is_file():
            st = p.stat()
            out[str(p.relative_to(path))] = (st.st_size, st.st_mtime_ns)
    return out


def _global_state() -> dict[str, Any]:
    return {
        "env": {k: os.environ.get(k) for k in run._ENV_KEYS},
        "data_override": paths._override_data_dir,
        "root_override": paths._override_project_root,
        "base_override": settings._default_base_dir_override,
        "container": runtime_service._override_container,
    }


async def _run_split(synth, llm: FakeLLM, variant: str, **kw):
    run_dir = run.make_run_dir(variant, synth["runs"])
    videos = run.select_videos("dev", None, synth["manifest"])
    failures = await run.run_all(
        videos, variant=variant, pipeline=kw.pop("pipeline", None), seeds=SEEDS, base_seed=BASE_SEED,
        run_dir=run_dir, corpus_root=synth["root"], http_fetcher=llm, **kw,
    )
    assert failures == []
    return run_dir


# ---------------------------------------------------------------------------
# tests
# ---------------------------------------------------------------------------


async def test_run_split_writes_artifacts_and_leaves_real_state_untouched(synth):
    real_before = _snapshot(REAL_DATA_DIR)
    state_before = _global_state()
    cfg_before = tool_configs.load_tool_configs() if hasattr(tool_configs, "load_tool_configs") else None
    test_data_dir = paths.data_dir()

    llm = FakeLLM()
    run_dir = await _run_split(synth, llm, "v1-test", pipeline="v1")

    assert _snapshot(REAL_DATA_DIR) == real_before
    assert _global_state() == state_before
    # the temporary configuration did not leak into the (test) data dir or the cache
    assert paths.data_dir() == test_data_dir
    active = runtime_service.get_container().load_active_tool_configs()
    assert (active.get("llm") or {}).get("analysis_seed") not in (BASE_SEED, BASE_SEED + 1)
    assert "analysis_pipeline" not in (active.get("llm") or {})
    assert not (test_data_dir / "custom_settings.json").exists() or "analysis_seed" not in (test_data_dir / "custom_settings.json").read_text(encoding="utf-8")
    if cfg_before is not None:
        assert tool_configs.load_tool_configs() == cfg_before

    seeds_in_requests = set()
    for body in llm.chat_bodies:
        seeds_in_requests.add(body.get("seed"))
    assert seeds_in_requests == {BASE_SEED, BASE_SEED + 1}  # analysis_seed differs per seed

    for slug in ("talk-en", "story-tr"):
        for seed in (BASE_SEED, BASE_SEED + 1):
            d = run_dir / slug / str(seed)
            cuts = json.loads((d / "cuts.json").read_text(encoding="utf-8"))
            trace = json.loads((d / "trace.json").read_text(encoding="utf-8"))
            assert cuts["slug"] == slug and cuts["seed"] == seed
            assert cuts["variant"] == "v1-test" and cuts["pipeline"] == "v1"
            assert len(cuts["cuts"]) >= 1
            for c in cuts["cuts"]:
                assert {"cut_id", "start", "end", "title", "score"} <= set(c)
            assert trace["seed"] == seed and trace["error"] is None
            assert trace["llm_calls"] >= 1
            assert trace["tokens_in"] >= 11 and trace["tokens_out"] >= 7
            assert trace["seconds_total"] > 0
            assert "analysis" in trace["seconds_per_stage"]
            assert trace["prompt_hashes"]["system"]
            assert trace["model"]
            assert trace["analysis_pipeline_config"] == "v1"


async def test_format_label_not_in_prompts(synth):
    llm = FakeLLM()
    await _run_split(synth, llm, "labelcheck")
    blob = "\n".join(llm.formats_seen)
    # format labels are used only to group report tables, never in a prompt
    assert "zzkind" not in blob.lower()


def test_holdout_without_gate_exits_nonzero_and_creates_nothing(synth, monkeypatch):
    monkeypatch.setattr(corpus, "RUNS_ROOT", synth["runs"])
    monkeypatch.setattr(corpus, "MANIFEST_PATH", synth["manifest"])
    rc = run.main(["--split", "holdout", "--variant", "nogate"])
    assert rc != 0
    assert not synth["runs"].exists()
    assert not (corpus.EVALS_DIR / "runs").exists() or not any(
        p.name.endswith("-nogate") for p in (corpus.EVALS_DIR / "runs").iterdir()
    )


async def test_judge_with_fake_callable_and_hash(synth):
    run_dir = await _run_split(synth, FakeLLM(), "judged")
    calls: list[tuple[str, str, dict, dict]] = []

    async def fake_judge(system_prompt, user_prompt, schema, *, model, temperature, seed):
        calls.append((system_prompt, user_prompt, schema, {"model": model, "temperature": temperature, "seed": seed}))
        ok = "alpha" in user_prompt
        return {"what_it_is_about": "x", "understandable": ok, "complete": True, "single_subject": True, "is_promo": False}

    written = await judge.judge_run(run_dir, judge_model="judge-x", llm=fake_judge, corpus_root=synth["root"])
    assert len(written) == 2 * SEEDS
    assert calls and all(c[0] == judge_prompt.JUDGE_SYSTEM_PROMPT and c[2] == judge_prompt.JUDGE_JSON_SCHEMA for c in calls)
    assert all(c[3]["temperature"] == 0.0 and c[3]["seed"] == judge.JUDGE_SEED and c[3]["model"] == "judge-x" for c in calls)
    en = json.loads((run_dir / "talk-en" / str(BASE_SEED) / "judge.json").read_text(encoding="utf-8"))
    tr = json.loads((run_dir / "story-tr" / str(BASE_SEED) / "judge.json").read_text(encoding="utf-8"))
    assert en["judge_prompt_hash"] == judge_prompt.judge_prompt_hash() == tr["judge_prompt_hash"]
    assert en["judge_prompt_version"] == judge_prompt.JUDGE_PROMPT_VERSION
    assert en["judge_pass_rate"] == 1.0 and tr["judge_pass_rate"] == 0.0
    assert all(i["judge_pass"] is True and i["answer"]["understandable"] for i in en["cuts"])
    assert all(i["judge_pass"] is False for i in tr["cuts"])


async def test_report_stability_and_decision(synth):
    base = await _run_split(synth, FakeLLM(), "base-stable")
    cand_same = await _run_split(synth, FakeLLM(), "cand-same")
    cand_diff = await _run_split(synth, FakeLLM(vary_with_seed=True), "cand-diff")
    kw = {"corpus_root": synth["root"], "manifest_path": synth["manifest"]}

    # identical runs: stability 1.0 everywhere, one row per format plus the aggregate
    rep = report.build_report(cand_same, base_dir=base, **kw)
    assert (cand_same / "report.json").exists() and (cand_same / "report.md").exists()
    assert set(rep["by_format"]) == {"zzkindalpha", "zzkindbeta", "__all__"}
    assert all(rep["by_format"][g]["stability"] == pytest.approx(1.0) for g in rep["by_format"])
    assert len(rep["videos"]) == 2
    assert rep["decision"] is not None and "passed" in rep["decision"] and "reasons" in rep["decision"]
    md = (cand_same / "report.md").read_text(encoding="utf-8")
    assert "Formato: zzkindalpha" in md and "Formato: zzkindbeta" in md and "Agregado" in md and "Regra de decisao" in md
    on_disk = json.loads((cand_same / "report.json").read_text(encoding="utf-8"))
    assert on_disk["decision"]["passed"] == rep["decision"]["passed"]

    # labels were applied for the video that has them
    talk_video = next(v for v in rep["videos"] if v["slug"] == "talk-en")
    assert talk_video["must_recall"] is not None

    # different cuts per seed: stability below 1, and the rule rejects it versus the stable base
    rep2 = report.build_report(cand_diff, base_dir=base, **kw)
    assert rep2["by_format"]["__all__"]["stability"] < 1.0
    assert rep2["decision"]["passed"] is False
    assert rep2["decision"]["worst_format"] in {"zzkindalpha", "zzkindbeta"}
    assert "PIOR FORMATO" in (cand_diff / "report.md").read_text(encoding="utf-8")

    # no base: still writes and has no verdict
    rep3 = report.build_report(base, **kw)
    assert rep3["decision"] is None and (base / "report.md").exists()


def test_import_job_copies_artifacts_and_upserts_manifest(synth, container):
    job = container.jobs.create_job("https://example.test/v", job_id="job-synth", video_duration_seconds=72.0)
    segs, words = _make_transcription([["one", "two", "three.", "four", "five."]] * 3)
    container.jobs.save_transcription_segments(job.job_id, segs)
    container.jobs.save_transcription_words(job.job_id, words)
    container.jobs.save_source_info(job.job_id, {"title": "T", "chapters": []})
    real_before = _snapshot(REAL_DATA_DIR)

    res = import_job.import_job(
        job.job_id, slug="imported-one", format_label="interview", split="holdout", language="xx",
        corpus_root=synth["root"], manifest_path=synth["manifest"],
    )
    d = synth["root"] / "imported-one"
    assert sorted(p.name for p in d.iterdir()) == [
        "source.info.json", "transcription.segments.json", "transcription.words.json",
    ]
    assert json.loads((d / "transcription.words.json").read_text(encoding="utf-8")) == words
    entries = {e.slug: e for e in corpus.load_manifest(synth["manifest"])}
    assert entries["imported-one"].format == "interview" and entries["imported-one"].split == "holdout"
    assert entries["imported-one"].duration_seconds == 72.0 and entries["imported-one"].language == "xx"
    assert {"talk-en", "story-tr"} <= set(entries)  # upsert keeps the others
    assert res["entry"]["slug"] == "imported-one"
    assert _snapshot(REAL_DATA_DIR) == real_before
    # source job untouched
    assert container.jobs.load_transcription_words(job.job_id)


# ---------------------------------------------------------------------------
# review fixes
# ---------------------------------------------------------------------------


def _copy_run(src: Path, dst_name: str, runs: Path) -> Path:
    import shutil

    dst = runs / dst_name
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns("report.*", "judge.json"))
    return dst


async def test_report_counts_crashed_seeds_and_rejects(synth):
    base = await _run_split(synth, FakeLLM(), "base-ok")
    cand = _copy_run(base, "20990101-000000-cand-crash", synth["runs"])
    # talk-en: one of two seeds crashed (trace only); story-tr: every seed crashed
    (cand / "talk-en" / str(BASE_SEED) / "cuts.json").unlink()
    for s in range(BASE_SEED, BASE_SEED + SEEDS):
        (cand / "story-tr" / str(s) / "cuts.json").unlink()
    kw = {"corpus_root": synth["root"], "manifest_path": synth["manifest"]}
    rep = report.build_report(cand, base_dir=base, **kw)
    rows = {v["slug"]: v for v in rep["videos"]}
    assert set(rows) == {"talk-en", "story-tr"}  # a fully crashed video is still reported
    assert rows["talk-en"]["failed_runs"] == 1 and rows["story-tr"]["failed_runs"] == SEEDS
    assert rows["talk-en"]["stability"] is None  # one surviving run: undefined, not 1.0
    assert rep["decision"]["passed"] is False
    assert any("falharam" in p for p in rep["integrity_problems"])
    assert "Problemas de integridade" in (cand / "report.md").read_text(encoding="utf-8")


async def test_report_identical_candidate_without_gain_is_rejected_and_worst_format_shown(synth):
    base = await _run_split(synth, FakeLLM(), "base-same")
    cand = await _run_split(synth, FakeLLM(), "cand-same2")
    kw = {"corpus_root": synth["root"], "manifest_path": synth["manifest"]}
    rep = report.build_report(cand, base_dir=base, **kw)
    assert rep["decision"]["passed"] is False
    assert any(r.startswith("[2]") for r in rep["decision"]["reasons"])
    md = (cand / "report.md").read_text(encoding="utf-8")
    assert "## Pior formato" in md and "**zzkind" in md  # worst-format line always present


async def test_report_flags_judge_mismatch(synth):
    import evals.judge as j

    base = await _run_split(synth, FakeLLM(), "base-j")
    cand = await _run_split(synth, FakeLLM(), "cand-j")

    async def ok(system_prompt, user_prompt, schema, *, model, temperature, seed):
        return {"what_it_is_about": "x", "understandable": True, "complete": True, "single_subject": True, "is_promo": False}

    await j.judge_run(base, judge_model="judge-a", llm=ok, corpus_root=synth["root"])
    await j.judge_run(cand, judge_model="judge-b", llm=ok, corpus_root=synth["root"])
    kw = {"corpus_root": synth["root"], "manifest_path": synth["manifest"]}
    rep = report.build_report(cand, base_dir=base, **kw)
    assert any("judge_model difere" in p for p in rep["integrity_problems"])
    assert rep["decision"]["passed"] is False


async def test_judge_errors_are_not_failed_cuts(synth):
    run_dir = await _run_split(synth, FakeLLM(), "judge-err")

    async def boom(*a, **k):
        raise ConnectionError("server down")

    await judge.judge_run(run_dir, judge_model="judge-x", llm=boom, corpus_root=synth["root"])
    data = json.loads((run_dir / "talk-en" / str(BASE_SEED) / "judge.json").read_text(encoding="utf-8"))
    assert data["judge_errors"] == len(data["cuts"]) > 0
    assert data["judge_pass_rate"] is None
    assert all(i["judge_pass"] is None and i["error"] for i in data["cuts"])
    kw = {"corpus_root": synth["root"], "manifest_path": synth["manifest"]}
    rep = report.build_report(run_dir, **kw)
    assert all(v["judge_pass_rate"] is None and v["judge_errors"] > 0 for v in rep["videos"])
    assert any("juiz falharam" in p for p in rep["integrity_problems"])


def test_make_run_dir_never_collides_and_resolve_is_exact(synth, monkeypatch):
    a = run.make_run_dir("v1-baseline", synth["runs"])
    b = run.make_run_dir("v1-baseline", synth["runs"])
    assert a != b and a.exists() and b.exists()
    monkeypatch.setattr(report, "RUNS_ROOT", synth["runs"])
    (synth["runs"] / "20250101-000000-v1-baseline").mkdir()
    assert report._resolve_run("v1-baseline") == b  # newest of the matching runs
    with pytest.raises(FileNotFoundError):
        report._resolve_run("baseline")  # no suffix match


def test_isolation_guard_fires_before_first_write_and_restores_globals(monkeypatch):
    import tempfile

    before = _global_state()
    monkeypatch.setattr(run, "_real_data_dir", lambda: Path(tempfile.gettempdir()).resolve())
    with pytest.raises(run.IsolationError):
        with run.isolated_workspace():
            pytest.fail("must not get here")
    assert _global_state() == before


async def test_unpunctuated_transcription_runs(synth):
    # no punctuation at all: the harness has no text logic, so it must not matter
    _write_video(synth["root"], "plain-xx", [[f"word{i}", "foo", "bar", "baz", f"qux{i}"] for i in range(12)])
    data = json.loads(synth["manifest"].read_text(encoding="utf-8"))
    data["videos"].append({"slug": "plain-xx", "format": "zzkindgamma", "language": "xx", "duration_seconds": 72.0, "split": "dev", "source": "synthetic"})
    synth["manifest"].write_text(json.dumps(data), encoding="utf-8")
    llm = FakeLLM()
    run_dir = run.make_run_dir("plain", synth["runs"])
    failures = await run.run_all(
        run.select_videos("dev", ["plain-xx"], synth["manifest"]), variant="plain", pipeline=None, seeds=1,
        base_seed=BASE_SEED, run_dir=run_dir, corpus_root=synth["root"], http_fetcher=llm,
    )
    assert failures == [] and (run_dir / "plain-xx" / str(BASE_SEED) / "cuts.json").exists()


async def test_trace_and_report_rows_carry_has_heatmap(synth):
    # talk-en has a source.info.json with a heatmap, story-tr has none.
    info = synth["root"] / "talk-en" / "source.info.json"
    info.write_text(
        json.dumps({"id": "x", "title": "t", "heatmap": [{"start_time": 0, "end_time": 10, "value": 0.5}]}),
        encoding="utf-8",
    )
    run_dir = await _run_split(synth, FakeLLM(), "v1-heat", pipeline="v1")
    for seed in (BASE_SEED, BASE_SEED + 1):
        assert json.loads((run_dir / "talk-en" / str(seed) / "trace.json").read_text(encoding="utf-8"))["has_heatmap"] is True
        assert json.loads((run_dir / "story-tr" / str(seed) / "trace.json").read_text(encoding="utf-8"))["has_heatmap"] is False
    rep = report.build_report(run_dir, corpus_root=synth["root"], manifest_path=synth["manifest"])
    rows = {v["slug"]: v for v in rep["videos"]}
    assert rows["talk-en"]["has_heatmap"] is True and rows["story-tr"]["has_heatmap"] is False


# --- phase 7: --history guard for the examples preset ---------------------------------------------------


def _history_file(tmp_path: Path, job_ids: list[str]) -> Path:
    path = tmp_path / "hist.json"
    path.write_text(
        json.dumps({"version": 1, "entries": [{"job_id": j, "status": "approved", "text": ["x"]} for j in job_ids]}),
        encoding="utf-8",
    )
    return path


def test_examples_preset_without_history_fails_fast_with_a_clear_message(synth, monkeypatch, capsys):
    monkeypatch.setattr(corpus, "RUNS_ROOT", synth["runs"])
    monkeypatch.setattr(corpus, "MANIFEST_PATH", synth["manifest"])
    rc = run.main(["--split", "dev", "--variant", "ex", "--preset", "v2-examples", "--model", "m"])
    assert rc == 2
    err = capsys.readouterr().err
    assert "--history" in err and "never read" in err
    assert not synth["runs"].exists()


def test_history_with_a_corpus_video_is_refused(synth, monkeypatch, tmp_path, capsys):
    monkeypatch.setattr(corpus, "RUNS_ROOT", synth["runs"])
    monkeypatch.setattr(corpus, "MANIFEST_PATH", synth["manifest"])
    bad = _history_file(tmp_path, ["abc123", "eval-talk-en-100"])
    rc = run.main(["--split", "dev", "--variant", "ex", "--preset", "v2-examples", "--history", str(bad), "--model", "m"])
    assert rc == 2 and "contaminated" in capsys.readouterr().err
    assert not synth["runs"].exists()
    assert run.history_corpus_conflicts(json.loads(bad.read_text()), ["talk-en", "story-tr"]) == ["eval-talk-en-100"]


async def test_run_one_copies_the_history_into_the_isolated_data_dir_only(synth, tmp_path):
    hist = _history_file(tmp_path, ["real-job-1", "real-job-2"])
    real_target = REAL_DATA_DIR / "analysis_history.json"
    before = real_target.read_bytes() if real_target.exists() else None
    seen: dict[str, Any] = {}

    async def analyze(job_id, *, llm_adapter, container):
        target = container.jobs.analysis_history_path()
        seen["path"] = target
        seen["data"] = container.jobs.load_analysis_history()
        return {"cuts": []}

    run_dir = run.make_run_dir("ex-one", synth["runs"])
    entry = run.select_videos("dev", ["talk-en"], synth["manifest"])[0]
    trace = await run.run_one(
        entry, BASE_SEED, variant="ex-one", pipeline="v2", run_dir=run_dir, corpus_root=synth["root"],
        llm_overrides=run.variants.resolve_preset("v2-examples"), preset="v2-examples", history_path=hist,
        analyze=analyze, http_fetcher=FakeLLM(), prebuild_segmentation=False,
    )
    assert [e["job_id"] for e in seen["data"]["entries"]] == ["real-job-1", "real-job-2"]
    assert REAL_DATA_DIR not in seen["path"].resolve().parents and trace["history_entries"] == 2
    assert (real_target.read_bytes() if real_target.exists() else None) == before


async def test_run_one_without_history_for_an_examples_preset_raises_isolation_error(synth):
    run_dir = run.make_run_dir("ex-two", synth["runs"])
    entry = run.select_videos("dev", ["talk-en"], synth["manifest"])[0]
    with pytest.raises(run.IsolationError):
        await run.run_one(
            entry, BASE_SEED, variant="ex-two", pipeline="v2", run_dir=run_dir, corpus_root=synth["root"],
            llm_overrides=run.variants.resolve_preset("v2-examples"), http_fetcher=FakeLLM(),
        )
