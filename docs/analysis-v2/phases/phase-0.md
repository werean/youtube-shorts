# Fase 0 — Saneamento da v1

## Objetivo

Deixar o pipeline atual determinístico e sem código feito para teste, para que o baseline da fase 1 meça o pipeline e não ruído. Nenhuma mudança de arquitetura.

## Depende de

- Nada. O modelo fixo foi decidido: Qwen3 14B, contexto 8192, raciocínio desligado (D15 e D16 em [decisions.md](../decisions.md)).

## Contexto verificado no código

- A configuração ativa é `data/custom_settings.json` sempre que o arquivo existe (`core/tool_configs.py`, `load_active_tool_configs`). Hoje ele define `llm.model = "gpt-oss:120b-cloud"`, marcado como `source: "cloud"`, e um `system_prompt` legado.
- `analyze_job` detecta o prompt legado e usa o canônico, com aviso no log.
- `word_timestamps` é forçado para `True` em `domain/transcription/service.py`, então o valor `false` do arquivo não tem efeito.
- `chat_json` usa `temperature=0.2` por padrão e não envia seed (`infrastructure/llm/unified_adapter.py`).
- `CUTS_RESPONSE_JSON_SCHEMA` lista `score` antes dos campos de evidência (`core/config.py`).
- Não há limite de duração de corte em nenhum ponto.
- `narrative_miner.py` fabrica cortes quando o LLM responde exatamente `"ok"`, que é o que o stub de `backend/tests/conftest.py` devolve. `unified_adapter.py` tem um desvio para o mesmo valor.

## Entregas

1. **Determinismo**
   - `chat_json` ganha parâmetro `seed` e o envia aos dois provedores (LM Studio: `seed`; Ollama: `options.seed`).
   - Padrão de `temperature` passa a `0.0`.
   - A análise lê `llm.analysis_seed` (padrão `42`). `normalize_llm_config` passa a preservar a chave.

2. **Schema**
   - Em `CUTS_RESPONSE_JSON_SCHEMA`, mover `score` para depois de `content_reason`, em `properties` e em `required`.

3. **Guarda de duração**
   - Constantes `MIN_CUT_SECONDS = 10` e `MAX_CUT_SECONDS = 180` em `core/config.py`.
   - Candidatos fora da faixa são descartados em `parse_candidate_cuts_from_llm_payload`, com aviso no log do job informando quantos.

4. **Remover código feito para teste**
   - Apagar o ramo `exc.raw_text.strip() == "ok"` em `mine_narrative_cuts` e a função `_synthesize_fallback_candidates_from_blocks`.
   - Apagar o desvio equivalente em `_execute_chat_json_with_repair`.
   - O stub de `conftest.py` passa a devolver JSON válido para o schema pedido. Testes que dependiam dos cortes sintéticos passam a fornecer a resposta do LLM explicitamente na fixture.

5. **Configuração local**
   - Ajustar `llm.model` em `data/custom_settings.json` para o Qwen3 14B (`qwen/qwen3-14b` no LM Studio; `qwen3:14b` no Ollama) e registrá-lo em `registered_models` como `source: "local"`.
   - `LMSTUDIO_CONTEXT_LENGTH` continua `8192`. Não subir para 16384 nesta fase (D15).
   - Na análise, registrar aviso no log do job quando o modelo resolvido estiver registrado com `source: "cloud"`. Não bloquear.

6. **Raciocínio desligado (D16)**
   - Descobrir como desligar o modo de raciocínio do Qwen3 pela API nos dois provedores e aplicar nas chamadas da análise. Não confiar no ajuste feito na interface do LM Studio.
   - Verificar, com o LLM real, que a saída em JSON restrito continua válida com o raciocínio desligado e que `max_tokens` não é consumido por tokens de raciocínio.
   - Registrar em `decisions.md` o parâmetro usado e o resultado da verificação.

7. **Estouro de contexto com erro claro (D18)**
   - Antes de cada chamada, estimar o tamanho do prompt mais `max_tokens` e comparar com o contexto configurado. Se não couber, levantar erro específico com os dois números, sem enviar.
   - Resposta com conteúdo vazio passa a gerar erro próprio, citando estouro de contexto como causa provável, em vez de "JSON inválido".

8. **Parâmetros de carga do modelo (D18)**
   - Ler em `infrastructure/llm/lmstudio_cli.py` como o pipeline carrega o modelo e garantir: contexto 8192, todas as camadas na GPU e uma predição por vez.
   - Registrar no log do job, ao carregar, o contexto e a quantidade de camadas na GPU informados pelo LM Studio.
   - Verificar com o LLM real que, carregado pelo pipeline, o modelo gera perto de 45 tokens/s. Se ficar perto de 20, o modelo não está inteiro na placa.

## Arquivos

Pode alterar:

- `backend/app/infrastructure/llm/unified_adapter.py`
- `backend/app/infrastructure/llm/lmstudio_cli.py`
- `backend/app/domain/analysis/narrative_miner.py`
- `backend/app/core/config.py`
- `backend/app/core/tool_configs.py`
- `backend/tests/conftest.py` e os testes que quebrarem
- `data/custom_settings.json` (só a chave `llm.model`, depois da resposta do dono)

Não pode alterar: qualquer outro arquivo, `frontend/`, `shared/`.

## Fora de escopo

- Mexer em listas léxicas, blocos, tópicos ou lookaround. A v1 fica como está.
- Criar o pacote `v2/`.

## Testes

- `pytest` inteiro passando.
- Teste novo: `chat_json` envia `seed` e `temperature=0` para os dois provedores.
- Teste novo: candidato de 300 s e candidato de 4 s são descartados.
- Teste novo: resposta inválida do LLM leva o job a `ERROR`; nenhum corte é gravado.
- Teste novo: prompt maior que o contexto levanta o erro específico sem chamar o provedor; resposta vazia levanta o erro de conteúdo vazio.

## Critério de pronto

1. `pytest` verde.
2. Busca por `== "ok"` em `backend/app/domain` e `backend/app/infrastructure/llm` não retorna nada.
3. No PC do dono, rodar a análise duas vezes no mesmo job produz `cuts.suggested.json` com os mesmos `start`, `end` e ordem. Esta verificação usa o LLM real e é feita pelo dono ou com autorização dele.
4. O log do job mostra o Qwen3 14B como modelo resolvido e nenhuma resposta da análise contém bloco de raciocínio.

## Modelos

Implementação e testes: Sonnet. Revisão: Opus, com [review-checklist.md](../review-checklist.md).
