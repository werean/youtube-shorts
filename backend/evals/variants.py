"""Named presets: a variant name -> the ``llm`` configuration overrides written into the temporary configuration.

Presets only ever touch the temporary data directory of an evaluation run (see ``evals.run``); they never
change the user's ``custom_settings.json``. The order in which phase 3 compares them is in
``docs/analysis-v2/phases/phase-3.md`` (3a to 3d) and in ``evals/README.md``.
"""

from __future__ import annotations

import copy
from typing import Any

# The phase-2 slice of the v2 pipeline: provisional brief, topic units, no boundary refinement.
_PHASE2_SLICE: dict[str, Any] = {"brief": "provisional", "units": "topics", "refine_boundaries": False}

PRESETS: dict[str, dict[str, Any]] = {
    "v1": {"analysis_pipeline": "v1"},
    "v2": {"analysis_pipeline": "v2", "analysis_v2": dict(_PHASE2_SLICE)},
    "v2-brief": {"analysis_pipeline": "v2", "analysis_v2": {**_PHASE2_SLICE, "brief": "llm"}},
    "v2-units": {"analysis_pipeline": "v2", "analysis_v2": {**_PHASE2_SLICE, "brief": "llm", "units": "llm"}},
    "v2-bounds": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True},
    },
    "v2-noemb": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "topic_embeddings": False},
    },
    # D16 variant: the full pipeline with reasoning on for scoring (S4) and boundary refinement (S5) only.
    "v2-think": {
        "analysis_pipeline": "v2",
        "analysis_v2": {
            "brief": "llm",
            "units": "llm",
            "refine_boundaries": True,
            "reasoning_stages": ["scoring", "refine"],
        },
    },
    # Phase 4: the full pipeline with semantic.blocks.json / topic.segments.json derived from sentences and units.
    "v2-derived": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "derive_legacy_artifacts": True},
    },
    # Phase 5 part A: the full pipeline with the audience heatmap used as tie-break / bounded score bonus.
    "v2-audience-tiebreak": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "audience_signal": "tiebreak"},
    },
    "v2-audience-bonus": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "audience_signal": "bonus"},
    },
    # Phase 6: the full pipeline with the conditional vision stage. It also needs llm.vision_model and the source video
    # file (see evals/README.md, "Fase 6"); without them the stage is skipped with a warning and nothing changes.
    "v2-vision": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "vision": True},
    },
    # Phase 7: the full pipeline with 6 past owner decisions shown to S4. Needs --history (see evals.run).
    "v2-examples": {
        "analysis_pipeline": "v2",
        "analysis_v2": {"brief": "llm", "units": "llm", "refine_boundaries": True, "scoring_examples": 6},
    },
}

# Order in which phase-3.md compares them: each preset against the one before (3d against 3c).
# `v2-think` (D16) and `v2-derived` (phase 4) are compared against `v2-bounds` and are not part of this chain.
COMPARISON_ORDER: tuple[str, ...] = ("v2", "v2-brief", "v2-units", "v2-bounds", "v2-noemb")


def overrides_need_history(overrides: dict[str, Any] | None) -> bool:
    """True when the llm overrides turn on ``analysis_v2.scoring_examples`` (they read a history file)."""
    v2 = (overrides or {}).get("analysis_v2")
    count = v2.get("scoring_examples") if isinstance(v2, dict) else None
    return isinstance(count, int) and not isinstance(count, bool) and count > 0


def preset_names() -> list[str]:
    return list(PRESETS)


def resolve_preset(name: str) -> dict[str, Any]:
    """The overrides of a preset (a fresh deep copy). Raises ``ValueError`` for an unknown name."""
    if name not in PRESETS:
        raise ValueError(f"unknown preset {name!r}; known presets: {', '.join(PRESETS)}")
    return copy.deepcopy(PRESETS[name])
