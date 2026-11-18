# Fase 3 — Brief do vídeo, unidades por LLM, refino de borda

## Objetivo

Substituir as três peças provisórias da fase 2 pelas definitivas. Com isso a v2 deixa de depender dos tópicos e das listas léxicas da v1 para decidir cortes.

## Depende de

- Fase 2 concluída.

## Leitura obrigatória

- [pipeline-v2.md](../pipeline-v2.md): S1, S2, S5.
- [stage-contracts.md](../stage-contracts.md): S1, S2, S5.

## Ordem de trabalho

As três peças entram uma por vez, cada uma comparada no harness contra a variante anterior. Não junte duas na mesma medição.

| Passo | Variante | Troca |
|---|---|---|
| 3a | `v2-brief` | Brief e outline por LLM no lugar do brief provisório |
| 3b | `v2-units` | Unidades por LLM no lugar dos tópicos da v1 |
| 3c | `v2-bounds` | Refino de borda antes do snap |
| 3d | `v2-noemb` | Igual à 3c, com embeddings desligados |

Uma peça que não melhora nem mantém a tabela não entra. Registre o resultado em `decisions.md` em qualquer dos casos.

## Entregas

1. **`brief.py`** (S1): map, reduce, caso de vídeo curto, limites em código para `unit_seconds`, brief mínimo quando a chamada falha.
2. **`units.py`** (S2): janelas com sobreposição, junção, fallback por janela.
3. **`boundaries.py`** (S5): escolha de início e de fim, validação de duração, repontuação quando a borda muda 2 frases ou mais, reversão quando os portões deixam de passar.
4. **`pipeline.py`** atualizado para a ordem S0 → S1 → S2 → S3 → S4 → S5 → S6.
5. **Ablação de embeddings (3d)**: executar a v2 com a segmentação de tópicos sem embeddings e comparar. Decisão registrada em D9.
6. **Revisão de D14** com os dados do harness: quantos vídeos caem no caso de nenhum corte atingir a nota mínima.

## Arquivos

Pode criar e alterar:

- `backend/app/domain/analysis/v2/**`
- `backend/app/application/job_lifecycle.py` (se faltar algum load/save)
- `backend/tests/test_analysis_v2_*.py`
- `docs/analysis-v2/decisions.md`

Não pode alterar: módulos da v1, rotas, `frontend/`, `shared/`.

## Fora de escopo

- Remover a v1 ou trocar o padrão (fase 4).
- Trocar o modelo de LLM (fase 4).

## Testes

Mockados:

- S1: limites de `unit_seconds` para valores absurdos; brief mínimo em falha; vídeo curto faz uma chamada só.
- S2: invariantes de cobertura; junção na sobreposição; primeira frase da janela sempre inicia unidade; fallback de uma janela não afeta as outras.
- S5: borda fora da duração é rejeitada; borda que invade `non_content` é rejeitada; repontuação acontece só a partir de 2 frases; reversão quando os portões falham.
- Os schemas enviados em S2 e S5 contêm `enum` com exatamente os IDs válidos.
- O brief e os prompts não contêm lista fechada de gêneros (teste de texto sobre `prompts.py`).

## Critério de pronto

1. `pytest` verde.
2. A variante final passa na regra de decisão contra a `v2` da fase 2, em `dev` e `holdout`.
3. No gabarito, `must_recall` não cai e `never_violations = 0`.
4. Jitter de borda não aumenta em relação à fase 2.
5. Vídeo de 60 min do corpus dentro do limite de D6.
6. A v2 não importa nada de `semantic_blocks.py`, `topic_segmentation.py` ou `lookaround.py` além de `compute_temporal_iou`, exceto no fallback de S2.
7. Revisão aprovada.

## Modelos

Implementação e testes: Sonnet. Prompts e schemas de S1, S2 e S5: Fable. Revisão: Opus.

## Risco principal

Um brief errado contamina S2. A proteção é que os portões de S4 julgam o texto do corte e não dependem de o brief estar certo. Na revisão, confira `video.brief.json` de pelo menos um vídeo por formato.
