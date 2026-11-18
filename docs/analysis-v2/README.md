# Análise v2 — Especificação

Reescrita da etapa que escolhe os cortes (segmentação + análise), para que o pipeline gere cortes consistentes em qualquer tipo de vídeo, com IA 100% local e o mínimo de intervenção manual.

Este diretório é a fonte de verdade do trabalho. O `AGENTS.md` da raiz continua valendo para invariantes de rotas, artefatos e concorrência.

## Problema que estamos resolvendo

O pipeline atual (v1) foi ajustado olhando um vídeo de cada vez. Os sintomas, verificados no código e em `data/jobs`:

- Regras de formato embutidas em listas léxicas PT/EN (`semantic_blocks.py`, `lookaround.py`) e em thresholds fixos.
- Uma única chamada de LLM por janela acha, delimita, pontua e justifica os cortes. As notas são auto-avaliação e não são comparáveis entre janelas.
- O pipeline particiona o vídeo em vez de selecionar: não há nota mínima nem limite de duração.
- Sinais determinísticos saturados (`TOPIC_SHIFT` em ~90% dos blocos de um job) e diarização acústica que inventa locutores.
- Nenhuma medição de qualidade de corte. A suíte `pytest` é 100% mockada.

## Objetivos

1. Cortes estáveis: rodar duas vezes o mesmo vídeo dá o mesmo resultado.
2. Cortes autocontidos, com início e fim em limite de frase, em qualquer formato e idioma.
3. Quantidade de cortes decidida pela qualidade, não por um teto a preencher.
4. Toda mudança medida num conjunto fixo de vídeos antes de entrar.

## Fora de escopo

- Ingestão, transcrição, renderização, enquadramento 9:16 e legendas.
- Rotas HTTP e `shared/contracts.ts`. Nada muda; campos novos são aditivos e opcionais.
- Qualquer arquivo em `frontend/` (exceto na fase 8, que é opcional e depende de coordenação).

## Restrições

| Restrição | Valor |
|---|---|
| Hardware | RTX 5070 12 GB, 32 GB DDR4 3200 |
| Modelos | Todos locais e inteiros na VRAM. Proibido offload parcial para RAM |
| GPU | Um modelo por vez, via `GPUMutex` existente |
| Contexto do LLM | 8192, máximo medido na placa (D18) |
| Tempo | Vídeo de 60 min: alvo ≤ 45 min antes da renderização, limite duro 60 min |
| Contratos | `cuts.suggested.json` e modelo `Cut` inalterados |
| Testes `pytest` | Continuam 100% mockados, sem hardware |

## Documentos

| Arquivo | Para quê |
|---|---|
| [decisions.md](./decisions.md) | Decisões tomadas e o motivo, incluindo o que foi descartado |
| [eval-harness.md](./eval-harness.md) | Como medimos qualidade de corte |
| [pipeline-v2.md](./pipeline-v2.md) | Arquitetura das etapas, artefatos, configuração, falhas |
| [stage-contracts.md](./stage-contracts.md) | Entrada, saída e schema JSON de cada etapa |
| [review-checklist.md](./review-checklist.md) | O que a revisão independente verifica em cada fase |
| [phases/](./phases) | Um arquivo por fase: escopo, arquivos, critério de pronto |

Quem implementa uma fase lê: este README, o arquivo da fase e os documentos que ele citar. Não é preciso ler as outras fases.

## Fases e status

Marque `[x]` ao concluir a fase **e** passar no critério de pronto dela.

| Status | Fase | Entrega | Depende de |
|---|---|---|---|
| `[ ]` | [0](./phases/phase-0.md) | Saneamento da v1: determinismo, schema, guarda de duração, remoção de código feito para teste | — |
| `[ ]` | [1](./phases/phase-1.md) | Harness de avaliação, corpus e baseline da v1 | 0 |
| `[ ]` | [2](./phases/phase-2.md) | v2 mínima: frases, pontuação por candidato, seleção | 1 |
| `[ ]` | [3](./phases/phase-3.md) | Brief do vídeo, unidades por LLM, refino de borda | 2 |
| `[ ]` | [4](./phases/phase-4.md) | Escolha de modelo, v2 como padrão, remoção do legado | 3 |
| `[ ]` | [5](./phases/phase-5.md) | Sinal de audiência do YouTube e diarização real | 4 |
| `[ ]` | [6](./phases/phase-6.md) | Visão condicional | 4 |
| `[ ]` | [7](./phases/phase-7.md) | Aprender com aprovações e aprovação automática | 4 |
| `[ ]` | [8](./phases/phase-8.md) | Cortes não contínuos (opcional) | 4 + frontend |

As fases 0 a 3 estão detalhadas. As fases 4 a 8 têm objetivo e critério de pronto; o detalhamento é feito quando chegar a vez, com os números do harness.

## Regras para quem implementa

1. **O critério de pronto é a tabela do harness**, não o `pytest`. O `pytest` verde é necessário, nunca suficiente.
2. **Nenhuma lista de palavras, frase ou marcador de idioma específico em código novo.** Se a regra depende de entender o texto, quem decide é o LLM.
3. **Nenhum caminho de produção que exista só para um teste passar.** Stubs de teste devolvem dados válidos; o código não reconhece stubs.
4. **Não ajuste nada olhando os vídeos de reserva** (`split: holdout`). Eles só são rodados nos portões de fase.
5. **Constantes numéricas ficam num único módulo** (`v2/constants.py`), com comentário dizendo de onde veio o valor. Mudar uma constante exige rodar o harness.
6. **Campos e artefatos novos são aditivos e opcionais.** Não remova nem renomeie nada que o frontend lê.
7. **Não toque em arquivos fora da lista da fase.** Se precisar, pare e registre em `decisions.md`.

## Modelos por tipo de trabalho

| Trabalho | Modelo |
|---|---|
| Orquestração e decisões entre fases | Fable (sessão) |
| Mapear código, localizar usos | Haiku |
| Implementar com especificação fechada, testes mockados | Sonnet |
| Escrever prompts e schemas da análise | Fable |
| Revisão independente de cada fase | Opus |

Os modelos locais do pipeline (texto, juiz, visão, diarização, embeddings) estão em [decisions.md](./decisions.md), D15 a D17.

Um workflow por fase, com poucos agentes. As etapas têm dependência em sequência; paralelizar além disso gasta tokens sem ganhar tempo.

## Pendências para o dono do projeto

Estas decisões não foram tomadas e bloqueiam a fase indicada:

| # | Pendência | Bloqueia |
|---|---|---|
| 1 | ~~Qual modelo local fica fixo na configuração ativa~~ **Resolvida:** Qwen3 14B, contexto 8192, raciocínio desligado (D15 e D16) | — |
| 2 | Autorização para os agentes rodarem o harness no PC com o LLM local carregado | Fase 1 |
| 3 | Quais vídeos entram no corpus e quais ficam de reserva | Fase 1 |
| 4 | Biblioteca de diarização (algumas exigem conta gratuita para baixar o modelo) | Fase 5 |
| 5 | Modelo de visão | Fase 6 |
