"""Phase 7: history, calibration, auto-approve and scoring examples (all opt-in, default off). 100% mocked."""

from __future__ import annotations

import json
import random
from pathlib import Path
from typing import Any

import pytest

from app.application.runtime_service import ServiceContainer
from app.core import paths
from app.core.tool_configs import normalize_llm_config
from app.domain.analysis.v2 import constants as C
from app.domain.analysis.v2 import history as H
from app.domain.analysis.v2.examples import select_examples
from app.domain.analysis.v2.pipeline import analyze_job_v2, resolve_auto_approve, resolve_scoring_examples
from app.domain.analysis.v2.prompts import SCORING_EXAMPLE_VERDICT_KEPT, SCORING_EXAMPLES_HEADER
from test_analysis_v2_pipeline import (  # noqa: E402
    FULL,
    TURKISH,
    FakeLLM,
    _log_text,
    _scored,
    configure,
    good_answers,
    make_words,
    seed_job,
    system_text,
    user_text,
)

# --- helpers --------------------------------------------------------------------------------


def _entry(job: str, status: str, interest: int | None, *, text: bool = True, created: str = "2026-01-01", cut: str = "c1",
           attempt: str | None = None) -> dict[str, Any]:
    e: dict[str, Any] = {
        "job_id": job, "attempt_id": attempt, "cut_id": cut, "start": 0.0, "end": 10.0, "status": status,
        "pipeline": "v2", "job_created_at": created,
    }
    if interest is not None:
        e["interest"] = interest
    if text:
        e["text"] = [f"line of {job} {cut} {status}"]
    return e


def _hist(entries: list[dict[str, Any]]) -> dict[str, Any]:
    return {"version": 1, "entries": entries, "jobs": len({e["job_id"] for e in entries}), "generated_from": {}}


def _cuts_file(container: ServiceContainer, jid: str) -> Path:
    return container.jobs.job_dir_path(jid) / "cuts.suggested.json"


def _cuts_bytes(container: ServiceContainer, jid: str) -> bytes:
    return _cuts_file(container, jid).read_bytes()


def _scored_bytes(container: ServiceContainer, jid: str) -> bytes:
    return (container.jobs.job_dir_path(jid) / "candidates.scored.json").read_bytes()


def _decide(container: ServiceContainer, jid: str, statuses: list[str]) -> None:
    raw = json.loads(_cuts_file(container, jid).read_text(encoding="utf-8"))
    for cut, st in zip(raw, statuses):
        cut["status"] = st
        cut["approved"] = st == "approved"
        cut["rejected"] = st == "rejected"
    _cuts_file(container, jid).write_text(json.dumps(raw), encoding="utf-8")


async def _analyse(container: ServiceContainer, *, v2: dict[str, Any] | None = None, llm: dict[str, Any] | None = None,
                   scoring=None, jid: str | None = None) -> tuple[str, FakeLLM]:
    jid = jid or seed_job(container, make_words(TURKISH, punctuate=True))
    fake = FakeLLM(container, **({"scoring": scoring} if scoring else {}))
    configure(container, analysis_pipeline="v2", analysis_v2={**FULL, **(v2 or {})}, **(llm or {}))
    await analyze_job_v2(jid, container=container)
    return jid, fake


def _scoring_bodies(fake: FakeLLM) -> list[dict[str, Any]]:
    return fake.calls("premise")


# --- collect_history ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_collect_history_over_jobs_attempts_pending_and_missing_scored(container: ServiceContainer) -> None:
    jid, _ = await _analyse(container)
    cuts = container.jobs.load_cuts(jid)
    assert len(cuts) >= 3
    _decide(container, jid, ["approved", "rejected"] + ["pending"] * (len(cuts) - 2))

    # A v1 job: no pipeline field, no scored file.
    v1 = container.jobs.create_job("https://example.com/v1", video_name="V1")
    container.jobs.save_cuts(v1.job_id, [
        {"cut_id": "c1", "start": 1.0, "end": 20.0, "status": "approved", "approved": True},
        {"cut_id": "c2", "start": 30.0, "end": 50.0, "status": "pending"},
    ])
    # A v2 cut whose scored file is missing.
    noscore = container.jobs.create_job("https://example.com/ns", video_name="NS")
    container.jobs.save_cuts(noscore.job_id, [
        {"cut_id": "c1", "start": 1.0, "end": 20.0, "status": "rejected", "rejected": True, "pipeline": "v2",
         "sentence_ids": ["s1", "s2"]},
    ])
    # An archived attempt of the first job.
    adir = container.jobs.attempt_dir_path(jid, "att1", create=True)
    (adir / "attempt.json").write_text(json.dumps({
        "attempt_id": "att1", "job_id": jid, "label": "a", "created_at": "2026-01-01T00:00:00", "archived_at": "2026-01-02T00:00:00",
        "status": "WAITING_APPROVAL"}), encoding="utf-8")
    (adir / "cuts.suggested.json").write_text(json.dumps([
        {"cut_id": "c1", "start": 5.0, "end": 9.0, "status": "approved", "pipeline": "v2"},
        {"cut_id": "c2", "start": 6.0, "end": 9.0, "status": "pending"},
    ]), encoding="utf-8")

    h = H.collect_history(container)
    by = {(e["job_id"], e["attempt_id"], e["cut_id"]): e for e in h["entries"]}
    assert len(h["entries"]) == 5 and h["jobs"] == 3 and h["version"] == 1
    approved = by[(jid, None, "c1")]
    assert approved["status"] == "approved" and approved["pipeline"] == "v2"
    assert isinstance(approved["interest"], int) and "answers" in approved and "score" in approved
    assert approved["text"] and all(isinstance(x, str) and x for x in approved["text"])
    assert by[(jid, None, "c2")]["status"] == "rejected"
    assert (jid, None, "c3") not in by  # pending ignored
    assert by[(v1.job_id, None, "c1")]["pipeline"] == "v1" and "interest" not in by[(v1.job_id, None, "c1")]
    assert (v1.job_id, None, "c2") not in by
    assert "interest" not in by[(noscore.job_id, None, "c1")]  # missing scored file: still recorded, without S4 data
    attempt_entry = by[(jid, "att1", "c1")]
    assert attempt_entry["status"] == "approved" and "text" not in attempt_entry
    counts = h["generated_from"]
    assert counts["attempts_scanned"] == 1 and counts["cuts_judged"] == 5 and counts["with_s4_details"] == 2
    assert counts["cuts_pending_ignored"] == len(cuts) - 2 + 1 + 1

    excl = H.collect_history(container, exclude_job_ids=[jid])
    assert {e["job_id"] for e in excl["entries"]} == {v1.job_id, noscore.job_id}


@pytest.mark.asyncio
async def test_collect_history_ignores_a_scored_file_of_another_run_and_auto_approved_cuts(container: ServiceContainer) -> None:
    jid, _ = await _analyse(container)
    raw = json.loads(_cuts_file(container, jid).read_text(encoding="utf-8"))
    raw[0].update(status="approved", approved=True, sentence_ids=["s998", "s999"])  # does not match the candidate
    raw[1].update(status="approved", approved=True, auto_approved=True)  # machine decision
    raw[2].update(status="rejected", rejected=True, auto_approved=True)  # owner override: kept
    _cuts_file(container, jid).write_text(json.dumps(raw), encoding="utf-8")
    h = H.collect_history(container)
    by = {e["cut_id"]: e for e in h["entries"]}
    assert "interest" not in by[raw[0]["cut_id"]]
    assert raw[1]["cut_id"] not in by and by[raw[2]["cut_id"]]["status"] == "rejected"
    assert h["generated_from"]["auto_approved_skipped"] == 1


def test_save_and_load_history_roundtrip_and_bad_files(container: ServiceContainer) -> None:
    assert H.load_history(container) is None
    h = _hist([_entry("j1", "approved", 4)])
    path = H.save_history(container, h)
    assert path == paths.data_dir() / "analysis_history.json"
    assert H.load_history(container) == h
    path.write_text("{not json", encoding="utf-8")
    assert H.load_history(container) is None
    path.write_text('{"entries": 3}', encoding="utf-8")
    assert H.load_history(container) is None


# --- approval table and suggestion ---------------------------------------------------------------


def _spread(approved: dict[int, int], rejected: dict[int, int], jobs: int) -> dict[str, Any]:
    entries: list[dict[str, Any]] = []
    n = 0
    for status, table in (("approved", approved), ("rejected", rejected)):
        for lvl, count in table.items():
            for _ in range(count):
                entries.append(_entry(f"job{n % jobs}", status, lvl, cut=f"c{n}"))
                n += 1
    return _hist(entries)


def test_approval_rate_by_interest_counts_only_entries_with_interest() -> None:
    h = _hist([
        _entry("a", "approved", 5), _entry("a", "approved", 5, cut="c2"), _entry("a", "rejected", 5, cut="c3"),
        _entry("b", "rejected", 2), _entry("b", "approved", None, cut="c9"),
    ])
    t = H.approval_rate_by_interest(h)
    assert t[5] == {"approved": 2, "rejected": 1, "rate": round(2 / 3, C.HISTORY_RATE_DECIMALS)}
    assert t[2] == {"approved": 0, "rejected": 1, "rate": 0.0}
    assert t[1]["rate"] is None and t[4]["rate"] is None
    assert H.approval_rate_by_interest({"entries": []})[3] == {"approved": 0, "rejected": 0, "rate": None}


def test_suggest_with_too_little_data_says_so_and_suggests_nothing() -> None:
    h = _spread({5: 30}, {1: 1}, jobs=3)
    s = H.suggest_min_interest(h, min_samples=5, target_rate=0.5)
    assert s["suggested"] is None and s["enough_data"] is False
    assert "not enough data" in s["reason"] and str(C.HISTORY_MIN_JUDGED_CUTS) in s["reason"]
    # Enough cuts but not enough videos.
    few_jobs = _spread({5: 150}, {}, jobs=C.HISTORY_MIN_JOBS - 1)
    assert H.suggest_min_interest(few_jobs, min_samples=5, target_rate=0.5)["enough_data"] is False
    assert H.suggest_min_interest(_hist([]))["suggested"] is None


def test_suggest_with_exactly_enough_data() -> None:
    # 100 judged cuts from exactly 10 videos: 5 -> 40/50 approved, 4 -> 5/20, 3 -> 0/10, 2 -> 0/20.
    h = _spread({5: 40, 4: 5}, {5: 10, 4: 15, 3: 10, 2: 20}, jobs=C.HISTORY_MIN_JOBS)
    s = H.suggest_min_interest(h, min_samples=20, target_rate=0.8)
    assert s["judged"] == C.HISTORY_MIN_JUDGED_CUTS and s["jobs"] == C.HISTORY_MIN_JOBS and s["enough_data"]
    assert s["suggested"] == 5 and "interest >= 5" in s["reason"]
    assert s["table"][4]["pooled_approved"] == 45 and s["table"][4]["pooled_rejected"] == 25
    # One decision fewer: no longer enough.
    h["entries"].pop()
    assert H.suggest_min_interest(h, min_samples=20, target_rate=0.8)["suggested"] is None


def test_suggest_with_plenty_of_data_picks_the_lowest_level_reaching_the_target_and_never_applies_it(
    container: ServiceContainer,
) -> None:
    h = _spread({5: 60, 4: 50, 3: 10}, {5: 5, 4: 5, 3: 30, 2: 40}, jobs=20)
    s = H.suggest_min_interest(h, min_samples=20, target_rate=0.8)
    # pooled >=4: 110/120 = 92% reaches 80%; pooled >=3: 120/160 = 75% does not.
    assert s["suggested"] == 4
    high_bar = H.suggest_min_interest(h, min_samples=1000, target_rate=0.8)
    assert high_bar["suggested"] is None and "no interest level reaches" in high_bar["reason"]
    # Never applies anything: no config key is written by the calculation.
    assert "analysis_min_interest" not in container.load_active_tool_configs().get("llm", {})


def test_cli_rebuild_writes_the_file_atomically_in_the_isolated_data_dir(
    container: ServiceContainer, capsys: pytest.CaptureFixture[str], monkeypatch: pytest.MonkeyPatch
) -> None:
    job = container.jobs.create_job("https://example.com/cli", video_name="CLI")
    container.jobs.save_cuts(job.job_id, [{"cut_id": "c1", "start": 1.0, "end": 9.0, "status": "approved"}])
    from app.infrastructure.storage import atomic_store

    replaced: list[tuple[str, str]] = []
    real_replace = atomic_store.os.replace

    def spy(src: Any, dst: Any) -> None:
        replaced.append((str(src), str(dst)))
        real_replace(src, dst)

    monkeypatch.setattr(atomic_store.os, "replace", spy)
    assert H.main(["--rebuild"]) == 0
    target = paths.data_dir() / "analysis_history.json"
    assert target.exists() and (str(target) in {d for _s, d in replaced})
    assert all(s.endswith(".tmp") for s, d in replaced if d == str(target))
    assert not list(paths.data_dir().glob("*.tmp"))
    saved = json.loads(target.read_text(encoding="utf-8"))
    assert [e["cut_id"] for e in saved["entries"]] == ["c1"] and saved["jobs"] == 1
    out = capsys.readouterr().out
    assert "not enough data" in out and "interest  approved" in out
    # Without --rebuild it only reads.
    assert H.main([]) == 0
    target.unlink()
    assert H.main([]) == 1


# --- config preservation ---------------------------------------------------------------------------


def test_normalize_llm_config_preserves_auto_approve_keys_and_does_not_invent_them() -> None:
    plain = normalize_llm_config({})
    assert "auto_approve" not in plain and "auto_approve_min_interest" not in plain
    kept = normalize_llm_config({"auto_approve": True, "auto_approve_min_interest": 4})
    assert kept["auto_approve"] is True and kept["auto_approve_min_interest"] == 4
    junk = normalize_llm_config({"auto_approve": "yes", "auto_approve_min_interest": True})
    assert "auto_approve" not in junk and "auto_approve_min_interest" not in junk


def test_resolvers_unit() -> None:
    warnings: list[str] = []
    assert resolve_auto_approve({}) is None and resolve_auto_approve({"auto_approve": False}) is None
    assert resolve_auto_approve({"auto_approve": True}) == C.AUTO_APPROVE_DEFAULT_MIN_INTEREST == 5
    assert resolve_auto_approve({"auto_approve": True, "auto_approve_min_interest": 3}) == 3
    warned: list[str] = []
    for bad in (0, -2, 6, 99):
        cfg = {"auto_approve": True, "auto_approve_min_interest": bad}
        assert resolve_auto_approve(cfg, warned.append) == C.AUTO_APPROVE_DEFAULT_MIN_INTEREST
    assert len(warned) == 4 and "outside 1..5" in warned[0]
    assert resolve_scoring_examples(None) == 0 and resolve_scoring_examples({}) == 0
    assert resolve_scoring_examples({"scoring_examples": 6}, warnings.append) == 6 and not warnings
    for bad in (-1, "3", True, 2.5):
        assert resolve_scoring_examples({"scoring_examples": bad}, warnings.append) == 0
    assert resolve_scoring_examples({"scoring_examples": 99}, warnings.append) == C.SCORING_EXAMPLES_MAX
    assert len(warnings) == 5


# --- auto-approve ----------------------------------------------------------------------------------


def _mixed(ids: list[str]) -> dict[str, Any]:
    return good_answers(interest=5 if int(ids[0][1:]) % 24 < 12 else 4)


@pytest.mark.asyncio
async def test_auto_approve_on_approves_only_selected_cuts_at_or_above_the_threshold(container: ServiceContainer) -> None:
    jid, _ = await _analyse(container, llm={"auto_approve": True}, scoring=_mixed)
    cuts = json.loads(_cuts_file(container, jid).read_text(encoding="utf-8"))
    assert cuts
    for cut in cuts:
        if cut["interest"] >= C.AUTO_APPROVE_DEFAULT_MIN_INTEREST:
            assert cut["status"] == "approved" and cut["approved"] is True and cut["auto_approved"] is True
        else:
            assert cut["status"] == "pending" and cut["approved"] is False and "auto_approved" not in cut
    assert {c["status"] for c in cuts} == {"approved", "pending"}
    scored = _scored(container, jid)
    assert scored["auto_approve"] == {"enabled": True, "min_interest": 5}
    selected = [c for c in scored["candidates"] if c["outcome"] == "selected"]
    assert selected and all(isinstance(c["auto_approved"], bool) for c in selected)
    assert sum(c["auto_approved"] for c in selected) == sum(1 for c in cuts if c["status"] == "approved")
    # The default threshold can be raised or lowered.
    jid3, _ = await _analyse(container, llm={"auto_approve": True, "auto_approve_min_interest": 4}, scoring=_mixed)
    assert {c["status"] for c in json.loads(_cuts_file(container, jid3).read_text(encoding="utf-8"))} == {"approved"}


@pytest.mark.asyncio
async def test_auto_approve_absent_false_and_off_leave_the_cuts_file_identical(container: ServiceContainer) -> None:
    j_absent, f_absent = await _analyse(container, scoring=_mixed)
    j_false, f_false = await _analyse(container, llm={"auto_approve": False}, scoring=_mixed)
    j_zero, f_zero = await _analyse(container, v2={"scoring_examples": 0}, scoring=_mixed)
    assert _cuts_bytes(container, j_absent) == _cuts_bytes(container, j_false) == _cuts_bytes(container, j_zero)
    assert _scored_bytes(container, j_absent) == _scored_bytes(container, j_false) == _scored_bytes(container, j_zero)
    assert f_absent.bodies == f_false.bodies == f_zero.bodies
    for key in ("auto_approve", "scoring_examples"):
        assert key not in _scored(container, j_absent)
    assert all("auto_approved" not in c for c in _scored(container, j_absent)["candidates"])
    cuts = json.loads(_cuts_bytes(container, j_absent))
    assert all(c["status"] == "pending" and "auto_approved" not in c for c in cuts)
    assert "history" not in _log_text(container, j_absent) and "scoring_examples" not in _log_text(container, j_absent)


@pytest.mark.asyncio
async def test_auto_approve_never_applies_to_the_d14_fallback(container: ServiceContainer) -> None:
    # Everything scores interest 3: below the default minimum (4), so the fallback keeps the best of them.
    jid, _ = await _analyse(
        container, llm={"auto_approve": True, "auto_approve_min_interest": 1}, scoring=lambda ids: good_answers(interest=3)
    )
    cuts = json.loads(_cuts_file(container, jid).read_text(encoding="utf-8"))
    assert cuts and all(c["status"] == "pending" and c["approved"] is False for c in cuts)
    scored = _scored(container, jid)
    selected = [c for c in scored["candidates"] if c["outcome"] == "selected"]
    assert selected and all(c["fallback"] is True and c["auto_approved"] is False for c in selected)


# --- scoring examples --------------------------------------------------------------------------------


def _history_for(entries: list[dict[str, Any]]) -> dict[str, Any]:
    return _hist(entries)


def test_select_examples_balanced_deterministic_recency_and_never_the_current_job() -> None:
    entries = [
        *(_entry(f"k{i}", "approved", 5, created=f"2026-01-{i + 1:02d}") for i in range(5)),
        *(_entry(f"r{i}", "rejected", 2, created=f"2026-02-{i + 1:02d}") for i in range(5)),
        _entry("current", "approved", 5, created="2026-12-31"),
        _entry("current", "rejected", 2, created="2026-12-31", cut="c2"),
        _entry("att", "approved", 5, text=False, created="2026-12-30"),  # no text: unusable
    ]
    picked = select_examples(_history_for(entries), 4, current_job_id="current")
    assert [e["verdict"] for e in picked] == ["kept", "rejected", "kept", "rejected"]
    assert [e["job_id"] for e in picked] == ["k4", "r4", "k3", "r3"]  # most recent first, per side
    assert all(e["job_id"] != "current" for e in picked)
    assert len(select_examples(_history_for(entries), 5, current_job_id="current")) == 5
    assert [e["verdict"] for e in select_examples(_history_for(entries), 5, current_job_id="current")].count("kept") == 3
    shuffled = entries[:]
    random.Random(3).shuffle(shuffled)
    assert select_examples(_history_for(shuffled), 4, current_job_id="current") == picked
    # A short side hands its places to the other one; nothing usable gives [].
    only_kept = [e for e in entries if e["status"] == "approved"]
    assert len(select_examples(_history_for(only_kept), 4, current_job_id="current")) == 4
    assert select_examples(_history_for(entries), 0, current_job_id="x") == []
    assert select_examples(None, 3, current_job_id="x") == [] and select_examples(_hist([]), 3, current_job_id="x") == []
    assert select_examples(_history_for([e for e in entries if e["job_id"] == "current"]), 3, current_job_id="current") == []


def test_select_examples_short_rejected_side_keeps_its_example_and_kept_fills_the_rest() -> None:
    entries = [
        *(_entry(f"k{i}", "approved", 5, created=f"2026-01-{i + 1:02d}") for i in range(5)),
        _entry("r0", "rejected", 2, created="2026-02-01"),
    ]
    picked = select_examples(_history_for(entries), 4, current_job_id="current")
    assert [e["verdict"] for e in picked].count("kept") == 3
    assert [e["verdict"] for e in picked].count("rejected") == 1
    assert len(picked) == 4
    mirror = [
        _entry("k0", "approved", 5),
        *(_entry(f"r{i}", "rejected", 2, created=f"2026-02-{i + 1:02d}") for i in range(5)),
    ]
    picked = select_examples(_history_for(mirror), 4, current_job_id="current")
    assert [e["verdict"] for e in picked].count("kept") == 1 and len(picked) == 4


def test_select_examples_trims_text_to_whole_lines() -> None:
    long = _entry("a", "approved", 5)
    long["text"] = ["x" * 400, "y" * 400, "z" * 10]
    (ex,) = select_examples(_hist([long]), 1, current_job_id="b")
    assert ex["text"] == ["x" * 400]
    huge = _entry("a", "approved", 5)
    huge["text"] = ["w" * 5000]
    assert select_examples(_hist([huge]), 1, current_job_id="b")[0]["text"] == ["w" * 5000]  # first line always kept


@pytest.mark.asyncio
async def test_scoring_examples_reach_every_scoring_call_with_an_identical_system_prompt(container: ServiceContainer) -> None:
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    entries = [
        _entry("other1", "approved", 5, created="2026-01-01"),
        _entry("other2", "rejected", 2, created="2026-01-02"),
        _entry("other3", "approved", 4, created="2026-01-03"),
        _entry("other4", "rejected", 1, created="2026-01-04"),
        {**_entry(jid, "approved", 5, created="2026-12-31"), "text": ["THE-CURRENT-JOB-MUST-NOT-LEAK"]},
    ]
    H.save_history(container, _hist(entries))
    _, fake = await _analyse(container, v2={"scoring_examples": 4}, jid=jid)
    bodies = _scoring_bodies(fake)
    assert len(bodies) > 3
    systems = {system_text(b) for b in bodies}
    assert len(systems) == 1  # byte-identical across the candidates of the video
    (system,) = systems
    assert SCORING_EXAMPLES_HEADER in system and system.count("<<<EXAMPLE ") == 4
    assert "THE-CURRENT-JOB-MUST-NOT-LEAK" not in system and all("THE-CURRENT-JOB" not in user_text(b) for b in bodies)
    assert system.count("KEPT BY THE OWNER") == 2 and system.count("REJECTED BY THE OWNER") == 2
    scored = _scored(container, jid)
    used = scored["scoring_examples"]
    assert used["requested"] == 4 and len(used["used_ids"]) == 4
    assert all(i.split(":")[0] != jid for i in used["used_ids"]) and "optional_prompt_hashes" in used
    assert "text" not in json.dumps(used)  # ids only
    assert _log_text(container, jid).count("no usable history") == 0
    # The kept example label is the prompt module's constant.
    assert SCORING_EXAMPLE_VERDICT_KEPT == "kept"


@pytest.mark.asyncio
async def test_scoring_examples_without_a_history_file_warn_once_and_run_as_with_zero(container: ServiceContainer) -> None:
    j0, f0 = await _analyse(container)
    j1, f1 = await _analyse(container, v2={"scoring_examples": 6})
    assert _log_text(container, j1).count("no usable history") == 1
    assert f0.bodies == f1.bodies
    assert _cuts_bytes(container, j0) == _cuts_bytes(container, j1)
    assert "scoring_examples" not in _scored(container, j1)
    # Same when the file exists but holds only the analysed job or entries without text.
    jid = seed_job(container, make_words(TURKISH, punctuate=True))
    H.save_history(container, _hist([_entry(jid, "approved", 5), _entry("o", "approved", 5, text=False)]))
    _, f2 = await _analyse(container, v2={"scoring_examples": 6}, jid=jid)
    assert _log_text(container, jid).count("no usable history") == 1
    assert all(SCORING_EXAMPLES_HEADER not in system_text(b) for b in _scoring_bodies(f2))


@pytest.mark.asyncio
async def test_toggles_absent_request_bodies_and_artifacts_identical_even_with_a_history_file(container: ServiceContainer) -> None:
    H.save_history(container, _hist([_entry("o1", "approved", 5), _entry("o2", "rejected", 2)]))
    j_a, f_a = await _analyse(container)
    j_b, f_b = await _analyse(container, v2={"scoring_examples": 0}, llm={"auto_approve": False})
    assert f_a.bodies == f_b.bodies
    assert all(SCORING_EXAMPLES_HEADER not in system_text(b) for b in f_a.bodies if "premise" in (b.get("format") or {}).get("properties", {}))
    assert _cuts_bytes(container, j_a) == _cuts_bytes(container, j_b)
    assert _scored_bytes(container, j_a) == _scored_bytes(container, j_b)
