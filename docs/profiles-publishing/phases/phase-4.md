# Fase 4 — Limpeza e notificação

## Em modo local (vale esta seção)

Por decisão do dono (D49), a pasta sincronizada entre computadores está adiada. Esta fase é feita **em um computador**, sobre a Base local ([phase-2-local.md](./phase-2-local.md)) e os perfis da fase 3. Leia [local-first.md](../local-first.md) antes do resto. **Onde esta seção e o resto do arquivo divergem, vale esta seção.** O que ela não cita vale como está escrito abaixo.

A regra de ouro fica mais curta: **nada é apagado sem clique, e a limpeza só apaga dentro das pastas de vídeos dos perfis, com uma única exceção** (o estado local do job de um vídeo que acabou).

**Depende de:** fases 2 (Base local) e 3. P2, P3, P4, P10, P11 e P12.

**Leitura obrigatória, no lugar da lista abaixo:** `local-first.md` inteiro; `architecture.md` 5, 12 e 14 (**não** a 7); `api-contracts.md` seções 1 e 5; `ui.md` 0, 6.2, 7, 8, 9, 10, 11, 15 e 16, com `local-first.md`, seção 5; `decisions.md` D12 a D18, D21, D30, D31, D46, D49, D50 (**não** a D33); `review-checklist.md`, seção B, com `local-first.md`, 2.4.

### O que troca nas entregas de backend

| Item abaixo | Em modo local |
|---|---|
| 1. Regras | Só em `machine.json` → `cleanup_local`. `GET /cleanup/settings` devolve sempre `scope: "local"`. Não existe `yts-root.json`. |
| 2. Varredura | Todas as pastas de vídeo das pastas de **todos os perfis disponíveis** (`storage_layout.videos_dir`), inclusive `_archived`. A pasta de um perfil indisponível é pulada: não entra no plano nem nos totais. O limite de tamanho vale para a soma (P10). Pasta de vídeo ainda sem `video.info.json` não é adotada pela varredura e nunca vence. |
| 3. Elegibilidade | `architecture.md`, 12.4, sem o item 5 (somente leitura). No item 3, "em uso por publicação" olha só a fila deste computador; não existe registro de outro computador. O arquivo "só na nuvem" do item 4 não se aplica. |
| 4. Plano | `synced_folder_warning` é sempre `false`. O plano guarda, por item, o `profile_id` e a pasta de vídeos do perfil. |
| 5. Execução | Como abaixo, sem o motivo `read_only`. O caminho é reconstruído a partir da pasta de vídeos do perfil do item. |
| 6. Depois da execução | Como abaixo, com **uma** exclusão fora da pasta de vídeos: `release_local_job_state`. A segunda (`data/jobs/<job_id>/audio_16k.wav` "em modo raiz") **não existe**: em modo local o `audio_16k.wav` fica em `transcrições/`, dentro da pasta do vídeo, e sai com o item `source` (`architecture.md`, 12.2). |
| 7. Registro | Um arquivo só, `data/cleanup.log.jsonl`. O módulo `backend/app/domain/storage/deletion_log.py` **nasce nesta fase** (não vem da fase 2). Tipos gravados: `source`, `short` e `video_info`. `machine_id` e `machine_name` não são gravados. `path` é relativo à pasta de vídeos do perfil do item, e a linha leva o `profile_id`. |
| 8. Adiar | Como abaixo. |
| 12. Canal global | `GET /events` já existe (fase 2). Esta fase acrescenta o evento `cleanup.summary` e o envio do resumo atual ao conectar. Não existe `storage.status`. |
| 9, 10, 11, 13, 14 | Como abaixo. |

### O que troca nas entregas de frontend

- `NoticePill` e `AppNotices` (`ui.md`, 0.3 e 7.2) **nascem nesta fase**, com a regra de canto da barra lateral. As duas linhas de somente leitura da tabela de avisos não existem.
- Lista de confirmação (`ui.md`, 8): sem a faixa extra de pasta sincronizada e sem o estado "Somente leitura". O perfil de cada item aparece quando há mais de um perfil.
- Diálogo de exceção depois de baixar (`ui.md`, 10): sem a linha "se esta pasta é sincronizada…".
- Histórico (`ui.md`, 6.2): tipos "Original", "Corte" e "Informações do vídeo"; sem coluna de computador.
- O bloco "ESPAÇO USADO" da seção Pasta entra inteiro nesta fase.
- A captura "`AppNotices` com a barra lateral fixada à direita" passa a ser desta fase.

### O que troca na lista de arquivos

Criar, **além** da lista abaixo:

- `backend/app/domain/storage/deletion_log.py`
- `frontend/src/components/redesign/AppNotices.tsx`

**Não** criar `backend/app/api/routers/events.py` (já existe; passa para "Alterar").

Alterar: a lista abaixo, **sem** `backend/app/domain/storage/root.py` (não existe) e com `deletion_log.py` e `AppNotices.tsx` saindo dela (são criados aqui). Entram: `backend/app/api/routers/events.py`, `backend/app/core/storage_layout.py` (só leitura das pastas dos perfis), `.gitignore` (`data/cleanup.log.jsonl`).

### O que troca nos testes

**Saem** (adiados): "A máquina perde a trava no meio da execução"; "Em somente leitura: `409`"; "Modo raiz, original apagado com cortes restando: `audio_16k.wav` some"; "Registro por computador" (fica só a parte da linha cortada no meio); "Corte com registro `in_progress` de **outra** máquina".

**Mudam:**

- "O vídeo que não acabou, modo raiz, original `source_absent`": o mesmo teste, em modo local. O original foi apagado por fora do app (`source.deleted_at` nulo, sem `video.<ext>`); a limpeza apaga os dois cortes; o `video.info.json`, a pasta e `data/jobs/<id>/` ficam. Se o arquivo do original volta à pasta, a listagem mostra o mesmo `video_id`, com a exceção de tamanho e a publicação preservadas.
- "Modo local, vídeo que acabou": fica como está (transcrição de nome conhecido em `also_removed`; `notas.txt` fica).
- Teste estrutural: `release_local_job_state` é a **única** exclusão da limpeza fora das pastas de vídeos; busque `unlink`, `remove` e `rmdir` em `app/domain/cleanup/` e confira os alvos.

**Entram:**

- **Dois perfis:** com vídeos vencidos nas pastas de dois perfis, o plano traz itens dos dois, cada um com o seu `profile_id` e `profile_name`; a execução apaga cada arquivo na pasta do perfil certo; um arquivo-sentinela de mesmo nome relativo na pasta do **outro** perfil sobrevive. O limite de tamanho conta a soma das duas pastas.
- **Perfil com a pasta indisponível:** os vídeos dele não entram em `items`, em `blocked` nem nos totais, e nada é criado no caminho.
- **Pasta sem arquivo de informações:** uma pasta de vídeo ainda não adotada (perfil nunca listado) não entra em `items` e a varredura não cria o arquivo.
- **Registro:** cada linha tem `profile_id` e `path` relativo, sem letra de disco; não tem `machine_id`.
- `GET /cleanup/settings` devolve `scope: "local"`; `POST /cleanup/plan` devolve `synced_folder_warning: false`.

### Critério de pronto e validação manual

Como abaixo. No item 5 do critério, os "dois testes do vídeo que não acabou" são o de `source_absent` em modo local e o do corte `missing`. Em [manual-validation.md](../manual-validation.md), fase 4, valem só os itens **[PC]**.

---

*O texto abaixo é o original. Vale no que a seção acima não troca.*

## Objetivo

Duas regras configuráveis, idade máxima e tamanho máximo da pasta de vídeos. O app calcula o que venceu, avisa na barra lateral e numa pílula, mostra a lista e só apaga o que o usuário confirmar. A exclusão é definitiva.

A regra de ouro desta fase: **nada é apagado sem clique, e nada fora da pasta de vídeos é apagado**, com as duas exceções de estado local do job descritas em `architecture.md`, 12.7, cada uma com teste próprio.

## Depende de

- Fase 2 concluída. Com a fase 3 concluída, a lista mostra o perfil de cada item; sem ela, há um perfil só e a coluna não aparece.
- P2, P3, P4, P10, P11 e P12 respondidas. Cada uma muda uma regra de `architecture.md`, seção 12; confira as respostas antes de começar.

## Leitura obrigatória

- [architecture.md](../architecture.md): seções 5, 7, 12 e 14.
- [api-contracts.md](../api-contracts.md): seções 1 e 5, e os tipos da fase 4.
- [ui.md](../ui.md): seções 0, 6.2, 7, 8, 9, 10, 11, 15 e 16.
- [decisions.md](../decisions.md): D12 a D18, D21, D30, D31, D33, D46.
- [review-checklist.md](../review-checklist.md): seção B, antes de escrever a primeira linha.

## Entregas

### Backend

1. **Regras** em `yts-root.json` (raiz) ou `machine.json` (local), desligadas por padrão.
2. **Varredura e conta do tamanho** (`architecture.md`, 12.2 e 12.3), com memória de 60 segundos.
3. **Elegibilidade, vencimento, destaques** (12.4 a 12.6).
4. **Plano** em memória, com validade de 10 minutos (12.7).
5. **Execução** (12.7): marca os jobs como "em limpeza" (`409` `busy_cleanup` em `ingest`, `render` e `run` enquanto dura); refaz os testes por item; reconstrói o caminho no servidor; confere que a pasta ainda é do **mesmo vídeo** (`video_id` e tamanho do plano); confere que o arquivo de informações pode ser regravado; registra antes de apagar; `unlink`; atualiza o arquivo de informações (`deleted_at` na entrada do corte, não remoção). **Uma única função apaga, e só a rota `POST /cleanup/execute` a chama.**
6. **Depois da execução** (12.7, "Depois"):
   - **"O vídeo acabou" é decidido pelo arquivo de informações, relido do disco**, e não pela falta de arquivos na pasta: `source.deleted_at` preenchido, **toda** entrada de `shorts[]` com `deleted_at` valendo e nenhum `video.<ext>` nem `.mp4` de `shorts/` no disco. Original `source_absent` ou corte vivo `missing` mantêm o vídeo, o `video.info.json` e o estado do job.
   - Quando o vídeo acabou, o `video.info.json` é apagado com linha própria no registro (`kind: "video_info"`), gravada antes do `unlink`.
   - Função **nova** `JobLifecycleService.release_local_job_state(job_id)` em `job_lifecycle.py`: valida o `job_id` com `_validate_safe_segment`, resolve o caminho, confere que é filho direto de `paths.jobs_dir()` e não é link, e só então remove `data/jobs/<job_id>/` e invalida os caches. É a exceção 1.
   - Remoção de `data/jobs/<job_id>/audio_16k.wav` em modo raiz, quando o original é apagado e restam cortes. É a exceção 2.
   - **Proibido** chamar, a partir de `app/domain/cleanup/`, o código de `DELETE /videos/:job_id`, `delete_render_outputs` ou `rename_video`. Aquele código faz `rmtree` na pasta do vídeo e em `shorts/`; não é uma rotina de ciclo de vida reutilizável (`architecture.md`, 12.7).
   - Em modo local, os arquivos de transcrição de nome conhecido saem quando o vídeo acaba; pastas só com `rmdir`; `folders_kept` na resposta.
7. **Registro** (12.8), nos dois modos, reusando `domain/storage/deletion_log.py` da fase 2: em modo raiz, um arquivo por computador; leitura que junta todos e ignora linha incompleta.
8. **Adiar** (12.9), em `machine.json`, com o corte em agora + 24 h na leitura.
9. **Vídeo maior que o limite** (12.10): `POST /storage/preflight`, a guarda em `POST /jobs/:id/ingest` (só com a regra de tamanho ligada), `size_exception_pending` depois de um download de tamanho desconhecido. As duas respostas do diálogo têm caminho definido:
   - "Manter com exceção" → `PUT /videos/:job_id/flags`, que também tira a pendência.
   - "Apagar este vídeo" → **plano manual** (`POST /cleanup/plan` com `rule: "manual"` e `job_id`) executado por `POST /cleanup/execute`. Nunca `DELETE /videos/:job_id`.
10. **`PUT /videos/:job_id/flags`** para "manter" e exceção.
11. **Original apagado com cortes restando:** `source_deleted` no job; o vídeo continua na listagem; `GET /media/videos/:job_id` responde `404` como já faz para arquivo ausente; `POST /jobs/:id/render` e `/run` recusam com mensagem clara ("O vídeo original foi apagado.").
    - **Opcional (O2 do README):** o botão "Baixar de novo". Sem ele, o estado "Original apagado" só informa.
12. **Canal global** `GET /events` (`architecture.md`, 14.1), com `cleanup.summary` e `storage.status`.
13. **Gatilhos de recálculo** (12.11). Nenhum deles chama a execução.
14. Rotas da seção 5 de `api-contracts.md`, no inventário.

### Frontend

1. Seção "Limpeza" nas Configurações e o bloco "Espaço usado" completo (`ui.md`, 6).
2. Linha "N itens para apagar" no rodapé da barra lateral e os avisos correspondentes em `AppNotices` (`ui.md`, 7).
3. Lista de confirmação com todos os estados (`ui.md`, 8).
4. Aviso de limite com "Apagar agora" / "Adiar por um dia" (`ui.md`, 9), chamado antes de baixar, enviar e gerar cortes (via `POST /storage/preflight`).
5. Diálogos de exceção de tamanho, antes e depois do download, e o selo no `NewVideoModal` (`ui.md`, 10). "Apagar este vídeo" usa o plano manual; "Manter com exceção" usa `flags`.
6. "Manter este vídeo", o alfinete e o estado "Original apagado" na barra lateral e no palco (`ui.md`, 11).
7. `useAppEvents` (um `EventSource` para `/events`), `useCleanup`, `api/cleanup.ts`.

## Arquivos que pode tocar

Criar:

- `backend/app/domain/cleanup/__init__.py`, `rules.py`, `scan.py`, `plan.py`, `execute.py`
- `backend/app/api/routers/cleanup.py`, `events.py`
- `backend/tests/test_pp_phase4_cleanup_plan.py`, `test_pp_phase4_cleanup_execute.py`, `test_pp_phase4_preflight.py`
- `frontend/src/api/cleanup.ts`, `events.ts`
- `frontend/src/hooks/useCleanup.ts`, `useAppEvents.ts`
- `frontend/src/components/redesign/CleanupDialog.tsx`, `StorageLimitDialog.tsx`, `SizeExceptionDialog.tsx`

Alterar:

- `backend/app/domain/storage/video_info.py`, `root.py`, `deletion_log.py` (tipos `source`, `short` e `video_info`; leitura para `GET /cleanup/log`)
- `backend/app/core/machine_state.py`
- `backend/app/application/runtime_service.py` (chave reservada no barramento; consulta de "em uso"; marca "em limpeza"), `job_lifecycle.py` (**só** a função nova `release_local_job_state`)
- `backend/app/domain/ingest/service.py` (estimativa de tamanho sem baixar; marca de pendência)
- `backend/app/api/routers/videos.py`, `storage.py`, `jobs_ingest.py`, `jobs_render.py`, `jobs.py`
- `backend/app/models/schemas.py`, `backend/app/main.py`
- `backend/tests/conftest.py`
- `shared/contracts.ts`
- `frontend/src/api/index.ts`, `videos.ts`; `frontend/src/hooks/index.ts`
- `frontend/src/components/redesign/ArcSidebar.tsx`, `AppNotices.tsx`, `NewVideoModal.tsx`, `ImmersiveVideoStage.tsx`, `GlassDock.tsx`, `SettingsHubModal.tsx`
- `frontend/src/components/redesign/settings/StorageSections.tsx` (entra o componente `StorageCleanupSection`), `settingsShared.tsx`
- `frontend/src/App.tsx`
- `AGENTS.md`, `DESIGN.md` da raiz

Não pode alterar: a rota `DELETE /videos/:job_id` e a de arquivar (continuam como estão); `backend/app/api/routers/media.py`.

## Fora de escopo

- Qualquer exclusão automática, agendada ou "ao iniciar".
- Lixeira, desfazer, quarentena.
- Limpar tentativas arquivadas (`data/jobs/<id>/attempts/`), logs, modelos ou cache.
- Limite por perfil (P10).
- "Baixar de novo" automático: o botão (opcional, O2) só reinicia o download pela rota de ingestão que já existe.
- Uma rota geral de "apagar este vídeo pela limpeza". O plano manual só vale para vídeo com `size_exception_pending`.
- Publicação: a consulta "está sendo publicado?" é uma função que devolve sempre "não" até a fase 5 preenchê-la.

## Testes

Árvores de arquivos montadas em `tmp_path`, relógio injetado, arquivos pequenos com o tamanho declarado no arquivo de informações quando o teste é de conta.

**Plano**

- Desligado: resumo zerado, nenhum aviso.
- Idade: vídeo com 31 dias e limite 30 entra; com 29 não. Original no grupo 1 marcado; cortes no grupo 2 desmarcados.
- Tamanho: marca os mais antigos até cobrir o excesso e para; pula os com exceção; só entra em cortes quando acabam os originais; `shortfall_bytes` quando não basta.
- "Manter": nunca aparece em `items`; aparece em `blocked`. Envio local nasce protegido.
- Exceção de tamanho: fora de `counted_bytes`, dentro de `total_bytes`; continua sujeita à idade.
- Tudo protegido: `all_protected: true`.
- Em uso (processando, em lote, renderizando): fora do plano.
- Destaques: corte sem publicação; original com cortes aprovados não gerados.
- A data usada é `downloaded_at`, não a data do arquivo (o teste altera a data do arquivo e o resultado não muda).
- Vídeo sem arquivo de informações ou sem data: nunca vence.
- Arquivo de informações ilegível (0 bytes, JSON cortado) ou de `schema_version` 2: o vídeo nunca entra em `items`; aparece em `blocked` com `info_unreadable`.
- `downloaded_at` dois dias no futuro: fora de `items`, em `blocked` com `clock`. Um dia e meio no passado, com limite de 1 dia: entra.
- Corte com registro `in_progress` de **outra** máquina, com `started_at` de uma hora atrás: fora (`publishing`). Com 25 horas: não bloqueia mais.
- Corte ou original que não está no disco (`missing`, `source_absent`): não é item.
- Em modo local, `transcrições/` conta em `total_bytes` e não vira item.
- Calcular o plano mil vezes não muda nenhum arquivo (comparação da árvore antes e depois).

**Execução**

- Sem `confirm: true`: `400`, nada apagado. Plano vencido: `409`. `item_ids` vazio: `400`.
- `item_id` que não está no plano: ignorado, nada apagado.
- Só os itens enviados são apagados; os outros do plano ficam.
- Item que ficou em uso ou ganhou "manter" depois do plano: pulado.
- **Alvo trocado:** entre o plano e a execução, a pasta do vídeo é renomeada e outra pasta, com outro `video_id`, ocupa o nome antigo → item pulado (`changed`), nada apagado. Mesmo vídeo com o arquivo de outro tamanho → pulado (`changed`).
- **Arquivo de informações ilegível na hora da execução** (truncado depois do plano): item pulado (`info_unreadable`) e o arquivo de vídeo **continua no disco**.
- **Em limpeza:** durante a execução (função de exclusão falsa que espera), `POST /jobs/:id/render` daquele job devolve `409` `busy_cleanup`; depois da execução, com sucesso ou com erro, volta a aceitar.
- A máquina perde a trava no meio da execução: os itens que faltam voltam em `skipped` com `read_only`.
- **Caminho:** nome de pasta ou de arquivo com `..`, caminho absoluto, link simbólico apontando para fora, arquivo com nome inesperado dentro da pasta do vídeo: nada é apagado e o item volta em `skipped`. Um arquivo-sentinela criado **fora** da pasta de vídeos existe no fim de todos os testes.
- O registro é gravado antes do `unlink`; se a gravação falhar, nada é apagado.
- Depois de apagar o original: arquivo de informações com `deleted_at` e a regra; job com `source_deleted`; os cortes continuam lá e tocam.
- Depois de apagar um corte: a entrada continua em `shorts[]`, com `deleted_at`; as `publications` dela continuam.
- Depois de apagar tudo de um vídeo: a pasta some se estiver vazia; se tiver um arquivo desconhecido, a pasta e o arquivo ficam, e `folders_kept` vale 1. O registro tem uma linha `kind: "video_info"` para o `video.info.json`, gravada antes de ele sumir; com a gravação dessa linha falhando, o `video.info.json`, a pasta e `data/jobs/<id>/` ficam.
- **O vídeo que não acabou, modo raiz, original `source_absent`:** arquivo de informações com `source.deleted_at` nulo, `size_exception: true`, sem `video.<ext>` no disco, e dois cortes no disco, um deles com um registro de publicação. A limpeza apaga os dois cortes → o `video.info.json` **continua lá** (com `deleted_at` nos dois cortes, a publicação e as `flags` intactas), a pasta do vídeo fica, `data/jobs/<id>/` fica e nenhuma linha `video_info` é gravada. Quando o original "chega" depois (o teste cria o arquivo), a listagem mostra o **mesmo** `video_id`, com a exceção de tamanho e o registro de publicação preservados.
- **O vídeo que não acabou, corte `missing`:** o original é apagado pela limpeza e existe uma entrada viva de `shorts[]` cujo `.mp4` não está no disco (com um registro de publicação) → o `video.info.json` e o estado do job ficam; a entrada e a publicação dela continuam no arquivo.
- **Arquivo que reaparece:** todas as entradas têm `deleted_at`, `source.deleted_at` está preenchido, mas há um `.mp4` em `shorts/` → o vídeo não acabou e nada além dos itens marcados é apagado.
- **`release_local_job_state`:** remove `data/jobs/<id>/` do vídeo que acabou e **só** ela; `data/jobs/<outro id>/` fica intacta; com `job_id` igual a `..`, vazio ou com `/`, levanta erro e não remove nada; com `data/jobs/<id>` sendo um link para fora, não remove nada. Um arquivo-sentinela em `data/` sobrevive.
- **A pasta do vídeo com arquivo desconhecido sobrevive à liberação do job:** é o teste que pega quem reusar o código de `DELETE /videos`.
- Modo raiz, original apagado com cortes restando: `data/jobs/<id>/audio_16k.wav` some; o resto de `data/jobs/<id>/` fica.
- Modo local, vídeo que acabou: os arquivos de transcrição de nome conhecido somem e aparecem em `also_removed`; um `notas.txt` dentro de `transcrições/` fica.
- Em somente leitura: `409`, nada apagado.
- Rota chamada de fora da máquina: `403`.
- **Teste estrutural:** a função de exclusão é referenciada em um único ponto de chamada no pacote `app` (busca no código-fonte); `shutil.rmtree` não aparece em `app/domain/cleanup/`; os nomes `delete_video`, `delete_render_outputs` e `rename_video` não aparecem em `app/domain/cleanup/`; `release_local_job_state` é o único lugar de `job_lifecycle.py` que a limpeza chama para remover algo.
- **Registro por computador:** duas máquinas (dois `data/`) apagando na mesma raiz escrevem em dois arquivos diferentes de `limpeza/`; `GET /cleanup/log` devolve as linhas das duas, em ordem de data. Um arquivo com a última linha cortada no meio: a leitura devolve as linhas inteiras e a próxima escrita não se junta à linha cortada.

**Tamanho e adiar**

- `preflight` para envio, link com tamanho, link sem tamanho; com a limpeza desligada, sempre `false`.
- `ingest` com estimativa acima do limite e sem exceção: `409`. Com exceção: segue. Com a limpeza desligada: igual a antes.
- Download de tamanho desconhecido que passa do limite: `size_exception_pending`, arquivo intacto.
- **"Manter com exceção":** `PUT /flags` com `size_exception: true` grava a exceção e tira `size_exception_pending` do job.
- **"Apagar este vídeo":** plano manual para o job pendente → um item `source` com `rules: ["manual"]`; executar apaga só `video.<ext>`, grava a linha de registro com `rule: ["manual"]` e deixa `deleted_by_rule: "manual"`. Plano manual para um job **sem** pendência: `400`. O teste confere que `DELETE /videos/:job_id` não foi chamada.
- Adiar: 23 h depois o aviso está inativo; 25 h depois, ativo. O contador de itens não é afetado.
- `cleanup_postponed_until` gravado à mão para daqui a um ano: lido como agora + 24 h.

**Eventos**

- `GET /events` envia o estado atual ao conectar e um `cleanup.summary` a cada recálculo. O fluxo do job (`/jobs/:id/events`) não recebe esses eventos.

**Regressão**

- Suíte inteira. Com a limpeza desligada, nenhuma rota existente muda de resposta.

## Critério de pronto

1. `pytest` verde, a suíte inteira.
2. `cd frontend && bun run build` sem erro.
3. Capturas em `docs/redesign/screenshots/profiles-publishing/fase-4/`: seção Limpeza (desligada, ligada), linha na barra lateral, pílula, lista (cada estado da tabela de `ui.md`, 8), aviso de limite (normal e tudo protegido), os dois diálogos de exceção, "Original apagado".
4. Os testes estruturais (ponto único de exclusão; sem `rmtree`; sem chamada ao código de `DELETE /videos`) verdes.
5. O arquivo-sentinela fora da pasta de vídeos sobrevive a toda a suíte, e os dois testes do "vídeo que não acabou" (`source_absent` e corte `missing`) estão verdes.
6. Revisão aprovada, **sem nenhuma ressalva na seção B** do [review-checklist.md](../review-checklist.md).

## Validação manual

Em [manual-validation.md](../manual-validation.md), fase 4: exclusão em Drive real e o que acontece no segundo computador.

## Modelos

Implementação e testes: Sonnet. Revisão: Opus, com uma segunda leitura só do pacote `cleanup`.
