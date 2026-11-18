# Harness de avaliação

Mede a qualidade dos cortes num conjunto fixo de vídeos, com o LLM local real. É o critério de pronto de todas as fases a partir da 2.

## Princípios

- Roda só a análise, em cima de transcrições já salvas. Não usa Whisper, yt-dlp nem renderização.
- Fica em `backend/evals/`, fora de `backend/tests/`. O `pytest` não pode coletar nada daqui; confirme o `testpaths` no `pyproject.toml`.
- Nunca escreve em `data/jobs/` real. Cada execução usa um diretório de dados temporário.
- Mede propriedades dos cortes. Não existe "o corte certo" para comparar.

## Estrutura

```
backend/evals/
  __init__.py
  corpus.manifest.json        # versionado
  corpus/<slug>/              # fora do git
    transcription.words.json
    transcription.segments.json
    source.info.json          # opcional: título, capítulos, heatmap
    labels.json               # opcional: gabarito leve
  runs/<data>-<variant>/      # fora do git
    <slug>/<seed>/cuts.json
    <slug>/<seed>/trace.json
    report.json
    report.md
  import_job.py
  run.py
  metrics.py
  judge.py
  report.py
```

Acrescentar `backend/evals/corpus/*/` e `backend/evals/runs/` ao `.gitignore`. As transcrições são de vídeos de terceiros e não entram no repositório.

## Corpus

`corpus.manifest.json`:

```json
{
  "videos": [
    {
      "slug": "podcast-2p-longo",
      "format": "entrevista",
      "language": "pt",
      "duration_seconds": 3720,
      "split": "dev",
      "source": "URL ou descrição do arquivo local"
    }
  ]
}
```

- `format` é um rótulo livre usado só para agrupar a tabela. Não entra em nenhum prompt e não é lido pelo pipeline.
- `split`: `dev` (ajuste) ou `holdout` (reserva). Cerca de um terço fica em `holdout`.
- De 10 a 15 vídeos, cobrindo pelo menos: entrevista com 2 pessoas, monólogo longo, lista/roundup, tutorial com tela, vlog, gameplay ou reação, vídeo curto (< 3 min), vídeo longo (> 60 min), um vídeo em outro idioma, um com áudio ruim.

`import_job.py` copia os artefatos de transcrição de um job existente:

```
python -m evals.import_job <job_id> --slug <slug> --format <rótulo> --split dev
```

## Gabarito leve (`labels.json`)

Opcional, recomendado para pelo menos 5 vídeos. Marcado uma vez por uma pessoa.

```json
{
  "must":  [{"start": 312.0, "end": 371.5, "note": "história do primeiro emprego"}],
  "never": [{"start": 0.0,   "end": 24.0,  "note": "vinheta e patrocínio"}]
}
```

## Execução

```
python -m evals.run --split dev --variant v1-baseline --seeds 3
python -m evals.run --split dev --variant v2 --pipeline v2 --seeds 3
python -m evals.report --base v1-baseline --candidate v2
```

- `--pipeline` define `llm.analysis_pipeline` só para a execução.
- `--seeds N` roda cada vídeo N vezes com seeds diferentes.
- Cada execução grava em `trace.json`: modelo, hash de cada prompt, número de chamadas, tokens, tempo por etapa e tempo total.
- `--split holdout` exige a flag `--i-am-at-a-phase-gate`, para não ser rodado por engano.

## Métricas

Todas são calculadas por vídeo e depois agregadas por `format`.

### Estabilidade

Para cada par de seeds do mesmo vídeo:

1. Casar cortes de A com cortes de B, guloso, por maior IoU temporal, exigindo IoU ≥ 0,5. Cada corte casa no máximo uma vez.
2. `F1 = 2 · casados / (|A| + |B|)`. Se os dois conjuntos são vazios, `F1 = 1`.

A estabilidade do vídeo é a média do F1 entre todos os pares.

### Jitter de borda

Nos cortes casados: média de `|Δinício|` e de `|Δfim|`, em segundos.

### Validade estrutural

- `starts_on_sentence`: fração de cortes cujo início está a até 0,3 s do início de uma frase.
- `ends_on_sentence`: idem para o fim.
- `duration_p10 / p50 / p90`.
- `coverage`: soma das durações dividida pela duração falada do vídeo.
- `max_overlap_iou`: maior IoU entre dois cortes do mesmo conjunto.
- `cut_count`.

As frases de referência vêm de `v2/sentences.py`, inclusive para avaliar a v1. Até a fase 2 existir, a referência são os limites de segmento do Whisper.

### Juiz

Um LLM local vê apenas o texto do corte, sem contexto do vídeo, e responde:

| Campo | Pergunta |
|---|---|
| `understandable` | Alguém que não viu o resto do vídeo entende do que se trata? |
| `complete` | O trecho termina o raciocínio que começou? |
| `single_subject` | O trecho trata de um assunto só? |
| `is_promo` | O trecho é principalmente anúncio, patrocínio ou aviso do canal? |

- `judge_pass` do corte: `understandable ∧ complete ∧ single_subject ∧ ¬is_promo`.
- `judge_pass_rate`: fração de cortes que passam.
- O prompt do juiz é **congelado** em `judge.py`. Alterá-lo exige nova entrada em `decisions.md` e refazer o baseline.
- O juiz usa um modelo diferente do gerador (`--judge-model`), `temperature=0`, seed fixo. Como o gerador é o Qwen3 14B (D15), o juiz inicial é um Gemma de 12B, com o Phi-4 14B como alternativa (D17). Os dois modelos se revezam na GPU: primeiro todos os cortes são gerados, depois todos são julgados.

### Gabarito (quando há `labels.json`)

- `must_recall`: fração das faixas `must` em que algum corte cobre ≥ 60% da faixa.
- `never_violations`: número de cortes que sobrepõem uma faixa `never` por mais de 3 s.

### Custo

- `llm_calls`, `tokens_in`, `tokens_out`, `seconds_total`, e `seconds_per_video_minute`.

## Relatório

`report.md` traz uma tabela por `format`, com a variante base e a candidata lado a lado, e a diferença. Sempre inclui a linha do pior formato em destaque.

## Regra de decisão

Uma variante candidata **passa** em relação à base quando, no split avaliado, todas as condições valem:

1. Em **cada** `format`: `stability` e `judge_pass_rate` não caem mais que 0,02.
2. No agregado: pelo menos uma entre `stability` e `judge_pass_rate` sobe 0,05 ou mais.
3. `starts_on_sentence` e `ends_on_sentence` ≥ 0,95.
4. `never_violations = 0` e `must_recall` não cai.
5. Nenhum vídeo passa do limite de tempo de `decisions.md` D6.

Os limiares são valores iniciais. Mudá-los exige entrada em `decisions.md`.

## Quando rodar

| Momento | Split |
|---|---|
| Durante o desenvolvimento de uma fase | `dev` |
| Portão das fases 2, 3 e 4 | `dev` e `holdout` |
| Fases 5 a 8 | `dev`; `holdout` antes de virar padrão |

## Limites conhecidos

- O juiz é um modelo local pequeno e erra. Ele serve para comparar variantes, não como verdade absoluta. Por isso existe o gabarito leve.
- Estabilidade alta não significa qualidade: um pipeline que sempre devolve o vídeo inteiro é perfeitamente estável. Leia sempre junto com `coverage`, duração e juiz.
- Análise só por texto: o harness não mede cortes cujo valor é visual até a fase 6.
