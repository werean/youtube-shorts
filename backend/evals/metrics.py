"""Metricas puras do harness de avaliacao (sem I/O, sem imports do app).

Spec: docs/analysis-v2/eval-harness.md (secoes "Metricas" e "Regra de decisao").

Decisoes de borda que a spec nao fixa:
- Corte degenerado (end <= start): IoU com qualquer corte e 0.0, nunca casa, e e
  ignorado nas metricas estruturais (duracao, cobertura, sobreposicao, bordas).
  `cut_count` conta todos os cortes recebidos.
- Percentis usam interpolacao linear; sem cortes validos viram None.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from itertools import combinations
from typing import Any, Mapping, Sequence

# --- Limiares da regra de decisao (eval-harness.md, "Regra de decisao") ---
# Condicao 1: queda maxima tolerada por format em stability e judge_pass_rate.
MAX_PER_FORMAT_DROP = 0.02
# Condicao 2: ganho minimo no agregado em stability OU judge_pass_rate.
MIN_AGGREGATE_GAIN = 0.05
# Condicao 3: validade de frase minima para inicio e fim.
MIN_SENTENCE_VALIDITY = 0.95
# Condicao 4: never_violations deve ser 0.
MAX_NEVER_VIOLATIONS = 0
# Gabarito leve (eval-harness.md, "Gabarito"): cobertura minima da faixa must e
# sobreposicao maxima tolerada (s) com faixa never.
MUST_COVERAGE_FRACTION = 0.60
NEVER_OVERLAP_SECONDS = 3.0

_EPS = 1e-9
ALL_GROUP = "__all__"


@dataclass(frozen=True)
class CutSpan:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def valid(self) -> bool:
        return self.end > self.start


def _overlap(a: CutSpan, b: CutSpan) -> float:
    return max(0.0, min(a.end, b.end) - max(a.start, b.start))


def temporal_iou(a: CutSpan, b: CutSpan) -> float:
    if not a.valid or not b.valid:
        return 0.0
    inter = _overlap(a, b)
    if inter <= 0.0:
        return 0.0
    union = a.duration + b.duration - inter
    return inter / union if union > 0 else 0.0


def match_cuts(
    a: Sequence[CutSpan], b: Sequence[CutSpan], *, iou_threshold: float = 0.5
) -> list[tuple[int, int, float]]:
    """Casamento guloso por maior IoU; cada corte casa no maximo uma vez."""
    pairs: list[tuple[float, int, int]] = []
    for i, ca in enumerate(a):
        for j, cb in enumerate(b):
            iou = temporal_iou(ca, cb)
            if iou > 0.0 and iou >= iou_threshold - _EPS:
                pairs.append((iou, i, j))
    pairs.sort(key=lambda p: (-p[0], p[1], p[2]))
    used_a: set[int] = set()
    used_b: set[int] = set()
    out: list[tuple[int, int, float]] = []
    for iou, i, j in pairs:
        if i in used_a or j in used_b:
            continue
        used_a.add(i)
        used_b.add(j)
        out.append((i, j, iou))
    out.sort(key=lambda m: (m[0], m[1]))
    return out


def stability_f1(
    a: Sequence[CutSpan], b: Sequence[CutSpan], *, iou_threshold: float = 0.5
) -> float:
    total = len(a) + len(b)
    if total == 0:
        return 1.0
    matched = len(match_cuts(a, b, iou_threshold=iou_threshold))
    return 2.0 * matched / total


def stability_across_runs(
    runs: Sequence[Sequence[CutSpan]], *, iou_threshold: float = 0.5
) -> float | None:
    # Fewer than 2 runs: no seed pair exists, stability is undefined (not perfect).
    if len(runs) < 2:
        return None
    scores = [
        stability_f1(x, y, iou_threshold=iou_threshold) for x, y in combinations(runs, 2)
    ]
    return sum(scores) / len(scores)


def boundary_jitter(
    a: Sequence[CutSpan], b: Sequence[CutSpan], *, iou_threshold: float = 0.5
) -> dict[str, float | None]:
    matches = match_cuts(a, b, iou_threshold=iou_threshold)
    if not matches:
        return {"start": None, "end": None}
    n = len(matches)
    return {
        "start": sum(abs(a[i].start - b[j].start) for i, j, _ in matches) / n,
        "end": sum(abs(a[i].end - b[j].end) for i, j, _ in matches) / n,
    }


def _percentile(sorted_values: Sequence[float], q: float) -> float | None:
    if not sorted_values:
        return None
    if len(sorted_values) == 1:
        return float(sorted_values[0])
    pos = (len(sorted_values) - 1) * q
    lo = int(math.floor(pos))
    hi = int(math.ceil(pos))
    frac = pos - lo
    return float(sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * frac)


def _near_any(value: float, refs: Sequence[float], tol: float) -> bool:
    return any(abs(value - r) <= tol + _EPS for r in refs)


def structural_metrics(
    cuts: Sequence[CutSpan],
    *,
    sentence_starts: Sequence[float],
    sentence_ends: Sequence[float],
    spoken_duration: float,
    tolerance: float = 0.3,
) -> dict[str, float | int | None]:
    valid = [c for c in cuts if c.valid]
    n = len(valid)
    durations = sorted(c.duration for c in valid)
    starts_frac: float | None = None
    ends_frac: float | None = None
    if n:
        starts_frac = sum(1 for c in valid if _near_any(c.start, sentence_starts, tolerance)) / n
        ends_frac = sum(1 for c in valid if _near_any(c.end, sentence_ends, tolerance)) / n
    max_iou = 0.0
    for x, y in combinations(valid, 2):
        max_iou = max(max_iou, temporal_iou(x, y))
    return {
        "starts_on_sentence": starts_frac,
        "ends_on_sentence": ends_frac,
        "duration_p10": _percentile(durations, 0.10),
        "duration_p50": _percentile(durations, 0.50),
        "duration_p90": _percentile(durations, 0.90),
        "coverage": (sum(durations) / spoken_duration) if spoken_duration > 0 else None,
        "max_overlap_iou": max_iou,
        "cut_count": len(cuts),
    }


def label_metrics(
    cuts: Sequence[CutSpan], *, must: Sequence[CutSpan], never: Sequence[CutSpan]
) -> dict[str, float | int | None]:
    valid_must = [m for m in must if m.valid]
    must_recall: float | None = None
    if valid_must:
        hit = sum(
            1
            for m in valid_must
            if any(
                c.valid and _overlap(c, m) / m.duration >= MUST_COVERAGE_FRACTION - _EPS
                for c in cuts
            )
        )
        must_recall = hit / len(valid_must)
    violations = sum(
        1
        for c in cuts
        if c.valid and any(_overlap(c, nv) > NEVER_OVERLAP_SECONDS + _EPS for nv in never)
    )
    return {"must_recall": must_recall, "never_violations": violations}


def _is_number(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(float(v))


def aggregate_by_format(per_video: Sequence[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    """Agrupa por row["format"] (ausente -> "unknown"), media ignorando None, mais "__all__".

    Cada grupo ganha `video_count`. Chave sem nenhum valor numerico -> None;
    chaves textuais (slug etc.) nao sao agregadas.
    """
    groups: dict[str, list[Mapping[str, Any]]] = {}
    for row in per_video:
        groups.setdefault(str(row.get("format") or "unknown"), []).append(row)

    def mean_group(rows: Sequence[Mapping[str, Any]]) -> dict[str, Any]:
        keys: list[str] = []
        for r in rows:
            for k in r:
                if k != "format" and k not in keys:
                    keys.append(k)
        out: dict[str, Any] = {}
        for k in keys:
            vals = [float(r[k]) for r in rows if _is_number(r.get(k))]
            textual = any(r.get(k) is not None and not _is_number(r.get(k)) for r in rows)
            if vals:
                out[k] = sum(vals) / len(vals)
            elif not textual:
                out[k] = None
        out["video_count"] = len(rows)
        return out

    result = {name: mean_group(rows) for name, rows in sorted(groups.items())}
    result[ALL_GROUP] = mean_group(list(per_video))
    return result


def _num(group: Mapping[str, Any] | None, key: str) -> float | None:
    if not group:
        return None
    v = group.get(key)
    return float(v) if _is_number(v) else None


def _label(fmt: str) -> str:
    return "agregado" if fmt == ALL_GROUP else f"format '{fmt}'"


def apply_decision_rule(
    base: Mapping[str, Mapping[str, Any]],
    candidate: Mapping[str, Mapping[str, Any]],
    *,
    time_limit_violations: int = 0,
    integrity_problems: Sequence[str] = (),
) -> dict[str, Any]:
    """As 5 condicoes de "Regra de decisao" (eval-harness.md).

    Decisoes de borda: format presente so na base reprova (nao da para provar que nao
    piorou); format so na candidata nao tem base e nao entra na condicao 1. Na condicao 1,
    metrica com valor na base e None na candidata reprova (nao da para verificar que nao
    caiu); None na base e ignorado. None em starts/ends_on_sentence ou nas duas metricas
    da condicao 2 reprova. ``integrity_problems`` (execucoes falhas, videos ou seeds
    faltando, juiz incompativel) reprovam sempre, como condicao [0].
    """
    reasons: list[str] = []
    guarded = ("stability", "judge_pass_rate")
    worst_format: str | None = None
    worst_delta = 0.0

    # 0. integridade da comparacao
    reasons.extend(f"[0] {p}" for p in integrity_problems)

    # 1. nenhum format piora mais que MAX_PER_FORMAT_DROP
    for fmt in sorted(k for k in base if k != ALL_GROUP):
        if fmt not in candidate:
            reasons.append(f"[1] format '{fmt}' existe na base mas nao na candidata")
            continue
        for key in guarded:
            b, c = _num(base[fmt], key), _num(candidate[fmt], key)
            if b is None:
                continue
            if c is None:
                reasons.append(f"[1] format '{fmt}': {key} indisponivel na candidata (base {b:.3f})")
                continue
            delta = c - b
            if delta < worst_delta - _EPS or (worst_format is None and delta < 0):
                worst_delta, worst_format = delta, fmt
            if delta < -MAX_PER_FORMAT_DROP - _EPS:
                reasons.append(
                    f"[1] format '{fmt}': {key} caiu {-delta:.3f} (limite {MAX_PER_FORMAT_DROP})"
                )

    for key in guarded:
        if _num(base.get(ALL_GROUP), key) is not None and _num(candidate.get(ALL_GROUP), key) is None:
            reasons.append(f"[1] {key} indisponivel na candidata no agregado")

    # 2. ganho no agregado
    gains = []
    for key in guarded:
        b, c = _num(base.get(ALL_GROUP), key), _num(candidate.get(ALL_GROUP), key)
        if b is not None and c is not None:
            gains.append(c - b)
    if not gains or max(gains) < MIN_AGGREGATE_GAIN - _EPS:
        reasons.append(
            f"[2] nem stability nem judge_pass_rate subiu {MIN_AGGREGATE_GAIN} no agregado"
        )

    # 3. validade de frase (agregado e cada format da candidata)
    for key in ("starts_on_sentence", "ends_on_sentence"):
        for fmt in sorted(candidate):
            v = _num(candidate[fmt], key)
            if v is None:
                reasons.append(f"[3] {key} indisponivel em {_label(fmt)}")
            elif v < MIN_SENTENCE_VALIDITY - _EPS:
                reasons.append(f"[3] {key}={v:.3f} em {_label(fmt)} (minimo {MIN_SENTENCE_VALIDITY})")

    # 4. never_violations = 0 e must_recall nao cai
    for fmt in sorted(candidate):
        nv = _num(candidate[fmt], "never_violations")
        if nv is not None and nv > MAX_NEVER_VIOLATIONS + _EPS:
            reasons.append(f"[4] never_violations medio {nv:.3f} > 0 em {_label(fmt)}")
    mb = _num(base.get(ALL_GROUP), "must_recall")
    mc = _num(candidate.get(ALL_GROUP), "must_recall")
    if mb is not None and mc is not None and mc < mb - _EPS:
        reasons.append(f"[4] must_recall caiu de {mb:.3f} para {mc:.3f}")

    # 5. limite de tempo (decisions.md D6)
    if time_limit_violations > 0:
        reasons.append(f"[5] {time_limit_violations} video(s) acima do limite de tempo (D6)")

    return {"passed": not reasons, "reasons": reasons, "worst_format": worst_format}
