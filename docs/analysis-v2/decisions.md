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
