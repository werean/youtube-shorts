# Fase 4 — Escolha de modelo, v2 como padrão, remoção do legado

> Detalhamento resumido. Antes de começar, o orquestrador completa este arquivo com os números do harness da fase 3.

## Objetivo

Escolher o modelo local pelo harness, tornar a v2 o pipeline padrão e remover o código da v1 que ela substitui.

## Depende de

- Fase 3 concluída.

## Entregas

1. **Comparação de modelos**: rodar a v2 em `dev` com o Qwen3 14B (modelo fixo, D15) contra os candidatos de D17: um Gemma de 12B, o Phi-4 14B e o `qwen2.5:14b`. Todos inteiros nos 12 GB (D7). Escolher pela tabela e pelo tempo. Confirmar no `holdout` só o escolhido.
2. **Variante com raciocínio (D16)**: Qwen3 14B com raciocínio ligado só em S4 e S5. Entra se passar na regra de decisão e couber em D6; nesse caso, rever `max_tokens` dessas etapas.
3. **Contexto**: permanece 8192. Contextos maiores foram medidos e descartados (D18); não há variante de contexto nesta fase. Um candidato de modelo menor que libere VRAM pode reabrir a questão, com nova entrada em `decisions.md`.
4. **Padrão**: `analysis_pipeline` passa a `"v2"` em `default_tool_configs()`. A v1 continua acessível pela chave.
5. **Artefatos canônicos sem listas léxicas**: `semantic.blocks.json` passa a ser derivado de `sentences.json` (agrupamento por duração e pausa) e `topic.segments.json` de `units.json`, mantendo os mesmos campos.
6. **Remoção**: depois de um período de uso sem regressão, definido com o dono do projeto, apagar a v1: `narrative_miner.py` (parte de mineração), `lookaround.py` (parte léxica), as listas de `semantic_blocks.py`, `topic_segmentation.py` se D9 decidir sem embeddings, e os testes correspondentes.
7. **Documentação**: atualizar `ARCHITECTURE.md` e `AGENTS.md` para descrever a v2.

## Critério de pronto

1. A v2 com o modelo escolhido passa na regra de decisão contra o `v1-baseline` em `holdout`.
2. Tempo dentro de D6.
3. O frontend continua funcionando com os artefatos derivados: verificar com a sessão de frontend antes de remover os construtores antigos.
4. `pytest` verde depois da remoção.
5. Revisão aprovada.

## Cuidados

- A troca do padrão e a remoção são dois passos separados, com uso real entre eles.
- Os cortes de `curate-before-render` e o arquivo de tentativas (`attempts/`) leem `cuts.suggested.json`; conferir que nada depende de campos que só a v1 preenchia.

## Modelos

Comparação e decisão: Fable. Implementação: Sonnet. Revisão: Opus.
