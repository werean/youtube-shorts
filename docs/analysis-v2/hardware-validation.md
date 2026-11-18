# Validações que dependem do hardware

Lista única do que foi implementado sem medição e precisa ser conferido no PC do dono, com o LLM real. Nada aqui foi rodado pelos agentes. Marque `[x]` ao conferir e anote o resultado ao lado.

## Fase 0 — Saneamento da v1

- [ ] **Determinismo:** rodar a análise duas vezes no mesmo job e comparar `cuts.suggested.json` (mesmos `start`, `end` e ordem).
- [ ] **Modelo resolvido:** o log do job mostra o Qwen3 14B.
- [ ] **Raciocínio desligado no LM Studio:** nenhuma resposta da análise traz bloco de raciocínio com o `/no_think` no fim do prompt.
- [ ] **JSON restrito com raciocínio desligado:** as respostas continuam válidas para o schema, e `max_tokens` não é consumido por tokens de raciocínio.
- [ ] **Campo `seed`:** o LM Studio aceita o campo sem devolver HTTP 400.
- [ ] **Carga pelo pipeline:** a linha de log da carga mostra contexto 8192 e GPU no máximo, e a geração fica perto de 45 tokens/s.
- [ ] **Campos do `lms ps --json`:** conferir os nomes reais de contexto, offload de GPU e paralelismo. Se forem diferentes dos esperados, o pipeline recarrega o modelo a cada análise.
- [ ] **Ollama (se for usado):** `"think": false` é aceito pela versão instalada.
- [ ] **Simulação manual:** rodar `manual-tests/simulacao-unidades-8192.txt` em 8192 e comparar com o gabarito de D18.

## Fase 1 — Harness

- [ ] **Corpus:** escolher de 10 a 15 vídeos de formatos diferentes, importar com `python -m evals.import_job` e separar cerca de um terço como reserva.
- [ ] **Gabarito leve:** preencher `labels.json` em pelo menos 5 vídeos.
- [ ] **Primeira execução real:** `python -m evals.run --split dev --variant v1-baseline --model qwen/qwen3-14b --seeds 3`. Conferir que o LM Studio carrega e descarrega o modelo dentro do diretório isolado.
- [ ] **Juiz:** rodar `python -m evals.judge` com um Gemma de 12B e ler uma amostra das respostas. Se o juiz aprovar cortes claramente ruins, corrigir o prompt (nova versão e novo hash) antes de qualquer comparação.
- [ ] **Troca de modelo na GPU:** confirmar que o gerador sai da VRAM antes de o juiz entrar.
- [ ] **Determinismo do harness:** duas execuções com as mesmas seeds dão as mesmas métricas.
- [ ] **Baseline:** gerar o `report.md` da v1 em `dev` e em `holdout` e conferir se a tabela reflete o que se vê nos vídeos.
- [ ] **Tokens reais:** ver se o LM Studio devolve contagem de tokens; hoje o `trace.json` usa estimativa.

## Fase 2 — v2 mínima

- [ ] **Primeira análise real com a v2:** ativar `llm.analysis_pipeline: "v2"` num job e conferir que termina, grava os quatro artefatos novos e produz cortes.
- [ ] **JSON das etapas:** as respostas de S3 e S4 saem válidas para o schema, com os IDs restritos por `enum` aceitos pelo LM Studio.
- [ ] **Leitura de `candidates.scored.json`:** em uns 10 candidatos, as respostas da pontuação batem com o texto? A escala de `interest` está sendo usada, ou tudo cai no mesmo nível?
- [ ] **Portão no harness:** `v2` contra `v1-baseline` em `dev` e `holdout`, pela regra de decisão.
- [ ] **Fronteiras:** `starts_on_sentence` e `ends_on_sentence` em 0,95 ou mais.
- [ ] **Seleção de fato:** `coverage` cai em relação ao baseline nos formatos em que a v1 particionava o vídeo.
- [ ] **Tempo:** vídeo mais longo do corpus dentro do limite de D6.
- [ ] **Prompts:** ajustar `v2-draft-1` com base nos itens acima, só em `dev`.

## Fase 3 — Brief, unidades e bordas

- [ ] **Brief:** ler `video.brief.json` de um vídeo por formato. A descrição bate com o vídeo? `unit_seconds` é plausível? `non_content` descreve o que de fato deve ficar fora?
- [ ] **Unidades:** ler `units.json` dos mesmos vídeos. As unidades coincidem com os assuntos? Estão longas demais (sinal de que S2 quase não corta) ou picadas demais?
- [ ] **Refino de borda:** em `candidates.scored.json`, ver `refine_outcome` e as justificativas. As bordas movidas ficaram melhores?
- [ ] **Tamanho real dos prompts:** janelas de 80 frases de S2 e o reduce de S1 cabem em 8192 em transcrições reais, inclusive em idiomas com palavras longas.
- [ ] **`max_tokens`:** 200 (map), 700 (reduce), 900 (unidades) e 300 (refino) bastam, ou o JSON sai cortado?
- [ ] **Comparações em sequência no harness:** `v2-brief` contra `v2`, `v2-units` contra `v2-brief`, `v2-bounds` contra `v2-units`. Uma peça que não melhora nem mantém a tabela é desligada pela chave correspondente.
- [ ] **Embeddings (D9):** `v2-noemb` contra `v2-bounds`. Se não houver diferença, remover os embeddings do pipeline.
- [ ] **Gabarito:** `must_recall` não cai e `never_violations` é zero.
- [ ] **Jitter de borda** não aumenta em relação à fase 2.
- [ ] **Tempo:** vídeo de 60 min dentro do limite de D6.
- [ ] **Prompts:** ajustar `v2-draft-3` com base nos itens acima, só em `dev`.

## Fase 4 — Modelo, padrão e remoção da v1

A parte de código está pronta (D23). O que segue é o que a fase 4 realmente pede, e nada disso foi feito.

- [ ] **Cancelamento real:** cancelar uma análise v2 no meio e medir quanto tempo leva para parar e liberar a GPU.
- [ ] **Raciocínio ligado:** com `v2-think`, o Qwen3 de fato raciocina quando o `/no_think` não é enviado? O JSON restrito continua válido? `max_tokens` × 4 basta?
- [ ] **`v2-think` contra `v2-bounds`** no harness, incluindo o tempo.
- [ ] **Comparação de modelos:** rodar a v2 em `dev` com Qwen3 14B, um Gemma de 12B, Phi-4 14B e `qwen2.5:14b` (`--model`), e confirmar no `holdout` só o escolhido.
- [ ] **`v2-derived` contra `v2-bounds`:** as métricas de seleção devem ficar iguais; conferir antes `s2_meta.fallback_windows`.
- [ ] **Frontend com artefatos derivados:** conferir com a sessão de frontend que nada quebra.
- [ ] **Trocar o padrão para `"v2"`**, só depois de a v2 ganhar no `holdout`.
- [ ] **Remover a v1**, depois de um período de uso sem regressão.
- [ ] **Atualizar `ARCHITECTURE.md` e a seção 3 do `AGENTS.md`**, que ainda descrevem a v1 e o `qwen2.5:14b`.

## Fase 5 — Audiência e diarização

- [ ] **Heatmap existe?** Baixar 5 vídeos reais e ver se `source.info.json` ganha o campo `heatmap`, e em que formato. Se não vier de forma confiável, abandonar o recurso.
- [ ] **`v2-audience-tiebreak` e `v2-audience-bonus`** contra `v2-bounds`: `must_recall` sobe nos vídeos com heatmap, e nada piora nos sem?
- [ ] **Instalar a biblioteca de diarização** (extra opcional `diarization`) e conferir licença, exigência de conta e consumo de VRAM.
- [ ] **Diarização real:** o modelo carrega, lê o WAV de 16 kHz, e a saída tem o formato esperado pelo adapter?
- [ ] **VRAM na troca:** o Whisper sai antes de a diarização entrar, e a diarização sai antes do LLM? O limite de 10,5 GB livres está calibrado para a placa?
- [ ] **Qualidade:** vídeo de um locutor só resulta em 1 locutor; em vídeos com vários, os turnos batem com quem fala.
- [ ] **Refazer o baseline** com a diarização nova antes de comparar qualquer coisa.

## Fase 6 — Visão

- [ ] **Escolher e baixar o modelo de visão** (candidato: Qwen3-VL 8B) e configurar `llm.vision_model`.
- [ ] **Requisição com imagem:** o LM Studio aceita o formato enviado e devolve JSON válido para o schema?
- [ ] **Carga do modelo de visão:** os parâmetros de carga do LLM de texto servem para ele?
- [ ] **Extração de frames:** o comando do ffmpeg funciona em vídeos reais e os frames saem legíveis.
- [ ] **Sequência na GPU:** nunca dois modelos ao mesmo tempo; a VRAM volta depois de cada descarga; o limite de 8 GB livres está calibrado.
- [ ] **Custo de contexto das imagens:** 6 frames de 768 px cabem em 8192 junto com o texto? A guarda de contexto não conta as imagens.
- [ ] **Qualidade:** as descrições batem com o que está na tela? A repontuação melhora os cortes de vídeos visuais?
- [ ] **Tempo:** dentro de D6 com a etapa ligada.
- [ ] **Medição:** exige vídeos no corpus e uma nova versão do juiz que receba a descrição visual.

## Fase 7 — Histórico e aprovação automática

- [ ] **Gerar o histórico:** `python -m app.domain.analysis.v2.history --rebuild` e ler a tabela. Só faz sentido com cerca de 100 cortes julgados em pelo menos 10 vídeos.
- [ ] **Calibrar a nota mínima** com a sugestão do histórico. A mudança é manual.
- [ ] **Aprovação automática:** ligar em vídeos novos e medir quantos cortes aprovados sozinhos você rejeitaria.
- [ ] **`v2-examples` contra `v2-bounds`**, com um histórico que não contenha vídeos do corpus. Se piorar a estabilidade ou algum formato, deixar desligado.
- [ ] **Frontend:** conferir como aparecem os campos extras `auto_approved` e `interest` nos cortes.
