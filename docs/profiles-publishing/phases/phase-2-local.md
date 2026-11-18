# Fase 2 — Base local

> Esta é a fase 2 que vale depois da emenda [local-first.md](../local-first.md). A fase 2 original ([phase-2.md](./phase-2.md), pasta sincronizada entre computadores) está **adiada**. Leia `local-first.md` antes deste arquivo; onde ele e os outros documentos divergem, vale ele.

## Objetivo

Entregar só o que as fases 3 a 6 precisam, em um computador, com o armazenamento de hoje:

- um **arquivo de informações** ao lado de cada vídeo (`video.info.json`), com a data de download, a marca "manter", a exceção de tamanho, os cortes gerados e onde cada um foi publicado;
- a **adoção** dos vídeos e dos cortes que já existem, sem mover nada;
- **nomes de pasta seguros**: a correção do defeito que deixa `.` e `..` passarem e do renomear que move uma pasta para dentro de outra;
- as rotas que apagam aceitando só chamadas **deste computador** (P22);
- o **canal de eventos** do app, que as fases 3, 4 e 5 usam.

Com um perfil só e nada ligado, o app continua como hoje. Os únicos efeitos novos são os da regra 1 relida em `local-first.md`, seção 7.

## Depende de

- Fase 1 concluída (primeiro perfil em `data/profile/` e `require_local_ui`).
- P22 e P28 respondidas.
  - P22 "não": as quatro rotas existentes ficam sem `require_local_ui` (item 13 sai).
  - P28 "não": pare. A fase precisa de outra regra para dois vídeos com o mesmo nome antes de começar.

## Leitura obrigatória

- [local-first.md](../local-first.md): inteiro. As seções 3.3, 3.6, 3.7, 3.8, 3.9, 5 e 7 são o centro desta fase.
- [architecture.md](../architecture.md): 5 (com as trocas de `local-first.md`, 3.7), 8.1, 8.2 (só os itens 1 e 3), 8.3 (só as linhas locais), 8.6, 14 e 15. **Não leia como tarefa** as seções 2, 3.3, 6, 7, 8.4, 8.5 e 9: estão adiadas.
- [api-contracts.md](../api-contracts.md): seção 1; da seção 3, só o que `local-first.md`, 2.2, diz que vale; `GET /events` na seção 5.
- [ui.md](../ui.md): 0, 3, 11 (com os textos de `local-first.md`, seção 5), 15 e 16.
- [decisions.md](../decisions.md): D7, D10, D22, D29, D36, D37, D43, D45, D49, D50.
- [review-checklist.md](../review-checklist.md): seção B, com as trocas de `local-first.md`, 2.4, antes de escrever a primeira linha. Esta fase mexe em renomear e em pastas.

## Entregas

### Backend

1. **`backend/app/core/machine_state.py`**: leitura e escrita atômica de `data/machine.json` no formato de `local-first.md`, 3.3, com o tratamento de arquivo ilegível (renomeia para `machine.json.corrupt-<data>` e cria um novo). Nesta fase nenhuma rota grava nele: o arquivo só nasce na fase 3. Arquivo ausente vale os padrões.
2. **`video.info.json`**: modelo, leitura e a função única de escrita `update(caminho, mudar)`, com trava por caminho dentro do processo (`local-first.md`, 3.7). Campos reservados gravados como lá: `updated_by: null`, `merged_conflict_files: []`.
3. **Arquivo ilegível nunca é sobrescrito** (`architecture.md`, 5.3): não é adotado, não é renomeado sozinho e nunca faz nascer um job. O vídeo que já tem job aparece com `info_unreadable`. Rota `POST /videos/:job_id/info/recreate` (local, com `confirm`) para a saída com clique: renomeia para `video.info.json.corrupt-<data>` e adota de novo.
4. **Criação** no fim do download e do envio local: `downloaded_at` = agora, `downloaded_at_origin = "app"`; para envio local, `keep: true` e `keep_reason: "upload"`.
5. **Cortes**: entrada em `shorts[]` no fim de cada renderização, com `cut_id`, `start`, `end`, título, resumo, `size_bytes` e `watermark` (o resultado da decisão da fase 1). Gerar de novo atualiza a entrada e mantém as `publications`. `DELETE /jobs/:job_id/renders/:file` grava `deleted_at`; **a entrada não é removida**.
6. **Conferência de `shorts[]` com o disco** (`architecture.md`, 5.5), na listagem e logo depois da adoção: cria a entrada dos cortes que já existiam, com `watermark: null`; marca como `missing`, só em memória, a entrada cujo arquivo não está no disco.
7. **Reconciliação e adoção** (`architecture.md`, 8.3, linhas locais; `local-first.md`, 3.6 e 3.7):
   - pasta com arquivo de informações legível: vale o `video_id`. Só `^[0-9a-f]{32}$` cria job, e `data/jobs/<video_id>` é conferido como filho direto de `paths.jobs_dir()` antes da primeira escrita. Id antigo fora do formato só vale se este computador já tem um job com exatamente esse id;
   - pasta sem arquivo de informações: adotada. Com job: `downloaded_at = Job.created_at`, origem `"job"`. Sem job: o job é criado pelo caminho, como hoje, e a pasta é adotada com a data de agora, origem `"migration"`, `source.kind = "upload"` e `keep: true`;
   - duas pastas com o mesmo `video_id`: fica com o id a pasta para onde o job já aponta; a outra recebe um id novo;
   - **uma pasta, um job**: outro job que ainda aponte para uma pasta reconhecida pelo `video_id` é desligado dela (`source_video_path` e `video_name` nulos).
8. **Pastas não reconhecidas**: pasta com `video.info.json` ilegível e sem job neste computador. Não vira vídeo, não aparece em `/videos`, nada é escrito nela. `GET /storage` conta em `unrecognized_folders` e `unrecognized_folders_ready` (sempre iguais). `POST /storage/folders/adopt` (local, com `confirm`): relê cada pasta; se o arquivo voltou a ser lido, vale a reconciliação normal; senão renomeia o arquivo ilegível para `.corrupt-<data>` e adota como "sem job". Nenhum nome de pasta vem do cliente.
9. **Original ausente** (`architecture.md`, 8.3, passo 2): pasta com `video.info.json` e sem arquivo de vídeo continua na lista. `source_missing` só com `source.deleted_at` preenchido; senão `source_absent`.
10. **`title`** do arquivo de informações atualizado ao renomear o vídeo.
11. **`GET /videos/:job_id/info`** e os campos `info`, `source_missing`, `source_absent` e `info_unreadable` em `VideoRecord`.
12. **Resolvedor e nomes seguros** (`backend/app/core/storage_layout.py`; `local-first.md`, 3.9). As funções de `settings.py:244-309` passam a pedir o nome e a pasta base a ele. Nesta fase só existe o primeiro perfil; a pasta base é `media.base_dir`.
    - `.`, `..`, nome vazio, `_archived` e `logs`: recusados no renomear (`400` "Escolha outro nome.") e trocados pelo `job_id` na ingestão e para job antigo com nome inválido gravado. Sem diferenciar maiúsculas.
    - O renomear recusa o nome de uma entrada que já existe e **nunca move uma pasta para dentro de outra**: a existência do destino é conferida de novo logo antes de mover. Trocar só a caixa do próprio nome muda o título e não move a pasta.
    - **Ingestão com nome que já existe** (P28): no download e no envio, se a pasta de destino já existe e não é a do próprio job, o vídeo vai para `<nome> (2)`, `(3)`… e `job.video_name` recebe esse nome. O código que hoje move os arquivos para dentro da pasta existente e apaga o que tem o mesmo nome (`ingest/service.py:422-432`) deixa de ser alcançado nesse caso.
    - Todo caminho montado é resolvido e conferido como descendente da pasta de vídeos antes de escrever, mover ou apagar.
13. **`require_local_ui`** em `DELETE /videos/:job_id`, `DELETE /jobs/:job_id/renders/:file`, `POST /videos/:job_id/archive` e `POST /config/select-folder` (P22). Corpo e resposta iguais.
14. **`POST /config/select-folder` espera o seletor fora do laço de eventos** (`run_in_threadpool` ou subprocesso `asyncio`), com tempo limite. Vale com qualquer seletor injetado.
15. **Opcional (O3 do README):** seletor de pasta nativo para Windows, injetado em `container.folder_picker`, num processo separado. Sem ele, a rota continua devolvendo `selected: false`.
16. **`GET /storage`** no formato reduzido de `local-first.md`, 3.8. Nesta fase `warnings` vem sempre vazio e `secret_store` não vem.
17. **`GET /events`** (`architecture.md`, 14.1): fluxo SSE no formato de `GET /jobs/:id/events`, usando o `JobEventBus` com a chave reservada `_app`, com linha de manutenção a cada ~15 s e uma função `publish_app_event(nome, dados)` para as próximas fases. **Nesta fase nenhum evento é publicado** e nada é enviado ao conectar. O canal nasce aqui porque a fase 3 já publica `account.state`. O fluxo do job não recebe eventos do app.
18. Rotas novas no inventário 4.1 do `AGENTS.md` e no `DESIGN.md` da raiz: `/storage` (`GET`), `/storage/folders/adopt` (`POST`), `/videos/:job_id/info` (`GET`), `/videos/:job_id/info/recreate` (`POST`), `/events` (`GET`). As quatro rotas do item 13 ganham "(local)". `.gitignore`: `data/machine.json`, `data/machine.json.corrupt-*`.

### Frontend

1. Os três estados de vídeo sem original (`source_missing`, `source_absent`, `info_unreadable`) e o corte `missing`, como em `ui.md`, 11, com os textos de `local-first.md`, seção 5. "Baixar de novo" não é desta fase. Os itens de "manter" são da fase 4.
2. O link "Recriar as informações", com a confirmação de `ui.md`, 11.
3. Entrada "Armazenamento e limpeza" → "Pasta" nas Configurações (`ui.md`, 3), com a seção reduzida de `local-first.md`, seção 5: o cartão "Neste computador" e, quando houver, o cartão de pastas não reconhecidas com "Adicionar ao app".
4. `api/storage.ts`, `hooks/useStorage.ts`. `GET /storage` é consultada ao entrar na seção Pasta e depois de "Adicionar ao app". Não há consulta periódica.

Nesta fase o frontend **não** abre `GET /events`. `useAppEvents` e `AppNotices` são da fase 4.

## Arquivos que pode tocar

Criar:

- `backend/app/core/storage_layout.py`, `machine_state.py`
- `backend/app/domain/storage/__init__.py`, `video_info.py`, `reconcile.py`
- `backend/app/infrastructure/system/folder_picker.py` (só com O3)
- `backend/app/api/routers/storage.py`, `events.py`
- `backend/tests/test_pp_phase2_video_info.py`, `test_pp_phase2_folder_names.py`, `test_pp_phase2_local_routes.py`
- `frontend/src/api/storage.ts`, `frontend/src/hooks/useStorage.ts`
- `frontend/src/components/redesign/settings/StorageSections.tsx` (nesta fase, só o componente `StorageFolderSection`)

Alterar:

- `backend/app/core/paths.py`, `settings.py` (só para consultar o resolvedor)
- `backend/app/application/job_lifecycle.py` (renomear; `title`), `runtime_service.py` (chave `_app` no barramento; seletor no container)
- `backend/app/domain/ingest/service.py`, `backend/app/domain/rendering/rendering_service.py`
- `backend/app/api/routers/videos.py`, `config.py`, `jobs_render.py`, `jobs_ingest.py`, `jobs.py` (só a reconciliação, o `400` do renomear, `require_local_ui` nas quatro rotas e a espera do seletor)
- `backend/app/models/schemas.py`, `backend/app/main.py`
- `backend/tests/conftest.py` (isolar `machine.json` em `tmp_path`; falsos novos)
- `shared/contracts.ts` (só acréscimos; os tipos de `local-first.md`, 3.7 e 3.8)
- `frontend/src/api/index.ts`, `videos.ts`; `frontend/src/hooks/index.ts`
- `frontend/src/components/redesign/settings/settingsShared.tsx`, `SettingsHubModal.tsx`, `ArcSidebar.tsx`, `GlassDock.tsx`, `ImmersiveVideoStage.tsx` (para mostrar os estados de `ui.md`, 11)
- `frontend/src/App.tsx`
- `.gitignore`, `AGENTS.md`, `DESIGN.md` da raiz

Não pode alterar: `backend/app/core/tool_configs.py`; `data/settings.json` e os outros JSON versionados de `data/`; o formato de resposta de `/config/settings` e `/config/tool-configs`; `media.py` além do necessário para achar o arquivo pelo resolvedor; `frontend/src/components/redesign/DeleteCutConfirmDialog.tsx`.

**Não criar** (são da fase adiada): `preferences_overlay.py` (entra na fase 3, em outra forma), `synced_store.py`, `root_lock.py`, `domain/storage/root.py`, `migration.py`, `merge.py`, `deletion_log.py` (entra na fase 4), `AppNotices.tsx`, `FolderField.tsx`, `StorageFirstRunDialog.tsx`, `StorageUnavailableDialog.tsx`, `DeleteVideoConfirmDialog.tsx`.

## Fora de escopo

- Tudo o que `local-first.md`, seção 2, marca como adiado: raiz, `yts-root.json`, migração, trava, somente leitura, fusão, cópias de conflito, área de trabalho local, temporários esquecidos, diálogo de primeira execução.
- Vários perfis, pasta por perfil e divisão de preferências (fase 3).
- Limpeza, "manter" e exceção de tamanho na tela (fase 4). Os campos já existem no arquivo.
- Publicação (fase 5). `shorts[].publications` nasce vazio.
- Consertar a rota de arquivar ou a de excluir vídeo. Elas só ganham `require_local_ui`. O `rmtree` delas continua.
- Cortar nomes de pasta em 80 caracteres ou tratar nomes reservados do Windows.

## Testes

Tudo em `tmp_path`, com `yt-dlp`, `ffprobe` e FFmpeg falsos e relógio injetado.

**Arquivo de informações** (`test_pp_phase2_video_info.py`)

- Download e envio criam o arquivo com os campos certos; envio local nasce com `keep: true`. `updated_by` é `null` e `merged_conflict_files` é `[]`.
- Renderização acrescenta a entrada, com `watermark` igual à decisão da fase 1; excluir o corte grava `deleted_at` e a entrada **continua** no arquivo; gerar de novo o mesmo corte deixa a entrada viva e mantém as `publications`.
- Campo desconhecido é preservado ao regravar; `schema_version` maior impede a escrita.
- **Arquivo ilegível com job** (0 bytes, JSON cortado no meio, `schema_version: 2`): o conteúdo do arquivo é **idêntico** antes e depois de listar; a pasta não é adotada; o vídeo vem com `info_unreadable` (os dois primeiros) ou com o aviso de versão mais nova (o terceiro). `info/recreate` sem `confirm` devolve `400`; com `confirm`, renomeia o arquivo (ele continua no disco com o nome `.corrupt-…`) e só então adota; com o arquivo legível, devolve `400`.
- **Arquivo ilegível sem job** (0 bytes e JSON cortado, com `data/jobs/` vazio): listar **não cria job**, não grava nada e o vídeo não aparece em `/videos`; `GET /storage` traz `unrecognized_folders: 1` e `unrecognized_folders_ready: 1`. Quando o arquivo passa a ser legível, a listagem seguinte cria **um** job, com o `video_id` do arquivo. Em nenhum momento há dois jobs para a mesma pasta.
- **"Adicionar ao app":** sem `confirm`, `400`; com `confirm`, o arquivo ilegível continua no disco com o nome `.corrupt-…` e o novo tem `keep: true`, `source.kind: "upload"` e `downloaded_at_origin: "migration"`. Se o arquivo voltou a ser lido entre a listagem e o clique, a rota não cria outro. Cliente de fora: `403`.
- **`video_id` adulterado:** arquivos com `video_id` igual a `..\..\x`, `../x`, um caminho absoluto, vazio, `CON`, 32 hex em maiúsculas, 31 e 33 caracteres, e um número em vez de texto. Em todos: nenhum job é criado, nada é escrito fora de `data/jobs/` nem dentro dele, o arquivo fica **idêntico**, e a pasta é tratada como ilegível. Um arquivo-sentinela criado **fora** de `data/jobs/` existe e está intacto no fim. Um id antigo fora do formato (`job-antigo`) é aceito quando este `data/` **já tem** esse job e conta como ilegível quando não tem.
- **Adoção com job:** pasta antiga sem arquivo, com job, é adotada com `video_id = job_id`, `downloaded_at = Job.created_at` e origem `"job"`; job com `youtube_url` `"[Local Upload] x"` gera `keep: true`.
- **Adoção sem job:** pasta com `video.mp4` e nenhum job → depois de listar há um job e um arquivo de informações com a data de agora (relógio injetado), origem `"migration"` e `keep: true`. Listar de novo não muda o arquivo.
- **Conferência de cortes:** pasta antiga com três `.mp4` em `shorts/` e nenhum arquivo de informações → depois da listagem há três entradas, com `start`/`end` tirados do nome, `cut_id`/título vindos de `cuts.suggested.json` quando início e fim casam e `null` quando não, e `watermark: null`. Listar de novo não muda o arquivo. Entrada cujo arquivo sumiu do disco: o arquivo de informações **não muda** e a resposta marca `missing`.
- **Escritores ao mesmo tempo:** 20 threads chamando `update` no mesmo `video.info.json`, cada uma acrescentando um corte diferente → no fim estão lá as 20 entradas, a `revision` subiu 20 e não sobrou nenhum `.tmp`. O teste falha se a trava por caminho for removida.
- Gravação que falha (escrita atômica falsa que levanta erro): o arquivo antigo fica idêntico e a operação devolve erro.
- Nenhum caminho absoluto aparece em nenhum `video.info.json` gerado (busca por letra de disco e por `tmp_path`).
- Pasta só com cortes e arquivo de informações: com `source.deleted_at` preenchido aparece com `source_missing: true`; com `deleted_at` nulo aparece com `source_absent: true` e **sem** `source_missing`.
- Duas pastas com o mesmo `video_id`: a segunda ganha id novo; fica com o id a pasta para onde o job já apontava (teste com o job apontando para a segunda em ordem alfabética).
- **Uma pasta, um job:** com um job antigo `J` apontando para uma pasta cujo `video.info.json` traz outro `video_id` válido `V`, a listagem cria `V` e deixa `J` sem `source_video_path` e sem `video_name`; `DELETE /videos/J` depois disso não toca na pasta (um sentinela dentro dela sobrevive).
- Sem nenhum `video.info.json` prévio, `/videos` devolve a mesma lista de antes (mais os campos opcionais).

**Nomes de pasta** (`test_pp_phase2_folder_names.py`)

- **Nome `..`:** renomear para `..`, `.` e um nome só de espaços devolve `400` e não move nada. Com um job cujo `video_name` foi gravado à mão como `..`, `DELETE /videos/:id` não toca em nada fora da pasta do vídeo: um arquivo-sentinela na pasta de cima sobrevive.
- **Nome de pasta que já existe:** com um arquivo-sentinela dentro da pasta de **outro** vídeo e outro dentro de `_archived/<um vídeo>/`, renomear para o nome do outro vídeo, para o mesmo nome com a caixa trocada, para `_archived`, `_ARCHIVED`, `logs` e `Logs` devolve `400` "Escolha outro nome.", a pasta do vídeo continua onde estava e **nenhuma pasta foi parar dentro de outra**. Em seguida, `DELETE /videos/:id` do vídeo que tentou renomear apaga só a pasta dele: os dois sentinelas sobrevivem. Renomear trocando só a caixa do próprio nome muda o título e não move a pasta.
- Na ingestão, um vídeo cujo título vira `_archived`, `logs`, `.` ou `..` usa o `job_id` como nome da pasta.
- **Colisão na ingestão (P28):** com um vídeo `A` já baixado, com um corte em `shorts/` e um sentinela na pasta, baixar outro vídeo com o mesmo título → o segundo fica em `<título> (2)`, com `video_name` igual; o arquivo de vídeo, o corte, o sentinela e o `video.info.json` de `A` estão **idênticos**; cada pasta tem o seu `video_id`. O mesmo com dois envios de arquivo de mesmo nome. Refazer a ingestão do **mesmo** job usa a pasta dele e não cria `(2)`.
- O resolvedor nunca devolve caminho com `.` ou `..`, nem `_archived` ou `logs` como pasta de vídeo (teste direto da função, com a lista de nomes acima).

**Rotas** (`test_pp_phase2_local_routes.py`)

- `require_local_ui` nas quatro rotas de P22: cliente de fora e `Origin` de outro site recebem `403`; cliente local recebe a resposta de sempre, com o mesmo corpo.
- `POST /config/select-folder` com um seletor falso que demora: outra rota responde enquanto ele espera.
- `GET /storage` devolve o formato de `local-first.md`, 3.8, com `mode: "local"` e `read_only: false`.
- `GET /events`: conecta, recebe a linha de manutenção, e um evento publicado com `publish_app_event` chega no formato `event:`/`data:`. O fluxo `GET /jobs/:id/events` não recebe esse evento.
- `machine_state`: arquivo ausente devolve os padrões e **não** cria o arquivo; arquivo ilegível é renomeado para `.corrupt-…` na primeira gravação e o novo nasce com os padrões; campo desconhecido é preservado.

**Regressão**

- A suíte existente inteira passa sem alteração de teste (exceto `conftest.py`).

## Critério de pronto

1. `pytest` verde, a suíte inteira.
2. `cd frontend && bun run build` sem erro.
3. Capturas em `docs/redesign/screenshots/profiles-publishing/fase-2/`: os três estados de vídeo sem original (o de `source_missing` montado com um arquivo de informações preparado à mão), o corte `missing`, a confirmação de "Recriar as informações", a seção Pasta sem e com o cartão de pastas não reconhecidas, e a confirmação de "Adicionar ao app".
4. Os testes do nome `..`, do nome de pasta que já existe, da colisão na ingestão, do `video_id` adulterado, do arquivo ilegível sem job e dos escritores ao mesmo tempo estão verdes, e todos os arquivos-sentinela sobrevivem.
5. Com um perfil só e nada ligado, o comportamento é o de antes, a não ser pela lista da regra 1 relida em `local-first.md`, seção 7.
6. Revisão aprovada, **sem ressalva na seção B** do [review-checklist.md](../review-checklist.md), lida com `local-first.md`, 2.4.

Se o teste de regressão falhar e a correção exigir mudar o comportamento de hoje além da lista da regra 1, pare e leve ao dono.

## Validação manual

Em [manual-validation.md](../manual-validation.md), fase 2, só os itens que `local-first.md`, 2.5, diz que valem, mais o item novo dos dois vídeos de mesmo título.

## Modelos

Mapear os pontos que leem `media.base_dir` e os que montam o nome da pasta do vídeo: Haiku. Implementação e testes: Sonnet. Revisão: Opus.
