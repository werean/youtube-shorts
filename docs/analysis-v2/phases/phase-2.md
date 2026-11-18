# Fase 2 — v2 mínima: frases, pontuação por candidato, seleção

## Objetivo

Entregar a menor fatia da v2 que já troca "nota dada pela mesma chamada que propôs o corte" por "pontuação um candidato por vez, com nota mínima". Nesta fase as unidades ainda vêm dos tópicos da v1.

## Depende de

- Fase 1 concluída, com baseline registrado.

## Leitura obrigatória

- [pipeline-v2.md](../pipeline-v2.md): S0, S3, S4, S6, Compatibilidade, Configuração, Falhas.
- [stage-contracts.md](../stage-contracts.md): S0, S3, S4, S6.

## Entregas

1. **Pacote `backend/app/domain/analysis/v2/`** com `constants.py`, `sentences.py`, `candidates.py`, `scoring.py`, `selection.py`, `pipeline.py`, `prompts.py`.
2. **S0** completo, gravando `sentences.json`.
3. **Unidades provisórias**: cada `TopicSegment` de `topic.segments.json` vira uma unidade, com as bordas ajustadas ao limite de frase mais próximo. `topic_type == "ad_span"` vira `non_content`. Gravar `units.json` no formato final.
4. **Brief provisório**: sem LLM. `unit_seconds = 20 / 60 / 120`, demais campos vazios. Gravar `video.brief.json` no formato final.
5. **S3** completo, incluindo a chamada de sub-trecho para unidade longa.
6. **S4** completo, incluindo fusão guiada por defeito.
7. **S6** completo, gravando `candidates.scored.json` e `cuts.suggested.json`. Sem S5: as bordas são as do candidato, seguidas do snap acústico.
8. **Despacho**: `analyze_job` chama `analyze_job_v2` quando `llm.analysis_pipeline == "v2"`. `normalize_llm_config` preserva `analysis_pipeline` e `analysis_min_interest`.
9. **Progresso**: mensagens de etapa publicadas dentro do status `ANALYZING`.

## Arquivos

Pode criar e alterar:

- `backend/app/domain/analysis/v2/**`
- `backend/app/domain/analysis/narrative_miner.py` (só o despacho em `analyze_job`)
- `backend/app/domain/analysis/__init__.py` (exports)
- `backend/app/core/tool_configs.py` (preservar as chaves novas)
- `backend/app/application/job_lifecycle.py` (caminhos e load/save dos artefatos novos)
- `backend/tests/test_analysis_v2_*.py` (novos)

Não pode alterar: `semantic_blocks.py`, `topic_segmentation.py`, `lookaround.py`, `rms_snap.py`, rotas, `frontend/`, `shared/`.

## Fora de escopo

- Brief por LLM, unidades por LLM e refino de borda (fase 3).
- Remover qualquer coisa da v1.
- Trocar o padrão para `v2`.

## Testes

Mockados, com LLM falso que devolve respostas definidas na fixture:

- Invariantes de S0 em transcrições sintéticas: com pontuação, sem pontuação, em um idioma que não seja PT nem EN, com uma frase de 60 s sem pausa.
- S3: unidade curta não vira candidato sozinha; unidade longa aciona sub-trecho; `non_content` nunca entra.
- S4: cálculo de `gates_ok` e `score`; fusão para trás e para a frente; no máximo uma fusão por lado; falha numa chamada descarta só aquele candidato.
- S6: invariantes de `stage-contracts.md`; regra D14 quando ninguém atinge a nota mínima.
- Despacho: com a chave ausente ou `"v1"`, o comportamento é idêntico ao anterior.
- O schema enviado ao LLM em S3 e S4 contém `enum` com exatamente os IDs válidos.

## Critério de pronto

1. `pytest` verde.
2. No harness, `v2` contra `v1-baseline` em `dev` e `holdout` passa na regra de decisão de `eval-harness.md`.
3. `starts_on_sentence` e `ends_on_sentence` ≥ 0,95.
4. `coverage` cai em relação ao baseline nos formatos em que a v1 particionava o vídeo. Se não cair, a nota mínima não está selecionando e a fase não está pronta.
5. Tempo dentro do limite de D6 no vídeo mais longo do corpus.
6. Revisão aprovada.

Se o item 2 falhar depois de duas rodadas de ajuste de prompt, pare e leve a tabela ao dono do projeto. Não acrescente regras para compensar.

## Modelos

Implementação e testes: Sonnet. Prompts e schemas de S3 e S4: Fable. Revisão: Opus.
