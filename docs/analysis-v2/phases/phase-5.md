# Fase 5 — Sinal de audiência e diarização real

> Detalhamento resumido. As duas partes são independentes e podem ser feitas em qualquer ordem.

## Depende de

- Fase 4 concluída.
- Pendência 4 do README (biblioteca de diarização).

## Parte A — Sinal de audiência do YouTube

**Objetivo:** usar o gráfico de "mais reassistidos" como evidência de interesse quando o vídeo veio do YouTube.

**Entregas:**

1. Verificar primeiro, em 5 vídeos reais, se o yt-dlp devolve o campo de heatmap e em que formato. Se não vier de forma confiável, encerrar a parte A e registrar em `decisions.md`.
2. A ingestão grava o heatmap em `source.info.json`, em campo opcional.
3. S6 usa a intensidade média do heatmap no intervalo do corte como critério de desempate e, se o harness mostrar ganho, como bônus limitado no `score`.
4. O harness passa a registrar se o vídeo tem heatmap.

**Regras:**

- O sinal nunca substitui os portões de S4: um trecho muito reassistido que não se entende sozinho continua rejeitado.
- Upload local e vídeos sem heatmap seguem exatamente o caminho de antes.

**Critério de pronto:** `must_recall` sobe nos vídeos com heatmap e nenhuma métrica piora nos vídeos sem.

## Parte B — Diarização real

**Objetivo:** trocar a heurística acústica de `acoustic_dsp.py` por um modelo de diarização local.

**Entregas:**

0. Escolher a biblioteca entre os candidatos de D17: pyannote Community-1 (primeira escolha) e NVIDIA Sortformer offline. Antes de adotar, confirmar licença e consumo de VRAM de cada um e testar os dois em 3 vídeos do corpus com mais de um locutor.
1. Adapter de diarização em `infrastructure/audio/`, rodando sob o `GPUMutex`, depois do Whisper e antes do LLM, com descarregamento explícito.
2. Atribuição de locutor por palavra em `transcription.words.json`.
3. Chave de configuração para desligar. Sem diarização, `speaker` fica `null`; a heurística antiga não volta como fallback (D8 e o diagnóstico: locutor inventado é pior que nenhum).
4. Reimportar o corpus com a nova diarização e refazer o baseline.

**Critério de pronto:** nos formatos com mais de um locutor, estabilidade e taxa do juiz não caem e o jitter de borda diminui; nos formatos de um locutor só, o número de locutores detectados é 1.

## Arquivos

- Parte A: `domain/ingest/`, `v2/selection.py`, `backend/evals/`.
- Parte B: `infrastructure/audio/`, `domain/transcription/service.py`, `application/scheduler.py` se necessário.

## Modelos

Implementação: Sonnet. Revisão: Opus.
