"""Eval harness presets (backend/evals/variants.py) and their wiring into evals.run. No hardware, no network."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from app.application import runtime_service
from evals import corpus, run, variants

PHASE2 = {"brief": "provisional", "units": "topics", "refine_boundaries": False}

DOCUMENTED = {
    "v1": {"analysis_pipeline": "v1"},
    "v2": {"analysis_pipeline": "v2", "analysis_v2": {"brief": "provisional", "units": "topics", "refine_boundaries": False}},
    "v2-brief": {"analysis_pipeline": "v2", "analysis_v2": {"brief": "llm", "units": "topics", "refine_boundaries": False}},
    "v2-units": {"analysis_pipeline": "v2", "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": False}},
    "v2-bounds": {"analysis_pipeline": "v2", "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True}},
    "v2-noemb": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "topic_embeddings": False},
    },
    "v2-think": {
        "analysis_pipeline": "v2",
        "analysis_v2": {
            "brief": "llm",
            "units": "llm",
            "refine_boundaries": True,
            "reasoning_stages": ["scoring", "refine"],
        },
    },
    "v2-derived": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "derive_legacy_artifacts": True},
    },
    "v2-audience-tiebreak": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "audience_signal": "tiebreak"},
    },
    "v2-audience-bonus": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "audience_signal": "bonus"},
    },
    "v2-vision": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "vision": True},
    },
    "v2-examples": {
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "scoring_examples": 6},
        "analysis_pipeline": "v2",
    },
}


def test_presets_resolve_to_the_documented_overrides() -> None:
    assert set(variants.preset_names()) == set(DOCUMENTED)
    for name, expected in DOCUMENTED.items():
        assert variants.resolve_preset(name) == expected, name
    assert set(variants.COMPARISON_ORDER) <= set(DOCUMENTED)
    assert variants.COMPARISON_ORDER == ("v2", "v2-brief", "v2-units", "v2-bounds", "v2-noemb")


def test_resolve_preset_returns_an_independent_copy_and_rejects_unknown_names() -> None:
    a = variants.resolve_preset("v2-bounds")
    a["analysis_v2"]["brief"] = "provisional"
    assert variants.resolve_preset("v2-bounds")["analysis_v2"]["brief"] == "llm"
    with pytest.raises(ValueError, match="unknown preset"):
        variants.resolve_preset("v3")


def test_every_preset_value_is_a_value_the_pipeline_accepts() -> None:
    from app.domain.analysis.v2.pipeline import resolve_stage_toggles

    for name, overrides in variants.PRESETS.items():
        cfg = overrides.get("analysis_v2")
        if cfg is None:
            continue
        warnings: list[str] = []
        stage_cfg = {k: v for k, v in cfg.items() if k not in ("reasoning_stages", "derive_legacy_artifacts", "audience_signal", "scoring_examples", "vision")}  # validated by resolve_reasoning_stages
        assert resolve_stage_toggles(cfg, warnings.append) | stage_cfg == resolve_stage_toggles(cfg), name
        assert warnings == [], name


def test_unknown_preset_exits_non_zero_before_doing_anything(capsys: pytest.CaptureFixture[str]) -> None:
    rc = run.main(["--split", "dev", "--variant", "x", "--preset", "does-not-exist"])
    assert rc != 0
    assert "does-not-exist" in capsys.readouterr().err


def test_parser_accepts_preset_and_keeps_pipeline() -> None:
    args = run.build_parser().parse_args(["--split", "dev", "--variant", "x", "--preset", "v2-brief", "--pipeline", "v2"])
    assert args.preset == "v2-brief" and args.pipeline == "v2"
    assert run.build_parser().parse_args(["--split", "dev", "--variant", "x"]).preset is None


# --- wiring into run_one ----------------------------------------------------------------------


@pytest.fixture
def one_video(tmp_path: Path) -> dict[str, Any]:
    root = tmp_path / "corpus"
    d = root / "vid"
    d.mkdir(parents=True)
    segs = [
        {"segment_id": f"s{i}", "start": 6.0 * i, "end": 6.0 * (i + 1), "text": f"merhaba dunya {i} nasilsin iyiyim."}
        for i in range(10)
    ]
    words = []
    for i, seg in enumerate(segs):
        for j, w in enumerate(seg["text"].split()):
            t = 6.0 * i + j * 1.0
            words.append({"word": w, "start": t, "end": t + 0.9, "probability": 0.9, "segment_id": seg["segment_id"]})
    (d / "transcription.segments.json").write_text(json.dumps(segs), encoding="utf-8")
    (d / "transcription.words.json").write_text(json.dumps(words), encoding="utf-8")
    entry = corpus.VideoEntry(slug="vid", format="zzkind", language="tr", duration_seconds=60.0, split="dev", source="synthetic")
    return {"root": root, "entry": entry, "runs": tmp_path / "runs"}


async def _dead_llm(method: str, url: str, body: dict[str, Any] | None = None) -> tuple[int, Any]:
    return 404, {}


async def _run_one(one_video: dict[str, Any], seen: list[dict[str, Any]], **kw: Any) -> dict[str, Any]:
    async def analyze(job_id: str, *, llm_adapter: Any, container: Any) -> dict[str, Any]:
        seen.append(dict(container.load_active_tool_configs().get("llm") or {}))
        return {"cuts": []}

    return await run.run_one(
        one_video["entry"], 7, variant="preset-test", run_dir=one_video["runs"], corpus_root=one_video["root"],
        analyze=analyze, http_fetcher=_dead_llm, **kw,
    )


async def test_run_one_writes_the_preset_to_the_temp_config_trace_and_cuts(one_video: dict[str, Any]) -> None:
    seen: list[dict[str, Any]] = []
    overrides = variants.resolve_preset("v2-noemb")
    trace = await _run_one(one_video, seen, pipeline=None, preset="v2-noemb", llm_overrides=overrides)

    assert seen[0]["analysis_pipeline"] == "v2"
    assert seen[0]["analysis_v2"] == overrides["analysis_v2"]
    assert trace["preset"] == "v2-noemb" and trace["llm_overrides"] == overrides
    on_disk = json.loads((one_video["runs"] / "vid" / "7" / "trace.json").read_text(encoding="utf-8"))
    assert on_disk["preset"] == "v2-noemb" and on_disk["llm_overrides"] == overrides
    cuts = json.loads((one_video["runs"] / "vid" / "7" / "cuts.json").read_text(encoding="utf-8"))
    assert cuts["preset"] == "v2-noemb"
    # Nothing leaked outside the temporary workspace.
    active = runtime_service.get_container().load_active_tool_configs()
    assert "analysis_v2" not in (active.get("llm") or {})


async def test_run_one_without_preset_keeps_the_pipeline_flag_working(one_video: dict[str, Any]) -> None:
    seen: list[dict[str, Any]] = []
    trace = await _run_one(one_video, seen, pipeline="v2")
    assert seen[0]["analysis_pipeline"] == "v2" and "analysis_v2" not in seen[0]
    assert trace["preset"] is None and trace["llm_overrides"] is None and trace["pipeline"] == "v2"


async def test_preset_overrides_win_over_the_pipeline_flag(one_video: dict[str, Any]) -> None:
    seen: list[dict[str, Any]] = []
    await _run_one(one_video, seen, pipeline="v2", preset="v1", llm_overrides=variants.resolve_preset("v1"))
    assert seen[0]["analysis_pipeline"] == "v1"


@pytest.mark.parametrize(
    ("preset", "expected"),
    [("v2-noemb", False), ("v2-bounds", True), ("v1", True), (None, True)],
)
async def test_topic_prebuild_follows_the_topic_embeddings_toggle(
    one_video: dict[str, Any], monkeypatch: pytest.MonkeyPatch, preset: str | None, expected: bool
) -> None:
    from app.domain.segmentation import topic_segmentation

    calls: list[dict[str, Any]] = []

    async def fake_topics(job_id: str, **kwargs: Any) -> list[Any]:
        calls.append(kwargs)
        return []

    monkeypatch.setattr(topic_segmentation, "build_topic_segments", fake_topics)
    seen: list[dict[str, Any]] = []
    overrides = variants.resolve_preset(preset) if preset else None
    await _run_one(one_video, seen, pipeline=None, preset=preset, llm_overrides=overrides, prebuild_segmentation=True)
    assert [c["use_embeddings"] for c in calls] == [expected]
