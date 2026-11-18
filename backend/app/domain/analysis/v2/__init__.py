"""Analysis pipeline v2 (sentences, units, candidates, per-candidate scoring, selection).

Spec: docs/analysis-v2/. Nothing heavy is imported here on purpose, so that
importing the package never pulls the LLM adapter or the v1 segmentation code.
"""
