# Decisões

Registro curto das decisões que sustentam a spec. Acrescente no fim; não reescreva entradas antigas. Para reverter uma decisão, crie uma entrada nova que a substitui.

Formato: **Decisão** / **Motivo** / **Consequência**.

---

## D1 — Não usar presets por gênero de vídeo

- **Decisão:** não existe enum de gênero nem configuração por tipo de vídeo.
- **Motivo:** cada formato novo exigiria um preset novo; é insustentável. As listas léxicas e as dicas de cadência da v1 já funcionam como presets escondidos e são a causa do overfitting.
- **Consequência:** o próprio LLM descreve o vídeo em texto livre (`video.brief.json`) e essa descrição guia as etapas seguintes.

## D2 — Uma tarefa por chamada de LLM

- **Decisão:** a análise é dividida em chamadas pequenas, cada uma com contexto limpo e uma única pergunta.
- **Motivo:** um modelo local de ~14B se perde quando precisa achar, delimitar, pontuar e justificar na mesma resposta.
- **Consequência:** muito mais chamadas por vídeo. Aceito, porque tempo não é a restrição principal (ver D6).

## D3 — O código faz tudo o que não exige entender texto

- **Decisão:** gerar candidatos, calcular nota final, remover sobreposição e escolher a quantidade de cortes é código determinístico.
- **Motivo:** são operações em que o LLM só acrescenta variância.
- **Consequência:** o LLM nunca devolve timestamps nem inventa spans; devolve IDs de frase restritos por `enum` no schema.

## D4 — Pontuação separada da proposta, um candidato por vez

- **Decisão:** cada candidato é avaliado sozinho, com as mesmas perguntas fechadas. A nota final é calculada em código a partir das respostas.
- **Motivo:** na v1 a nota vem da mesma chamada que propôs o corte, sai sempre alta e não é comparável entre janelas.
- **Consequência:** existe uma nota mínima absoluta. Um vídeo pode render 2 cortes ou 10.

## D5 — Nenhuma regra léxica em código novo

- **Decisão:** proibido lista de conectivos, marcadores de tópico, padrões de anúncio ou qualquer texto de idioma específico.
- **Motivo:** só valem para o idioma e o estilo em que foram escritas, e dependem da pontuação do Whisper.
- **Consequência:** em código ficam apenas invariantes agnósticos: limite de frase, duração mínima e máxima, sem sobreposição, snap acústico.

## D6 — Orçamento de tempo

- **Decisão:** vídeo de 60 min deve terminar a análise com alvo de até 45 min e limite duro de 60 min, antes da renderização.
- **Motivo:** o dono do projeto aceita demorar se o resultado for preciso, mas não 1h30 ou 2h.
- **Consequência:** o harness mede tempo por vídeo; passar do limite reprova a variante.

## D7 — Proibido estourar a VRAM

- **Decisão:** todo modelo roda inteiro nos 12 GB. Nada de offload parcial para RAM.
- **Motivo:** com DDR4 3200, a estimativa para um modelo de ~20 GB com parte na RAM é de 3 a 4 tokens/s. Com 160 a 250 chamadas por vídeo de 1 h, passaria de 2 horas.
- **Consequência:** ganho de qualidade vem de escolher um modelo melhor do mesmo tamanho (fase 4), não um maior. Estimativa não medida na máquina.

## D8 — Modelos rodam em sequência, nunca juntos

- **Decisão:** Whisper, LLM de texto, diarização e visão se revezam na GPU. O que passa de um para outro é texto em disco.
- **Motivo:** nenhuma etapa precisa de dois modelos ao mesmo tempo, e o projeto já tem `GPUMutex`.
- **Consequência:** toda troca verifica explicitamente que o modelo anterior saiu da VRAM. No Windows, o driver pode transbordar para RAM em silêncio; o sintoma é lentidão sem erro.

## D9 — Embeddings ficam em observação

- **Decisão:** não remover nem investir agora. A fase 3 roda o harness com e sem embeddings e decide.
- **Motivo:** hoje só servem ao TextTiling. No job analisado, os tópicos não coincidiram com os itens e o LLM ignorou a divisão. O `nomic-embed-text` v1.5 é, até onde sabemos, treinado principalmente em inglês.
- **Consequência:** se ficarem, trocar por modelo multilíngue. Uso futuro previsto: aprendizado com aprovações (fase 7).

## D10 — Visão é condicional e por último na GPU

- **Decisão:** o modelo de visão só olha candidatos marcados como dependentes da tela ou vídeos com pouca fala, com 4 a 8 frames reduzidos por corte, em bloco único depois da pontuação por texto.
- **Motivo:** em vídeo guiado por fala a visão acrescenta pouco; varrer o vídeo inteiro estoura o tempo.
- **Consequência:** modelos de visão desse porte respondem perguntas estreitas ("o que está na tela?"); a decisão de interesse continua na pontuação.

## D11 — v2 entra ao lado da v1

- **Decisão:** pacote novo `domain/analysis/v2/`, ativado pela chave opcional `llm.analysis_pipeline`. Padrão continua `v1` até a fase 4.
- **Motivo:** permite comparar as duas no mesmo harness e voltar atrás sem reverter código.
- **Consequência:** a v1 só é removida depois que a v2 ganhar nos vídeos de reserva.

## D12 — Julgar pelo pior formato, não pela média

- **Decisão:** uma variante só passa se não piorar nenhum grupo de formato de vídeo.
- **Motivo:** a média esconde o caso em que um formato melhora muito e outro quebra, que é exatamente o overfitting que queremos evitar.
- **Consequência:** a tabela do harness é sempre por formato.

## D13 — Descartado: agente que navega a transcrição com ferramentas

- **Decisão:** não fazer agora.
- **Motivo:** com modelo local desse porte tende a ser menos previsível que etapas fixas, e previsibilidade é o objetivo.

## D14 — Quando nenhum corte atinge a nota mínima

- **Decisão:** devolver até 3 candidatos com `interest = 3` que passaram nos portões, sempre como `pending` e nunca aprovados automaticamente, com aviso no log do job.
- **Motivo:** devolver zero cortes quebra a experiência de um clique; preencher o teto com cortes ruins é o defeito da v1.
- **Consequência:** revisar esta regra com dados do harness na fase 3.

## D15 — Modelo de texto fixo: Qwen3 14B, contexto 8192

- **Decisão:** o modelo fixo da análise, desde a fase 0, é o Qwen3 14B (`qwen/qwen3-14b` no LM Studio; `qwen3:14b` no Ollama), com contexto de 8192. O baseline da v1 e a v2 são medidos nesse mesmo modelo.
- **Motivo:** a configuração ativa apontava para um modelo de nuvem, então não havia calibração local a preservar. No PC do dono, o Qwen3 14B rodou a ~45 tokens/s, dentro da estimativa usada no orçamento de tempo.
- **Consequência:** 8192 basta porque as maiores chamadas da v2 têm de 2 a 3 mil tokens de entrada. O contexto de 16384 só pode ser adotado depois de um teste com prompt longo (10 a 12 mil tokens) confirmar que a velocidade se mantém e que a memória compartilhada da GPU não cresce; a estimativa é que 16384 fique no limite dos 12 GB (ver D7). A comparação com outros modelos continua na fase 4.

## D16 — Raciocínio do modelo desligado por padrão

- **Decisão:** as chamadas da análise rodam com o modo de raciocínio do Qwen3 desligado.
- **Motivo:** no teste do dono, a velocidade de geração foi a mesma nos dois modos, mas o raciocínio gastou cerca de 8 s e centenas de tokens antes da resposta. Em 200 chamadas isso pode somar perto de 27 minutos num vídeo de 1 h. O schema de S4 já força o modelo a escrever premissa e contexto faltante antes da nota.
- **Consequência:** uma variante do harness liga o raciocínio só em S4 e S5; ela entra se passar na regra de decisão e couber em D6. A fase 0 precisa descobrir como desligar o raciocínio pela API e verificar a convivência com saída em JSON restrito e com `max_tokens`.

## D17 — Modelos candidatos por tarefa

- **Decisão:** lista inicial de candidatos, todos cabendo sozinhos nos 12 GB. Nenhum foi testado em português neste projeto; a escolha final de cada um é feita na fase indicada.

| Tarefa | Primeira escolha | Alternativa | Decide na fase |
|---|---|---|---|
| Transcrição | `large-v3-turbo` (atual) | — | não muda |
| Análise de texto | Qwen3 14B (D15) | Gemma de 12B, Phi-4 14B, `qwen2.5:14b` | 4 |
| Juiz do harness | Gemma de 12B (`gemma3:12b` já registrado) | Phi-4 14B | 1 |
| Visão | Qwen3-VL 8B | Gemma de 12B multimodal | 6 |
| Diarização | pyannote Community-1 | NVIDIA Sortformer (offline) | 5 |
| Embeddings | `bge-m3` | Qwen3-Embedding 0.6B | 3 (D9) e 7 |

- **Motivo:** o juiz deve ser de família diferente do gerador. Para visão, o Qwen3-VL 8B é a recomendação mais consistente para 12 GB. Para diarização, o Community-1 tem licença clara; o Sortformer aparece com menos erro em um benchmark multilíngue, mas de fonte com interesse comercial, e sem licença nem VRAM verificadas. Para embeddings, o `bge-m3` é multilíngue e leve.
- **Consequência:** os números de VRAM vêm de páginas de comparação, não de medição. Confirmar cada modelo na máquina antes de adotá-lo.

## D18 — 8192 é o contexto máximo; contextos maiores estão descartados

- **Decisão:** o contexto fica em 8192. As variantes de 12288 e 16384 saem do plano. Esta entrada substitui a parte de D15 que deixava 16384 em aberto.
- **Motivo:** medições feitas pelo dono no LM Studio com o Qwen3 14B Q4_K_M, em 18/11/2026:

| Situação | Resultado |
|---|---|
| Prompts curtos, antes de mexer no contexto | ~45 tokens/s |
| Contexto 12288, prompt de 9.834 tokens | 18,76 tokens/s; leitura do prompt em 7,5 s; respostas corretas no início, meio e fim |
| Contexto 12288, prompt curto | 21,20 tokens/s |
| Contexto 8192, prompt de 9.834 tokens | Resposta vazia, sem mensagem de erro |
| Placa sem modelo carregado | 1,6 GB já ocupados pelo sistema |
| Placa com o modelo carregado | 11,2 de 12 GB de memória dedicada; 0,5 GB compartilhada; RAM do sistema em 90% |

- **Consequência:**
  - Com contexto maior que 8192, a velocidade cai para menos da metade mesmo em prompt curto, o que levaria a análise de um vídeo de 1 h de cerca de 12 para perto de 30 minutos, sem ganho: as chamadas da v2 usam de 2 a 3 mil tokens.
  - Sobra menos de 1 GB de VRAM com o modelo carregado. Ao rodar o pipeline ou o harness, fechar programas que usem GPU ou muita RAM.
  - Quando o prompt passa do contexto, o LM Studio devolve conteúdo vazio. O pipeline precisa medir o prompt antes de enviar e falhar com mensagem clara (fase 0).
- **Não verificado:**
  - A causa exata da queda em 12288 (o LM Studio reduzir sozinho as camadas na GPU, ou a VRAM transbordar para a RAM).
  - Com qual contexto o modelo estava carregado nas medições de ~45 tokens/s e de 11,2 GB. O painel de carregamento mostrava GPU Offload em 4 e estimativa de 970 MB de GPU, o que não bate com os 11,2 GB do Gerenciador de Tarefas.
  - Se o `/no_think` no fim do prompt foi o que desligou o raciocínio, ou se foi o botão da interface.
  - O teste da simulação de S2 em 8192 ainda não foi rodado. Os dois prompts de teste manual estão em `manual-tests/`: `teste-contexto-longo-qwen3.txt` (9.834 tokens; respostas esperadas: LARANJA-4172, porteiro Belmiro, dia 23) e `simulacao-unidades-8192.txt` (~2.500 tokens; unidades esperadas começando em s1, s7, s27, s34, s53 e s73, com s1, s27 e s73 como `non_content`).

## D19 — Como o raciocínio é desligado, e o que ficou fora da fase 0

- **Decisão:** a chave opcional `llm.disable_reasoning` (padrão ligado) desliga o raciocínio em toda chamada da análise. No Ollama, o adapter envia `"think": false` no corpo de `/api/chat`. No LM Studio, acrescenta `/no_think` ao fim da mensagem do usuário.
- **Motivo:** o campo do Ollama é documentado. Para o LM Studio não há mecanismo por requisição documentado para o Qwen3 no endpoint compatível com OpenAI: existe `reasoning_effort` desde a versão 0.4.8, mas sem valores aceitos publicados, e `enable_thinking` e `chat_template_kwargs` não constam na documentação. O `/no_think` é o interruptor descrito pela própria Qwen e não quebra modelos sem raciocínio.
- **Consequência:**
  - O `/no_think` vai em todo prompt enviado ao LM Studio, inclusive para modelos que não são Qwen3, onde é só texto a mais. Reavaliar na fase 4, ao comparar modelos.
  - Ao carregar o LLM, o pipeline pede `--gpu max -c 8192 --parallel 1`. Se já houver um modelo carregado com contexto, paralelismo ou offload diferentes, ele descarrega e recarrega. Se o `lms ps --json` não informar esses campos, vai recarregar sempre: é seguro, mas custa uma carga por análise.
  - Modelos de até 9,5B, que antes carregavam com contexto de 16384, passam a carregar com 8192 (D18).
- **Limitações conhecidas da v1, não corrigidas por ela estar de saída:**
  - `lookaround.py` engole os erros novos de contexto estourado e de resposta vazia e cai para o resultado determinístico, sem aviso no log do job.
  - A guarda de duração roda antes do lookaround, que ainda pode estender um corte para além de 180 s.
  - A contagem de candidatos descartados pode contar duas vezes o mesmo trecho em janelas sobrepostas.
  - O aviso de modelo de nuvem olha o modelo configurado, não o que foi de fato resolvido.
- **Não verificado:** tudo o que depende do LLM real está em [hardware-validation.md](./hardware-validation.md).

## D20 — Harness implementado sem medição; prompt do juiz congelado

- **Decisão:** o harness da fase 1 está em `backend/evals/`, com testes mockados. O corpus está vazio e nenhum baseline foi gerado: por decisão do dono, tudo o que usa o LLM real fica para o fim.
- **Prompt do juiz:** versão `judge-v1`, hash `8999225e4a5bddf7ca37fc795dbdd29675abb20ce23a95fb79eb3d013658fcdb`, em `backend/evals/judge_prompt.py`. Nunca foi executado contra um modelo real. A fase 1 previa calibrá-lo com o dono antes de existir v2; como a ordem mudou, a calibração pode exigir uma versão `judge-v2`, o que é aceitável desde que aconteça antes do primeiro baseline válido.
- **Regras acrescentadas à regra de decisão durante a revisão:**
  - Estabilidade com menos de 2 seeds é indefinida, não 1,0. O padrão do runner passou a 3 seeds.
  - Execuções que falharam contam: uma variante com seed ou vídeo que deu erro é reprovada, em vez de sumir da tabela.
  - Uma variante sem resultado do juiz é reprovada quando a base tem.
  - Base e candidata precisam ter o mesmo hash de prompt e o mesmo modelo de juiz, e o juiz não pode ser o modelo gerador.
- **Desvios conhecidos da spec:**
  - O limite de tempo de D6 é aplicado como 3600 s fixos por vídeo, sem escalar pela duração.
  - O runner parte dos padrões do app, não da configuração ativa do dono. Para medir com o modelo de D15 é preciso passar `--model qwen/qwen3-14b`; sem isso ele avisa e usa o padrão do código.
  - Sem editar `backend/app`, o tempo por etapa interna da análise não é observável; o `trace.json` registra chamadas, caracteres, tokens estimados e tempo total.
  - As frases de referência da validade estrutural são os segmentos do Whisper até a fase 2 entregar `v2/sentences.py`.

## D21 — Fase 2 implementada sem medição; ajustes feitos na revisão

- **Decisão:** a v2 mínima está em `backend/app/domain/analysis/v2/`, ativada só com `llm.analysis_pipeline: "v2"`. Com a chave ausente ou `"v1"`, o caminho da v1 é o mesmo de antes; um teste compara cortes, requisições ao LLM e resposta nos dois casos. Os prompts de S3 e S4 estão na versão `v2-draft-1` e nunca viram o modelo real.
- **Emenda a D14:** quando nada atinge a nota mínima, o grupo de reserva são os candidatos aprovados nos portões com o maior `interest` abaixo do mínimo configurado, desde que seja 3 ou mais. A remoção de sobreposição acontece antes de limitar a 3. A redação original (apenas `interest = 3`) ignorava candidatos melhores quando o mínimo configurado era 5.
- **Emenda a S0:** no empate de pausas ao fundir uma frase curta, a fusão vai para a vizinha mais curta. Sem isso, uma sequência de frases curtas crescia até virar uma frase de 20 s.
- **Erros que derrubam o job, em vez de descartar um candidato:** contexto estourado e resposta vazia, em S3 e em S4. São defeito do pipeline, não do candidato.
- **Registro de descartes:** unidades longas descartadas em S3 ficam em `discarded_units` dentro de `candidates.scored.json`. O original substituído por uma fusão fica como `rejected_gates` com o campo `superseded_by`.
- **Limitações conhecidas:**
  - A análise v2 não pode ser cancelada no meio: o token de cancelamento da rota não chega às chamadas. A v1 tem a mesma lacuna. Em vídeo de 1 h são cerca de 200 chamadas sem ponto de parada.
  - A checagem de sobreposição usa as bordas antes do snap acústico; o snap pode levar dois cortes limítrofes um pouco acima de 0,35.
  - Os quatro artefatos novos não são apagados quando a transcrição é refeita; são sobrescritos na próxima análise.

## D22 — Fase 3 implementada sem medição; chaves de variante e ajustes da revisão

- **Decisão:** S1 (brief e outline), S2 (unidades por LLM) e S5 (refino de borda) estão implementados e ligados por padrão quando `llm.analysis_pipeline` é `"v2"`. Os prompts estão na versão `v2-draft-3` e nunca viram o modelo real. As comparações 3a a 3d da fase 3 não foram feitas.
- **Chave nova `llm.analysis_v2`** (opcional, só lida pela v2), para medir cada peça em separado:

| Chave | Padrão | Outro valor |
|---|---|---|
| `brief` | `"llm"` | `"provisional"`: brief sem LLM, 20/60/120 s |
| `units` | `"llm"` | `"topics"`: unidades vindas dos tópicos da v1 |
| `refine_boundaries` | `true` | `false`: pula S5 |
| `topic_embeddings` | `true` | `false`: constrói os tópicos sem embeddings |

- **Variantes do harness** (`python -m evals.run --preset <nome>`): `v1`, `v2` (fatia da fase 2), `v2-brief`, `v2-units`, `v2-bounds` (pipeline completo) e `v2-noemb`. A ordem de comparação é a da fase 3: cada uma contra a anterior.
- **Ajustes de comportamento feitos na revisão:**
  - Uma unidade longa demais para caber no prompt de S3 é dividida ao meio por contagem de frases, recursivamente, antes de chegar a S3. Sem isso, uma resposta válida de S2 que marcasse só a primeira frase de cada janela derrubava o job por contexto estourado.
  - Resposta vazia e válida de S2 (`{"units": []}`) significa "uma unidade para a janela inteira", não falha.
  - S5 valida início e fim como par antes de validar cada borda isolada; antes, um par válido era descartado quando o novo início sozinho estourava a duração.
  - Todo fallback de S1, S2 e S5 fica registrado em `candidates.scored.json`, além do log do job.
  - `MAX_TOKENS_REFINE` subiu de 150 para 300, porque o prompt de S5 pede uma justificativa por opção.
  - Trecho do outline sem resumo (vídeo curto ou falha no map) é marcado `mixed`, não `content`, para não induzir S2.
- **Limitações conhecidas:**
  - `topic_embeddings: false` só tem efeito quando `topic.segments.json` ainda não existe. No fluxo de um clique os tópicos são construídos antes da análise, então a chave é ignorada ali; o harness contorna isso.
  - O prompt de S2 tendia a produzir unidades longas. A redação foi suavizada e há a proteção em código acima, mas só a medição diz se ficou equilibrado.
  - A decisão de "vídeo curto" confia na duração gravada no job. Se ela estiver errada, a transcrição inteira vai numa chamada só e pode estourar o contexto (com erro claro).

## D23 — Fase 4: só a parte que não depende de medição

- **Decisão:** da fase 4 foram implementados apenas os itens que não exigem medir nada. **Não foram feitos, e continuam dependendo do harness:** escolher o modelo, tornar a v2 o padrão (`llm.analysis_pipeline` segue `"v1"`) e remover a v1.
- **Cancelamento da análise v2** (substitui a limitação registrada em D21): a análise consulta o token de cancelamento do job antes de cada chamada ao LLM, antes de carregar o modelo, depois de obter a GPU e depois da última chamada. Ao cancelar, o job volta para `DOWNLOADED`, nada é gravado e a GPU é liberada. A chamada que já está em andamento termina; a requisição HTTP em si não é interrompida.
- **Raciocínio por etapa** (variante de D16): `chat_json` aceita `reasoning` por chamada, e a chave `analysis_v2.reasoning_stages` aceita `"scoring"` e `"refine"`. Nas etapas com raciocínio, `max_tokens` é multiplicado por 4 (valor inicial). Variante do harness: `v2-think`. Atenção: `reasoning=True` apenas deixa de enviar o comando de desligar; se o modelo raciocina ou não passa a depender do padrão dele.
- **Artefatos antigos derivados:** com `analysis_v2.derive_legacy_artifacts: true`, `semantic.blocks.json` e `topic.segments.json` são gerados a partir de frases e unidades, sem regra léxica, e só são gravados no fim, junto com os cortes. Padrão `false`. Variante do harness: `v2-derived`.
- **Limitações conhecidas:**
  - A rota `/analyze` devolve HTTP 500 quando uma análise v2 é cancelada, porque não trata esse erro. O estado do job fica correto; só a resposta HTTP é ruim. A correção é de uma linha na rota (devolver 409, como a transcrição faz) e está prevista junto das fases 5 a 7.
  - Com a chave de artefatos derivados ligada, o orquestrador de um clique e a rota `/blocks` ainda chamam os construtores da v1 antes da análise. Isso só se resolve na troca do padrão.
  - Blocos derivados fecham por duração e por limite de unidade, não por pausa nem por troca de locutor, e são mais longos que os da v1 (alvo de 12 s, máximo de 30 s). O contador "N blocos" do frontend mostra números menores com a chave ligada.
  - Depois de uma execução com artefatos derivados, desligar a chave não reconstrói os arquivos da v1: eles ficam em disco até a transcrição ser refeita.

## D24 — Fases 5, 6 e 7 implementadas atrás de chaves desligadas

- **Decisão:** o código das fases 5, 6 e 7 existe, mas nenhum recurso muda o comportamento com as chaves ausentes. Isso é verificado por testes que comparam requisições ao LLM, artefatos e cortes com e sem as chaves. Nada foi executado contra modelo real, e as bibliotecas de diarização e de visão são dependências opcionais que não foram instaladas.

| Recurso | Chave | Padrão | Outros valores |
|---|---|---|---|
| Sinal de audiência do YouTube na seleção | `llm.analysis_v2.audience_signal` | `"off"` | `"tiebreak"`, `"bonus"` |
| Diarização | `whisper.diarization` | `"acoustic"` (heurística atual) | `"model"`, `"off"` |
| Visão condicional | `llm.analysis_v2.vision` e `llm.vision_model` | `false` / ausente | `true` e o nome do modelo |
| Aprovação automática | `llm.auto_approve` e `llm.auto_approve_min_interest` | `false` / `5` | `true` / 1 a 5 |
| Exemplos de decisões passadas na pontuação | `llm.analysis_v2.scoring_examples` | `0` | quantidade de exemplos |

- **Sinal de audiência:** o heatmap é salvo em `source.info.json` na ingestão quando o yt-dlp o traz. Ele nunca entra em nenhum prompt: atua só no código da seleção. No modo `bonus` soma no máximo 5 pontos, nunca ultrapassa um nível de `interest` e nunca resgata um candidato reprovado nos portões.
- **Diarização:** com `"model"`, roda depois de o Whisper sair da VRAM. Se a biblioteca ou o modelo não estiverem disponíveis, os locutores ficam `null`; a heurística acústica não volta como fallback. Com `"off"`, idem.
- **Visão:** roda depois de S4, só para candidatos elegíveis (limite de 8), com 6 frames de até 768 px cada. A sequência é: descarregar o LLM de texto, conferir a VRAM, carregar o modelo de visão, descrever, descarregar, conferir a VRAM, recarregar o LLM de texto e repontuar só os descritos. Qualquer pré-condição que falhe pula a etapa com aviso.
- **Histórico e calibração:** `python -m app.domain.analysis.v2.history --rebuild` gera `data/analysis_history.json` e imprime a taxa de aprovação por nível de `interest` e uma sugestão de nota mínima. Nunca aplica a sugestão.
- **Correção de rota:** a rota `/analyze` passou a devolver o mesmo status da transcrição quando a análise é cancelada, em vez de 500 (limitação de D23).
- **Limitações conhecidas:**
  - Exceção a D8: se a VRAM não for liberada depois de o modelo de visão sair, o LLM de texto é recarregado mesmo assim, porque o job precisa dele para terminar. As respostas da visão são descartadas e a falha fica registrada.
  - `auto_approve` só é lido pela v2. Com a v1 ativa, a chave não faz nada e não avisa.
  - Os exemplos de decisões passadas são escolhidos por recência. A escolha por semelhança, prevista em D9, não foi feita: carregar um modelo de embeddings no meio do pipeline exige uma sequência de GPU ainda não validada.
  - O harness guarda só transcrições, não o vídeo, então a variante `v2-vision` fica "pulada" nele até haver vídeos no corpus. O juiz congelado também não mede visão.
  - O modelo de visão é carregado pelo mesmo mecanismo do LLM de texto, com os mesmos parâmetros de carga.
- **Escrito sem nunca ter sido executado:** as chamadas à biblioteca de diarização, o formato das requisições com imagem para LM Studio e Ollama, o comando de extração de frames e o formato do heatmap do yt-dlp. Tudo isso está na lista de validação.
- **Fase 8 (cortes não contínuos):** não implementada. Depende do frontend e as specs exigem decisão à parte.
