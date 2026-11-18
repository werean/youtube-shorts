"""Phase 7 - history of the owner's decisions on cuts (approved / rejected), calibration of the minimum interest.

``collect_history`` scans every job and its archived attempts through the jobs store and consolidates each cut with
a final status into ``data/analysis_history.json`` (atomic write). Nothing here changes a configuration: the
suggested minimum interest is only reported (the owner confirms before ``analysis_min_interest`` changes).

What is available per source:
  * the active run of a job: ``cuts.suggested.json`` plus, when the same run's ``candidates.scored.json`` and
    ``sentences.json`` exist and the cut matches a selected candidate, the S4 answers, interest, score and the cut text;
  * an archived attempt: only its ``cuts.suggested.json`` (archive_attempt does not copy the v2 artifacts), so its
    entries carry status and times but no answers or text.

A cut that the pipeline auto-approved (``auto_approved: true`` and still "approved") is NOT a decision of the owner and
is skipped; a rejection of such a cut is kept (the owner overrode the machine).

CLI:  python -m app.domain.analysis.v2.history --rebuild   (prints the table and the suggestion, writes the file)
"""

from __future__ import annotations

import argparse
import json
import sys
from collections.abc import Collection, Mapping
from pathlib import Path
from typing import Any

from app.application.runtime_service import ServiceContainer, get_container
from app.domain.analysis.v2 import constants as C

FINAL_STATUSES = ("approved", "rejected")


def _final_status(cut: Mapping[str, Any]) -> str | None:
    status = cut.get("status")
    if status in FINAL_STATUSES:
        return str(status)
    if status in (None, "pending"):  # legacy files may carry only the booleans
        if cut.get("approved") is True:
            return "approved"
        if cut.get("rejected") is True:
            return "rejected"
    return None


def _read_cuts(container: ServiceContainer, path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    try:
        raw = container.jobs.store.read_json(path)
    except Exception:  # noqa: BLE001 - a corrupt file of one job never stops the scan
        return []
    return [c for c in raw if isinstance(c, dict)] if isinstance(raw, list) else []


def _s4_details(
    cut: Mapping[str, Any], scored: Mapping[str, Any] | None, sentences: Mapping[str, Any] | None
) -> dict[str, Any]:
    """Answers, interest, score and text of the selected candidate this cut came from; {} when not provable."""
    if not scored or cut.get("pipeline") != "v2" or not cut.get("cut_id"):
        return {}
    candidates = scored.get("candidates")
    if not isinstance(candidates, list):
        return {}
    cand = next(
        (
            x
            for x in candidates
            if isinstance(x, dict) and x.get("cut_id") == cut["cut_id"] and x.get("outcome") == "selected"
        ),
        None,
    )
    if cand is None:
        return {}
    ids = cut.get("sentence_ids")
    if isinstance(ids, list) and ids and (
        ids[0] != cand.get("start_sentence_id") or ids[-1] != cand.get("end_sentence_id")
    ):
        return {}  # the scored file belongs to another run than this cut
    details: dict[str, Any] = {}
    if isinstance(cand.get("answers"), dict):
        details["answers"] = cand["answers"]
        if isinstance(cand["answers"].get("interest"), int):
            details["interest"] = cand["answers"]["interest"]
    if isinstance(cand.get("score"), (int, float)):
        details["score"] = cand["score"]
    rows = sentences.get("sentences") if isinstance(sentences, Mapping) else None
    if isinstance(rows, list):
        by_id = {r.get("sentence_id"): i for i, r in enumerate(rows) if isinstance(r, dict)}
        a, b = by_id.get(cand.get("start_sentence_id")), by_id.get(cand.get("end_sentence_id"))
        if a is not None and b is not None and a <= b:
            lines = [str(r.get("text") or "").strip() for r in rows[a : b + 1] if isinstance(r, dict)]
            lines = [x for x in lines if x]
            if lines:
                details["text"] = lines
    return details


def collect_history(container: ServiceContainer, *, exclude_job_ids: Collection[str] = ()) -> dict[str, Any]:
    """Every approved / rejected cut of every job (and archived attempt); pending cuts are ignored."""
    excluded = set(exclude_job_ids)
    entries: list[dict[str, Any]] = []
    counts = {
        "jobs_scanned": 0,
        "attempts_scanned": 0,
        "cuts_judged": 0,
        "cuts_pending_ignored": 0,
        "auto_approved_skipped": 0,
        "with_s4_details": 0,
    }
    jobs_with_entries: set[str] = set()
    for job in container.jobs.list_jobs():
        jid = job.job_id
        if jid in excluded:
            continue
        counts["jobs_scanned"] += 1
        sources: list[tuple[str | None, Path]] = [(None, container.jobs.cuts_path(jid))]
        try:
            for attempt in container.jobs.list_attempts(jid):
                sources.append(
                    (
                        attempt.attempt_id,
                        container.jobs.attempt_dir_path(jid, attempt.attempt_id) / "cuts.suggested.json",
                    )
                )
        except Exception:  # noqa: BLE001
            pass
        scored = sentences = None
        loaded = False
        for attempt_id, path in sources:
            if attempt_id is not None:
                counts["attempts_scanned"] += 1
            for cut in _read_cuts(container, path):
                status = _final_status(cut)
                if status is None:
                    counts["cuts_pending_ignored"] += 1
                    continue
                if status == "approved" and cut.get("auto_approved") is True:
                    counts["auto_approved_skipped"] += 1
                    continue
                entry: dict[str, Any] = {
                    "job_id": jid,
                    "attempt_id": attempt_id,
                    "cut_id": cut.get("cut_id"),
                    "start": cut.get("start"),
                    "end": cut.get("end"),
                    "status": status,
                    "pipeline": cut.get("pipeline") or "v1",
                    "job_created_at": job.created_at,
                }
                if attempt_id is None and cut.get("pipeline") == "v2":
                    if not loaded:
                        scored = container.jobs.load_scored_candidates(jid)
                        sentences = container.jobs.load_sentences(jid)
                        loaded = True
                    details = _s4_details(cut, scored, sentences)
                    if details:
                        entry.update(details)
                        counts["with_s4_details"] += 1
                entries.append(entry)
                counts["cuts_judged"] += 1
                jobs_with_entries.add(jid)
    entries.sort(key=lambda e: (e["job_id"], e["attempt_id"] or "", str(e["cut_id"])))
    return {
        "version": C.HISTORY_VERSION,
        "entries": entries,
        "jobs": len(jobs_with_entries),
        "generated_from": counts,
    }


def save_history(container: ServiceContainer, history: dict[str, Any]) -> Path:
    """Atomic write of data/analysis_history.json."""
    return container.jobs.save_analysis_history(history)


def load_history(container: ServiceContainer) -> dict[str, Any] | None:
    """The saved history, or None when the file is missing, unreadable or of another shape."""
    try:
        data = container.jobs.load_analysis_history()
    except Exception:  # noqa: BLE001
        return None
    if not isinstance(data, dict) or not isinstance(data.get("entries"), list):
        return None
    return data


def _interest(entry: Mapping[str, Any]) -> int | None:
    value = entry.get("interest")
    if isinstance(value, bool) or not isinstance(value, int):
        return None
    return value if C.INTEREST_MIN <= value <= C.INTEREST_MAX else None


def _rate(approved: int, rejected: int) -> float | None:
    total = approved + rejected
    return round(approved / total, C.HISTORY_RATE_DECIMALS) if total else None


def approval_rate_by_interest(history: Mapping[str, Any]) -> dict[int, dict[str, Any]]:
    """Per interest level 1..5: approved, rejected and the approval rate (None without decisions).

    Only entries that carry an S4 interest count (v1 cuts and attempts have none).
    """
    table = {lvl: {"approved": 0, "rejected": 0} for lvl in range(C.INTEREST_MIN, C.INTEREST_MAX + 1)}
    for entry in history.get("entries") or []:
        if not isinstance(entry, Mapping):
            continue
        lvl = _interest(entry)
        if lvl is None or entry.get("status") not in FINAL_STATUSES:
            continue
        table[lvl][entry["status"]] += 1
    return {lvl: {**row, "rate": _rate(row["approved"], row["rejected"])} for lvl, row in table.items()}


def suggest_min_interest(
    history: Mapping[str, Any],
    *,
    min_samples: int = C.SUGGEST_MIN_SAMPLES,
    target_rate: float = C.SUGGEST_TARGET_RATE,
) -> dict[str, Any]:
    """The lowest level whose approval rate, pooled with every higher level, reaches ``target_rate``.

    It needs at least ``min_samples`` pooled decisions, and the history as a whole must hold at least
    HISTORY_MIN_JUDGED_CUTS judged cuts (with an interest) from HISTORY_MIN_JOBS videos; otherwise ``suggested`` is None.
    This function only reports: it never applies anything.
    """
    per_level = approval_rate_by_interest(history)
    table: dict[int, dict[str, Any]] = {}
    for lvl in range(C.INTEREST_MIN, C.INTEREST_MAX + 1):
        pa = sum(per_level[k]["approved"] for k in range(lvl, C.INTEREST_MAX + 1))
        pr = sum(per_level[k]["rejected"] for k in range(lvl, C.INTEREST_MAX + 1))
        table[lvl] = {**per_level[lvl], "pooled_approved": pa, "pooled_rejected": pr, "pooled_rate": _rate(pa, pr)}
    judged = sum(r["approved"] + r["rejected"] for r in per_level.values())
    jobs = {
        e.get("job_id")
        for e in history.get("entries") or []
        if isinstance(e, Mapping) and _interest(e) is not None and e.get("status") in FINAL_STATUSES
    }
    result: dict[str, Any] = {
        "suggested": None,
        "reason": "",
        "table": table,
        "judged": judged,
        "jobs": len(jobs),
        "enough_data": judged >= C.HISTORY_MIN_JUDGED_CUTS and len(jobs) >= C.HISTORY_MIN_JOBS,
    }
    if not result["enough_data"]:
        result["reason"] = (
            f"not enough data: {judged} judged cut(s) with an interest from {len(jobs)} video(s); "
            f"{C.HISTORY_MIN_JUDGED_CUTS} cuts from at least {C.HISTORY_MIN_JOBS} videos are needed before the "
            "approval rates mean anything."
        )
        return result
    for lvl in range(C.INTEREST_MIN, C.INTEREST_MAX + 1):
        row = table[lvl]
        pooled = row["pooled_approved"] + row["pooled_rejected"]
        if pooled >= min_samples and row["pooled_rate"] is not None and row["pooled_rate"] >= target_rate:
            result["suggested"] = lvl
            result["reason"] = (
                f"interest >= {lvl}: {row['pooled_approved']} of {pooled} decisions approved "
                f"({row['pooled_rate']:.0%}), target {target_rate:.0%} with at least {min_samples} decisions. "
                "Suggestion only; analysis_min_interest changes only with the owner's confirmation."
            )
            return result
    result["reason"] = (
        f"no interest level reaches an approval rate of {target_rate:.0%} with at least {min_samples} decisions."
    )
    return result


def format_report(suggestion: Mapping[str, Any]) -> str:
    lines = ["interest  approved  rejected  rate    pooled(>=)"]
    for lvl, row in suggestion["table"].items():
        rate = "-" if row["rate"] is None else f"{row['rate']:.0%}"
        pooled = "-" if row["pooled_rate"] is None else f"{row['pooled_rate']:.0%}"
        lines.append(f"{lvl:<9} {row['approved']:<9} {row['rejected']:<9} {rate:<7} {pooled}")
    lines.append(f"judged cuts with interest: {suggestion['judged']} from {suggestion['jobs']} video(s)")
    lines.append(f"suggested analysis_min_interest: {suggestion['suggested']}")
    lines.append(f"reason: {suggestion['reason']}")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m app.domain.analysis.v2.history")
    ap.add_argument("--rebuild", action="store_true", help="rescan every job and rewrite data/analysis_history.json")
    args = ap.parse_args(argv)
    container = get_container()
    if args.rebuild:
        history = collect_history(container)
        path = save_history(container, history)
        print(f"wrote {path} ({len(history['entries'])} judged cut(s) from {history['jobs']} job(s))")
        print(json.dumps(history["generated_from"], sort_keys=True))
    else:
        history = load_history(container)
        if history is None:
            print("no history file; run with --rebuild", file=sys.stderr)
            return 1
    print(format_report(suggest_min_interest(history)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
