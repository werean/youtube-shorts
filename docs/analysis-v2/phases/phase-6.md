# Fase 6 — Visão condicional

> Detalhamento resumido. Ver D8 e D10 em [decisions.md](../decisions.md).

## Objetivo

Cobrir os vídeos em que o valor está na imagem (gameplay, reação, tutorial com tela), que a análise por transcrição não enxerga.

## Depende de

- Fase 4 concluída.
- Pendência 5 do README (modelo de visão). Candidatos de D17: Qwen3-VL 8B (primeira escolha) e um Gemma de 12B multimodal. O segundo só vale se também for o modelo de texto escolhido na fase 4, porque aí não há troca de modelo.

## Como funciona

1. A pontuação por texto (S4) termina normalmente.
2. Candidatos elegíveis para visão: os que têm `depends_on_visuals == true` e `interest ≥ 3`, mais os candidatos de vídeos com pouca fala (fração falada abaixo de um limite em `constants.py`).
3. Se não há elegíveis, a etapa é pulada e o custo é zero.
4. O LLM de texto é descarregado; confirma-se que a VRAM foi liberada; o modelo de visão é carregado.
5. Para cada elegível, extraem-se 4 a 8 frames reduzidos, espaçados no intervalo, e o modelo responde perguntas estreitas: o que aparece na tela e se a fala se refere a algo visível.
6. A descrição é gravada como texto em `candidates.scored.json`.
7. O modelo de visão é descarregado, o LLM de texto volta, e só os elegíveis são pontuados de novo com a descrição anexada.

## Entregas

- `v2/vision.py` e adapter em `infrastructure/vision/`.
- Extração de frames via FFmpeg, em CPU.
- Verificação explícita de VRAM livre antes de cada carga; se não liberar, a etapa é abortada com aviso e o job segue sem visão.
- Remoção da penalidade de `depends_on_visuals` no `score` para candidatos que passaram pela visão.
- Chave de configuração para desligar.
- Para vídeos sem fala nenhuma, definir com o dono do projeto se a análise tenta algo ou devolve erro claro. Fica fora desta fase por padrão.

## Critério de pronto

1. Nos formatos visuais do corpus, a taxa do juiz ou `must_recall` sobe.
2. Nos demais formatos, nenhuma métrica muda (a etapa quase não é acionada).
3. Tempo dentro de D6 no vídeo mais longo.
4. Nenhum momento com dois modelos na VRAM; conferido pelo log de carga e descarga.

## Limite conhecido

O juiz do harness lê só texto. Para medir esta fase, o juiz recebe também a descrição visual do corte, o que exige nova entrada em `decisions.md` e novo baseline.

## Modelos

Implementação: Sonnet. Prompts de visão: Fable. Revisão: Opus.
