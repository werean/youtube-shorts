# Contratos das etapas

Entrada, saída e schema de cada etapa do pipeline v2. A arquitetura está em [pipeline-v2.md](./pipeline-v2.md).

Convenções:

- Tempos em segundos, `float`.
- IDs: frases `s1..sN`, unidades `u1..uN`, candidatos `k1..kN`, cortes `c1..cN`.
- Onde um schema de LLM diz `enum: [IDs válidos]`, o código monta o `enum` em tempo de execução com os IDs daquela chamada. O modelo não consegue devolver um ID inexistente.
- Os valores numéricos citados são os iniciais de `v2/constants.py`. Ajuste só com o harness.
- O texto final de cada prompt é escrito na fase correspondente. Aqui fica o contrato: o que o prompt recebe, o que pergunta e o que devolve.

---

## S0 — Frases

**Entrada:** `list[WordTiming]` (ou `list[Segment]` como fallback).

**Saída:** `sentences.json`

```json
{
  "version": 1,
  "source": "words",
  "pause_threshold_seconds": 0.62,
  "sentences": [
    {
      "sentence_id": "s1",
      "start": 0.0,
      "end": 4.82,
      "text": "…",
      "speaker": "SPEAKER_00",
      "word_start": 0,
      "word_end": 13
    }
  ]
}
```

**Regras:**

1. Limiar de pausa = percentil 95 das pausas entre palavras do vídeo, limitado a `[0,4 ; 1,5]` s.
2. Quebra depois de uma palavra se ela termina em pontuação terminal (`. ! ? …`) ou se a pausa até a próxima é ≥ limiar.
3. Modo de pouca pontuação: menos de 2 sinais terminais por 100 palavras → ignora a pontuação e usa percentil 90.
4. Frase com menos de 1,0 s ou menos de 3 palavras é fundida à vizinha com a menor pausa entre elas.
5. Frase com mais de 20 s é dividida na maior pausa interna, recursivamente.
6. `speaker` é o locutor da maioria das palavras, ou `null`.

**Invariantes testáveis:** frases cobrem todas as palavras sem sobra nem repetição; `start < end`; ordem crescente; nenhuma frase > 20 s salvo quando não há pausa interna.

---

## S1 — Brief e outline

### Map

**Entrada do prompt:** um trecho contíguo de frases (até ~6000 caracteres), no formato `s12: texto`.

**Schema de saída:**

```json
{
  "type": "object",
  "properties": {
    "summary": {"type": "string"},
    "kind": {"type": "string", "enum": ["content", "non_content", "mixed"]}
  },
  "required": ["summary", "kind"],
  "additionalProperties": false
}
```

`summary`: uma frase, no idioma do vídeo, dizendo do que o trecho trata.

### Reduce

**Entrada do prompt:** título e capítulos se existirem, duração, e o outline (uma linha por trecho com faixa de tempo).

**Schema de saída:**

```json
{
  "type": "object",
  "properties": {
    "language": {"type": "string"},
    "format_description": {"type": "string"},
    "speakers": {"type": "string"},
    "unit_definition": {"type": "string"},
    "good_cut_criteria": {"type": "array", "items": {"type": "string"}, "minItems": 2, "maxItems": 5},
    "non_content": {"type": "string"},
    "unit_seconds": {
      "type": "object",
      "properties": {
        "min": {"type": "number"},
        "typical": {"type": "number"},
        "max": {"type": "number"}
      },
      "required": ["min", "typical", "max"],
      "additionalProperties": false
    }
  },
  "required": ["language", "format_description", "speakers", "unit_definition",
               "good_cut_criteria", "non_content", "unit_seconds"],
  "additionalProperties": false
}
```

**Regras do prompt:**

- Todos os campos de texto são livres. É proibido pedir ou oferecer uma lista fechada de gêneros.
- `unit_definition`: o que é um trecho que faz sentido sozinho **neste** vídeo.
- `non_content`: o que deve ficar fora dos cortes neste vídeo.

**Pós-processamento em código:** `min` limitado a `[10, 60]`, `max` a `[45, 180]`, `min < typical < max`; se incoerente, usa `20 / 60 / 120`.

**Saída:** `video.brief.json`

```json
{
  "version": 1,
  "brief": { "…campos acima…" },
  "outline": [
    {"start_sentence_id": "s1", "end_sentence_id": "s48", "start": 0.0, "end": 312.4,
     "summary": "…", "kind": "content"}
  ]
}
```

**Vídeo curto** (duração < 180 s): sem map. Uma chamada com a transcrição inteira devolve o brief; o outline tem uma linha.

---

## S2 — Unidades

**Janelas:** 80 frases, sobreposição de 15. O tamanho é reduzido se o prompt não couber no contexto.

**Entrada do prompt:** brief (`format_description`, `unit_definition`, `non_content`), as linhas do outline que cobrem a janela, e as frases no formato `s12 [SPEAKER_00]: texto`.

**Schema de saída:**

```json
{
  "type": "object",
  "properties": {
    "units": {
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "start_sentence_id": {"type": "string", "enum": ["…IDs da janela…"]},
          "label": {"type": "string"},
          "kind": {"type": "string", "enum": ["content", "non_content"]}
        },
        "required": ["start_sentence_id", "label", "kind"],
        "additionalProperties": false
      }
    }
  },
  "required": ["units"],
  "additionalProperties": false
}
```

**Pós-processamento em código:**

1. Ordena por posição e remove duplicatas.
2. Garante que a primeira frase da janela inicia uma unidade.
3. Junção de janelas: na sobreposição, as marcações da primeira metade vêm da janela anterior e as da segunda metade da janela seguinte.
4. O fim de cada unidade é a frase anterior ao início da próxima.

**Saída:** `units.json`

```json
{
  "version": 1,
  "units": [
    {"unit_id": "u1", "start_sentence_id": "s1", "end_sentence_id": "s9",
     "start": 0.0, "end": 41.3, "label": "…", "kind": "non_content"}
  ]
}
```

**Invariantes testáveis:** unidades cobrem todas as frases, sem sobreposição, em ordem.

---

## S3 — Candidatos

**Entrada:** `units.json`, `unit_seconds` do brief.

**Regras:** ver tabela em `pipeline-v2.md`. Candidato nunca contém frase de unidade `non_content`.

**Sub-trecho de unidade longa — schema de saída:**

```json
{
  "type": "object",
  "properties": {
    "spans": {
      "type": "array",
      "maxItems": 2,
      "items": {
        "type": "object",
        "properties": {
          "start_sentence_id": {"type": "string", "enum": ["…IDs da unidade…"]},
          "end_sentence_id": {"type": "string", "enum": ["…IDs da unidade…"]}
        },
        "required": ["start_sentence_id", "end_sentence_id"],
        "additionalProperties": false
      }
    }
  },
  "required": ["spans"],
  "additionalProperties": false
}
```

O código descarta spans com `início > fim` ou fora de `[min, max]`.

**Estrutura do candidato:**

```json
{"candidate_id": "k7", "start_sentence_id": "s40", "end_sentence_id": "s52",
 "start": 181.2, "end": 243.9, "unit_ids": ["u6"],
 "origin": "unit"}
```

`origin`: `unit` | `subspan` | `merge_prev` | `merge_next` | `refined`.

---

## S4 — Pontuação

**Entrada do prompt, nesta ordem:**

1. System + brief resumido (`format_description`, `good_cut_criteria`, `non_content`). Idêntico para todos os candidatos do vídeo.
2. `CONTEXTO ANTERIOR (não faz parte do corte)`: até 3 frases.
3. `CORTE`: frases do candidato.
4. `CONTEXTO SEGUINTE (não faz parte do corte)`: até 2 frases.

**Schema de saída** (a ordem das propriedades é a ordem em que o modelo escreve; não reordene):

```json
{
  "type": "object",
  "properties": {
    "premise": {"type": "string"},
    "missing_context": {"type": "string"},
    "understandable_alone": {"type": "boolean"},
    "has_payoff": {"type": "boolean"},
    "ends_complete": {"type": "boolean"},
    "depends_on_visuals": {"type": "boolean"},
    "is_non_content": {"type": "boolean"},
    "interest": {"type": "integer", "enum": [1, 2, 3, 4, 5]},
    "title": {"type": "string"}
  },
  "required": ["premise", "missing_context", "understandable_alone", "has_payoff",
               "ends_complete", "depends_on_visuals", "is_non_content", "interest", "title"],
  "additionalProperties": false
}
```

| Campo | Pergunta |
|---|---|
| `premise` | Em uma frase, o que o espectador leva deste trecho |
| `missing_context` | O que falta para entender sem ter visto o resto; vazio se nada |
| `understandable_alone` | Quem só vê o CORTE entende do que se trata |
| `has_payoff` | O trecho entrega uma conclusão, resposta, virada ou resultado |
| `ends_complete` | A última frase do CORTE fecha o raciocínio |
| `depends_on_visuals` | O trecho só faz sentido vendo o que está na tela |
| `is_non_content` | É principalmente o que o brief descreve como fora de conteúdo |
| `interest` | 1 a 5, com âncoras descritas no prompt |
| `title` | Título curto, baseado só no CORTE, no idioma do vídeo |

**Âncoras de `interest`:** o prompt descreve cada nível em termos gerais (do "nada que alguém pararia para ver" ao "funciona sozinho e dá vontade de compartilhar"). É proibido descrever níveis com exemplos de um gênero específico.

**Cálculo em código:**

```
gates_ok = understandable_alone and ends_complete and not is_non_content
score    = interest * 20
           - (10 if not has_payoff else 0)
           - (5 if depends_on_visuals else 0)      # até a fase 6
```

**Fusão guiada por defeito:** para candidato com `interest ≥ 3` e `gates_ok == false`:

- `understandable_alone == false` → novo candidato `merge_prev` incluindo a unidade `content` anterior, se a duração total ≤ `max`.
- `ends_complete == false` → novo candidato `merge_next` incluindo a unidade `content` seguinte, se a duração total ≤ `max`.

Cada candidato origina no máximo uma fusão por lado. Candidatos de fusão não geram novas fusões.

---

## S5 — Refino de borda

Duas chamadas por candidato pré-selecionado.

**Início — entrada:** `OPÇÕES` = até 4 frases anteriores (sem cruzar unidade `non_content`) + as 2 primeiras do candidato; depois, as 3 frases seguintes como contexto.

**Fim — entrada:** as 3 frases anteriores como contexto; `OPÇÕES` = as 2 últimas do candidato + até 3 seguintes (sem cruzar unidade `non_content`).

**Schema de saída (igual para os dois, trocando o nome do campo):**

```json
{
  "type": "object",
  "properties": {
    "reason": {"type": "string"},
    "start_sentence_id": {"type": "string", "enum": ["…IDs das OPÇÕES…"]}
  },
  "required": ["reason", "start_sentence_id"],
  "additionalProperties": false
}
```

**Perguntas:**

- Início: qual é a frase **mais tardia** a partir da qual quem nunca viu o vídeo ainda entende o trecho.
- Fim: em qual frase o raciocínio do trecho **termina**, sem começar o assunto seguinte.

**Validação em código:** a nova borda é aceita se a duração fica em `[min, max]`. Caso contrário, mantém a original.

**Repontuação:** se início e fim somados mudaram 2 frases ou mais, roda S4 uma vez no novo intervalo (`origin: "refined"`). Se `gates_ok` virar falso, volta ao intervalo anterior.

**Snap:** `snap_cut_boundaries(start, end, words=..., audio_wav_path=...)`.

---

## S6 — Seleção e montagem

**Entrada:** candidatos pontuados e refinados; `analysis_min_interest`; `max_suggested_cuts`.

**Saída:** `cuts.suggested.json` com `list[Cut]`.

**Mapeamento para `Cut`:**

| Campo de `Cut` | Origem |
|---|---|
| `cut_id`, `id` | `c1..cN`, em ordem de nota |
| `start`, `end` | Bordas depois do snap |
| `duration`, `duration_seconds` | `end - start` |
| `title` | `title` de S4 |
| `score` | `score` calculado, 0 a 100 |
| `summary`, `content_reason` | `premise` |
| `reasoning`, `hook_reason` | Texto curto montado das respostas de S4 |
| `block_ids` | Blocos de `semantic.blocks.json` que se sobrepõem a `[start, end]` |
| `status` | `"pending"` (ou `"approved"` com `auto_approve`, fase 7) |
| `sentence_ids`, `interest`, `pipeline` | Extras |

**`candidates.scored.json`:**

```json
{
  "version": 1,
  "model": "…",
  "seed": 42,
  "candidates": [
    {
      "candidate_id": "k7",
      "origin": "unit",
      "start_sentence_id": "s40", "end_sentence_id": "s52",
      "start": 181.2, "end": 243.9,
      "answers": { "…saída de S4…" },
      "gates_ok": true,
      "score": 80,
      "outcome": "selected",
      "outcome_reason": "",
      "cut_id": "c3"
    }
  ]
}
```

`outcome`: `selected` | `rejected_gates` | `below_min_interest` | `overlap` | `over_cap` | `error`.

**Invariantes testáveis:** nenhum par de cortes com IoU > 0,35; todo corte dentro de `[min, max]`; todo corte começa e termina em limite de frase antes do snap; `len(cuts) ≤ max_suggested_cuts`; nenhum corte contém frase de unidade `non_content`.
