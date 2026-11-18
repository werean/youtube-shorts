"""Relatorio do harness: le uma pasta de execucao, calcula metricas e escreve report.json/report.md.

Layout lido (eval-harness.md, "Estrutura"):
    <run_dir>/<slug>/<seed>/cuts.json | trace.json | judge.json (opcional)

Decisoes que a spec nao fixa:
- Frases de referencia: app.domain.analysis.v2.sentences.build_sentences sobre as palavras de
  transcription.words.json do corpus; sem palavras, cai para os segmentos de
  transcription.segments.json (cada segmento vira uma frase). Duracao falada = soma das
  duracoes das frases.
- Metricas por video = media entre seeds (stability e jitter sao calculados entre pares
  de seeds; jitter = media dos pares que casaram algo).
- judge.json: aceita lista em "cuts" ou "answers"; cada item usa seu "judge_pass" booleano
  ou, na falta, judge_pass(item["answer"] ou o proprio item).
- Limite de tempo (decisions.md D6): TIME_LIMIT_SECONDS por video, FIXO (limite duro de 60 min,
  nao escala com a duracao do video; interpretacao nao fixada na spec, registrada aqui e no report.md).
- Execucoes que falharam (trace.json sem cuts.json) NAO somem: contam em failed_runs e reprovam a
  regra de decisao da candidata. Estabilidade com menos de 2 execucoes ok e None.
- Integridade da comparacao (condicao [0]): videos da base ausentes na candidata, numero de seeds
  diferente, judge_prompt_hash/judge_model diferentes, juiz igual ao gerador.
- Exit code de main: 0 aprovado (ou sem base), 1 reprovado na regra de decisao, 2 erro de uso.
"""
from __future__ import annotations

import argparse
import re
import sys
from itertools import combinations
from pathlib import Path
from typing import Any, Mapping, Sequence

from app.domain.analysis.v2.sentences import build_sentences
from app.infrastructure.storage.atomic_store import atomic_write_json, atomic_write_text, read_json
from app.models.domain import Segment, WordTiming
from evals.corpus import corpus_dir, load_labels, load_manifest
from evals.judge_prompt import judge_pass
from evals.metrics import (
    ALL_GROUP,
    CutSpan,
    aggregate_by_format,
    apply_decision_rule,
    boundary_jitter,
    label_metrics,
    stability_across_runs,
    structural_metrics,
)

# decisions.md D6: limite duro de 60 min por video para a analise.
TIME_LIMIT_SECONDS = 3600.0

RUNS_ROOT = Path(__file__).resolve().parent / "runs"

DISPLAY_METRICS = (
    "stability",
    "judge_pass_rate",
    "jitter_start",
    "jitter_end",
    "starts_on_sentence",
    "ends_on_sentence",
    "duration_p10",
    "duration_p50",
    "duration_p90",
    "coverage",
    "max_overlap_iou",
    "cut_count",
    "must_recall",
    "never_violations",
    "llm_calls",
    "tokens_in",
    "tokens_out",
    "seconds_total",
    "seconds_per_video_minute",
)


def _mean(values: Sequence[float | None]) -> float | None:
    vals = [float(v) for v in values if isinstance(v, (int, float)) and not isinstance(v, bool)]
    return sum(vals) / len(vals) if vals else None


def _spans(cuts_payload: Mapping[str, Any]) -> list[CutSpan]:
    out: list[CutSpan] = []
    for c in cuts_payload.get("cuts") or []:
        try:
            out.append(CutSpan(float(c["start"]), float(c["end"])))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def _segments(slug: str, corpus_root: Path | None = None) -> list[Mapping[str, Any]]:
    path = corpus_dir(slug, corpus_root) / "transcription.segments.json"
    if not path.exists():
        return []
    data = read_json(path)
    if isinstance(data, Mapping):
        data = data.get("segments") or []
    return [s for s in data if isinstance(s, Mapping) and "start" in s and "end" in s]


def _words(slug: str, corpus_root: Path | None = None) -> list[Mapping[str, Any]]:
    path = corpus_dir(slug, corpus_root) / "transcription.words.json"
    if not path.exists():
        return []
    data = read_json(path)
    if isinstance(data, Mapping):
        data = data.get("words") or []
    return [w for w in data if isinstance(w, Mapping) and "start" in w and "end" in w]


def _reference_sentences(slug: str, corpus_root: Path | None = None) -> tuple[list[float], list[float], float]:
    """Sentence starts, ends and spoken seconds from the v2 S0 splitter (words first, segments as fallback)."""
    words: list[WordTiming] = []
    for w in _words(slug, corpus_root):
        try:
            words.append(WordTiming(**{**w, "word": str(w.get("word") or w.get("text") or "")}))
        except (TypeError, ValueError):
            continue
    segments: list[Segment] = []
    if not words:
        for sg in _segments(slug, corpus_root):
            try:
                segments.append(Segment(**{**sg, "text": str(sg.get("text") or "")}))
            except (TypeError, ValueError):
                continue
    sentences, _meta = build_sentences(words or None, segments or None)
    starts = [float(x.start) for x in sentences]
    ends = [float(x.end) for x in sentences]
    spoken = sum(max(0.0, e - b) for b, e in zip(starts, ends))
    return starts, ends, spoken


def _trace_value(trace: Mapping[str, Any], *names: str) -> float | None:
    for n in names:
        v = trace.get(n)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            return float(v)
    return None


def _judge_data(judge_path: Path) -> Mapping[str, Any] | None:
    if not judge_path.exists():
        return None
    data = read_json(judge_path)
    return data if isinstance(data, Mapping) else None


def _judge_rate(judge_path: Path) -> float | None:
    data = _judge_data(judge_path)
    if data is None:
        return None
    items = data.get("cuts") if isinstance(data, Mapping) else None
    if items is None and isinstance(data, Mapping):
        items = data.get("answers")
    if not isinstance(items, list) or not items:
        return None
    passes: list[bool] = []
    for it in items:
        if not isinstance(it, Mapping) or it.get("error"):
            continue  # judge transport/parse errors are not failed cuts
        if isinstance(it.get("judge_pass"), bool):
            passes.append(it["judge_pass"])
        else:
            answer = it.get("answer") if isinstance(it.get("answer"), Mapping) else it
            passes.append(bool(judge_pass(answer)))
    return sum(passes) / len(passes) if passes else None


def _seed_dirs(video_dir: Path) -> list[Path]:
    """Every seed folder that ran (has cuts.json or at least a trace.json)."""
    return sorted(
        d
        for d in video_dir.iterdir()
        if d.is_dir() and ((d / "cuts.json").exists() or (d / "trace.json").exists())
    )


def _video_row(video_dir: Path, entry: Any | None, corpus_root: Path | None = None) -> dict[str, Any]:
    slug = video_dir.name
    all_seeds = _seed_dirs(video_dir)
    seeds = [d for d in all_seeds if (d / "cuts.json").exists()]
    failed_runs = len(all_seeds) - len(seeds)
    runs: list[list[CutSpan]] = []
    traces: list[Mapping[str, Any]] = []
    for sd in seeds:
        runs.append(_spans(read_json(sd / "cuts.json")))
        tp = sd / "trace.json"
        traces.append(read_json(tp) if tp.exists() else {})
    judges = [j for j in (_judge_data(sd / "judge.json") for sd in seeds) if j is not None]

    starts, ends, spoken = _reference_sentences(slug, corpus_root)
    must, never = load_labels(slug, corpus_root)

    structs = [
        structural_metrics(r, sentence_starts=starts, sentence_ends=ends, spoken_duration=spoken)
        for r in runs
    ]
    labs = [label_metrics(r, must=must, never=never) for r in runs]
    jit = [boundary_jitter(x, y) for x, y in combinations(runs, 2)]

    row: dict[str, Any] = {
        "slug": slug,
        "format": (getattr(entry, "format", None) or "unknown") if entry else "unknown",
        "seeds": [sd.name for sd in seeds],
        "failed_runs": failed_runs,
        "has_heatmap": any(bool(t.get("has_heatmap")) for t in traces),
        "zero_cut_runs": sum(1 for r in runs if not r),
        "judge_errors": sum(int(j.get("judge_errors") or 0) for j in judges),
        "judge_hashes": sorted({str(j["judge_prompt_hash"]) for j in judges if j.get("judge_prompt_hash")}),
        "judge_models": sorted({str(j["judge_model"]) for j in judges if j.get("judge_model")}),
        "generator_models": sorted({str(t["model"]) for t in traces if t.get("model")}),
        "stability": stability_across_runs(runs),
        "jitter_start": _mean([j["start"] for j in jit]),
        "jitter_end": _mean([j["end"] for j in jit]),
        "judge_pass_rate": _mean([_judge_rate(sd / "judge.json") for sd in seeds]),
    }
    for key in (
        "starts_on_sentence",
        "ends_on_sentence",
        "duration_p10",
        "duration_p50",
        "duration_p90",
        "coverage",
        "max_overlap_iou",
        "cut_count",
    ):
        row[key] = _mean([s[key] for s in structs])
    row["must_recall"] = _mean([m["must_recall"] for m in labs])
    row["never_violations"] = _mean([m["never_violations"] for m in labs])
    row["llm_calls"] = _mean([_trace_value(t, "llm_calls", "llm_call_count") for t in traces])
    row["tokens_in"] = _mean([_trace_value(t, "tokens_in") for t in traces])
    row["tokens_out"] = _mean([_trace_value(t, "tokens_out") for t in traces])
    row["seconds_total"] = _mean([_trace_value(t, "seconds_total") for t in traces])
    row["seconds_max"] = max(
        (v for v in (_trace_value(t, "seconds_total") for t in traces) if v is not None),
        default=None,
    )
    duration = getattr(entry, "duration_seconds", None) if entry else None
    if not duration:
        duration = spoken or None
    if row["seconds_total"] is not None and duration:
        row["seconds_per_video_minute"] = row["seconds_total"] / (float(duration) / 60.0)
    else:
        row["seconds_per_video_minute"] = None
    return row


def _collect(
    run_dir: Path, corpus_root: Path | None = None, manifest_path: Path | None = None
) -> list[dict[str, Any]]:
    manifest = {e.slug: e for e in load_manifest(manifest_path)}
    rows = []
    for vd in sorted(d for d in Path(run_dir).iterdir() if d.is_dir()):
        if not _seed_dirs(vd):
            continue
        rows.append(_video_row(vd, manifest.get(vd.name), corpus_root))
    return rows


_NON_AGGREGATED = ("seeds", "judge_hashes", "judge_models", "generator_models", "has_heatmap")


def _agg_rows(rows: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    return [{k: v for k, v in r.items() if k not in _NON_AGGREGATED} for r in rows]


def _union(rows: Sequence[Mapping[str, Any]], key: str) -> set[str]:
    return {x for r in rows for x in r[key]}


def _integrity_problems(
    base_rows: Sequence[Mapping[str, Any]] | None, cand_rows: Sequence[Mapping[str, Any]]
) -> list[str]:
    problems: list[str] = []
    failed = sum(int(r.get("failed_runs") or 0) for r in cand_rows)
    if failed:
        problems.append(f"{failed} execucao(oes) da candidata falharam (video, seed)")
    judge_errors = sum(int(r.get("judge_errors") or 0) for r in cand_rows)
    if judge_errors:
        problems.append(f"{judge_errors} chamada(s) do juiz falharam na candidata")
    if base_rows is None:
        return problems
    base_by = {r["slug"]: r for r in base_rows}
    cand_by = {r["slug"]: r for r in cand_rows}
    missing = sorted(set(base_by) - set(cand_by))
    if missing:
        problems.append(f"videos da base ausentes na candidata: {missing}")
    for slug in sorted(set(base_by) & set(cand_by)):
        nb, nc = len(base_by[slug]["seeds"]), len(cand_by[slug]["seeds"])
        if nb != nc:
            problems.append(f"{slug}: seeds ok diferentes (base {nb}, candidata {nc})")
    bh, ch = _union(base_rows, "judge_hashes"), _union(cand_rows, "judge_hashes")
    if (bh and ch and bh != ch) or len(bh) > 1 or len(ch) > 1:
        problems.append("judge_prompt_hash difere entre base e candidata (ou dentro de uma execucao)")
    bm, cm = _union(base_rows, "judge_models"), _union(cand_rows, "judge_models")
    if bm and cm and bm != cm:
        problems.append(f"judge_model difere entre base {sorted(bm)} e candidata {sorted(cm)}")
    gens = _union(base_rows, "generator_models") | _union(cand_rows, "generator_models")
    if (bm | cm) & gens:
        problems.append("o modelo juiz e igual ao modelo gerador (spec exige modelos diferentes)")
    return problems


def _fallback_worst(by_format: Mapping[str, Mapping[str, Any]]) -> str | None:
    best: tuple[float, str] | None = None
    for fmt, g in by_format.items():
        if fmt == ALL_GROUP:
            continue
        vals = [g.get(k) for k in ("stability", "judge_pass_rate")]
        nums = [float(v) for v in vals if isinstance(v, (int, float)) and not isinstance(v, bool)]
        if not nums:
            continue
        if best is None or min(nums) < best[0]:
            best = (min(nums), fmt)
    return best[1] if best else None


def _time_violations(rows: Sequence[Mapping[str, Any]]) -> int:
    return sum(
        1 for r in rows if r.get("seconds_max") is not None and r["seconds_max"] > TIME_LIMIT_SECONDS
    )


def _fmt(v: Any) -> str:
    if v is None:
        return "-"
    if isinstance(v, float):
        return f"{v:.3f}"
    return str(v)


def _delta(b: Any, c: Any) -> str:
    if isinstance(b, (int, float)) and isinstance(c, (int, float)):
        return f"{c - b:+.3f}"
    return "-"


def _render_md(report: Mapping[str, Any]) -> str:
    base = report.get("base_by_format")
    cand = report["by_format"]
    decision = report.get("decision")
    worst = (decision["worst_format"] if decision else None) or report.get("fallback_worst_format")
    lines = [f"# Relatorio: {report['variant']}", ""]
    if base is not None:
        lines.append(f"Base: `{report['base_variant']}`  |  Candidata: `{report['variant']}`")
        lines.append("")
    for fmt in [f for f in cand if f != ALL_GROUP] + [ALL_GROUP]:
        title = "Agregado (todos os formatos)" if fmt == ALL_GROUP else f"Formato: {fmt}"
        if fmt == worst:
            title = f"**{title} (PIOR FORMATO)**"
        lines += [f"## {title} ({cand[fmt].get('video_count', 0)} videos)", ""]
        if base is not None:
            lines += ["| metrica | base | candidata | diferenca |", "|---|---|---|---|"]
            for m in DISPLAY_METRICS:
                b = (base.get(fmt) or {}).get(m)
                lines.append(f"| {m} | {_fmt(b)} | {_fmt(cand[fmt].get(m))} | {_delta(b, cand[fmt].get(m))} |")
        else:
            lines += ["| metrica | valor |", "|---|---|"]
            for m in DISPLAY_METRICS:
                lines.append(f"| {m} | {_fmt(cand[fmt].get(m))} |")
        lines.append("")
    lines.append("## Pior formato")
    lines.append("")
    if worst:
        real = bool(decision and decision["worst_format"])
        note = "" if real else " (menor stability/judge_pass_rate; nenhuma piora medida em relacao a base)"
        lines.append(f"**{worst}**{note}")
    else:
        lines.append("Sem dados para escolher o pior formato.")
    lines.append("")
    problems = report.get("integrity_problems") or []
    if problems:
        lines += ["## Problemas de integridade", ""] + [f"- {p}" for p in problems] + [""]
    zero = [v["slug"] for v in report["videos"] if v.get("zero_cut_runs")]
    if zero:
        lines += ["## Videos com execucoes sem cortes", ""] + [f"- {z}" for z in zero] + [""]
    lines += [f"Limite de tempo: {report.get('time_limit_note', '')}.", ""]
    if decision:
        lines.append("## Regra de decisao")
        lines.append("")
        lines.append("**APROVADA**" if decision["passed"] else "**REPROVADA**")
        lines += [f"- {r}" for r in decision["reasons"]]
        lines.append("")
    return "\n".join(lines)


def build_report(
    run_dir: Path,
    *,
    base_dir: Path | None = None,
    corpus_root: Path | None = None,
    manifest_path: Path | None = None,
) -> dict[str, Any]:
    run_dir = Path(run_dir)
    rows = _collect(run_dir, corpus_root, manifest_path)
    by_format = aggregate_by_format(_agg_rows(rows))
    report: dict[str, Any] = {
        "variant": run_dir.name,
        "run_dir": str(run_dir),
        "videos": rows,
        "by_format": by_format,
        "time_limit_violations": _time_violations(rows),
        "time_limit_note": f"limite fixo de {TIME_LIMIT_SECONDS:.0f}s por video (D6), sem escala pela duracao",
        "integrity_problems": _integrity_problems(None, rows),
        "fallback_worst_format": _fallback_worst(by_format),
        "base_variant": None,
        "base_by_format": None,
        "decision": None,
    }
    if base_dir is not None:
        base_rows = _collect(Path(base_dir), corpus_root, manifest_path)
        base_by_format = aggregate_by_format(_agg_rows(base_rows))
        report["integrity_problems"] = _integrity_problems(base_rows, rows)
        report["base_variant"] = Path(base_dir).name
        report["base_by_format"] = base_by_format
        report["decision"] = apply_decision_rule(
            base_by_format,
            by_format,
            time_limit_violations=report["time_limit_violations"],
            integrity_problems=report["integrity_problems"],
        )
    atomic_write_json(run_dir / "report.json", report)
    atomic_write_text(run_dir / "report.md", _render_md(report))
    return report


def _resolve_run(value: str) -> Path:
    p = Path(value)
    if p.is_dir():
        return p
    matches: list[Path] = []
    if RUNS_ROOT.is_dir():
        safe = re.sub(r"[^A-Za-z0-9._-]+", "-", value).strip("-") or "variant"
        pat = re.compile(r"^\d{8}-\d{6}-" + re.escape(safe) + r"(-\d+)?$")
        matches = [m for m in sorted(RUNS_ROOT.iterdir()) if m.is_dir() and pat.match(m.name)]
    if not matches:
        raise FileNotFoundError(f"Run not found for variant or path: {value}")
    return matches[-1]  # timestamp no prefixo: o ultimo e o mais recente


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="evals.report")
    parser.add_argument("--base", help="variante ou caminho da execucao base")
    parser.add_argument("--candidate", required=True, help="variante ou caminho da candidata")
    args = parser.parse_args(argv)
    try:
        cand = _resolve_run(args.candidate)
        base = _resolve_run(args.base) if args.base else None
    except FileNotFoundError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    report = build_report(cand, base_dir=base)
    print(f"Report written to {cand / 'report.md'}")
    decision = report["decision"]
    if decision is not None:
        print("PASSED" if decision["passed"] else "FAILED: " + "; ".join(decision["reasons"]))
        return 0 if decision["passed"] else 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
