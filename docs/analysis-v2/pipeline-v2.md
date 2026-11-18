# Pipeline v2 — Arquitetura

Substitui a segmentação e a análise da v1. Os schemas exatos de cada etapa estão em [stage-contracts.md](./stage-contracts.md).

## Visão geral

```
transcription.words.json
        │
   S0  Frases                 código    → sentences.json
        │
   S1  Brief e outline        LLM       → video.brief.json
        │
   S2  Unidades               LLM       → units.json
        │
   S3  Candidatos             código (+ LLM só para unidade longa demais)
        │
   S4  Pontuação              LLM, 1 chamada por candidato
        │                               → candidates.scored.json
   S5  Refino de borda        LLM, só nos pré-selecionados
        │
   S6  Seleção e montagem     código    → cuts.suggested.json
```

Cada etapa lê artefatos em disco e grava o seu. Nenhuma depende de estado em memória da anterior, o que permite reexecutar a partir de qualquer ponto.

## Onde fica

```
backend/app/domain/analysis/v2/
  __init__.py
  constants.py      # todas as constantes numéricas, comentadas
  sentences.py      # S0
  brief.py          # S1
  units.py          # S2
  candidates.py     # S3
  scoring.py        # S4
  boundaries.py     # S5
  selection.py      # S6
  pipeline.py       # orquestra S0..S6 para um job
  prompts.py        # textos dos prompts e schemas JSON
```

`analyze_job` em `narrative_miner.py` despacha para `v2.pipeline.analyze_job_v2` quando `llm.analysis_pipeline == "v2"`. A assinatura e o retorno (`{"cuts": [...], "raw_response": "..."}`) não mudam.

## Reaproveitado da v1

| O quê | Onde |
|---|---|
| Adapter de LLM com saída estruturada | `UnifiedLocalLLMAdapter.chat_json` |
| Fila da GPU e ciclo de vida do LM Studio | `scheduler.gpu_slot`, `lmstudio.stage` |
| IoU temporal | `lookaround.compute_temporal_iou` |
| Snap acústico de início e fim | `rms_snap.snap_cut_boundaries` |
| Persistência atômica e caminhos do job | `c.jobs.*` |
| Modelo `Cut` e `cuts.suggested.json` | `models/domain.py` |

Nada de `semantic_blocks.py`, `topic_segmentation.py` ou da parte léxica de `lookaround.py` é importado pela v2, com uma exceção temporária descrita em "Compatibilidade".

## Etapas

### S0 — Frases

Transforma as palavras com timestamp em frases, que passam a ser a unidade mínima de tudo. A fronteira de um corte só pode cair em limite de frase.

- Quebra em pontuação terminal ou em pausa longa. O limiar de pausa é relativo ao próprio vídeo (percentil das pausas entre palavras), não um valor fixo.
- Se a transcrição tiver pouca pontuação, usa só pausas.
- Frases muito curtas são fundidas com a vizinha; frases muito longas são divididas na maior pausa interna.
- Sem `transcription.words.json`, cai para os segmentos do Whisper como frases.

Código puro, sem LLM e sem nenhuma lista de palavras.

### S1 — Brief e outline

Dá ao modelo, e às etapas seguintes, uma visão do vídeo inteiro.

- **Map:** para cada trecho de frases, uma linha de resumo. O conjunto é o outline.
- **Reduce:** uma chamada recebe título (se houver), duração, capítulos (se houver) e o outline, e devolve o brief.
- O brief é texto livre mais três números (`unit_seconds`), limitados por código.
- Vídeo curto pula o map e faz uma chamada só, com a transcrição inteira.

O brief é o substituto dos presets: descreve o que é uma unidade autocontida neste vídeo, o que seria um bom corte e o que não é conteúdo.

### S2 — Unidades

Marca onde começa cada unidade (um item, uma resposta, uma história, um passo), de acordo com o brief.

- Janelas de frases com sobreposição.
- O modelo devolve IDs de frase onde uma unidade começa, um rótulo curto e se é conteúdo ou não. Os IDs são restritos por `enum` no schema.
- Na região de sobreposição entre duas janelas, vale a marcação da janela em que a frase está mais longe da borda.
- Unidades `non_content` (vinheta, patrocínio, avisos) nunca viram corte nem entram no meio de um.

### S3 — Candidatos

Código, a partir das unidades e dos limites de duração do brief.

| Situação da unidade `content` | Candidato gerado |
|---|---|
| Duração entre `min` e `max` | A própria unidade |
| Menor que `min` | Nenhum sozinho; só entra em fusão com vizinha |
| Maior que `max` | Uma chamada de LLM escolhe até 2 sub-trechos contíguos, com IDs restritos |

Não se geram todas as combinações de unidades vizinhas. Fusões são criadas sob demanda em S4.

### S4 — Pontuação

Uma chamada por candidato. Entrada: brief resumido, 3 frases anteriores marcadas como contexto, o texto do candidato, 2 frases seguintes.

- O schema pede primeiro a premissa e o que falta de contexto, depois os booleanos, e a nota de interesse por último.
- `understandable_alone`, `ends_complete` e `is_non_content` são portões; `interest` (1 a 5) ordena.
- **Fusão guiada por defeito:** candidato com `interest ≥ 3` que falha em `understandable_alone` gera um novo candidato incluindo a unidade anterior; se falha em `ends_complete`, incluindo a seguinte. O novo candidato é pontuado. No máximo uma fusão para cada lado.
- O prefixo do prompt (system + brief) é idêntico em todas as chamadas e a parte variável fica no fim, para aproveitar o cache de prefixo do servidor local.

### S5 — Refino de borda

Só para os candidatos pré-selecionados (aprovados nos portões e com nota suficiente, até 1,5× `max_suggested_cuts`).

- **Início:** entre até 4 frases anteriores e as 2 primeiras do candidato, qual é a mais tardia a partir da qual um espectador novo ainda entende.
- **Fim:** entre as 2 últimas e as 3 seguintes, onde o raciocínio realmente termina.
- O código rejeita qualquer escolha que viole duração ou invada unidade `non_content`, e mantém a borda original.
- Se as bordas mudaram 2 frases ou mais no total, o candidato é pontuado de novo uma vez; se deixar de passar nos portões, volta às bordas originais.
- Por fim, `snap_cut_boundaries` ajusta o início e o fim ao vale de energia do áudio.

### S6 — Seleção e montagem

Código.

1. Mantém quem passou nos portões e tem `interest ≥ analysis_min_interest`.
2. Ordena por nota; desempata por `has_payoff`, depois pelo sinal de audiência (fase 5), depois pelo início mais cedo.
3. Remove sobreposição: IoU temporal > 0,35 com um corte já aceito descarta o de menor nota.
4. Limita a `max_suggested_cuts`, que passa a ser só teto.
5. Se nada passou, aplica `decisions.md` D14.
6. Monta os `Cut` e grava `cuts.suggested.json`.

## Artefatos novos

Todos em `data/jobs/<job_id>/`, com escrita atômica. São aditivos; nenhum existente é removido.

| Arquivo | Etapa | Conteúdo |
|---|---|---|
| `sentences.json` | S0 | Frases com ID, tempos, texto, locutor |
| `video.brief.json` | S1 | Brief e outline |
| `units.json` | S2 | Unidades com frases de início e fim, rótulo, tipo |
| `candidates.scored.json` | S4/S5 | Todos os candidatos, respostas da pontuação, motivo de aceite ou descarte |

`candidates.scored.json` guarda também os rejeitados. É o que permite entender por que um trecho não virou corte.

## Compatibilidade

- `semantic.blocks.json` e `topic.segments.json` continuam sendo gerados pelos construtores da v1 enquanto a v2 não for o padrão, porque são artefatos canônicos e o frontend pode lê-los. A fase 4 decide como gerá-los sem as listas léxicas.
- `Cut.block_ids` continua preenchido: são os blocos semânticos que se sobrepõem ao intervalo do corte.
- Campos extras gravados no `Cut` (o modelo aceita): `sentence_ids`, `interest`, `pipeline: "v2"`.
- `Cut.score` continua de 0 a 100.
- Os status do job (`BUILDING_BLOCKS`, `BUILDING_TOPICS`, `ANALYZING`, `WAITING_APPROVAL`) e os eventos SSE seguem os mesmos. As etapas novas publicam progresso dentro de `ANALYZING`.

## Configuração

Chaves novas na seção `llm`, todas opcionais. `normalize_llm_config` em `core/tool_configs.py` precisa passar a preservá-las.

| Chave | Padrão | Efeito |
|---|---|---|
| `analysis_pipeline` | `"v1"` | `"v2"` ativa este pipeline |
| `analysis_seed` | `42` | Seed de todas as chamadas da análise |
| `analysis_min_interest` | `4` | Nota mínima para virar corte |
| `auto_approve` | `false` | Fase 7: aprova sozinho o que passa do limite |

`target_cut_duration_seconds` deixa de ser usado pela v2: a duração vem do brief. `max_suggested_cuts` vira só teto.

## Chamadas ao LLM

- `temperature = 0` e `seed = analysis_seed` em todas.
- Toda saída é JSON com schema estrito. IDs são sempre `enum` dos valores válidos naquela chamada.
- `max_tokens` por etapa, pequeno e definido em `constants.py`.
- Cada prompt cabe com folga no contexto configurado (`LMSTUDIO_CONTEXT_LENGTH`, fixo em 8192 por D18), contando a saída. O tamanho das janelas é derivado disso.
- O tamanho do prompt é verificado antes do envio. Um prompt que não cabe é erro do pipeline, nunca enviado: o LM Studio devolve conteúdo vazio nesse caso, sem mensagem.
- A análise inteira roda dentro de um único `gpu_slot` e um único `lmstudio.stage`, como na v1, para o modelo não ser recarregado entre chamadas.
- O modelo fixo é o Qwen3 14B com contexto de 8192 (D15). O modo de raciocínio fica desligado em todas as chamadas (D16); ligá-lo em S4 e S5 é uma variante a medir na fase 4, com revisão de `max_tokens`.

## Falhas

| Onde | Comportamento |
|---|---|
| S0 sem palavras | Usa segmentos do Whisper como frases |
| S1 falha | Segue com brief mínimo: só duração e limites padrão de `constants.py` |
| S2 falha numa janela | Aquela janela vira uma unidade por tópico do TextTiling, se existir; senão, unidades de duração `typical` |
| S3 sub-trecho falha | A unidade longa é descartada, com registro |
| S4 falha num candidato | O candidato é descartado, com registro; o job continua |
| S5 falha | Mantém as bordas originais |
| LLM indisponível | O job vai para `ERROR` com mensagem clara, como na v1 |

Toda queda para fallback é registrada no log do job e em `candidates.scored.json`. Nenhum fallback fabrica cortes.

## Orçamento estimado

Estimativas não medidas; o harness confirma.

| Vídeo | S1 | S2 | S3 | S4 | S5 | Total de chamadas |
|---|---|---|---|---|---|---|
| 10 min | 3 | 2 | 0-2 | 25-40 | 10-16 | ~40-60 |
| 60 min | ~12 | ~10 | 0-10 | 120-200 | 20-36 | ~160-270 |

Se o tempo passar do limite, a primeira alavanca é reduzir candidatos em S3 (unidades `non_content` já ficam de fora), não encurtar prompts.
