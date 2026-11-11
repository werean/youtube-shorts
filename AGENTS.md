# AGENTS.md — Memória Operacional e Guia de Arquitetura para Agentes

Guia operacional e memória persistente para agentes de IA trabalhando no repositório `youtube-shorts`.

---

## 1. Documentos Oficiais de Especificação (Leitura Obrigatória)

Antes de implementar ou alterar qualquer funcionalidade no backend, leia integralmente os documentos de especificação na raiz do projeto:

1. **[`DESIGN.md`](./DESIGN.md)** — Especificação completa da API REST, contratos HTTP/JSON, streaming HTTP Range (`206 Partial Content`), envelope de erros e compatibilidade com [`shared/contracts.ts`](./shared/contracts.ts) e [`frontend/src/api/`](./frontend/src/api).
2. **[`ARCHITECTURE.md`](./ARCHITECTURE.md)** — Desenho técnico do motor de IA local em **Python (`FastAPI`)**, pipeline algorítmico em 5 estágios, escalonador de recursos por hardware (`IOQueue`, `GPUMutex` + `ActiveVRAMBudgetManager`, `RenderWorkerPool`), máquina de estados do Cinegrafista Virtual 9:16, `pyproject.toml`, templates canônicos de prompts/schemas JSON e persistência atômica em arquivos `.json`.
3. **[`shared/contracts.ts`](./shared/contracts.ts)** — Contratos compartilhados entre Frontend e Backend.

---

## 2. Coordenação Multi-Sessão (Frontend vs. Backend)

- **Sessão de Frontend:** Trabalha exclusivamente em `frontend/` na branch `feature/frontend-liquid-glass` (implementando a interface Linear Studio / Liquid Glass).
- **Sessão de Backend (Esta Sessão):** Trabalha exclusivamente na branch `feature/backend` focada no backend (`backend/`, `scripts/` de inicialização do backend e docs de arquitetura).
- **Regra de Isolamento:**
  - **NÃO** edite arquivos dentro de `frontend/` a partir da sessão de Backend.
  - Mantenha 100% de compatibilidade com todas as rotas existentes e tipos de [`shared/contracts.ts`](./shared/contracts.ts). Campos novos nos payloads de resposta devem ser **aditivos e opcionais** até que o Frontend os integre.

---

## 3. Perfil de Hardware de Referência e Premissas de Produto

- **Hardware Alvo Principal:**
  - **GPU:** NVIDIA GeForce **RTX 5070 (12 GB GDDR7 VRAM, Arquitetura Blackwell, Tensor Cores 5ª Geração, NVENC 9ª Geração)**.
  - **RAM:** **32 GB DDR4 3200MHz**.
- **Premissas Inegociáveis do Produto:**
  1. **100% IA Local e Custo Zero:** Nenhum fluxo deve depender de APIs pagas na nuvem.
  2. **Suporte Nativo Dual a Provedores Locais:** Suporte integrado a **LM Studio (`http://127.0.0.1:1234/v1`)** e **Ollama (`http://127.0.0.1:11434`)** com autodetecção zero-config do modelo local carregado.
  3. **Modelos Locais Padrão Calibrados para RTX 5070:**
     - **LLM Principal:** `qwen2.5:14b` (`Qwen2.5-14B-Instruct-GGUF Q4_K_M`, ~9.5 GB VRAM), com `qwen2.5:7b` e `gemma3:12b` pré-registrados.
     - **Embeddings:** `nomic-embed-text` (`nomic-embed-text-v1.5`, ~270 MB, executado com offload CPU `num_gpu=0` ou unload imediato para evitar *model thrashing* na VRAM com o modelo 14B).
     - **Transcrição:** `faster-whisper` com `large-v3-turbo` em `compute_type="int8_float16"` (~1.8 GB VRAM) + `Silero VAD` + `word_timestamps=True` (com fallback transparente para `device="cpu", compute_type="int8"` caso a VRAM livre seja $< 2.2\text{ GB}$).
  4. **Cortes com Começo, Meio e Fim Reais (~90s de Média Flexível):**
     - A duração do corte **não é rígida**: tem média de referência de ~90 segundos, mas é ditada exclusivamente pelo início e conclusão naturais do sub-assunto (podendo variar de ~15s–50s para assuntos rápidos/vídeos curtos até ~120s–160s para histórias completas).
     - Todo corte passa pelo pré-filtro Top-$K$ e **Boundary Lookaround (`[-3, +3]` blocos vizinhos)** para garantir que o início não dependa de contexto anterior e o fim conclua o raciocínio, seguido de **Snap Acústico em Vale de Energia RMS + Zero-Crossing**.
  5. **Experiência 1-Clique para Leigos e Curadoria para Avançados:**
     - Um usuário leigo deve conseguir apenas colar um link do YouTube ou enviar um arquivo local e receber os vídeos verticais `.mp4` prontos sem configurar nada manualmente.

---

## 4. Invariantes Críticos do Sistema

Nunca quebre estes invariantes durante a implementação:

### 4.1 Rotas e Contratos da API (Porta `8000`)
- `/health` (`GET`)
- `/jobs` (`POST`)
- `/jobs/upload` (`POST`)
- `/jobs/:job_id` (`GET`)
- `/jobs/:job_id/events` (`GET` — **Server-Sent Events `text/event-stream` com progresso em tempo real, ETA e eventos de estado**)
- `/jobs/:job_id/rename` (`POST` e `PUT` — **retorna o objeto `Job` diretamente no top-level**)
- `/jobs/:job_id/ingest` (`POST` — **`video_path` é `/media/videos/:job_id` e `full_path` o caminho físico no disco**)
- `/jobs/:job_id/logs/:task` (`GET` — `task` $\in$ `ingest | transcription | render`)
- `/jobs/:job_id/transcribe` (`POST` — **retorna `transcription`, `segments` e `available_formats: { segments, text, vtt }`**)
- `/jobs/:job_id/transcribe/cancel` (`POST`)
- `/jobs/:job_id/transcription` (`GET`, `DELETE`)
- `/jobs/:job_id/transcription/:format` (`DELETE` — aceita `segments | text | vtt` e aliases `json | txt | vtt`, resetando `job.status = "DOWNLOADED"` ao remover `segments`/tudo)
- `/jobs/:job_id/blocks` (`POST`)
- `/jobs/:job_id/analyze` (`POST`)
- `/jobs/:job_id/cuts` (`GET`, `PUT`)
- `/jobs/:job_id/cuts/:cut_id/approve` (`POST`)
- `/jobs/:job_id/cuts/:cut_id/reject` (`POST`)
- `/jobs/:job_id/render` (`POST`)
- `/jobs/:job_id/render/cancel` (`POST` — mata árvore FFmpeg e limpa arquivos `.mp4`/`.ass` parciais)
- `/jobs/:job_id/renders` (`GET`)
- `/jobs/:job_id/renders/:file` (`DELETE` — retorna `{ "ok": true, "file": "..." }`)
- `/jobs/:job_id/renders/:file/open-folder` (`POST`)
- `/jobs/:job_id/run` (`POST`)
- `/jobs/batch/run` (`POST`)
- `/jobs/batch/:batch_id/status` (`GET`)
- `/jobs/batch/:batch_id/cancel` (`POST` — propaga cancelamento imediato para a tarefa ativa do `current_job_id`)
- `/jobs/batch/:batch_id/continue` (`POST`)
- `/videos` (`GET`)
- `/videos/archived` (`GET`)
- `/videos/:job_id/archive` (`POST`)
- `/videos/:job_id` (`DELETE`)
- `/videos/:job_id/open-folder` (`POST`)
- `/media/videos/:job_id` (`GET` com suporte a HTTP `Range` / `206 Partial Content`)
- `/media/shorts/:job_id/:file` (`GET` com suporte a HTTP `Range` / `206 Partial Content`)
- `/config` (`GET`)
- `/config/llm-models` e alias `/config/ollama-models` (`GET`)
- `/config/llm-models/register` e alias `/config/ollama-models/register` (`POST` — erros `400` usam `{ "detail": "..." }`)
- `/config/llm-models/:modelName` e alias `/config/ollama-models/:modelName` (`DELETE` — erros `400` usam `{ "detail": "..." }`)
- `/config/settings` (`GET`, `POST`)
- `/config/tool-configs` (`GET`, `POST` — retorna `{ "source", "defaults", "active" }`)
- `/config/tool-configs/reset` (`POST`)
- `/config/tool-configs/reset/:section` (`POST`)
- `/config/tool-configs/import` (`POST`)
- `/config/llm-prompt` (`GET`)
- `/config/llm-prompt/default` (`GET`)
- `/config/llm-saved-prompts` (`GET`, `POST`)
- `/config/common-folders` (`GET`)
- `/config/select-folder` (`POST`)
- `/config/dependencies` (`GET`)
- `/config/dependencies/:name/instructions` (`GET` — `404` retorna `{ "error": "Dependency not found" }`)
- `/config/dependencies/:name/install` (`POST`)
- `/config/dependencies/:name/uninstall` (`POST`)
- `/config/dependencies/:name/install/start` (`POST`)
- `/config/dependencies/:name/uninstall/start` (`POST`)
- `/config/dependencies/install-sessions/:sessionId` (`GET`)
- `/config/dependencies/install-sessions/:sessionId/cancel` (`POST`)
- `/config/dependencies/:name/open-terminal` (`POST`)

### 4.2 Artefatos Persistidos em Disco (Sem Banco de Dados)
- Artefatos de estado e análise do Job residem em `data/jobs/<job_id>/` com os nomes canônicos:
  - `job.json`
  - `source.info.json`
  - `semantic.blocks.json`
  - `topic.segments.json` (sempre gerado, mesmo para vídeos `< 150s` com tópico único `t1`)
  - `cuts.suggested.json`
- Artefatos de transcrição residem em `{media.base_dir}/{video_name}/transcrições/` (com fallback de leitura em `data/jobs/<job_id>/`):
  - `transcription.segments.json`
  - `transcription.words.json` (alinhamento palavra-por-palavra)
  - `transcription.txt`
  - `transcription.vtt`
- Configurações globais residem em `data/`:
  - `settings.json` (com normalização cross-OS automática de `base_dir` entre Windows e Linux)
  - `default_configs.json`
  - `custom_settings.json`
  - `saved_llm_prompts.json` (nome canônico preservado)
- Toda escrita de arquivo `.json` deve ser **atômica** (`write .tmp` + `fsync` + `os.replace`).

### 4.3 Concorrência Isolada por Recurso de Hardware e Orçamento de VRAM
- **`GPUMutex` + `ActiveVRAMBudgetManager` (Concorrência = `1`):**
  - Nunca rodar `faster-whisper` e LLM ao mesmo tempo.
  - Antes de alocar `faster-whisper` em CUDA, checar VRAM livre ($\ge 2.2\text{ GB}$); se insuficiente, solicitar unload de modelos ociosos no Ollama (`keep_alive: 0`) ou cair para `device="cpu", compute_type="int8"`.
  - Sempre descarregar o modelo Whisper da VRAM (`del model; gc.collect(); torch.cuda.empty_cache()`) no bloco `finally:` ao concluir ou cancelar a transcrição.
- **`IOQueue` (Concorrência = `2`):** Downloads `yt-dlp` e extração de áudio PCM 16kHz rodam de forma assíncrona em paralelo à GPU.
- **`RenderWorkerPool` (Concorrência = `2`):** Até 2 cortes simultâneos combinando Auto-Reframe na CPU (`OpenCV`/`MediaPipe`) com encode no ASIC dedicado **NVENC** (`h264_nvenc`) via `-filter_complex_script`.

---

## 5. Runbook e Checklist Persistente de Execução (Backend 100% Python Clean)

> **REGRAS OBRIGATÓRIAS PARA OS AGENTES IMPLEMENTADORES:**
> 1. **Testes 100% Lógicos (PROIBIDO Usar Hardware Real / GPU / Downloads Pesados):**
>    - Toda a suíte `pytest` (`backend/tests/test_phase*.py`) deve validar **exclusivamente a lógica algorítmica, máquinas de estado, persistência atômica e contratos HTTP/JSON** usando **mocks, fakes, stubs e fixtures sintéticas leves em memória/tmp**.
>    - **NUNCA** baixe modelos reais (`faster-whisper`, `nomic-embed-text`, `qwen2.5`), **NUNCA** aloque GPU/CUDA/NVENC real, **NUNCA** faça downloads reais do YouTube via `yt-dlp` e **NUNCA** execute renders pesados de vídeo durante os testes automatizados. A validação em hardware físico real será feita exclusivamente pelo usuário no PC dele.
> 2. **Atualização de Progresso:**
>    - Ao concluir cada fase abaixo e validar seus testes lógicos automatizados, **edite este arquivo (`AGENTS.md`) marcando `[x]` na fase concluída**. Caso a sessão sofra compactação de contexto ou seja retomada em outra conversa, leia a tabela abaixo para retomar imediatamente da próxima fase pendente `[ ]`.

### 5.1 Checklist de Status das Fases

| Status | Fase | Escopo Principal e Arquivos Alvo | Critério de Pronto (Definition of Done — Testes 100% Lógicos/Mockados) |
| :--- | :--- | :--- | :--- |
| `[x]` | **Fase 1** | **Fundação FastAPI, Storage Atômico, Configs, Biblioteca e Media Range 206**<br>- Criar `backend/pyproject.toml` (conforme Seção 5 de `ARCHITECTURE.md`) e ambiente virtual `.venv`.<br>- Criar `backend/app/core/` (`config.py`, `paths.py`, `settings.py` com normalização cross-OS, `tool_configs.py`).<br>- Atualizar `data/default_configs.json` (conforme Seção 6.4 de `ARCHITECTURE.md`).<br>- Criar `backend/app/models/`, `backend/app/infrastructure/storage/atomic_store.py`, `backend/app/application/runtime_service.py`, `job_lifecycle.py` e `scheduler.py` (`IOQueue`, `GPUMutex`, `ActiveVRAMBudgetManager`, `RenderWorkerPool`).<br>- Implementar `api/routers/health.py`, `config.py` (incluindo `/config/llm-models` e alias `/config/ollama-models`), `videos.py` e `media.py` (com HTTP Range `206 Partial Content`). | 1. `pytest backend/tests/test_phase1_foundation.py` passando 100% (testando logicamente escrita atômica, locks do scheduler, `/health`, `/config/*`, `/videos/*` e `/media/*` `206 Partial Content` sobre bytes sintéticos). |
| `[x]` | **Fase 2** | **Ingestão Nativa (`yt_dlp` + `ffprobe`), Upload Local, SSE Events e Rotas Iniciais de `/jobs`**<br>- Implementar `backend/app/domain/ingest/` e `infrastructure/audio/pcm_extractor.py`.<br>- Garantir preenchimento obrigatório de `job.video_duration_seconds`, extração de `chapters` para `source.info.json` e extração de `audio_16k.wav` em `{video_dir}/transcrições/`.<br>- Implementar `POST /jobs`, `POST /jobs/upload`, `GET /jobs/:id`, `GET /jobs/:id/events` (SSE em tempo real), `POST` e `PUT /jobs/:id/rename` (retornando `Job` no top-level), `POST /jobs/:id/ingest` (`video_path: "/media/videos/:id"`, `full_path` físico) e `GET /jobs/:id/logs/:task`. | 1. `pytest backend/tests/test_phase2_ingest.py` passando 100% com mocks de `yt_dlp`/`ffprobe` (validando `/jobs`, `/events` SSE, `/rename`, `/ingest`, `/upload` e extração de `video_duration_seconds`). |
| `[x]` | **Fase 3** | **Motor de Transcrição GPU (`faster-whisper` + `Silero VAD` + Prosódia em Chunks)**<br>- Implementar `backend/app/infrastructure/audio/acoustic_dsp.py` (energia RMS em janelas de `10ms` e detecção acústica de troca de locutor em chunks de 5 min) e `domain/transcription/`.<br>- Integrar `ActiveVRAMBudgetManager` (checando $\ge 2.2\text{ GB}$ VRAM livre, unload de modelos ociosos no Ollama ou fallback `cpu int8`) + unload explícito no `finally:`.<br>- Implementar cancelamento cooperativo `< 500ms`, filtro anti-alucinação e gravação de `transcription.segments.json`, `transcription.words.json`, `.txt` e `.vtt` em `{video_dir}/transcrições/`.<br>- Implementar `POST /jobs/:id/transcribe`, `POST /jobs/:id/transcribe/cancel`, `GET` e `DELETE /jobs/:id/transcription` e `DELETE /jobs/:id/transcription/:format` (aceitando `segments\|text\|vtt` e aliases `json\|txt\|vtt`). | 1. `pytest backend/tests/test_phase3_transcription.py` passando 100% com adapter Whisper mockado e arrays numpy sintéticos (testando `available_formats`, decisão de VRAM/fallback, cancelamento cooperativo, deleção por formato com reset para `DOWNLOADED` e filtro anti-alucinação). |
| `[x]` | **Fase 4** | **Segmentação Consciente de Discurso e TextTiling Contextual (`domain/segmentation`)**<br>- Implementar `semantic_blocks.py` (conectivos bloqueadores de abertura PT/EN, gatilhos de pergunta/resposta e pausas) gerando `semantic.blocks.json`.<br>- Implementar `topic_segmentation.py` com janelas deslizantes $k=3$, embeddings via LM Studio / Ollama (`nomic-embed-text` com `num_gpu=0` para evitar *model thrashing*), *Depth Score* adaptativo e geração garantida de `topic.segments.json` (incluindo tópico único `t1` para vídeos `< 150s`).<br>- Implementar `POST /jobs/:id/blocks`. | 1. `pytest backend/tests/test_phase4_segmentation.py` passando 100% com vetores de embedding mockados (testando vídeos curtos `< 150s`, vídeos longos $\ge 150\text{s}$, bloqueio de conectivos dependentes e cálculo matemático de *Depth Score*). |
| `[x]` | **Fase 5** | **Motor de Cortes em 3 Fases (`LM Studio` + `Ollama` + Top-K Boundary Lookaround + Snap RMS)**<br>- Implementar `backend/app/infrastructure/llm/unified_adapter.py` (suporte dual LM Studio `:1234/v1` e Ollama `:11434`, autodetecção zero-config e Structured Outputs via JSON Schema da Seção 6.2 de `ARCHITECTURE.md`).<br>- Implementar `domain/analysis/` com Fase 4A (janelas sobrepostas 25% e média flexível ~90s), Fase 4B (pré-filtro Top-18 + *Boundary Lookaround* `[-3, +3]` blocos vizinhos da Seção 6.3) e Fase 4C (expansão determinística de `block_ids`, deduplicação IoU $> 0.35$, teto `max_suggested_cuts` e snap acústico em vale RMS `10ms` + zero-crossing).<br>- Implementar `POST /jobs/:id/analyze`, `GET` e `PUT /jobs/:id/cuts`, `POST /jobs/:id/cuts/:cut_id/approve` e `reject`. | 1. `pytest backend/tests/test_phase5_analysis.py` passando 100% com cliente HTTP LLM mockado (validando recuo automático em início dependente, extensão de conclusão em Lookaround `[-3, +3]`, deduplicação IoU e matemática de snap RMS). |
| `[x]` | **Fase 6** | **Cinegrafista Virtual 9:16, Legendas `.ass` e FFmpeg NVENC (`-filter_complex_script`)**<br>- Implementar `backend/app/infrastructure/vision/` e `domain/rendering/` com máquina de estados completa (`0`, `1`, `2`, `3+` rostos, filtro de rostos falsos $< 1.5\%$, Hold-Last-Position $< 2\text{s}$, fallback automático para `blur`/`zoom` em slides/screen-share sem rosto $\ge 2\text{s}$, Deadband 15%, Savitzky-Golay isolado por `shot` HSV e simplificação Ramer-Douglas-Peucker).<br>- Implementar gerador `.ass` palavra-por-palavra (sincronizado com `trim_internal_silence`), `-filter_complex_script`, áudio `-14 LUFS` e `h264_nvenc` (com fallback automático para `libx264`).<br>- Implementar `POST /jobs/:id/render`, `POST /jobs/:id/render/cancel` (matando árvore FFmpeg e limpando `.mp4`/`.ass` parciais), `GET /jobs/:id/renders`, `DELETE /jobs/:id/renders/:file` e `open-folder`. | 1. `pytest backend/tests/test_phase6_rendering.py` passando 100% com trajetórias de bounding-boxes sintéticas e subprocesso FFmpeg mockado (validando máquina de estados `0/1/2/3+` rostos, isolamento por corte de cena, geração `.ass`, conteúdo de `-filter_complex_script` e limpeza em `/render/cancel`). |
| `[x]` | **Fase 7** | **Orquestrador 1-Clique, Batch Pipeline, Limpeza Total do Legado TS e Validação Lógica Final**<br>- Implementar `backend/app/application/orchestrator.py` (`POST /jobs/:id/run` suportando início tanto em `PENDING` quanto em `DOWNLOADED`, e rotas `/jobs/batch/run`, `status`, `cancel` em cascata e `continue`).<br>- **Remover 100% do código TypeScript legado do backend** (`backend/src/`, `backend/package.json`, `backend/tsconfig.json`, `backend/tests/*.ts` e `tests/bun/contracts`), deixando `backend/` 100% Python puro.<br>- Atualizar `scripts/dev-backend.ts` e `package.json` raiz (removendo `backend` dos workspaces Node/Bun) para iniciar o FastAPI (`uvicorn app.main:app --host 0.0.0.0 --port 8000`) de forma cross-OS.<br>- Executar suíte completa de testes lógicos Python (`pytest`). | 1. `pytest` (toda a suíte lógica `backend/tests/`) passando 100% sem tocar em GPU/hardware.<br>2. Zero arquivos `.ts` restantes dentro de `backend/`.<br>3. Smoke test de `GET /health` respondendo `200 OK`. |

### 5.2 Orquestração em Ondas para Execução em Swarm (`/swarm` + `/goal`)

Como todos os subagentes compartilham o mesmo workspace (`Workspace: "inherit"`), a execução em Swarm deve usar **Ondas com Isolamento Estrito de Diretórios (Zero Conflito de Escrita)** para evitar que dois agentes editem o mesmo arquivo simultaneamente:

1. **Onda 1 — Fundação e Contratos Base (Sequencial — Fase 1):**
   - Um agente cria `backend/pyproject.toml`, `.venv`, `backend/app/core/*`, `backend/app/models/*`, `backend/app/infrastructure/storage/*`, `backend/app/application/{scheduler,runtime_service,job_lifecycle}.py`, rotas da Fase 1 (`health.py`, `config.py`, `videos.py`, `media.py`) e valida `pytest backend/tests/test_phase1_foundation.py`.
2. **Onda 2 — Motores de Domínio e Infraestrutura em Paralelo (Fases 2 a 6 com Diretórios Isolados):**
   - **Agente Worker A (Ingestão, Áudio DSP & Transcrição — Fases 2 e 3):** Trabalha **exclusivamente** em `backend/app/domain/ingest/`, `backend/app/infrastructure/audio/`, `backend/app/domain/transcription/`, `backend/tests/test_phase2_ingest.py` e `backend/tests/test_phase3_transcription.py` (usando 100% mocks/fixtures sintéticas nos testes).
   - **Agente Worker B (Blocos Semânticos, TextTiling & Motor de Cortes LLM — Fases 4 e 5):** Trabalha **exclusivamente** em `backend/app/domain/segmentation/`, `backend/app/infrastructure/llm/`, `backend/app/domain/analysis/`, `backend/tests/test_phase4_segmentation.py` e `backend/tests/test_phase5_analysis.py` (usando 100% mocks/fixtures sintéticas nos testes).
   - **Agente Worker C (Cinegrafista Virtual 9:16, Legendas `.ass` & FFmpeg — Fase 6):** Trabalha **exclusivamente** em `backend/app/infrastructure/vision/`, `backend/app/infrastructure/video/`, `backend/app/domain/rendering/` e `backend/tests/test_phase6_rendering.py` (usando 100% mocks/fixtures sintéticas nos testes).
3. **Onda 3 — Integração de Rotas `/jobs`, Orquestrador, Limpeza do Legado TS e Auditoria Final (Fase 7):**
   - Integra os motores nas rotas `backend/app/api/routers/jobs.py`, implementa `backend/app/application/orchestrator.py` e `backend/app/main.py`.
   - Deleta 100% do código TypeScript legado (`backend/src/`, `backend/package.json`, `backend/tsconfig.json`, `backend/tests/*.ts`, `tests/bun/contracts`), atualiza `scripts/dev-backend.ts` e `package.json` raiz.
   - Roda um subagente revisor independente para validar `pytest` completo (100% lógico/mockado, sem usar hardware), marcar `[x]` em todas as fases do `AGENTS.md` e fazer `git commit` + `git push origin feature/backend`.



