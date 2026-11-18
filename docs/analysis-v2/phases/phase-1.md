# Fase 1 — Harness de avaliação e baseline

## Objetivo

Construir o harness descrito em [eval-harness.md](../eval-harness.md), montar o corpus e registrar o baseline da v1. A partir daqui, toda fase é julgada por esta tabela.

## Depende de

- Fase 0 concluída.
- Pendência 2 do README: autorização para rodar o harness no PC com o LLM local.
- Pendência 3 do README: lista de vídeos e divisão entre ajuste e reserva.

## Entregas

1. **Pacote `backend/evals/`** com `import_job.py`, `run.py`, `metrics.py`, `judge.py`, `report.py`, conforme a estrutura da spec.
2. **`.gitignore`**: `backend/evals/corpus/*/` e `backend/evals/runs/`.
3. **Isolamento**: o runner cria um diretório de dados temporário por execução e nunca escreve em `data/jobs/` real. O `pytest` não coleta nada de `backend/evals/`.
4. **Corpus**: 10 a 15 vídeos importados, `corpus.manifest.json` preenchido e versionado, cerca de um terço em `holdout`.
5. **Gabarito leve**: `labels.json` em pelo menos 5 vídeos. É trabalho manual do dono; o agente só prepara o arquivo com o formato.
6. **Juiz**: prompt escrito, congelado e com hash registrado em `decisions.md`. Modelo inicial: um Gemma de 12B (D17), de família diferente do gerador.
7. **Baseline**: execução `v1-baseline` com 3 seeds em `dev` e em `holdout`, com `report.md` salvo.

## Arquivos

Pode criar e alterar:

- `backend/evals/**`
- `.gitignore`
- `backend/pyproject.toml`, só se for preciso excluir `evals` da coleta do `pytest`
- `backend/tests/test_evals_metrics.py` (novo)

Não pode alterar: `backend/app/**`. Se o harness precisar de um ponto de entrada que não existe, registre em `decisions.md` e pare.

## Fora de escopo

- Qualquer mudança no pipeline.
- Ajustar o prompt do juiz depois de ver resultados da v2.

## Testes

Mockados, em `backend/tests/test_evals_metrics.py`:

- Casamento por IoU e cálculo de F1, incluindo conjuntos vazios e cortes idênticos.
- Jitter de borda em casos construídos à mão.
- `must_recall` e `never_violations` com faixas conhecidas.
- Aplicação da regra de decisão: um caso que passa, um que reprova por piorar um único formato.

Runner, juiz e importação não entram no `pytest`: dependem de LLM real.

## Critério de pronto

1. `pytest` verde, incluindo os testes de métricas.
2. `python -m evals.run --split dev --variant v1-baseline --seeds 3` termina sem erro em todos os vídeos de `dev`.
3. `report.md` do baseline existe, com tabela por formato e todas as métricas da spec.
4. Rodar o baseline duas vezes com as mesmas seeds dá as mesmas métricas (o determinismo da fase 0 se mantém no harness).
5. O dono do projeto leu a tabela e confirma que ela reflete o que ele vê nos vídeos. Se o juiz aprova cortes claramente ruins, o prompt do juiz é corrigido **agora**, antes de existir v2.

## Modelos

Implementação e testes: Sonnet. Prompt do juiz: Fable. Revisão: Opus.

## Observação

O número que esta fase produz já é uma decisão: se a estabilidade e a taxa do juiz da v1 depois da fase 0 forem boas em todos os formatos, a reescrita das fases 2 e 3 deve ser reavaliada antes de começar.
