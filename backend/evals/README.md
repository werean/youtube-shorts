# Eval harness

Measures cut quality on a fixed set of saved transcriptions. Spec: `docs/analysis-v2/eval-harness.md`.
Run everything from `backend/` (`python -m evals.<module>`). Not collected by `pytest`.
Reference sentence boundaries for the report (`starts_on_sentence`, `ends_on_sentence`, spoken duration) come from
`app.domain.analysis.v2.sentences.build_sentences` run over the corpus `transcription.words.json`, falling back to
`transcription.segments.json` (one sentence per segment) when a video has no words.

## Steps

1. Import a job's transcription (read-only on the job):
   `python -m evals.import_job <job_id> --slug <slug> --format <label> --split dev|holdout [--language pt] [--source "..."]`
   Files go to `evals/corpus/<slug>/` (git-ignored) and the entry is upserted in `corpus.manifest.json`.
   Optional `labels.json` per video: `{"must": [{"start":..,"end":..}], "never": [...]}`.
2. Generate (NEEDS the real local LLM, run on the owner's PC):
   `python -m evals.run --split dev --variant v1-baseline --seeds 3`
   `--split holdout` requires `--i-am-at-a-phase-gate`. Seed i uses `analysis_seed = base_seed + i` (`--base-seed`, default 42).
   Output: `runs/<YYYYMMDD-HHMMSS>-<variant>/<slug>/<analysis_seed>/{cuts.json,trace.json}`.
3. Judge (NEEDS the real local LLM, a different model, after generation finishes):
   `python -m evals.judge --run runs/<run> --judge-model <model>`
4. Report: `python -m evals.report --base <variant|path> --candidate <variant|path>`

## Isolation

Each (video, seed) runs in a fresh temp dir (`evalrun-*`) with its own `data/`, media and project root.
`YTS_DATA_DIR`, `YTS_MEDIA_BASE_DIR`, `YTS_PROJECT_ROOT`, the path/settings overrides and the container
override are redirected and restored in `finally`; config caches are invalidated on entry and exit.
The run aborts (exit 3) if the jobs dir resolves inside the repository `data/`. The tuning config of the
run is the app defaults plus `llm.analysis_seed` (and `llm.model`, `llm.analysis_pipeline`), written only
to the temp `custom_settings.json`; the user's own `custom_settings.json` is NOT applied.

## trace.json

Observed from outside by wrapping the HTTP layer: model, `llm_calls`, `embedding_calls`, tokens in/out
(from the response `usage` / `prompt_eval_count` / `eval_count`; otherwise estimated at ~3 chars/token and
`tokens_estimated: true`), prompt hashes (sha256 prefix of system and user text of each chat call),
seconds per stage (`segmentation`, `analysis`), `seconds_total`, `seconds_per_video_minute`, `error`.
Not observable without editing `backend/app`: per-phase timing inside the analysis (4A/4B/4C) and the
prompt template identity beyond the hashes (`null`/absent). `llm.analysis_pipeline` is written to the
temp config and read by `analyze_job` (`"v2"` dispatches to `analyze_job_v2`; absent or `"v1"` keeps the v1 path).

## Presets (`--preset`)

`python -m evals.run --split dev --variant <label> --preset <name> --model <model>` writes the preset's `llm`
overrides into the temporary configuration only (applied after `--pipeline`, so a preset wins). The preset name and
the resolved overrides are recorded in `run.json`, in every `trace.json` and in every `cuts.json`. An unknown preset
exits with code 2 before anything runs. `--pipeline v1|v2` keeps working on its own. Presets live in `evals/variants.py`.

| Preset | `llm.analysis_pipeline` | `llm.analysis_v2` |
|---|---|---|
| `v1` | `v1` | (absent) |
| `v2` | `v2` | `brief: provisional`, `units: topics`, `refine_boundaries: false` (the phase-2 slice) |
| `v2-brief` | `v2` | as `v2`, with `brief: llm` |
| `v2-units` | `v2` | as `v2-brief`, with `units: llm` |
| `v2-bounds` | `v2` | as `v2-units`, with `refine_boundaries: true` (the full pipeline) |
| `v2-noemb` | `v2` | as `v2-bounds`, with `topic_embeddings: false` |
| `v2-think` | `v2` | as `v2-bounds`, with `reasoning_stages: ["scoring", "refine"]` (D16: reasoning on for S4/S5 only; their `max_tokens` are multiplied by `REASONING_MAX_TOKENS_MULTIPLIER`) |
| `v2-derived` | `v2` | as `v2-bounds`, with `derive_legacy_artifacts: true` (`semantic.blocks.json` and `topic.segments.json` derived from sentences and units; the v1 builders are not called by the pipeline) |

Order of comparison (phase-3.md): `v2` is the base; `v2-brief` against `v2` (3a); `v2-units` against `v2-brief` (3b);
`v2-bounds` against `v2-units` (3c); `v2-noemb` against `v2-bounds` (3d). One piece per measurement, never two at once. `v2-think` and `v2-derived` (phase 4) are each compared against `v2-bounds`, outside that chain.
With `topic_embeddings: false` the prebuild of topics inside `evals.run` also skips embeddings, so the ablation measures
what it says.

## Fase 4

Comparing models: run the same preset once per model with a distinct `--variant` label, for example
`python -m evals.run --split dev --variant qwen3-14b-bounds --preset v2-bounds --model qwen3:14b`, then the same
command with `--model` and `--variant` changed for each candidate. A preset never carries `model`: overrides are
applied after `--model`, so a model in a preset would silently win over the flag. Each run is a separate directory
and `run.json` records the model.

Presets for the phase-4 gate (all measured against `v2-bounds`, one change at a time): `v2-think` (reasoning on in
S4/S5) and `v2-derived` (artifacts derived from sentences and units). `v2-derived` changes which blocks the cuts' `block_ids` point to and what is written to `semantic.blocks.json` /
`topic.segments.json`. It is not a strictly one-change comparison: S2 falls back to typical-duration units when a window
fails (v2-bounds falls back to units built from the v1 topics), so whenever `s2_meta.fallback_windows > 0` the units,
candidates and selection can differ too; read `s2_meta` of both runs before comparing selection metrics. Note that
`evals.run` still prebuilds the v1 topics before the pipeline starts (its time counts in the harness), and the
pipeline then overwrites both files.

Known behaviour with `derive_legacy_artifacts` (kept for the default-switch step): the files stay on disk after the
toggle is turned off, and a later v1 run reuses them (they are non-empty) with empty `signal_tags`; the 1-click
orchestrator and `POST /jobs/:id/blocks` still build the v1 blocks first and the v2 run overwrites them; an empty
transcription writes no derived files; the frontend shows fewer, longer blocks per cut (`ShortInspectorView.tsx`).

## Fase 5

Parte A (sinal de audiencia). Presets `v2-audience-tiebreak` e `v2-audience-bonus`: o pipeline completo
(`v2-bounds`) mais `analysis_v2.audience_signal` = `tiebreak` (a intensidade media do heatmap desempata depois de
`has_payoff` e antes do corte mais cedo) ou `bonus` (alem disso soma ate `AUDIENCE_BONUS_MAX_POINTS` ao score, sem
nunca passar um candidato de interesse maior e sem resgatar quem reprovou nos portoes). Ambos sao medidos contra
`v2-bounds`. `trace.json` e as linhas do relatorio ganham `has_heatmap` (o `source.info.json` do corpus traz o campo
`heatmap`; videos sem ele seguem exatamente o caminho "off"). Para medir "must_recall sobe nos videos com heatmap e
nada piora nos sem", separe as linhas por `has_heatmap`. Presenca e formato do campo do yt-dlp ainda nao foram
verificados em videos reais; ate la a chave `audience_signal` fica desligada por padrao.

## Fase 6

Preset `v2-vision`: o pipeline completo (`v2-bounds`) mais `analysis_v2.vision` = true. Mede-se contra `v2-bounds`.
A etapa so age quando ha `llm.vision_model` configurado, o arquivo do video de origem existe e ha candidato elegivel
(`depends_on_visuals` com interesse >= 3, ou video com pouca fala); caso contrario ela e pulada com aviso no log do
job e `candidates.scored.json` traz `vision.skipped` com o motivo. Pendencias do harness, fora do escopo desta entrega:
`evals.run` ainda nao tem flag `--vision-model` (a chave precisa estar no `llm` da configuracao temporaria) e o corpus
guarda so transcricoes, nao o video, entao a etapa fica pulada ate o dono fornecer os videos.

O juiz congelado le so texto: ele NAO consegue medir esta fase. Medir exige uma nova versao do juiz que receba a
descricao visual do corte (`vision.answers` em `candidates.scored.json`), uma nova entrada em `decisions.md` e um novo
baseline (phase-6.md, "Limite conhecido"). Ate la, `v2-vision` serve para conferir que nada muda nos formatos falados
(a etapa quase nao e acionada) e para ler as descricoes a olho.

## Fase 7

Preset `v2-examples`: o pipeline completo (`v2-bounds`) mais `analysis_v2.scoring_examples` = 6 (seis decisoes passadas
do dono no prompt de S4, metade mantidas, metade rejeitadas, de OUTROS videos; escolha por recencia, ver
`app/domain/analysis/v2/examples.py`). Mede-se contra `v2-bounds`; a regra de decisao do harness decide se os exemplos
ficam ligados.

O harness nunca le o `data/analysis_history.json` real. O preset exige `--history <arquivo>`; sem ele a execucao falha
logo (exit 2) com uma mensagem. O arquivo e validado e COPIADO para o `data/` temporario de cada execucao. Os videos do
corpus nao podem estar nesse historico (phase-7.md): o harness recusa o arquivo se algum `job_id` contiver o slug de um
video do manifest. Gere o historico com `python -m app.domain.analysis.v2.history --rebuild` num `data/` que nao tenha os
videos do corpus, ou filtre as entradas. Entradas de tentativas arquivadas nao trazem texto e nao viram exemplo.

`python -m evals.run --split dev --variant v2-examples --preset v2-examples --history <arquivo> --model <modelo>`
