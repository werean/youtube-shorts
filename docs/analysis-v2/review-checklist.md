# Checklist de revisão independente

Usado pelo revisor (Opus) ao fim de cada fase. O revisor recebe este arquivo, o arquivo da fase, o diff e a tabela do harness. Ele **não** recebe o raciocínio de quem implementou.

O revisor responde cada item com `ok`, `falha` ou `não se aplica`, citando arquivo e linha quando for `falha`. Uma `falha` nos itens de 1 a 5 reprova a fase.

## 1. Ajuste ao teste ou ao vídeo

- [ ] Não há lista de palavras, frases ou marcadores de idioma específico em código novo.
- [ ] Não há condição que dependa de título, canal, nome de arquivo, slug do corpus ou rótulo de formato.
- [ ] Nenhum prompt cita um gênero como exemplo de forma que favoreça esse gênero.
- [ ] Nenhum código de produção reconhece saída de stub de teste ou muda de comportamento sob teste.
- [ ] Nenhum fallback fabrica cortes.
- [ ] Constantes novas estão em `v2/constants.py`, com a origem do valor comentada.

## 2. Evidência do harness

- [ ] A tabela anexada foi gerada com o código do diff (confira o hash dos prompts e o modelo no `trace.json`).
- [ ] A regra de decisão de `eval-harness.md` foi aplicada por formato, e o pior formato não piorou.
- [ ] Os vídeos de reserva só foram rodados no portão da fase.
- [ ] Nenhum vídeo passou do limite de tempo.
- [ ] O prompt do juiz não foi alterado.

## 3. Contratos e compatibilidade

- [ ] Nenhuma rota, campo de resposta ou tipo de `shared/contracts.ts` foi removido ou renomeado.
- [ ] `cuts.suggested.json` continua válido para o modelo `Cut`.
- [ ] `semantic.blocks.json` e `topic.segments.json` continuam sendo gerados.
- [ ] Chaves novas de configuração são opcionais e têm padrão que preserva o comportamento anterior.
- [ ] Toda escrita de `.json` é atômica.
- [ ] Nenhum arquivo fora da lista da fase foi alterado.

## 4. Saída do LLM

- [ ] Todo ID devolvido pelo modelo é restrito por `enum` montado em tempo de execução.
- [ ] O modelo nunca devolve timestamp.
- [ ] `temperature = 0` e seed fixo em todas as chamadas da análise.
- [ ] Em schemas de pontuação, a justificativa vem antes da nota.
- [ ] Toda resposta inválida tem tratamento definido e registrado; nenhuma é engolida em silêncio.

## 5. GPU e tempo

- [ ] Nenhum modelo é carregado enquanto outro ocupa a VRAM.
- [ ] A análise roda dentro de um único `gpu_slot`, sem recarregar o modelo entre chamadas.
- [ ] Não há offload parcial para RAM configurado.

## 6. Testes

- [ ] Os testes novos verificam propriedades (invariantes de `stage-contracts.md`), não um exemplo único.
- [ ] Há pelo menos uma fixture em idioma diferente de PT e EN e uma sem pontuação.
- [ ] O caminho de falha de cada etapa tem teste.
- [ ] Nenhum teste usa GPU, rede, modelo real ou renderização.
- [ ] As fixtures não foram escritas para casar com regras do código.

## 7. Leitura crítica

- [ ] Existe algo no diff que melhora a métrica sem melhorar o corte? (por exemplo: devolver menos cortes para subir a taxa do juiz, ou cortes maiores para subir a estabilidade)
- [ ] `coverage`, contagem e duração dos cortes mudaram de forma coerente com o objetivo da fase?
- [ ] Olhando 5 cortes ao acaso em `candidates.scored.json`, as respostas da pontuação batem com o texto?

## Saída do revisor

```
Fase: N
Veredito: aprovado | aprovado com ressalvas | reprovado
Falhas: [item, arquivo:linha, descrição]
Ressalvas: [...]
O que eu não consegui verificar: [...]
```
