"""Testes 100% mockados das metricas e da regra de decisao do harness (evals/)."""
from __future__ import annotations

import json
import random
from pathlib import Path

import pytest

from evals.metrics import (
    ALL_GROUP,
    CutSpan,
    aggregate_by_format,
    apply_decision_rule,
    boundary_jitter,
    label_metrics,
    match_cuts,
    stability_across_runs,
    stability_f1,
    structural_metrics,
    temporal_iou,
)

C = CutSpan


def test_iou_basic_and_edges():
    assert temporal_iou(C(0, 10), C(0, 10)) == 1.0
    assert temporal_iou(C(0, 10), C(5, 15)) == pytest.approx(5 / 15)
    assert temporal_iou(C(0, 10), C(10, 20)) == 0.0
    assert temporal_iou(C(0, 10), C(20, 30)) == 0.0
    assert temporal_iou(C(0, 20), C(5, 10)) == pytest.approx(0.25)
    # degenerate cuts never overlap anything
    assert temporal_iou(C(5, 5), C(5, 5)) == 0.0
    assert temporal_iou(C(10, 5), C(0, 20)) == 0.0


def test_iou_symmetry_random():
    rng = random.Random(1)
    for _ in range(200):
        a = C(rng.uniform(0, 50), rng.uniform(50, 100))
        b = C(rng.uniform(0, 70), rng.uniform(30, 120))
        assert temporal_iou(a, b) == pytest.approx(temporal_iou(b, a))
        assert 0.0 <= temporal_iou(a, b) <= 1.0


def test_match_greedy_never_reuses_a_cut():
    a = [C(0, 10)]
    b = [C(0, 10), C(0, 9)]
    m = match_cuts(a, b)
    assert m == [(0, 0, 1.0)]  # highest IoU wins, the other b stays unmatched
    # one b candidate shared by two a: only the best a gets it
    m2 = match_cuts([C(0, 10), C(1, 10)], [C(0, 10)])
    assert m2 == [(0, 0, 1.0)]
    for i, j, _ in match_cuts([C(0, 10), C(2, 12), C(4, 14)], [C(1, 11), C(3, 13)]):
        pass
    rng = random.Random(3)
    for _ in range(50):
        xs = [C(s := rng.uniform(0, 100), s + rng.uniform(5, 30)) for _ in range(6)]
        ys = [C(s := rng.uniform(0, 100), s + rng.uniform(5, 30)) for _ in range(6)]
        ms = match_cuts(xs, ys, iou_threshold=0.1)
        assert len({i for i, _, _ in ms}) == len(ms)
        assert len({j for _, j, _ in ms}) == len(ms)


def test_match_threshold_is_inclusive():
    # IoU exactly 0.5: [0,10] vs [0,5]
    assert len(match_cuts([C(0, 10)], [C(0, 5)])) == 1
    assert match_cuts([C(0, 10)], [C(0, 4.9)]) == []


def test_f1_cases():
    assert stability_f1([], []) == 1.0
    assert stability_f1([C(0, 10)], []) == 0.0
    assert stability_f1([], [C(0, 10)]) == 0.0
    a = [C(0, 10), C(20, 30)]
    assert stability_f1(a, a) == 1.0
    assert stability_f1(a, [C(0, 10)]) == pytest.approx(2 * 1 / 3)
    assert stability_f1([C(0, 10)], [C(50, 60)]) == 0.0


def test_f1_symmetric_and_bounded():
    rng = random.Random(7)
    for _ in range(100):
        xs = [C(s := rng.uniform(0, 100), s + rng.uniform(5, 30)) for _ in range(rng.randint(0, 5))]
        ys = [C(s := rng.uniform(0, 100), s + rng.uniform(5, 30)) for _ in range(rng.randint(0, 5))]
        f = stability_f1(xs, ys)
        assert 0.0 <= f <= 1.0
        assert f == pytest.approx(stability_f1(ys, xs))
        assert stability_f1(xs, xs) == 1.0


def test_stability_across_runs():
    assert stability_across_runs([]) is None
    assert stability_across_runs([[C(0, 10)]]) is None
    r1, r2, r3 = [C(0, 10)], [C(0, 10)], [C(50, 60)]
    # pairs: (1,2)=1, (1,3)=0, (2,3)=0
    assert stability_across_runs([r1, r2, r3]) == pytest.approx(1 / 3)
    assert stability_across_runs([[], []]) == 1.0


def test_boundary_jitter_hand_built():
    a = [C(0, 10), C(100, 120)]
    b = [C(1, 11), C(98, 119)]
    j = boundary_jitter(a, b)
    assert j["start"] == pytest.approx((1 + 2) / 2)
    assert j["end"] == pytest.approx((1 + 1) / 2)
    assert boundary_jitter(a, [C(500, 510)]) == {"start": None, "end": None}
    assert boundary_jitter([], []) == {"start": None, "end": None}
    assert boundary_jitter(a, a) == {"start": 0.0, "end": 0.0}


def test_structural_metrics_known_values():
    starts = [0.0, 10.0, 20.0, 30.0]
    ends = [9.8, 19.9, 29.9, 40.0]
    cuts = [C(0.1, 19.9), C(20.0, 40.0), C(5.0, 12.0)]
    m = structural_metrics(cuts, sentence_starts=starts, sentence_ends=ends, spoken_duration=50.0)
    assert m["starts_on_sentence"] == pytest.approx(2 / 3)
    assert m["ends_on_sentence"] == pytest.approx(2 / 3)
    assert m["cut_count"] == 3
    # durations sorted: 7, 19.8, 20
    assert m["duration_p50"] == pytest.approx(19.8)
    assert m["duration_p10"] == pytest.approx(7 + (19.8 - 7) * 0.2)
    assert m["duration_p90"] == pytest.approx(19.8 + (20 - 19.8) * 0.8)
    assert m["coverage"] == pytest.approx((19.8 + 20 + 7) / 50)
    assert m["max_overlap_iou"] == pytest.approx(temporal_iou(cuts[0], cuts[2]))


def test_structural_metrics_tolerance_is_inclusive_and_edge_cases():
    m = structural_metrics([C(0.3, 5)], sentence_starts=[0.0], sentence_ends=[5.0], spoken_duration=10)
    assert m["starts_on_sentence"] == 1.0
    empty = structural_metrics([], sentence_starts=[0], sentence_ends=[1], spoken_duration=0)
    assert empty["starts_on_sentence"] is None and empty["duration_p50"] is None
    assert empty["coverage"] is None and empty["cut_count"] == 0 and empty["max_overlap_iou"] == 0.0
    degenerate = structural_metrics([C(5, 5), C(1, 3)], sentence_starts=[1], sentence_ends=[3], spoken_duration=4)
    assert degenerate["cut_count"] == 2
    assert degenerate["starts_on_sentence"] == 1.0
    assert degenerate["coverage"] == pytest.approx(0.5)
    ident = structural_metrics([C(0, 10), C(0, 10)], sentence_starts=[0], sentence_ends=[10], spoken_duration=10)
    assert ident["max_overlap_iou"] == 1.0


def test_label_metrics():
    must = [C(100, 160), C(300, 400)]
    never = [C(0, 24)]
    cuts = [C(90, 140), C(0, 30), C(310, 330)]
    m = label_metrics(cuts, must=must, never=never)
    # (90,140) covers 40/60 = 0.667 of the first must; (310,330) covers only 20% of the second
    assert m["must_recall"] == pytest.approx(0.5)
    assert m["never_violations"] == 1  # (0,30) overlaps 24 s
    # exactly 3 s of overlap is not a violation; more is
    assert label_metrics([C(21, 40)], must=[], never=never)["never_violations"] == 0
    assert label_metrics([C(20.5, 40)], must=[], never=never)["never_violations"] == 1
    # exactly 60% covers
    assert label_metrics([C(0, 6)], must=[C(0, 10)], never=[])["must_recall"] == 1.0
    assert label_metrics([C(0, 5.9)], must=[C(0, 10)], never=[])["must_recall"] == 0.0
    assert label_metrics(cuts, must=[], never=[]) == {"must_recall": None, "never_violations": 0}
    assert label_metrics([], must=must, never=never)["must_recall"] == 0.0


def test_aggregate_by_format():
    rows = [
        {"slug": "a", "format": "x", "stability": 0.8, "judge_pass_rate": None, "cut_count": 4},
        {"slug": "b", "format": "x", "stability": 0.6, "judge_pass_rate": 0.5, "cut_count": 6},
        {"slug": "c", "format": "y", "stability": 1.0, "judge_pass_rate": None, "cut_count": 2},
    ]
    agg = aggregate_by_format(rows)
    assert agg["x"]["stability"] == pytest.approx(0.7)
    assert agg["x"]["judge_pass_rate"] == pytest.approx(0.5)  # None ignored
    assert agg["x"]["video_count"] == 2
    assert agg["y"]["judge_pass_rate"] is None
    assert agg[ALL_GROUP]["stability"] == pytest.approx(0.8)
    assert agg[ALL_GROUP]["cut_count"] == pytest.approx(4.0)
    assert "slug" not in agg["x"]
    assert set(agg) == {"x", "y", ALL_GROUP}
    assert aggregate_by_format([]) == {ALL_GROUP: {"video_count": 0}}


def _grp(stab, judge, so=0.97, eo=0.97, nv=0.0, must=0.8, n=2):
    return {
        "stability": stab, "judge_pass_rate": judge, "starts_on_sentence": so,
        "ends_on_sentence": eo, "never_violations": nv, "must_recall": must, "video_count": n,
    }


def _base():
    return {"x": _grp(0.60, 0.60), "y": _grp(0.70, 0.70), ALL_GROUP: _grp(0.65, 0.65)}


def test_decision_passes():
    cand = {"x": _grp(0.72, 0.62), "y": _grp(0.69, 0.75), ALL_GROUP: _grp(0.705, 0.685)}
    r = apply_decision_rule(_base(), cand)
    assert r["passed"] is True and r["reasons"] == []


def test_decision_fails_when_single_format_worse_but_aggregate_improves():
    cand = {"x": _grp(0.90, 0.90), "y": _grp(0.60, 0.70), ALL_GROUP: _grp(0.75, 0.80)}
    r = apply_decision_rule(_base(), cand)
    assert r["passed"] is False
    assert r["worst_format"] == "y"
    assert any(s.startswith("[1]") and "'y'" in s for s in r["reasons"])
    assert not any(s.startswith("[2]") for s in r["reasons"])


def test_decision_drop_within_tolerance_ok():
    cand = {"x": _grp(0.58, 0.60), "y": _grp(0.80, 0.70), ALL_GROUP: _grp(0.69, 0.65)}
    base = _base()
    r = apply_decision_rule(base, cand)
    assert r["passed"] is False  # aggregate gain only 0.04 < 0.05
    assert [s[:3] for s in r["reasons"]] == ["[2]"]


def test_decision_fails_on_sentence_validity():
    cand = {"x": _grp(0.72, 0.62, so=0.90), "y": _grp(0.75, 0.75), ALL_GROUP: _grp(0.735, 0.685, so=0.94)}
    r = apply_decision_rule(_base(), cand)
    assert r["passed"] is False
    assert any(s.startswith("[3]") for s in r["reasons"])


def test_decision_fails_on_never_violations_and_must_recall():
    cand = {"x": _grp(0.8, 0.8, nv=0.5), "y": _grp(0.8, 0.8), ALL_GROUP: _grp(0.8, 0.8, nv=0.25, must=0.5)}
    r = apply_decision_rule(_base(), cand)
    assert r["passed"] is False
    assert any("never_violations" in s for s in r["reasons"])
    assert any("must_recall" in s for s in r["reasons"])


def test_decision_fails_on_time_limit():
    cand = {"x": _grp(0.8, 0.8), "y": _grp(0.8, 0.8), ALL_GROUP: _grp(0.8, 0.8)}
    assert apply_decision_rule(_base(), cand)["passed"] is True
    r = apply_decision_rule(_base(), cand, time_limit_violations=1)
    assert r["passed"] is False and any(s.startswith("[5]") for s in r["reasons"])


def test_decision_missing_format_and_none_values():
    base = _base()
    cand = {"x": _grp(0.8, 0.8), ALL_GROUP: _grp(0.8, 0.8)}  # y missing
    r = apply_decision_rule(base, cand)
    assert r["passed"] is False and any("'y'" in s for s in r["reasons"])
    # format only in candidate is not compared; None sentence metric cannot be verified
    cand2 = {"x": _grp(0.8, 0.8), "y": _grp(0.8, 0.8), "z": _grp(0.1, 0.1, so=None), ALL_GROUP: _grp(0.8, 0.8)}
    r2 = apply_decision_rule(base, cand2)
    assert any("indisponivel" in s for s in r2["reasons"])
    # no gains computable
    r3 = apply_decision_rule({ALL_GROUP: {}}, {ALL_GROUP: _grp(0.9, 0.9)})
    assert any(s.startswith("[2]") for s in r3["reasons"])


def test_build_report_end_to_end(tmp_path, monkeypatch):
    from evals import report as rep

    corpus = tmp_path / "corpus"
    (corpus / "vid").mkdir(parents=True)
    (corpus / "vid" / "transcription.segments.json").write_text(
        json.dumps([{"start": 0, "end": 10, "text": "a"}, {"start": 10, "end": 20, "text": "b"}])
    )

    class Entry:
        slug = "vid"
        format = "talk"
        duration_seconds = 60

    monkeypatch.setattr(rep, "corpus_dir", lambda slug, root=None: corpus / slug)
    monkeypatch.setattr(rep, "load_manifest", lambda path=None: [Entry()])
    monkeypatch.setattr(rep, "load_labels", lambda slug, root=None: ([C(0, 10)], [C(15, 20)]))

    def make(name, cuts):
        run = tmp_path / name
        for seed in ("1", "2"):
            d = run / "vid" / seed
            d.mkdir(parents=True)
            (d / "cuts.json").write_text(json.dumps({"cuts": [{"start": s, "end": e} for s, e in cuts]}))
            (d / "trace.json").write_text(json.dumps({"seconds_total": 30, "llm_calls": 4}))
            (d / "judge.json").write_text(json.dumps({"cuts": [{"judge_pass": True}, {"judge_pass": False}]}))
        return run

    base = make("b-base", [(0, 10)])
    cand = make("c-cand", [(0, 10), (10, 20)])
    report = rep.build_report(cand, base_dir=base)
    row = report["videos"][0]
    assert row["format"] == "talk" and row["stability"] == 1.0
    assert row["seconds_per_video_minute"] == pytest.approx(30.0)
    assert row["judge_pass_rate"] == 0.5
    assert row["must_recall"] == 1.0
    assert report["by_format"]["talk"]["cut_count"] == 2
    assert (cand / "report.json").exists()
    md = (cand / "report.md").read_text(encoding="utf-8")
    assert "talk" in md and "Pior formato" in md
    assert report["decision"] is not None


def test_decision_rule_fails_when_candidate_lacks_judge():
    from evals.metrics import apply_decision_rule
    ok = {"starts_on_sentence": 1.0, "ends_on_sentence": 1.0, "never_violations": 0}
    base = {"x": {**ok, "judge_pass_rate": 0.9, "stability": 0.5},
            "__all__": {**ok, "judge_pass_rate": 0.9, "stability": 0.5}}
    cand = {"x": {**ok, "judge_pass_rate": None, "stability": 0.6},
            "__all__": {**ok, "judge_pass_rate": None, "stability": 0.6}}
    res = apply_decision_rule(base, cand)
    assert res["passed"] is False
    assert any("judge_pass_rate" in r for r in res["reasons"])


def test_decision_rule_integrity_problems_fail():
    from evals.metrics import apply_decision_rule
    g = {"starts_on_sentence": 1.0, "ends_on_sentence": 1.0, "judge_pass_rate": 0.5, "stability": 0.5}
    cand = {"x": {**g, "stability": 0.9}, "__all__": {**g, "stability": 0.9}}
    base = {"x": g, "__all__": g}
    assert apply_decision_rule(base, cand)["passed"] is True
    res = apply_decision_rule(base, cand, integrity_problems=["2 run(s) failed"])
    assert res["passed"] is False and "[0]" in res["reasons"][0]
