# Fase 7 — Aprender com aprovações e aprovação automática

> Detalhamento resumido.

## Objetivo

Chegar em intervenção zero para o gosto do dono do projeto, usando as aprovações e rejeições que o app já grava, sem criar presets.

## Depende de

- Fase 4 concluída.
- Volume mínimo de histórico: definir com o dono (sugestão inicial: 100 cortes julgados em pelo menos 10 vídeos).

## Entregas

1. **Histórico**: coletar, de `cuts.suggested.json` e de `attempts/`, cada corte com `status` final, junto das respostas de S4 em `candidates.scored.json`. Gravar um arquivo consolidado em `data/`, com escrita atômica.
2. **Calibração da nota mínima**: a partir do histórico, medir a taxa de aprovação por nível de `interest` e sugerir `analysis_min_interest`. O valor só muda com confirmação do dono.
3. **Exemplos na pontuação**: incluir no prompt de S4 poucos exemplos de cortes aprovados e rejeitados. Os exemplos são escolhidos por semelhança com o candidato, usando embeddings; é o uso previsto em D9.
4. **Aprovação automática**: com `auto_approve: true`, cortes que passam nos portões e têm `interest` acima do limite calibrado saem como `approved`. O padrão continua `false`.

## Regras

- Exemplos nunca vêm do mesmo vídeo que está sendo analisado.
- O harness roda com e sem exemplos. Os vídeos do corpus não entram no histórico usado como exemplo, para a medição não se contaminar.
- Se os exemplos reduzirem a estabilidade ou piorarem algum formato, ficam desligados e só a calibração é mantida.

## Critério de pronto

1. Em vídeos novos, fora do histórico, a fração de cortes aprovados automaticamente que o dono rejeitaria fica abaixo de um limite acordado com ele.
2. A regra de decisão do harness passa com os exemplos ligados.
3. Com `auto_approve: false`, o comportamento é idêntico ao da fase 4.

## Modelos

Implementação: Sonnet. Prompt com exemplos: Fable. Revisão: Opus.
