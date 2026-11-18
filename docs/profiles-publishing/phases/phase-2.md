# Fase 2 — Pasta portátil, divisão de configurações e arquivo de informações

> **ADIADA: não implementar.**
>
> Por decisão do dono (18/11/2026; [decisions.md](../decisions.md), D49), a pasta sincronizada entre computadores fica escrita, mas não é implementada: não é urgente nem necessária. Este arquivo passa a se chamar, nos índices, **"Pasta sincronizada entre computadores (adiada)"** e fica guardado como foi escrito, para o dia em que voltar.
>
> A fase 2 que vale agora é a **Base local**: [phase-2-local.md](./phase-2-local.md). O que dela veio deste arquivo (arquivo de informações por vídeo, adoção, nomes de pasta seguros, rotas locais) está lá, já adaptado. A emenda inteira está em [local-first.md](../local-first.md).
>
> Nenhum arquivo, rota, teste ou tela descrito abaixo deve ser criado a partir deste arquivo.

## Objetivo

O usuário escolhe uma pasta (a raiz). Vídeos, cortes, preferências do perfil e um arquivo de informações por vídeo passam a ficar nela. Abrir o app em outro computador e apontar para a mesma pasta mostra os mesmos vídeos e cortes, sem duplicar nada.

Sem raiz escolhida, o app continua como hoje, com estes efeitos novos e só estes:

- `data/machine.json` passa a existir.
- Cada pasta de vídeo ganha um `video.info.json` (criado no download, ou por adoção na primeira listagem).
- O diálogo "Onde guardar seus vídeos?" aparece uma vez (P20).
- Renomear um vídeo para um nome que vira `.`, `..` ou vazio, para um nome reservado (`_archived`, `logs`) ou para o nome de uma pasta que já existe é recusado (correção de defeito; `architecture.md`, 8.2).
- Uma pasta cujo `video.info.json` existe, não pode ser lido e que esta máquina ainda não conhecia não vira vídeo sozinha: aparece em Configurações → Pasta como "não reconhecida" (`architecture.md`, 8.3). Só acontece com arquivos que esta própria fase cria.
- Se P22 for "sim": quatro rotas existentes passam a recusar chamadas de outro aparelho ou de outro site.

## Depende de

- Fase 1 concluída (perfil local e `require_local_ui`).
- P5, P6, P9, P15, P20 e P22 respondidas.
  - P20 "não": o diálogo de primeira execução não existe; `first_run_pending` é sempre `false` e a escolha fica só em Configurações.
  - P22 "não": as quatro rotas existentes ficam sem `require_local_ui` (item 9 da Parte B sai).

## Leitura obrigatória

- [architecture.md](../architecture.md): seções 1 a 9, 12.8 (o registro de exclusões), 14.2 e 15.
- [api-contracts.md](../api-contracts.md): seções 1 e 3, e os tipos da fase 2.
- [ui.md](../ui.md): seções 0, 1, 2, 3, 6.1, 7.2, 11 (só os três estados sem original e 11.1), 15 e 16.
- [decisions.md](../decisions.md): D3, D4, D7 a D11, D22, D29 a D37, e D42 a D45 e D47 (a revisão que mudou a migração, a identidade do vídeo, o renomear e a validação da raiz).
- [review-checklist.md](../review-checklist.md): seção B, antes de escrever a primeira linha. Esta fase já apaga e move arquivos.

## Entregas

A fase é grande. Faça em três partes, nesta ordem, cada uma com seus testes verdes antes da seguinte.

### Parte A — Arquivo de informações e identidade da máquina (vale nos dois modos)

1. `data/machine.json` (`architecture.md`, 3.1), com o tratamento de arquivo ilegível.
2. `video.info.json`: modelo, leitura, escrita, versão (`architecture.md`, 5).
3. **Arquivo ilegível nunca é sobrescrito** (`architecture.md`, 5.3): não é adotado, não é renomeado sozinho e **nunca faz nascer um job**; o vídeo que já tem job aparece com `info_unreadable`. Rota `POST /videos/:job_id/info/recreate` para a saída com clique.
4. Criação no fim do download e do envio local, com `downloaded_at` e, para envio local, `keep: true`. Em modo raiz, o arquivo de informações é gravado **antes** de o vídeo ser copiado para a pasta (`architecture.md`, 3.3).
5. Entrada em `shorts[]` no fim de cada renderização (com `cut_id`, `start`, `end`, título, resumo, `watermark`). `DELETE /jobs/:id/renders/:file` grava `deleted_at` na entrada; **a entrada não é removida** (`architecture.md`, 5.2).
6. **Conferência de `shorts[]` com o disco** (`architecture.md`, 5.5), na listagem, depois da adoção e depois da migração: cria a entrada dos cortes que já existiam (a biblioteca inteira de quem já usa o app), com `watermark: null`; marca como `missing`, só em memória, a entrada cujo arquivo não está no disco. Em somente leitura não grava.
7. Reconciliação pasta ↔ job por `video_id` e adoção de pastas antigas (`architecture.md`, 8.3). `create_job` já aceita `job_id` (`job_lifecycle.py:229-241`); a reconciliação passa esse id. Não há mudança de assinatura. Quatro regras que não podem faltar:
   - **O `video_id` é conferido antes de virar job** (`architecture.md`, 5.3): só `^[0-9a-f]{32}$` cria job, e o caminho `data/jobs/<video_id>` é conferido como filho direto de `paths.jobs_dir()` antes da primeira escrita. Fora do formato, o arquivo conta como ilegível. Um id antigo fora do formato só vale se esta máquina já tem um job com esse id.
   - **Em modo raiz, pasta sem arquivo de informações só é adotada sozinha quando esta máquina já tem job para ela.** As outras ficam entre as "não reconhecidas": nenhum job, nenhuma escrita.
   - **Duas pastas com o mesmo `video_id`:** em modo local a segunda ganha id novo; em modo raiz nada é regravado sozinho.
   - **Uma pasta, um job:** outro job local que ainda aponte para uma pasta reconhecida pelo `video_id` é desligado dela (`source_video_path` e `video_name` nulos).
8. **Pastas não reconhecidas** (`architecture.md`, 8.3): lista em memória com a hora da primeira vez em que foram vistas; campos `unrecognized_folders` e `unrecognized_folders_ready` em `GET /storage`; `POST /storage/folders/adopt` (local, com `confirm`), que só adota as que estão há pelo menos 10 minutos na lista, relendo o disco antes.
9. Original ausente: `source_missing` só com `source.deleted_at` preenchido; senão `source_absent` (`architecture.md`, 8.3).
10. `title` atualizado ao renomear o vídeo.
11. `GET /videos/:job_id/info` e os campos `info`, `source_missing`, `source_absent` e `info_unreadable` em `VideoRecord`.
12. **Nome de pasta de vídeo** (`architecture.md`, 8.2, item 1), nos dois modos e sem diferenciar maiúsculas: `.`, `..`, nome vazio e os nomes reservados (`_archived`; `logs` em modo local) são recusados no renomear (`400`) e trocados pelo `job_id` na ingestão. O renomear recusa também o nome de uma pasta que já existe e **nunca move uma pasta para dentro de outra**: a existência do destino é conferida de novo logo antes de mover.

### Parte B — Raiz, trava e área de trabalho

1. Resolvedor de caminhos (`architecture.md`, 8.2). Em modo local devolve os caminhos de hoje. Em modo raiz, os ajustes de nome de pasta (80 caracteres, ponto e espaço no fim, nomes reservados) e a conferência de que todo caminho montado é descendente da pasta de vídeos do perfil.
2. Função de escrita para a raiz (`architecture.md`, 6): interface única `update(caminho, mudar)`, em que `mudar` recebe o conteúdo relido na hora; **trava por caminho dentro do processo** em volta de todo o ciclo ler-mudar-gravar; temporário de nome único com o `<m8>` da máquina; novas tentativas; releitura que, se não bate, **aplica a mudança de novo** sobre o conteúdo atual; escritas pendentes guardadas como mudança, não como conteúdo.
3. Fusão de duas versões inteiras, campo a campo (`architecture.md`, 6.3), usada para as cópias de conflito: remoções como datas (`deleted_at`, `removed_at`) e desempate por `revision` antes de `updated_at`.
4. Cópias de conflito (`architecture.md`, 6.4), inclusive as de `yts-root.json` e de `yts-lock.json`, com as cinco conferências antes de apagar.
5. Varredura de temporários de JSON ao abrir a raiz, **só** nos caminhos e nomes de `architecture.md`, 6.2. É a única exclusão sem clique.
6. `yts-root.json` no formato de `architecture.md`, 2.1 (sem índice de perfis: os perfis vêm de `perfis/*/profile.json`). Validação de caminho com as 12 linhas de `architecture.md`, 8.4, a lista de `looks_synced` e as conferências ao iniciar (`app_overlaps_root`, `data_dir_synced`). Criar e abrir raiz; raiz indisponível.
7. Trava (`architecture.md`, 7): **nunca muda de dono sem clique**, nem quando parece parada (`lock.stale`). Modo somente leitura, com `409 storage_read_only` nas rotas que escrevem na raiz; a lista dessas rotas fica num único lugar. Escritas de conclusão (fim de download, de envio local e de renderização) como lista fechada.
8. Área de trabalho local para download, envio, renderização, transcrição e logs em modo raiz (`architecture.md`, 3.3), com os temporários nomeados `…<m8>.tmp`. `POST /storage/leftovers/clear` e os campos `leftover_tmp_*` de `GET /storage`.
9. `require_local_ui` em `DELETE /videos/:job_id`, `DELETE /jobs/:job_id/renders/:file`, `POST /videos/:job_id/archive` e `POST /config/select-folder` (P22; `architecture.md`, 14.2). Sem mudança de corpo nem de resposta.
10. Migração em sessão com progresso e cancelamento (`architecture.md`, 8.5): arquivados vão para `videos/_archived/`; o destino é achado pelo `video_id` (primeiro procurando o id nas pastas que já estão no destino, que é o que faz a retomada continuar na mesma pasta), nunca fundindo dois vídeos; só `video.info.json`, `shorts/*.mp4` e `video.<ext>` são levados, **nessa ordem** (o arquivo de informações vai primeiro e, no mesmo disco, o da origem só sai por último), arquivo por arquivo; cópia entre discos por `.tmp` + conferência + `os.replace`; `moved_videos` na sessão.
11. Registro de exclusões (`architecture.md`, 12.8): o módulo que escreve `limpeza/<machine_id>.jsonl` nasce **nesta** fase, porque cópias de conflito e temporários apagados já são registrados. A fase 4 reusa o módulo.
12. Rotas da seção 3 de `api-contracts.md`.
13. `POST /config/select-folder` passa a **esperar o seletor fora do laço de eventos** (`run_in_threadpool` ou subprocesso `asyncio`), com tempo limite. Vale com qualquer seletor injetado, inclusive o falso dos testes.
14. **Opcional (O3 do README):** seletor de pasta nativo para Windows injetado em `container.folder_picker`, num processo separado. Sem ele, a rota continua devolvendo `selected: false` e a tela usa o caminho digitado, que já funciona sozinho. Em outros sistemas é sempre assim.

### Parte C — Divisão das configurações

1. `PORTABLE_KEYS` e a sobreposição de leitura e escrita (`architecture.md`, 9).
2. A migração preenche `preferences.settings` e `preferences.tool_configs` do perfil com os valores atuais.
3. Restauração de padrões respeitando a divisão.
4. O perfil local vira o primeiro perfil da raiz (com `profile_id` novo); a marca d'água da fase 1 vai junto.

### Frontend

1. `FolderField` e `NoticePill` / `AppNotices` (`ui.md`, 0.3 e 7.2). Nesta fase a pílula só mostra somente leitura (inclusive "o outro computador parece parado") e escrita pendente. `AppNotices` troca de canto quando a barra lateral está visível à direita.
2. Diálogo de primeira execução, com validação, migração e todos os resultados, inclusive a tabela de fim de migração (`ui.md`, 1).
3. Diálogo de pasta indisponível, pílula e confirmação de somente leitura (`ui.md`, 2).
4. Entrada "Armazenamento e limpeza" → "Pasta" nas Configurações (`ui.md`, 6.1), com as confirmações de "Deixar de usar esta pasta" e "Trocar pasta", os avisos de `warnings`, os arquivos de conflito, os temporários esquecidos e as pastas não reconhecidas (com "Adicionar ao app"). O bloco "Espaço usado" mostra só o total nesta fase.
5. Controles desabilitados em somente leitura.
6. Os três estados de vídeo sem original (`source_missing`, `source_absent`, `info_unreadable`) e o corte `missing` (`ui.md`, 11). "Baixar de novo" não é desta fase.
7. **Em modo raiz:** confirmação do "Remover" da barra lateral e a linha de aviso no `DeleteCutConfirmDialog` (`ui.md`, 11.1). Em modo local os dois ficam idênticos aos de hoje.
8. `api/storage.ts`, `hooks/useStorage.ts`.

O canal `GET /events` é da fase 4. Nesta fase o frontend consulta `GET /storage` a cada 30 segundos e ao voltar o foco para a janela.

## Arquivos que pode tocar

Criar:

- `backend/app/core/storage_layout.py`, `machine_state.py`, `preferences_overlay.py`
- `backend/app/infrastructure/storage/synced_store.py`, `root_lock.py`
- `backend/app/infrastructure/system/folder_picker.py`
- `backend/app/domain/storage/__init__.py`, `video_info.py`, `root.py`, `migration.py`, `reconcile.py`, `merge.py`, `deletion_log.py`
- `backend/app/api/routers/storage.py`
- `backend/tests/test_pp_phase2_video_info.py`, `test_pp_phase2_root.py`, `test_pp_phase2_overlay.py`
- `frontend/src/api/storage.ts`, `frontend/src/hooks/useStorage.ts`
- `frontend/src/components/redesign/AppNotices.tsx`, `FolderField.tsx`, `StorageFirstRunDialog.tsx`, `StorageUnavailableDialog.tsx`, `DeleteVideoConfirmDialog.tsx`
- `frontend/src/components/redesign/settings/StorageSections.tsx` (nesta fase, só o componente `StorageFolderSection`)

Alterar:

- `backend/app/core/paths.py`, `settings.py`, `tool_configs.py` (só para consultar o resolvedor e a sobreposição)
- `backend/app/application/job_lifecycle.py`, `runtime_service.py` (adaptadores novos no container)
- `backend/app/domain/ingest/service.py`, `backend/app/domain/rendering/rendering_service.py`
- `backend/app/domain/profiles/profile_store.py`
- `backend/app/api/routers/videos.py`, `config.py`, `jobs_render.py`, `jobs_ingest.py`, `jobs.py`, `jobs_transcription.py`, `jobs_analysis.py` (só a guarda de somente leitura, a reconciliação, `require_local_ui` nas quatro rotas de P22 e a espera do seletor fora do laço de eventos)
- `backend/app/models/schemas.py`, `backend/app/main.py`
- `backend/tests/conftest.py` (isolar `machine.json` e a raiz em `tmp_path`; falsos novos)
- `shared/contracts.ts`
- `frontend/src/api/index.ts`, `frontend/src/hooks/index.ts`
- `frontend/src/components/redesign/settings/settingsShared.tsx`, `SettingsHubModal.tsx`, `ArcSidebar.tsx`, `GlassDock.tsx`, `NewVideoModal.tsx`, `ImmersiveVideoStage.tsx` (para desabilitar em somente leitura e mostrar os estados de `ui.md`, 11)
- `frontend/src/components/redesign/DeleteCutConfirmDialog.tsx` (só a linha de aviso em modo raiz)
- `frontend/src/api/videos.ts` (tipos novos de `VideoRecord`; chamada de `info/recreate`)
- `frontend/src/App.tsx`
- `.gitignore`, `AGENTS.md`, `DESIGN.md` da raiz

Não pode alterar: `data/settings.json` e os outros JSON versionados de `data/`; o formato de resposta de `/config/settings` e `/config/tool-configs`; `media.py` além do necessário para achar o arquivo pelo resolvedor.

## Fora de escopo

- Vários perfis e troca de perfil (fase 3). A raiz nasce com um perfil.
- Limpeza, "manter", exceção de tamanho na tela (fase 4). Os campos já existem no arquivo.
- Publicação (fases 5 e 6). `shorts[].publications` nasce vazio.
- Levar transcrição, análise ou cortes não aprovados para a raiz.
- Consertar a rota de arquivar ou a de excluir vídeo. Elas só ganham `require_local_ui` (P22) e, na tela, a confirmação em modo raiz. O `rmtree` delas continua.
- Mover a raiz de lugar pelo app.

## Testes

Tudo em `tmp_path`. "Dois computadores" são dois diretórios `data/` diferentes apontando para a mesma raiz, dentro do mesmo teste. Nenhum disco sincronizado real.

**Arquivo de informações**

- Download e envio (com `yt-dlp` e `ffprobe` falsos) criam o arquivo com os campos certos; envio local nasce com `keep: true`.
- Renderização acrescenta a entrada; excluir o corte grava `deleted_at` e a entrada **continua** no arquivo; gerar de novo o mesmo corte deixa a entrada viva e mantém as `publications`.
- Campo desconhecido é preservado ao regravar; `schema_version` maior impede a escrita.
- **Arquivo ilegível**, três casos (0 bytes, JSON cortado no meio, `schema_version: 2`), numa pasta para a qual a máquina **já tem** job: o conteúdo do arquivo é **idêntico** antes e depois de listar; a pasta não é adotada; o vídeo vem com `info_unreadable` (os dois primeiros) ou com o aviso de versão mais nova (o terceiro); `flags` e publicação são recusados. `info/recreate` renomeia o arquivo (ele continua no disco com o nome `.corrupt-…`) e só então adota.
- **Arquivo ilegível sem job** (0 bytes e JSON cortado, nos dois modos, com `data/jobs/` vazio): listar **não cria job**, não grava nada e o vídeo não aparece em `/videos`; `GET /storage` conta a pasta em `unrecognized_folders`. Quando o arquivo passa a ser legível, a listagem seguinte cria **um** job, com o `video_id` do arquivo, e a pasta sai da contagem. Em nenhum momento há dois jobs para a mesma pasta.
- **`video_id` adulterado:** arquivos de informações com `video_id` igual a `..\..\x`, `../x`, um caminho absoluto, vazio, `CON`, 32 hex em maiúsculas, 31 e 33 caracteres, e um número em vez de texto. Em todos: nenhum job é criado, nada é escrito fora de `data/jobs/` nem dentro dele, o arquivo fica **idêntico**, e a pasta é tratada como ilegível. Um arquivo-sentinela criado **fora** de `data/jobs/` (no lugar para onde `..\..\x` apontaria) existe e está intacto no fim. Um id antigo fora do formato (`job-antigo`) é aceito na máquina que **já tem** esse job e conta como ilegível na que não tem.
- **Conferência de cortes:** pasta antiga com três `.mp4` em `shorts/` e nenhum arquivo de informações → depois da listagem há três entradas, com `start`/`end` tirados do nome, `cut_id`/título vindos de `cuts.suggested.json` quando início e fim casam e `null` quando não, e `watermark: null`. Listar de novo não muda o arquivo. Entrada cujo arquivo sumiu do disco: o arquivo de informações **não muda** e a resposta marca `missing`. Em somente leitura nada é gravado.
- Nenhum caminho absoluto aparece em nenhum arquivo dentro da raiz (busca por letra de disco e por `tmp_path` em todos os JSON gerados).

**Reconciliação**

- Máquina B abre a raiz criada por A: os jobs têm os **mesmos** ids; listar duas vezes não cria job novo.
- Pasta antiga sem arquivo, com job que a máquina já tinha, é adotada com `downloaded_at = Job.created_at` (nos dois modos). Em modo local, sem job: vale a regra de hoje (job criado pelo caminho e pasta adotada).
- **Modo raiz, pasta que chega sem arquivo de informações:** com a raiz criada por A e o `data/` **vazio** da máquina B, uma pasta com `video.mp4` e sem `video.info.json` → depois de listar duas vezes em B, **nada foi escrito** na raiz (comparação da árvore antes e depois), nenhum job foi criado em B e `GET /storage` traz `unrecognized_folders: 1` com `unrecognized_folders_ready: 0`. Quando o `video.info.json` verdadeiro "chega" (o teste o grava, com `keep: true` e uma publicação), a listagem seguinte usa o `video_id` dele, e a marca e a publicação estão lá.
- **"Adicionar ao app":** `POST /storage/folders/adopt` sem `confirm` devolve `400`; com a pasta há 9 minutos na lista (relógio injetado) não adota nada (`waiting: 1`); com 11 minutos adota, e o arquivo criado tem `keep: true`, `source.kind: "upload"` e `downloaded_at_origin: "migration"`. Para `info_unreadable`, o arquivo ilegível continua no disco com o nome `.corrupt-…`. Se o arquivo de informações apareceu entre a varredura e o clique, a rota não cria outro. Em somente leitura: `409`. Cliente de fora: `403`.
- Pasta só com cortes e arquivo de informações: com `source.deleted_at` preenchido aparece com `source_missing: true`; com `deleted_at` nulo aparece com `source_absent: true` e **sem** `source_missing`.
- **Nome `..`:** renomear para `..`, `.` e um nome só de espaços devolve `400` e não move nada. Com um job cujo `video_name` foi gravado à mão como `..`, `DELETE /videos/:id` não toca em nada fora da pasta do vídeo: um arquivo-sentinela na pasta de cima sobrevive. Nos dois modos.
- **Nome de pasta que já existe:** com um arquivo-sentinela dentro da pasta de **outro** vídeo e outro dentro de `_archived/<um vídeo>/`, renomear para o nome do outro vídeo, para o mesmo nome com a caixa trocada (`Outro Video` → `outro video`), para `_archived`, para `_ARCHIVED` e, em modo local, para `logs` e `Logs` devolve `400` "Escolha outro nome.", a pasta do vídeo continua onde estava e **nenhuma pasta foi parar dentro de outra**. Em seguida, `DELETE /videos/:id` do vídeo que tentou renomear apaga só a pasta dele: os dois sentinelas sobrevivem. Renomear trocando só a caixa do próprio nome muda o título e não move a pasta. Na ingestão, um vídeo cujo título vira `_archived` ou `logs` usa o `job_id` como nome da pasta. Nos dois modos.
- Duas pastas com o mesmo `video_id`: em modo local a segunda ganha id novo. Em modo raiz **nenhum** dos dois arquivos muda, a segunda pasta conta em `unrecognized_folders`, e fica com o id a pasta para onde o job já apontava (teste com o job apontando para a segunda em ordem alfabética).
- **Uma pasta, um job:** com um job antigo `J` apontando para uma pasta cujo `video.info.json` passa a trazer outro `video_id` válido `V`, a listagem cria `V` e deixa `J` sem `source_video_path` e sem `video_name`; `DELETE /videos/J` depois disso não toca na pasta (um sentinela dentro dela sobrevive).
- Em modo local, sem nenhum `video.info.json` prévio, `/videos` devolve a mesma lista de antes (mais os campos opcionais).

**Raiz e trava**

- Validação: cada uma das 12 linhas da tabela de `architecture.md`, 8.4. Em especial: raiz que **contém** o repositório; raiz que contém o diretório de dados com `YTS_DATA_DIR` apontando para outro lugar; a pasta do usuário, a pasta **acima** dela e cada pasta geral da lista (`too_broad`), com uma subpasta de Documentos sendo aceita; raiz igual a `media.base_dir`; pasta dentro de outra raiz (um `yts-root.json` duas pastas acima, legível e de 0 bytes) e pasta que contém a raiz em uso (`overlaps_other_root`), com a **mesma** raiz em uso sendo aceita como raiz existente; `yts-root.json` de 0 bytes (`unreadable`, e **nada** é criado nem sobrescrito). Em nenhum caso inválido aparece `yts-root.json` ou `perfis/` no caminho.
- `looks_synced`: um teste por nome da lista, e um caminho comum que não casa.
- Ao iniciar com o diretório de dados dentro da raiz configurada: a raiz não é aberta e `warnings` traz `app_overlaps_root`. Com o diretório de dados num caminho que "parece sincronizado": `warnings` traz `data_dir_synced`.
- `yts-root.json`: criado com todos os campos de `architecture.md`, 2.1; `root_id` não muda numa fusão; duas pastas com o mesmo `profile_id` → vale a primeira, `warnings` traz `duplicate_profile`, nada é regravado.
- Raiz indisponível na inicialização: nada é criado no caminho, `machine.json` não é alterado.
- Trava: sem trava; trava própria; trava alheia recente (somente leitura); trava alheia antiga (**continua** somente leitura, com `lock.stale`, e a trava no disco **não muda**); tomar o controle com clique nos dois casos; o antigo dono percebe e vira somente leitura. Dez minutos de `heartbeat_at` parado, medidos no relógio injetado, **não** trocam o dono.
- Perda da trava no meio: uma renderização que já estava rodando termina e o corte entra em `shorts[]` (escrita de conclusão); uma renderização pedida depois recebe `409`.
- Em somente leitura, cada rota da lista devolve `409` e nenhum arquivo da raiz muda (comparação de conteúdo antes e depois).
- `require_local_ui` nas quatro rotas existentes de P22: cliente de fora e `Origin` de outro site recebem `403`; cliente local recebe a resposta de sempre, com o mesmo corpo.
- `POST /config/select-folder` com um seletor falso que demora: outra rota responde enquanto ele espera (o laço de eventos não trava).

**Escrita**

- `os.replace` falhando 3 vezes e passando na 4ª: grava. Falhando sempre: arquivo antigo intacto, temporário removido, escrita pendente registrada.
- Fusão de duas versões do mesmo arquivo (a oficial e uma cópia de conflito), conforme a tabela de `architecture.md`, 6.3, um teste por linha. Em especial: uma publicação presente só num dos lados **nunca** some; um corte com `deleted_at` num lado e sem no outro continua apagado; `abandoned` vence `in_progress` e perde para `published`; em "demais campos" vence a `revision` maior mesmo com `updated_at` mais antigo.
- **Escritores ao mesmo tempo:** 20 threads chamando `update` no mesmo `video.info.json`, cada uma acrescentando um corte ou um registro de publicação diferente → no fim estão lá as 20 entradas, a `revision` subiu 20 e não sobrou nenhum `.tmp`.
- Releitura que não bate (o arquivo é trocado por fora entre o `os.replace` e a releitura, com outra mudança dentro): a mudança é aplicada de novo e as duas ficam.
- Escrita pendente: com o `os.replace` falhando sempre, outra mudança entra no arquivo por fora; quando a escrita volta a funcionar, a pendente é aplicada sobre o conteúdo novo e as duas mudanças ficam.
- **Varredura de temporários:** um `video.info.json.<m8 desta máquina>.<hex>.tmp` com duas horas é apagado; o mesmo com 10 minutos fica; o de **outro** `<m8>` com duas horas fica; um `outro.json.tmp` antigo na raiz fica; um `.tmp` com o nome certo dentro de `shorts/` ou de uma subpasta qualquer fica; um link simbólico com o nome certo fica.
- Cópia de conflito: fundida, anotada, não apagada; `conflicts/clear` apaga só as anotadas e registra cada uma.
- **`merged_conflict_files` adulterado:** com os valores `../x/video.mp4`, `video.mp4`, `video.info.json`, um caminho absoluto e `shorts/a.mp4` na lista, `conflicts/clear` não apaga nenhum deles (todos contam em `ignored`) e os arquivos continuam lá.
- `leftovers/clear`: apaga `video.mp4.<m8 desta máquina>.tmp` antigo; não apaga o de outro `<m8>`, nem o de um vídeo em processamento, nem `video.mp4`.

**Migração**

- Mesmo disco: `video.info.json`, `shorts/*.mp4` e `video.<ext>` levados (no fim, a origem não tem mais nenhum dos três); `transcrições/` e um arquivo desconhecido **ficam** na pasta antiga e **não** aparecem na raiz. Outro disco (simulado): copiados, tamanho conferido, origem intacta; durante a cópia o nome final só aparece depois do `.tmp` completo.
- **Arquivados:** uma pasta em `_archived/` vai para `videos/_archived/` e continua arquivada. Um vídeo ativo e um arquivado com o **mesmo nome** viram duas pastas separadas, cada uma com o seu `video_id` e os seus cortes; nenhum arquivo de um aparece na pasta do outro.
- **Colisão:** destino já tem uma pasta com o mesmo nome e outro `video_id` → o vídeo vai para `<nome> (2)`; os arquivos da pasta que já estava lá não mudam.
- **Ordem:** o primeiro arquivo que aparece na pasta de destino é `video.info.json`; no mesmo disco, o `video.info.json` da origem só some depois de os cortes e o original estarem no destino.
- **Interrompida no meio de um vídeo e refeita**, no mesmo disco e em outro disco, com a interrupção (função de mover ou copiar falsa que levanta erro) em cada um destes pontos: logo depois de criar a pasta de destino (antes do arquivo de informações); depois do arquivo de informações; depois dos cortes; depois do original (mesmo disco: antes de remover o `video.info.json` da origem). Em todos, depois de retomar: existe **exatamente uma** pasta de destino com aquele `video_id`, **não existe** `<nome> (2)`, cada arquivo aparece uma vez só, os tamanhos batem e, em outro disco, a origem está intacta. Listar a raiz em seguida mostra **um** vídeo, com um job só.
- **Interrompida com colisão de nome:** o destino já tinha `<nome>` de **outro** vídeo; a primeira tentativa vai para `<nome> (2)` e é interrompida depois dos cortes; a retomada continua em `<nome> (2)` e não cria `<nome> (3)`.
- **Mudança entre a interrupção e a retomada:** depois de interromper, o teste marca `keep: true` no arquivo de informações da origem; depois de retomar, o do destino tem `keep: true` (fusão, não sobrescrita).
- Refeita depois de terminada: o vídeo já levado é reconhecido pelo `video_id`, nada é copiado de novo e ele conta em `skipped_videos`; `moved_videos` informa quantos originais já saíram da origem.
- Pasta de origem com arquivo de informações ilegível: fica na origem, idêntica, e conta em `skipped_videos`.
- Com uma raiz já em uso, `POST /storage/root` para outra pasta abre a outra e não leva nada, mesmo com `migrate: "bring"`.
- Transcrição vai para `data/jobs/<id>/` e continua sendo encontrada.
- Depois da migração, os cortes antigos têm entrada em `shorts[]`.
- Com job em processamento: `409`.

**Sobreposição**

- Em modo local: `/config/settings` e `/config/tool-configs` leem e gravam nos arquivos de hoje, byte a byte.
- Em modo raiz: chave portátil gravada vai para `profile.json` e **não** para os arquivos de `data/`; chave de máquina faz o contrário; a resposta das rotas tem o mesmo formato.
- Máquina B com outra configuração de máquina lê as preferências do perfil gravadas por A.
- `PORTABLE_KEYS` bate, chave por chave, com as tabelas de `architecture.md`, 9.1.

**Regressão**

- A suíte existente inteira passa sem alteração de teste (exceto `conftest.py`).

## Critério de pronto

1. `pytest` verde, a suíte inteira.
2. `cd frontend && bun run build` sem erro.
3. Capturas em `docs/redesign/screenshots/profiles-publishing/fase-2/`: primeira execução (cada resultado e cada motivo de pasta inválida), migração em andamento e cada linha da tabela de fim de migração, pasta indisponível, somente leitura (normal e "parece parado"), seção Pasta nos dois modos com cada aviso e com o cartão de pastas não reconhecidas (botão aguardando e botão liberado), os três estados de vídeo sem original, a confirmação do "Remover" em modo raiz, e `AppNotices` com a barra lateral fixada à direita.
4. Teste "dois computadores" verde: mesma lista de vídeos e de cortes, mesmos ids, preferências iguais.
5. Nenhum caminho absoluto dentro da raiz (teste automático).
6. Os testes de escritores ao mesmo tempo, de varredura de temporários, de `merged_conflict_files` adulterado, do nome `..`, do nome de pasta que já existe, do `video_id` adulterado, da pasta que chega sem arquivo de informações em modo raiz e da migração interrompida em cada ponto verdes.
7. Revisão aprovada, **sem ressalva na seção B** do [review-checklist.md](../review-checklist.md) para o que esta fase apaga ou move.

Se o teste de regressão do modo local falhar e a correção exigir mudar o comportamento de hoje, pare e leve ao dono.

## Validação manual

Em [manual-validation.md](../manual-validation.md), fase 2: Drive real, segundo computador, comportamento do programa de sincronização.

## Modelos

Mapear os pontos que leem `media.base_dir`: Haiku. Implementação e testes: Sonnet. Revisão: Opus.
