"""Judge stage of the evaluation harness.

    python -m evals.judge --run backend/evals/runs/<run> --judge-model <model>

Run it AFTER generation: every cut of every (video, seed) is judged from its text
alone, with the frozen prompt in ``evals.judge_prompt``. The generator and the judge
take turns on the GPU, so this stage never overlaps with ``evals.run``.
Writes ``<run>/<slug>/<seed>/judge.json``.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any, Awaitable, Callable

from app.infrastructure.storage.atomic_store import atomic_write_json

from evals import corpus, judge_prompt

JUDGE_SEED = 1234
JUDGE_TEMPERATURE = 0.0

# async (system_prompt, user_prompt, json_schema, *, model, temperature, seed) -> parsed dict
JudgeLLM = Callable[..., Awaitable[dict[str, Any]]]


async def default_judge_llm(
    system_prompt: str,
    user_prompt: str,
    json_schema: dict[str, Any],
    *,
    model: str,
    temperature: float,
    seed: int,
) -> dict[str, Any]:
    """Real local LLM through the app's adapter. Needs LM Studio/Ollama: never used by tests."""
    from app.application import runtime_service
    from app.infrastructure.llm.unified_adapter import UnifiedLocalLLMAdapter
    from evals.run import isolated_workspace

    with isolated_workspace():
        container = runtime_service.ServiceContainer()
        runtime_service.set_container_override(container)
        adapter = UnifiedLocalLLMAdapter(container=container, model=model)
        parsed, _raw = await adapter.chat_json(
            system_prompt,
            user_prompt,
            json_schema=json_schema,
            schema_name="cut_judgement",
            temperature=temperature,
            seed=seed,
        )
    return parsed if isinstance(parsed, dict) else {}


def _seed_dirs(run_dir: Path) -> list[Path]:
    out: list[Path] = []
    for slug_dir in sorted(p for p in run_dir.iterdir() if p.is_dir()):
        for seed_dir in sorted(p for p in slug_dir.iterdir() if p.is_dir()):
            if (seed_dir / "cuts.json").exists():
                out.append(seed_dir)
    return out


async def judge_seed_dir(
    seed_dir: Path,
    *,
    judge_model: str,
    llm: JudgeLLM | None = None,
    corpus_root: Path | None = None,
) -> dict[str, Any]:
    """Judge all cuts in <seed_dir>/cuts.json and write <seed_dir>/judge.json."""
    llm = llm or default_judge_llm
    data = json.loads((seed_dir / "cuts.json").read_text(encoding="utf-8"))
    slug = str(data.get("slug") or seed_dir.parent.name)
    items: list[dict[str, Any]] = []
    for cut in data.get("cuts", []):
        start, end = float(cut["start"]), float(cut["end"])
        text = corpus.cut_text(slug, start, end, corpus_root)
        item: dict[str, Any] = {"cut_id": cut.get("cut_id"), "start": start, "end": end}
        if not text.strip():
            item.update(answer=None, judge_pass=False, note="empty cut text")
        else:
            try:
                answer = await llm(
                    judge_prompt.JUDGE_SYSTEM_PROMPT,
                    judge_prompt.build_judge_user_prompt(text),
                    judge_prompt.JUDGE_JSON_SCHEMA,
                    model=judge_model,
                    temperature=JUDGE_TEMPERATURE,
                    seed=JUDGE_SEED,
                )
                item.update(answer=answer, judge_pass=bool(judge_prompt.judge_pass(answer)))
            except Exception as exc:  # noqa: BLE001
                # Transport/parse failure: NOT a failed cut. judge_pass stays None and the
                # item is left out of the rate (counted in judge_errors).
                item.update(answer=None, judge_pass=None, error=f"{type(exc).__name__}: {exc}")
        items.append(item)
    passes = [bool(i["judge_pass"]) for i in items if i["judge_pass"] is not None]
    errors = sum(1 for i in items if i.get("error"))
    result = {
        "slug": slug,
        "seed": data.get("seed"),
        "judge_model": judge_model,
        "judge_prompt_version": judge_prompt.JUDGE_PROMPT_VERSION,
        "judge_prompt_hash": judge_prompt.judge_prompt_hash(),
        "temperature": JUDGE_TEMPERATURE,
        "judge_seed": JUDGE_SEED,
        "judge_pass_rate": (sum(passes) / len(passes)) if passes else None,
        "judge_errors": errors,
        "cuts": items,
    }
    atomic_write_json(seed_dir / "judge.json", result)
    return result


async def judge_run(
    run_dir: Path,
    *,
    judge_model: str,
    llm: JudgeLLM | None = None,
    corpus_root: Path | None = None,
) -> list[Path]:
    """Judge every (video, seed) of a finished generation run. Returns the judge.json paths."""
    written: list[Path] = []
    for sd in _seed_dirs(Path(run_dir)):
        await judge_seed_dir(sd, judge_model=judge_model, llm=llm, corpus_root=corpus_root)
        written.append(sd / "judge.json")
    return written


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m evals.judge")
    ap.add_argument("--run", required=True, help="run directory produced by evals.run")
    ap.add_argument("--judge-model", required=True)
    a = ap.parse_args(argv)
    run_dir = Path(a.run)
    if not run_dir.is_dir():
        print(f"run directory not found: {run_dir}", file=sys.stderr)
        return 2
    written = asyncio.run(judge_run(run_dir, judge_model=a.judge_model))
    print(f"judged {len(written)} (video, seed) sets")
    errors = 0
    for path in written:
        errors += int(json.loads(path.read_text(encoding="utf-8")).get("judge_errors") or 0)
    if errors:
        print(f"{errors} judge call(s) failed; those cuts are excluded from judge_pass_rate", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
