# Contratos de API

> **Leia antes: [local-first.md](./local-first.md) ("Emenda: só neste computador").**
>
> Por decisão do dono (D49), a pasta sincronizada entre computadores está **adiada**. Este documento continua como foi escrito, mas para as fases 2 a 6 a emenda vence onde houver diferença. A seção 2 (fase 1, marca d'água) **não muda**.
>
> **Rotas adiadas, que não devem ser criadas nem entrar no inventário:** `POST /storage/root/validate`; `POST /storage/root`; `DELETE /storage/root`; `GET /storage/migrations/:migration_id`; `POST /storage/migrations/:migration_id/cancel`; `POST /storage/retry`; `POST /storage/first-run/dismiss`; `POST /storage/lock/takeover`; `POST /storage/conflicts/clear`; `POST /storage/leftovers/clear`.
>
> **Também adiados:** a convenção "Somente leitura" e os códigos `storage_read_only`, `storage_unavailable` e `root_required` (seção 1); os campos de raiz, de trava e de máquina de `GET /storage` (seção 3); os tipos `RootInvalidReason`, `RootValidation` e `StorageMigration` (seção 7).
>
> **Valem com trocas descritas na emenda:** `GET /storage` (reduzida), `POST /storage/folders/adopt`, as rotas de `/profiles` da seção 4 (pasta de vídeos por perfil; remover) e os tipos `StorageStatus`, `VideoInfo`, `ShortPublicationRecord`, `ProfileSummary` e `Profile`. A emenda cria três códigos: `invalid_videos_dir`, `videos_dir_unavailable` e `first_profile`. O resto das seções 3 a 6 **vale como está**. Detalhe em `local-first.md`, 2.2, 3.4, 3.5, 3.7 e 3.8.

Todas as rotas **novas**, os campos acrescentados às rotas existentes e os acréscimos em `shared/contracts.ts`. O significado dos dados está em [architecture.md](./architecture.md).

## 1. Convenções

- Porta `8000`, JSON, mesmas convenções do `DESIGN.md` da raiz.
- **Erro:** `{ "detail": "<texto em português, pronto para mostrar>" }`, com campo aditivo opcional `code` quando a tela precisa reagir ao tipo do erro. É o envelope da seção 2.2 do `DESIGN.md`.
- **Datas:** ISO 8601 em UTC com `Z`, como `Job.created_at`.
- **Tamanhos:** sempre em bytes, em campos terminados em `_bytes`.
- **Aditivo:** nenhuma rota existente perde, renomeia ou muda o tipo de um campo. Todo campo novo em resposta existente é opcional.
- **`:profile_id`** aceita o alias `active` (o perfil ativo desta máquina).
- **Rota "local":** protegida por `require_local_ui` ([architecture.md](./architecture.md), 14.2). Chamada de fora da máquina ou de outra origem: `403` `{ "detail": "Esta ação só pode ser feita neste computador.", "code": "local_only" }`.
- **Somente leitura:** rota que escreveria na raiz devolve `409` `{ "detail": "Esta pasta está em uso em outro computador.", "code": "storage_read_only" }`.
- **Nenhuma resposta e nenhum evento contém token, segredo, código de autorização nem endereço de sessão de envio.**
- **Texto de erro vem de tabela fixa.** `detail` e `error.message` nunca são montados com o texto de uma exceção HTTP (que pode trazer uma URL com segredo). Ver [architecture.md](./architecture.md), 10.5.
- **Identificadores em rota** (`profile_id`, `account_id`, `job_id`, `session_id`, `migration_id`, `publication_id`, `plan_id`, `file`) são validados por formato antes de qualquer acesso a disco. Nenhum deles vira nome de pasta direto: a pasta do perfil vem da leitura de `perfis/*/profile.json`; os arquivos de conta e de marca d'água têm nome fixo reconstruído no servidor ([architecture.md](./architecture.md), 2.1 e 4.2).
- **Identificador lido de arquivo sincronizado** (`video_id`, `profile_id`, `root_id`, `account_id`) passa pela mesma conferência de formato antes de qualquer uso. Um `video_id` que não seja 32 hex minúsculos nunca cria job nem vira caminho; o arquivo conta como ilegível ([architecture.md](./architecture.md), 5.3).

Códigos de erro usados (`code`):

| `code` | HTTP | Quando |
|---|---|---|
| `local_only` | 403 | Rota local chamada de fora |
| `storage_read_only` | 409 | Outro computador é o dono da trava |
| `storage_unavailable` | 409 | A raiz configurada não está acessível |
| `busy_processing` | 409 | Há algo em processamento que impede a ação |
| `busy_cleanup` | 409 | O vídeo está sendo apagado pela limpeza neste instante |
| `busy_publishing` | 409 | A conta tem envio em andamento; cancele ou espere |
| `publish_in_progress` | 409 | O corte já está sendo enviado para aquela conta (aqui ou em outro computador) |
| `info_unreadable` | 409 | O arquivo de informações do vídeo não pôde ser lido |
| `invalid_image` | 400 | Imagem da marca d'água recusada |
| `watermark_missing` | 400 | Pediu marca d'água e não há imagem |
| `profile_unreadable` | 409 | `profile.json` existe e não pôde ser lido (ou é de versão mais nova); o arquivo nunca é sobrescrito |
| `plan_expired` | 409 | Plano de limpeza vencido ou desconhecido |
| `size_exception_required` | 409 | Vídeo maior que o limite, sem exceção aberta |
| `account_mismatch` | 409 | Login feito com conta diferente da esperada |
| `account_in_other_profile` | 409 | A conta já pertence a outro perfil |
| `client_missing` | 409 | Falta a credencial de aplicativo nesta máquina |
| `login_required` | 409 | A conta precisa entrar de novo nesta máquina |
| `already_published` | 409 | O corte já foi publicado naquela conta |
| `quota_exceeded` | 429 | Limite diário da plataforma |

## 2. Fase 1 — Marca d'água

### `GET /profiles/:profile_id/watermark`

Resposta `200`: `WatermarkSettings`.

```json
{
  "mode": "never",
  "has_image": false,
  "image_url": null,
  "opacity": 0.7,
  "position": "top-right",
  "size_percent": 18,
  "image": null
}
```

`image_url` é `"/profiles/<id>/watermark/image?v=<updated_at>"` quando há imagem. `404` se o perfil não existe.

### `PUT /profiles/:profile_id/watermark` — local

Corpo: qualquer subconjunto de `{ "mode", "opacity", "position", "size_percent" }`.

Resposta `200`: `WatermarkSettings`.

Erros: `400` valor fora da faixa ou de tipo errado (número inteiro em `size_percent`; booleano não vale como número; corpo que não é JSON); `409` `profile_unreadable`; `400` `watermark_missing` ao pedir `mode` diferente de `"never"` sem imagem; `409` `storage_read_only`.

**"Restaurar padrões"** da seção Marca d'água não tem rota própria: o frontend chama esta rota com `{ "opacity": 0.7, "position": "top-right", "size_percent": 18 }`. `mode` e a imagem **não** mudam.

### `POST /profiles/:profile_id/watermark/image` — local

`multipart/form-data`, campo `file`.

Resposta `200`: `WatermarkSettings`. O `mode` **não muda** com o envio ([architecture.md](./architecture.md), 11.2; P21). O arquivo é sempre gravado em `marca-dagua/watermark.png`; o nome enviado é descartado.

Erros: `400` `invalid_image` com `detail` específico ("Use uma imagem PNG, JPG ou WebP.", "A imagem passa de 5 MB.", "A imagem é grande demais.", "A imagem é pequena demais." (lado menor que 16 px), "Não foi possível ler a imagem."). PNG/WebP animados são recusados com "Use uma imagem PNG, JPG ou WebP."; `409` `storage_read_only`.

### `GET /profiles/:profile_id/watermark/image`

Resposta `200`: `image/png`. `404` `{ "detail": "Watermark not found" }`.

Este `404`, o `404` `"Profile not found"` das rotas desta seção e o `404` de `GET /videos/:job_id/info` são a exceção à regra "texto em português" da seção 1: seguem o estilo em inglês que as rotas de mídia e de vídeo já usam (`"Video not found"`, `backend/app/api/routers/videos.py`) e **nunca são mostrados ao usuário**. A tela trata o `404` pelo código HTTP (sem imagem, sem perfil) e não exibe o `detail`.

### `DELETE /profiles/:profile_id/watermark/image` — local

Resposta `200`: `WatermarkSettings` (com `mode: "never"`, `has_image: false`). `409` `storage_read_only`.

Apaga `marca-dagua/watermark.png` pelo caminho fixo, reconstruído no servidor; o campo `watermark.file` do JSON não é usado para achar o arquivo. A partir da fase 2, em modo raiz, a exclusão ganha uma linha no registro (`kind: "profile_file"`).

### Campos acrescentados a rotas existentes

| Rota | Campo novo no corpo | Efeito |
|---|---|---|
| `POST /jobs/:job_id/render` | `watermark?: boolean` | Tabela de [architecture.md](./architecture.md), 11.3. Hoje o corpo só usa `cut_ids` (`backend/app/api/routers/jobs_render.py:51-56`); corpo sem o campo = comportamento atual. |
| `POST /jobs/:job_id/run` | `watermark?: boolean` | Repassado à renderização. `RunPipelineRequest` (`backend/app/models/schemas.py:96-97`) ganha o campo com padrão `None`. |
| `POST /jobs/batch/run` | `options.watermark?: boolean` | Idem. `BatchPipelineOptions` (`schemas.py:100-104`) ganha o campo com padrão `None`. |

`watermark` que não seja booleano (nem ausente/`null`) devolve `400` `{ "detail": "Valor inválido para watermark." }`, sem `code`. Ausente ou `null` = sem resposta (vale o modo do perfil; em `ask`, sem marca).

Erro novo possível nessas três rotas, só quando a marca d'água vai ser aplicada: `400` `watermark_missing` `{ "detail": "A imagem da marca d'água não foi encontrada." }`.

**Quando o `400` sai.** As três rotas resolvem a decisão (pedido × modo do perfil) e conferem a imagem **no próprio pedido, antes de iniciar ou enfileirar qualquer coisa**. `POST /jobs/:job_id/run` e `POST /jobs/batch/run` só fazem essa conferência quando o fluxo inclui renderização (`include_render` / `options.render`); sem renderização, o campo é aceito e ignorado. Assim ninguém baixa e analisa um vídeo para descobrir no fim que a imagem não existe.

A mesma conferência é **repetida** pelo serviço de renderização antes do primeiro corte, porque a imagem pode ser removida entre o pedido e a renderização. Nesse segundo momento não há `400` `watermark_missing` (em `/render` e no lote a rota já respondeu; em `/run` o erro sai como qualquer falha de etapa do fluxo): a renderização falha como qualquer falha de renderização, com a mensagem fixa "A imagem da marca d'água não foi encontrada." no evento de estado e no log `render` do job, e nenhum corte é gerado. Detalhes em [architecture.md](./architecture.md), 11.3.

## 3. Fase 2 — Armazenamento

### `GET /storage`

Resposta `200`: `StorageStatus`.

```json
{
  "mode": "root",
  "root_path": "G:\\Meu Drive\\Cortes",
  "root_available": true,
  "root_id": "r_1b22c9d04e7f4a10",
  "videos_dir": "G:\\Meu Drive\\Cortes\\perfis\\cortes-do-podcast\\videos",
  "local_base_dir": "C:\\Users\\fulano\\Downloads\\uploads",
  "read_only": false,
  "lock": { "state": "owner", "holder_name": "PC-SALA", "heartbeat_at": "2026-11-20T09:15:00Z", "stale": false },
  "machine": { "machine_id": "m_3f9a0c1e8b7d4f52", "machine_name": "PC-SALA" },
  "first_run_pending": false,
  "pending_writes": 0,
  "conflict_files": 0,
  "leftover_tmp_files": 0,
  "leftover_tmp_bytes": 0,
  "unrecognized_folders": 0,
  "unrecognized_folders_ready": 0,
  "warnings": [],
  "secret_store": "os"
}
```

| Campo | Valores |
|---|---|
| `mode` | `"local"` ou `"root"` |
| `root_id` | O `root_id` de `yts-root.json`, ou `null` em modo local |
| `lock.state` | `"none"` (modo local), `"owner"`, `"other"` |
| `lock.stale` | `true` quando a trava é de outro computador e parece parada ([architecture.md](./architecture.md), 7). A trava nunca troca de dono sozinha. |
| `conflict_files` | Cópias de conflito já fundidas, prontas para remover |
| `leftover_tmp_files`, `leftover_tmp_bytes` | Temporários esquecidos **desta** máquina ([architecture.md](./architecture.md), 3.3) |
| `unrecognized_folders` | Pastas, dentro da pasta de vídeos, que o app não transforma em vídeo sozinho: sem arquivo de informações (modo raiz), com arquivo de informações ilegível, ou com um `video_id` que já é de outra pasta ([architecture.md](./architecture.md), 8.3). Não aparecem em `GET /videos` |
| `unrecognized_folders_ready` | Quantas delas já podem ser adicionadas com `POST /storage/folders/adopt` (estão há pelo menos 10 minutos na lista) |
| `warnings` | Lista de: `"data_dir_synced"`, `"credentials_file_in_root"`, `"duplicate_profile"`, `"unreadable_profile"`, `"app_overlaps_root"` |
| `secret_store` | `"os"` ou `"memory"` (antes da fase 3: ausente) |

### `POST /storage/root/validate` — local

Corpo: `{ "path": "G:\\Meu Drive\\Cortes" }`.

Resposta `200`:

```json
{
  "ok": true,
  "kind": "existing_root",
  "profiles": [{ "profile_id": "p_8f3a2c1d", "name": "Cortes do podcast", "videos_count": 14 }],
  "free_bytes": 53687091200,
  "local_videos_count": 9,
  "local_videos_bytes": 16106127360,
  "same_volume": false,
  "warnings": ["looks_synced"]
}
```

`kind`: `"existing_root"`, `"new_root"` ou `"invalid"`. Quando `"invalid"`, `ok` é `false` e `reason` traz um de: `"not_found"`, `"too_broad"`, `"inside_app"`, `"contains_app"`, `"overlaps_local_videos"`, `"overlaps_other_root"`, `"path_too_long"`, `"not_writable"`, `"unreadable"`, `"newer_version"`. A ordem dos testes e o significado de cada um estão em [architecture.md](./architecture.md), 8.4.

`warnings` pode trazer `"not_empty"` e `"looks_synced"`. `looks_synced` é um palpite pelo nome do caminho, não uma certeza; a lista exata de nomes está em [architecture.md](./architecture.md), 8.4.

Esta rota não cria nada na pasta, a não ser o arquivo de teste de escrita, que ela mesma apaga.

### `POST /storage/root` — local

Corpo: `{ "path": "...", "migrate": "bring" | "none" }`. `migrate` só importa quando `kind` é `"new_root"` **e** o app está em modo local. Com uma raiz já em uso, a rota **abre outra raiz** e `migrate` é ignorado: nada é levado da raiz atual para a nova. A pasta nova não pode ficar dentro da raiz em uso nem contê-la (`overlaps_other_root`).

A rota refaz a validação inteira antes de criar qualquer coisa.

Resposta `200`: `{ "storage": StorageStatus, "migration_id": "mig_42" | null }`.

Erros: `400` caminho inválido (com o mesmo `reason` da validação); `409` `busy_processing`.

### `GET /storage/migrations/:migration_id`

Resposta `200`:

```json
{
  "migration_id": "mig_42",
  "status": "running",
  "total_videos": 9,
  "done_videos": 3,
  "moved_videos": 0,
  "skipped_videos": 0,
  "current_title": "Episódio 42",
  "copied": true,
  "source_dir": "C:\\Users\\fulano\\Downloads\\uploads",
  "destination_dir": "G:\\Meu Drive\\Cortes\\perfis\\cortes-do-podcast\\videos",
  "error": null
}
```

`status`: `"running"`, `"success"`, `"failed"`, `"cancelled"`. `copied: true` significa que foi cópia (outro disco) e os originais continuam em `source_dir`. `moved_videos` é quantos vídeos **saíram** de `source_dir` (migração no mesmo disco); num erro ou cancelamento, é o que a tela usa para dizer onde eles estão. `skipped_videos` conta os que já estavam inteiros no destino e os que ficaram na origem porque o arquivo de informações deles não pôde ser lido.

### `POST /storage/migrations/:migration_id/cancel` — local

Resposta `200`: o mesmo objeto. O que já foi copiado ou movido fica onde está; nada é apagado. Para continuar, o frontend chama `POST /storage/root` de novo com o mesmo caminho e `migrate: "bring"`; os vídeos já levados são pulados, e um vídeo interrompido no meio continua **na mesma pasta de destino**, achada pelo `video_id` ([architecture.md](./architecture.md), 8.5).

### `DELETE /storage/root` — local

Volta para o modo local. Não move nem apaga nada. Os vídeos que estão na raiz continuam lá e deixam de aparecer no app. Resposta `200`: `StorageStatus`. `409` `busy_processing`.

### `POST /storage/retry` — local

Tenta de novo abrir a raiz configurada. Resposta `200`: `StorageStatus`.

### `POST /storage/first-run/dismiss` — local

Marca a primeira execução como respondida, mantendo o modo local. Resposta `200`: `StorageStatus`.

### `POST /storage/lock/takeover` — local

Corpo: `{ "confirm": true }`. Resposta `200`: `StorageStatus`. `400` sem `confirm`.

É o **único** jeito de a trava mudar de dono, esteja o outro computador ativo ou parado (`lock.stale`).

### `POST /storage/conflicts/clear` — local

Apaga as cópias de conflito **já fundidas** ([architecture.md](./architecture.md), 6.4). Resposta `200`: `{ "removed": 3, "ignored": 0 }`. `409` `storage_read_only`.

Os nomes vêm de `merged_conflict_files`, que está num arquivo sincronizado e **não é confiável**. Para cada nome a rota refaz as cinco conferências de [architecture.md](./architecture.md), 6.4 (nome simples, casa com o padrão, diferente do arquivo oficial, na mesma pasta, arquivo comum), uma vez antes e outra no instante de apagar. Nome que falha é contado em `ignored` e não é apagado. Cada exclusão é registrada.

### `POST /storage/leftovers/clear` — local

Apaga os temporários esquecidos **desta** máquina ([architecture.md](./architecture.md), 3.3). Corpo: `{ "confirm": true }`. Resposta `200`: `{ "removed": 2, "freed_bytes": 1843200000 }`. `400` sem `confirm`; `409` `storage_read_only`.

Só apaga arquivo cujo nome casa exatamente com `video.<ext>.<m8>.tmp` ou `shorts/<nome>.mp4.<m8>.tmp` com o `<m8>` desta máquina, com mais de uma hora, de vídeo que não está em processamento; e as pastas de `data/work/` de jobs que não estão em processamento. Cada exclusão na raiz é registrada.

### `POST /storage/folders/adopt` — local

Adiciona ao app as **pastas não reconhecidas** ([architecture.md](./architecture.md), 8.3). É o único jeito de uma pasta assim virar vídeo; o app nunca faz isso sozinho. Corpo: `{ "confirm": true }`. Resposta `200`: `{ "adopted": 1, "waiting": 2 }`. `400` sem `confirm`; `409` `storage_read_only`.

- Nenhum caminho nem nome de pasta vem do cliente: a rota trabalha sobre a lista que o servidor montou na varredura.
- Só entra a pasta que continua não reconhecida há pelo menos 10 minutos desde a primeira vez em que esta máquina a viu. As outras contam em `waiting`.
- Antes de agir, a rota relê cada pasta no disco. Se o arquivo de informações chegou ou voltou a ser lido, ela não cria outro: vale a reconciliação normal.
- Sem arquivo de informações: cria um job novo e o `video.info.json`, com `source.kind: "upload"` e `keep: true` (a origem é desconhecida; vale o lado que protege). Arquivo ilegível: é **renomeado** para `video.info.json.corrupt-<data>` (não apagado) antes disso. `video_id` repetido: a pasta ganha um `video_id` novo e o resto do arquivo fica.

### `GET /videos/:job_id/info`

Resposta `200`: o conteúdo de `video.info.json` (`VideoInfo`), com dois acréscimos calculados na hora, que **não** são gravados no arquivo: em cada corte, `missing: true` quando o arquivo não está no disco; em cada registro `in_progress`, `stalled: true` quando ele está parado ([architecture.md](./architecture.md), 13.3). Cortes com `deleted_at` valendo não vêm na lista.

`404` `{ "detail": "Video info not found" }` (em inglês, no estilo do `"Video not found"` que as rotas de vídeo já usam; nunca é mostrado ao usuário, ver a nota na seção 2). `409` `info_unreadable` quando o arquivo existe e não pôde ser lido.

### `POST /videos/:job_id/info/recreate` — local

Só para vídeo com `info_unreadable: true`, isto é, que já tem job nesta máquina. (Pasta com arquivo ilegível e **sem** job não aparece em `GET /videos`; a saída dela é `POST /storage/folders/adopt`.) Corpo: `{ "confirm": true }`.

Renomeia o arquivo ilegível para `video.info.json.corrupt-<data>` (**não apaga**) e adota a pasta de novo ([architecture.md](./architecture.md), 5.3 e 8.3). Resposta `200`: `VideoInfo`. `400` sem `confirm` ou se o arquivo está legível; `409` `storage_read_only`.

### Seletor de pasta

`POST /config/select-folder` (existente) passa a abrir o seletor nativo no Windows (entrega opcional O3 do [README](./README.md); sem ela, a rota continua devolvendo `selected: false`). Formato inalterado: `{ "selected": boolean, "path": string | null }`.

Duas mudanças na rota, as duas sem tocar no formato:

- O seletor é **esperado fora do laço de eventos** (`await run_in_threadpool(...)` ou subprocesso `asyncio`), com tempo limite. Hoje a rota é `async` e chama o seletor de forma síncrona (`config.py:969-973`): com uma janela de verdade aberta, o servidor inteiro pararia até o usuário fechá-la.
- A rota passa a ser **local** (P22). A partir desta fase ela abre uma janela no computador onde o backend roda; não pode ser acionada por outro aparelho da rede nem por outro site.

### Rotas existentes que passam a ser locais (P22)

`DELETE /videos/:job_id`, `DELETE /jobs/:job_id/renders/:file`, `POST /videos/:job_id/archive` e `POST /config/select-folder` ganham `require_local_ui` nesta fase. Corpo, resposta e comportamento para o frontend local ficam **iguais**. Motivo e alternativa em [architecture.md](./architecture.md), 14.2.

### Campos acrescentados a rotas existentes

`VideoRecord` (resposta de `GET /videos` e `GET /videos/archived`; o modelo aceita campos extras, `schemas.py:139-148`):

| Campo | Tipo | Significado |
|---|---|---|
| `source_missing` | `boolean?` | O original foi **apagado pelo app** (`source.deleted_at` preenchido); restam os cortes |
| `source_absent` | `boolean?` | O arquivo do original não está no disco e ninguém o apagou pelo app (em geral, ainda não chegou pela sincronização) |
| `info_unreadable` | `boolean?` | O arquivo de informações existe e não pôde ser lido |
| `info` | `VideoInfoSummary?` | Resumo do arquivo de informações. Ausente quando `info_unreadable` |

Erro novo em rota existente, nos dois modos: `POST` e `PUT /jobs/:job_id/rename` devolvem `400` `{ "detail": "Escolha outro nome." }`, sem mover nada, quando o nome da pasta, depois do saneamento ([architecture.md](./architecture.md), 8.2):

- fica vazio, `.` ou `..`;
- é um nome reservado: `_archived` ou, em modo local, `logs`;
- é o nome de uma entrada que já existe na pasta de vídeos e não é a pasta do próprio vídeo (a pasta de outro vídeo, por exemplo).

As comparações não diferenciam maiúsculas de minúsculas, em nenhum sistema. Hoje o primeiro caso move a pasta para o lugar errado, e os outros dois movem a pasta **para dentro** da que já existe.

```json
"info": {
  "downloaded_at": "2026-11-18T14:10:03Z",
  "source_kind": "youtube",
  "keep": false,
  "keep_reason": null,
  "size_exception": false,
  "size_exception_pending": false,
  "folder_bytes": 1900000000,
  "shorts_count": 6,
  "unpublished_count": 2
}
```

`shorts_count` e `unpublished_count` contam só cortes vivos (sem `deleted_at` valendo) e presentes no disco.

`Job` ganha os campos extras opcionais `profile_id`, `source_deleted`, `size_exception_pending`.

## 4. Fase 3 — Perfis e contas

### `GET /profiles`

Resposta `200`:

```json
{
  "active_profile_id": "p_8f3a2c1d",
  "can_create": true,
  "profiles": [
    { "profile_id": "p_8f3a2c1d", "name": "Cortes do podcast", "videos_count": 14, "accounts_count": 2, "has_watermark": true }
  ]
}
```

Em modo local: um perfil só (`p_local`) e `can_create: false`.

### `POST /profiles` — local

Corpo: `{ "name": "Canal de games" }`. Resposta `201`: `Profile`.

Erros: `400` nome vazio ou com mais de 60 caracteres; `409` `{ "detail": "Escolha uma pasta para criar mais de um perfil.", "code": "root_required" }` em modo local; `409` `storage_read_only`.

O perfil novo nasce com as preferências do perfil ativo copiadas, sem marca d'água e sem contas.

### `GET /profiles/:profile_id`

Resposta `200`: `Profile` (conteúdo de `profile.json`; cada conta vem acrescida de `connection` e `avatar_url`).

### `PUT /profiles/:profile_id` — local

Corpo: `{ "name"?: string, "publish"?: { "default_hashtags": string } }`. Resposta `200`: `Profile`.

### `DELETE /profiles/:profile_id` — local

Resposta `200`: `{ "ok": true, "profile_id": "..." }`.

Erros: `409` `{ "detail": "Este perfil ainda tem vídeos.", "code": "profile_not_empty" }`; `409` `{ "detail": "Não é possível remover o único perfil.", "code": "last_profile" }`; `409` ao tentar remover o perfil ativo.

Também `409` `busy_publishing` se alguma conta do perfil tem envio em andamento.

Remove as fotos das contas, a marca d'água e, por último, `profile.json` daquele perfil, e os logins dessas contas nesta máquina. Regras ([architecture.md](./architecture.md), 4.4):

- **"Com vídeos"** (`profile_not_empty`) é: existe **qualquer** entrada dentro de `videos/`, inclusive uma pasta só com cortes, um vídeo em `_archived/` ou um arquivo desconhecido. Só uma pasta `_archived/` sem nada dentro é tolerada. A contagem `videos_count` da listagem não serve para essa decisão.
- A exclusão é **arquivo por arquivo**, por nomes fixos reconstruídos no servidor (`contas/<account_id>.jpg`, `marca-dagua/watermark.png`, `profile.json`). Nenhum caminho vem de campo do JSON (`avatar_file`, `watermark.file`).
- As pastas saem com `rmdir`, só se vazias. Sem `rmtree`. Arquivo desconhecido dentro da pasta do perfil faz a pasta ficar.
- Cada arquivo apagado é registrado.

### `POST /profiles/:profile_id/activate` — local

Resposta `200`: `{ "active_profile_id": "..." }`. `409` `busy_processing`.

### `GET /platforms`

Resposta `200`:

```json
{
  "platforms": [
    { "platform": "youtube", "available": true, "client_configured": false, "uploads_today": 0, "daily_limit": 100 },
    { "platform": "tiktok", "available": false, "client_configured": false }
  ]
}
```

`available` é `false` enquanto a fase daquela plataforma não foi entregue.

`uploads_today` conta só os envios feitos **por este computador** hoje. O limite do YouTube é por projeto do Google Cloud (R-YT-3): dois computadores com a mesma credencial dividem a mesma cota, e um não vê a conta do outro. Por isso o número é só informativo, aparece na tela como "neste computador" e **nunca** bloqueia um envio. Quem diz que a cota acabou é o erro devolvido pela plataforma.

### `PUT /platforms/:platform/client` — local

Corpo: `{ "client_id": "...", "client_secret": "..." }` (o `client_secret` pode ser vazio se a plataforma não exigir).

Resposta `200`: `{ "platform": "youtube", "client_configured": true }`. Guarda no cofre. **Nunca devolve os valores.**

### `DELETE /platforms/:platform/client` — local

Resposta `200`: `{ "platform": "youtube", "client_configured": false }`. As contas daquela plataforma passam a `client_missing`. `409` `busy_publishing` se há envio em andamento para alguma conta daquela plataforma.

### `GET /profiles/:profile_id/accounts`

Resposta `200`: `{ "accounts": LinkedAccount[] }`.

```json
{
  "account_id": "a_51c0e7aa",
  "platform": "youtube",
  "platform_account_id": "UCxxxxxxxxxxxxxxxxxxxxxx",
  "display_name": "Podcast Tal",
  "handle": null,
  "avatar_url": "/profiles/p_8f3a2c1d/accounts/a_51c0e7aa/avatar",
  "linked_at": "2026-11-19T10:00:00Z",
  "connection": "login_required",
  "publish_defaults": { "privacy": "private", "made_for_kids": null }
}
```

`connection`: `"connected"`, `"login_required"`, `"client_missing"`.

### `GET /profiles/:profile_id/accounts/:account_id/avatar`

Resposta `200`: `image/jpeg`. `404` se não houver foto.

### `POST /profiles/:profile_id/accounts/link/start` — local

Corpo: `{ "platform": "youtube" }`.

Resposta `200`: `{ "session_id": "ls_3c1f…(32 hex)", "auth_url": "https://...", "expires_at": "..." }`.

O frontend abre `auth_url` numa aba nova. Erros: `409` `client_missing`; `409` `storage_read_only`; `400` plataforma indisponível.

Regras da sessão de login:

- `session_id` é `ls_` + 32 hex vindos de fonte criptográfica (128 bits). Não dá para adivinhar.
- `auth_url` contém o `state` e o desafio PKCE. Ela é devolvida **só aqui**, uma vez, na resposta de uma rota local. Nenhuma outra rota a devolve.
- O ouvinte de retorno escuta só em `127.0.0.1`, numa porta livre, por no máximo 5 minutos. Uma chamada com `state` **errado** é ignorada (resposta de erro simples) e **não** encerra o ouvinte nem a sessão; senão qualquer página poderia gastar a sessão do usuário com uma chamada falsa. O ouvinte encerra na primeira chamada com o `state` certo, no cancelamento ou ao vencer o prazo.

### `POST /profiles/:profile_id/accounts/:account_id/reconnect/start` — local

Mesma resposta de `link/start`. Ao concluir, o ID devolvido pela plataforma precisa ser o da conta; senão a sessão termina com `account_mismatch`. Nesse caso o token novo é revogado, a não ser que o ID devolvido seja o de outra conta já conectada nesta máquina; aí ele é só descartado ([architecture.md](./architecture.md), 10.4).

### `GET /accounts/link-sessions/:session_id` — local

Resposta `200` (nunca traz `auth_url`):

```json
{
  "session_id": "ls_3c1f…",
  "status": "choose_account",
  "platform": "youtube",
  "choices": [{ "platform_account_id": "UC...", "display_name": "Podcast Tal" }],
  "account": null,
  "error": null
}
```

`status`: `"pending"`, `"choose_account"` (o login tem mais de um canal), `"success"`, `"failed"`, `"expired"`, `"cancelled"`. Em `"failed"`, `error` é `{ "code", "message" }`. `404` sessão desconhecida. A sessão vence em 5 minutos.

### `POST /accounts/link-sessions/:session_id/choose` — local

Corpo: `{ "platform_account_id": "UC..." }`. Resposta `200`: o objeto da sessão.

### `POST /accounts/link-sessions/:session_id/cancel` — local

Resposta `200`: o objeto da sessão, com `status: "cancelled"`.

### `POST /profiles/:profile_id/accounts/:account_id/disconnect` — local

Sai da conta **nesta máquina**: revoga o token na plataforma e apaga a entrada do cofre. A conta continua no perfil.

Resposta `200`: `LinkedAccount` com `connection: "login_required"`. Se a revogação na plataforma falhar, o token é apagado mesmo assim e a resposta traz `"revoked": false`.

`409` `busy_publishing` se a conta tem envio em andamento.

Depois de sair, o servidor recalcula o estado das outras contas da mesma plataforma nesta máquina e publica `account.state` para as que mudaram. Motivo: se revogar um token derruba as outras contas do mesmo login **não foi confirmado** ([architecture.md](./architecture.md), 10.4).

### `PUT /profiles/:profile_id/accounts/:account_id` — local

Corpo: `{ "publish_defaults"?: {...}, "move_to_profile_id"?: string }`. Resposta `200`: `LinkedAccount`.

Com `move_to_profile_id`: `409` `busy_publishing` se a conta tem envio em andamento. Mover é remover de um perfil e ligar no outro; o login desta máquina é mantido.

### `DELETE /profiles/:profile_id/accounts/:account_id` — local

Remove a conta do perfil: sai da conta nesta máquina, apaga nome e foto guardados. Os registros de publicação nos vídeos ficam (só com o ID da conta).

A entrada da conta **não some** de `profile.json`: ganha `removed_at` e perde nome, usuário e foto ([architecture.md](./architecture.md), 4.2). A foto é apagada pelo caminho fixo `contas/<account_id>.jpg`, e a exclusão é registrada. As listagens não devolvem contas removidas.

Resposta `200`: `{ "ok": true, "account_id": "..." }`. `409` `busy_publishing` se a conta tem envio em andamento.

## 5. Fase 4 — Limpeza

### `GET /cleanup/settings`

Resposta `200`: `{ "enabled": false, "max_age_days": null, "max_size_gb": null, "scope": "root" }`. `scope` é `"root"` ou `"local"`.

### `PUT /cleanup/settings` — local

Corpo: qualquer subconjunto de `{ "enabled", "max_age_days", "max_size_gb" }`. `max_age_days`: inteiro de 1 a 3650 ou `null`. `max_size_gb`: número de 1 a 100000 ou `null`.

Resposta `200`: o mesmo objeto. `409` `storage_read_only`.

### `GET /cleanup/summary`

Resposta `200`: `CleanupSummary`.

```json
{
  "enabled": true,
  "due_count": 7,
  "due_sources": 4,
  "due_shorts": 3,
  "due_bytes": 6442450944,
  "unpublished_due_count": 1,
  "total_bytes": 60129542144,
  "counted_bytes": 55834574848,
  "excepted_bytes": 4294967296,
  "protected_bytes": 2147483648,
  "limit_bytes": 53687091200,
  "over_bytes": 2147483648,
  "size_warning_active": true,
  "all_protected": false,
  "postponed_until": null,
  "pending_exceptions": [{ "job_id": "...", "title": "...", "size_bytes": 64424509440 }],
  "computed_at": "2026-12-20T18:00:00Z"
}
```

Com `enabled: false`, os contadores vêm zerados e `size_warning_active` é `false`; os totais de tamanho vêm preenchidos mesmo assim, para a tela de armazenamento.

### `POST /cleanup/plan` — local

Corpo: `{ "rule"?: "age" | "size" | "all" | "manual", "job_id"?: string }` (padrão `"all"`).

`rule: "manual"` monta o **plano de um vídeo só**, usado pelo botão "Apagar este vídeo" do diálogo de vídeo acima do limite ([architecture.md](./architecture.md), 12.10). Exige `job_id` e só é aceito quando aquele job tem `size_exception_pending: true`; senão `400`. O original vem marcado; os cortes, se houver, desmarcados. Os itens saem com `rules: ["manual"]`. O plano manual funciona mesmo com as regras desligadas e é executado pela mesma `POST /cleanup/execute`.

Resposta `200`: `CleanupPlan`.

```json
{
  "plan_id": "plan_77aa",
  "expires_at": "2026-12-20T18:12:00Z",
  "synced_folder_warning": true,
  "shortfall_bytes": 0,
  "all_protected": false,
  "items": [
    {
      "item_id": "2747c40e…:source",
      "kind": "source",
      "group": 1,
      "rules": ["age", "size"],
      "profile_id": "p_8f3a2c1d",
      "profile_name": "Cortes do podcast",
      "job_id": "2747c40e027844d9908c9aded7d493c4",
      "title": "Episódio 42 — conversa com Fulano",
      "file": "video.mp4",
      "size_bytes": 1843200000,
      "downloaded_at": "2026-11-18T14:10:03Z",
      "age_days": 32,
      "preselected": true,
      "unpublished": false,
      "has_pending_approved_cuts": false,
      "can_redownload": true
    }
  ],
  "blocked": [
    { "job_id": "...", "title": "...", "reason": "processing" }
  ],
  "totals": { "preselected_bytes": 5368709120, "preselected_count": 4 }
}
```

`blocked[].reason`: `"processing"`, `"publishing"` (na fila desta máquina **ou** com registro de envio em andamento vindo de outro computador), `"keep"`, `"clock"` (data de download no futuro), `"info_unreadable"`. É só para a tela explicar por que algo ficou de fora.

`synced_folder_warning` é `true` em modo raiz. A tela usa esse campo para mostrar os dois avisos de pasta sincronizada: o que for apagado some em todos os computadores, e mudanças feitas em outro computador que ainda não chegaram não são vistas ([ui.md](./ui.md), 8).

### `POST /cleanup/execute` — local

Corpo: `{ "plan_id": "plan_77aa", "item_ids": ["..."], "confirm": true }`.

Resposta `200`:

```json
{
  "deleted": [{ "item_id": "...", "size_bytes": 1843200000 }],
  "skipped": [{ "item_id": "...", "reason": "processing" }],
  "freed_bytes": 1843200000,
  "folders_kept": 0,
  "summary": { }
}
```

`skipped[].reason`: `"processing"`, `"publishing"`, `"keep"`, `"clock"`, `"not_found"`, `"changed"` (a pasta não é mais do mesmo vídeo, ou o arquivo mudou de tamanho desde o plano), `"info_unreadable"`, `"outside_videos_dir"`, `"in_use"`, `"read_only"` (a máquina perdeu a trava no meio), `"log_failed"`.

`folders_kept` conta as pastas de vídeo que ficaram no disco, depois de tudo apagado, porque tinham arquivo que o app não reconhece.

Erros: `400` sem `confirm: true` ou com `item_ids` vazio; `409` `plan_expired`; `409` `storage_read_only`.

**É a única rota que apaga pela limpeza.** Isso inclui o "Apagar este vídeo" do diálogo de vídeo acima do limite, que passa por aqui com um plano manual.

Durante a execução, `POST /jobs/:job_id/ingest`, `/render` e `/run` dos vídeos do plano devolvem `409` `{ "detail": "Este vídeo está sendo apagado.", "code": "busy_cleanup" }`.

### `POST /cleanup/postpone` — local

Resposta `200`: `{ "postponed_until": "2026-12-21T18:00:00Z" }`.

### `GET /cleanup/log?limit=50&offset=0`

Resposta `200`: `{ "entries": CleanupLogEntry[], "total": 132 }`, mais recentes primeiro. Formato das entradas em [architecture.md](./architecture.md), 12.8.

Em modo raiz, a rota junta os arquivos de **todos** os computadores (`limpeza/*.jsonl`), ordena por data, descarta linha repetida e ignora linha incompleta. As entradas incluem as exclusões que não vêm de regra (`kind`: `"conflict_copy"`, `"tmp_leftover"`, `"profile_file"`) e a do arquivo de informações de um vídeo que acabou (`kind`: `"video_info"`; [architecture.md](./architecture.md), 12.7).

### `PUT /videos/:job_id/flags` — local

Corpo: qualquer subconjunto de `{ "keep": boolean, "size_exception": boolean }`.

Resposta `200`: `VideoInfo`. `404` vídeo desconhecido. `409` `storage_read_only`. `409` `info_unreadable`.

`size_exception: true` num job com `size_exception_pending: true` também tira a pendência do job. É o caminho do botão "Manter com exceção".

Para um job que ainda não tem pasta (antes do download), os valores ficam no job e são gravados no arquivo de informações quando ele for criado.

### `POST /storage/preflight`

Corpo: `{ "kind": "url" | "upload" | "render", "job_id"?: string, "url"?: string, "size_bytes"?: number }`.

Resposta `200`:

```json
{
  "cleanup_enabled": true,
  "estimated_bytes": 64424509440,
  "limit_bytes": 53687091200,
  "counted_bytes": 40802189312,
  "exceeds_single": true,
  "would_exceed_total": true,
  "size_warning_active": false
}
```

`estimated_bytes` é `null` quando o tamanho não pôde ser descoberto. Com a limpeza desligada ou sem limite de tamanho, `exceeds_single` e `would_exceed_total` são sempre `false`.

### Erro novo em rota existente

`POST /jobs/:job_id/ingest`, **só** com a regra de tamanho ligada: `409` `{ "detail": "Este vídeo é maior que o limite da pasta.", "code": "size_exception_required", "estimated_bytes": ..., "limit_bytes": ... }`. Com a limpeza desligada (o padrão), a rota não muda.

### `GET /events`

`text/event-stream`. Eventos em [architecture.md](./architecture.md), 14.1. Cada `data` é JSON:

| Evento | `data` |
|---|---|
| `storage.status` | `StorageStatus` |
| `cleanup.summary` | `CleanupSummary` |
| `publication.state` | `Publication` |
| `publication.progress` | `{ "publication_id", "bytes_sent", "bytes_total" }` |
| `account.state` | `{ "profile_id", "account_id", "connection" }` |
| `migration.progress` | o objeto de `GET /storage/migrations/:id` |

Linha de manutenção a cada ~15 s, como no fluxo do job. Ao conectar, o servidor envia o estado atual de `storage.status` e `cleanup.summary`.

## 6. Fases 5 e 6 — Publicação

### `POST /publications/prepare` — local

Corpo: `{ "job_id": "...", "file": "01_05-02_30.mp4" }`.

Resposta `200`:

```json
{
  "short": {
    "job_id": "...",
    "file": "01_05-02_30.mp4",
    "url": "/media/shorts/<job_id>/01_05-02_30.mp4",
    "duration_seconds": 85.0,
    "size_bytes": 28400000,
    "watermark": true
  },
  "suggested": {
    "title": "Por que ele largou tudo",
    "description": "Fulano conta o dia em que decidiu mudar de carreira.",
    "hashtags": "#podcast #cortes"
  },
  "destinations": [
    {
      "account": { },
      "can_publish": true,
      "blocked_reason": null,
      "already_published": [{ "publication_id": "pub_9d2e41", "status": "published", "url": "https://...", "finished_at": "..." }],
      "in_progress": null,
      "options": {
        "privacy_choices": ["private", "unlisted", "public"],
        "privacy_default": "private",
        "made_for_kids": null
      }
    }
  ]
}
```

- `account` é um `LinkedAccount`.
- `short.watermark` pode ser `null` (corte anterior a esta spec; não se sabe).
- `blocked_reason`: `"login_required"`, `"client_missing"`, `"quota_exceeded"`, `"publish_in_progress"`, `"creator_cannot_post"`, `"video_too_long"`, `"platform_unavailable"` ou `null`.
- `quota_exceeded` só aparece depois que **a plataforma** devolveu o erro de cota para aquela credencial no dia de hoje. A contagem local de envios nunca bloqueia.
- `in_progress`, quando o corte tem um registro de envio em andamento para aquela conta: `{ "publication_id", "machine_name", "started_at", "stalled": boolean, "here": boolean }`. `stalled: true` é o registro parado de [architecture.md](./architecture.md), 13.3, que a tela mostra como "Envio interrompido em <computador>" com a ação "Liberar".
- `404` corte desconhecido ou ainda não disponível no disco; `409` `info_unreadable`.
- Para o TikTok, `options` traz o que a consulta ao criador devolveu naquele instante: `nickname`, `privacy_choices` (sem `privacy_default`), `comment_disabled`, `duet_disabled`, `stitch_disabled`, `max_duration_seconds`, e `mode: "inbox" | "direct"`.
- Esta rota **não envia nada** à plataforma além das consultas de leitura.

### `POST /publications` — local

Corpo:

```json
{
  "job_id": "...",
  "file": "01_05-02_30.mp4",
  "consent": true,
  "destinations": [
    {
      "account_id": "a_51c0e7aa",
      "title": "Por que ele largou tudo",
      "description": "Fulano conta...\n\n#podcast #cortes",
      "privacy": "private",
      "made_for_kids": false,
      "allow_repeat": false
    }
  ]
}
```

Campos só do TikTok, por destino (fase 6; o valor `"direct"` só existe se a entrega opcional O1 entrar, pergunta P23): `tiktok: { "mode": "inbox" | "direct", "allow_comment": false, "allow_duet": false, "allow_stitch": false, "commercial": { "enabled": false, "your_brand": false, "branded_content": false } }`.

Resposta `201`: `{ "publications": Publication[] }`.

Erros: `400` sem `consent: true`, sem destino, ou com campo obrigatório vazio; `404` corte desconhecido ou ainda não disponível no disco; `409` `already_published`, `publish_in_progress`, `login_required`, `client_missing`, `storage_read_only`, `info_unreadable`; `429` `quota_exceeded`. Se **um** destino é inválido, **nada** é criado.

`allow_repeat: true` só vence `already_published`. Não vence `publish_in_progress`: um envio em andamento precisa terminar, ser cancelado ou, se está parado, ser liberado.

O corte precisa ter entrada viva em `shorts[]`. Cortes gerados antes desta spec ganham a entrada na conferência de [architecture.md](./architecture.md), 5.5.

### `POST /publications/records/release` — local

Libera um registro de envio **parado** ([architecture.md](./architecture.md), 13.3), para o corte poder ser enviado de novo àquela conta.

Corpo: `{ "job_id": "...", "file": "01_05-02_30.mp4", "publication_id": "pub_9d2e41", "confirm": true }`.

Resposta `200`: `VideoInfo`. O registro passa a `abandoned`; não é removido. `400` sem `confirm`; `404` registro desconhecido; `409` se o registro não está parado (envio vivo, ou já concluído); `409` `storage_read_only`.

### `GET /publications?state=active|finished|all&job_id=`

Resposta `200`: `{ "publications": Publication[] }`. Padrão `state=active`: `queued`, `uploading`, `processing`, `paused`, `needs_login`, `unconfirmed`.

`Publication` é o objeto de [architecture.md](./architecture.md), 13.1, **sem** o conteúdo de `resume` e com `account_display_name`, `short_title` e `requested_privacy` para a tela.

### `GET /publications/:publication_id`

Resposta `200`: `Publication`. `404` desconhecida.

### `POST /publications/:publication_id/cancel` — local

Resposta `200`: `Publication` com `status: "canceled"`. `409` se já está em estado final. Vale também de `unconfirmed`.

### `POST /publications/:publication_id/retry` — local

Só de `failed` ou `needs_login`.

- De `needs_login`: resposta `200`, a mesma `Publication` com `status: "queued"`.
- De `failed`: resposta `200`, uma `Publication` **nova** (outro `publication_id`, com `retry_of` apontando para a antiga), em `queued`. A antiga continua `failed`. As validações de `POST /publications` são refeitas, inclusive a releitura do arquivo de informações.

### `POST /publications/:publication_id/resume` — local

Só de `paused`. Resposta `200`: `Publication` com `status: "queued"`. `409` `storage_read_only` se a máquina ainda não é a dona da trava.

### `POST /publications/:publication_id/resolve` — local

Só de `unconfirmed` (tudo foi enviado, mas a confirmação se perdeu; [architecture.md](./architecture.md), 13.5).

Corpo: `{ "outcome": "published" | "resend", "confirm": true }`.

- `"published"` ("Já está no canal"): resposta `200`, a `Publication` com `status: "published"`, `result.remote_id` e `result.url` nulos e `confirmed_by_user: true`.
- `"resend"` ("Não está; enviar de novo"): a atual vai para `failed` e nasce uma nova, como no `retry`. Resposta `200`: a `Publication` nova.

`400` sem `confirm`; `409` fora de `unconfirmed`.

## 7. Acréscimos em `shared/contracts.ts`

Só **acréscimos**. Nenhuma interface existente perde ou muda campo. `AppSettings` **não muda** (as preferências novas não passam por `/config/settings`).

Campos opcionais novos em interfaces existentes:

```ts
export interface Job {
  // ...campos existentes...
  profile_id?: string;
  source_deleted?: boolean;
  size_exception_pending?: boolean;
}

export interface VideoRecord {
  // ...campos existentes...
  source_missing?: boolean;   // apagado pelo app
  source_absent?: boolean;    // não está no disco, e não foi apagado pelo app
  info_unreadable?: boolean;
  info?: VideoInfoSummary;
}

export interface BatchPipelineOptions {
  // ...campos existentes...
  watermark?: boolean;
}
```

Tipos novos (cada fase acrescenta os seus):

```ts
// Fase 1
export type WatermarkMode = "always" | "never" | "ask";
export type WatermarkPosition =
  | "top-left" | "top-center" | "top-right"
  | "middle-left" | "center" | "middle-right"
  | "bottom-left" | "bottom-center" | "bottom-right";

export interface WatermarkSettings {
  mode: WatermarkMode;
  has_image: boolean;
  image_url: string | null;
  opacity: number;
  position: WatermarkPosition;
  size_percent: number;
  image: { width: number; height: number; updated_at: string } | null;
}

export interface RenderRequest {
  cut_ids?: string[];
  watermark?: boolean;
}

// Fase 2
export interface StorageStatus {
  mode: "local" | "root";
  root_path: string | null;
  root_available: boolean;
  root_id: string | null;
  videos_dir: string;
  local_base_dir: string;
  read_only: boolean;
  lock: { state: "none" | "owner" | "other"; holder_name: string | null; heartbeat_at: string | null; stale?: boolean };
  machine: { machine_id: string; machine_name: string };
  first_run_pending: boolean;
  pending_writes: number;
  conflict_files: number;
  leftover_tmp_files?: number;
  leftover_tmp_bytes?: number;
  unrecognized_folders?: number;
  unrecognized_folders_ready?: number;
  warnings?: StorageWarning[];
  secret_store?: "os" | "memory";
}

export type StorageWarning =
  | "data_dir_synced" | "credentials_file_in_root"
  | "duplicate_profile" | "unreadable_profile" | "app_overlaps_root";

export type RootInvalidReason =
  | "not_found" | "too_broad" | "inside_app" | "contains_app"
  | "overlaps_local_videos" | "overlaps_other_root" | "path_too_long" | "not_writable"
  | "unreadable" | "newer_version";

export interface RootValidation {
  ok: boolean;
  kind: "existing_root" | "new_root" | "invalid";
  reason?: RootInvalidReason;
  profiles?: { profile_id: string; name: string; videos_count: number }[];
  free_bytes?: number;
  local_videos_count?: number;
  local_videos_bytes?: number;
  same_volume?: boolean;
  warnings?: string[];
}

export interface StorageMigration {
  migration_id: string;
  status: "running" | "success" | "failed" | "cancelled";
  total_videos: number;
  done_videos: number;
  moved_videos: number;
  skipped_videos: number;
  current_title: string | null;
  copied: boolean;
  source_dir: string;
  destination_dir: string;
  error: string | null;
}

export interface VideoInfoSummary {
  downloaded_at: string | null;
  source_kind: "youtube" | "upload";
  keep: boolean;
  keep_reason: "upload" | "user" | null;
  size_exception: boolean;
  size_exception_pending?: boolean;
  folder_bytes: number;
  shorts_count: number;
  unpublished_count: number;
}

export interface ShortPublicationRecord {
  publication_id: string;
  platform: PlatformName;
  account_id: string;
  platform_account_id: string;
  status: "in_progress" | "published" | "sent_to_inbox" | "abandoned";
  remote_id?: string | null;
  url?: string | null;
  privacy?: string | null;
  started_at: string;
  finished_at?: string | null;
  machine_id: string;
  machine_name?: string | null;
  stalled?: boolean;          // calculado na resposta; não é gravado
}

export interface VideoInfoShort {
  file: string;
  cut_id?: string | null;
  start: number;
  end: number;
  title?: string | null;
  description?: string | null;
  rendered_at: string;
  deleted_at?: string | null;
  size_bytes: number;
  watermark: boolean | null;  // null = não se sabe (corte anterior a esta spec)
  publications: ShortPublicationRecord[];
  missing?: boolean;          // calculado na resposta; não é gravado
}

export interface VideoInfo {
  schema_version: number;
  video_id: string;
  revision: number;
  updated_at: string;
  updated_by: { machine_id: string; machine_name: string };
  title: string;
  source: {
    kind: "youtube" | "upload";
    url: string | null;
    original_file_name: string | null;
    channel?: string | null;
    duration_seconds?: number | null;
    file_name: string | null;
    size_bytes: number;
    downloaded_at: string;
    downloaded_at_origin: "app" | "job" | "migration";
    deleted_at: string | null;
    deleted_by_rule: "age" | "size" | "manual" | null;
  };
  flags: {
    keep: boolean;
    keep_reason: "upload" | "user" | null;
    size_exception: boolean;
    size_exception_at: string | null;
  };
  shorts: VideoInfoShort[];
}

// Fase 3
export type PlatformName = "youtube" | "tiktok";
export type AccountConnection = "connected" | "login_required" | "client_missing";

export interface LinkedAccount {
  account_id: string;
  platform: PlatformName;
  platform_account_id: string;
  display_name: string;
  handle: string | null;
  avatar_url: string | null;
  linked_at: string;
  connection: AccountConnection;
  publish_defaults?: { privacy?: string | null; made_for_kids?: boolean | null };
}

export interface ProfileSummary {
  profile_id: string;
  name: string;
  videos_count: number;
  accounts_count: number;
  has_watermark: boolean;
}

export interface Profile {
  profile_id: string;
  name: string;
  created_at: string;
  accounts: LinkedAccount[];
  preferences: {
    watermark: WatermarkSettings;
    publish: { default_hashtags: string };
  };
}

export interface ProfilesResponse {
  active_profile_id: string;
  can_create: boolean;
  profiles: ProfileSummary[];
}

export interface PlatformStatus {
  platform: PlatformName;
  available: boolean;
  client_configured: boolean;
  uploads_today?: number;
  daily_limit?: number;
}

// Resposta de link/start e reconnect/start. É a única que traz auth_url.
export interface AccountLinkStart {
  session_id: string;
  auth_url: string;
  expires_at: string;
}

// Resposta de GET /accounts/link-sessions/:id. Nunca traz auth_url.
export interface AccountLinkSession {
  session_id: string;
  status: "pending" | "choose_account" | "success" | "failed" | "expired" | "cancelled";
  platform: PlatformName;
  choices?: { platform_account_id: string; display_name: string }[];
  account?: LinkedAccount | null;
  error?: { code: string; message: string } | null;
}

// Fase 4
export interface CleanupSettings {
  enabled: boolean;
  max_age_days: number | null;
  max_size_gb: number | null;
  scope: "root" | "local";
}

export interface CleanupSummary {
  enabled: boolean;
  due_count: number;
  due_sources: number;
  due_shorts: number;
  due_bytes: number;
  unpublished_due_count: number;
  total_bytes: number;
  counted_bytes: number;
  excepted_bytes: number;
  protected_bytes: number;
  limit_bytes: number | null;
  over_bytes: number;
  size_warning_active: boolean;
  all_protected: boolean;
  postponed_until: string | null;
  pending_exceptions: { job_id: string; title: string; size_bytes: number }[];
  computed_at: string;
}

export type CleanupRule = "age" | "size" | "manual";

export type CleanupLogKind =
  | "source" | "short" | "video_info"
  | "conflict_copy" | "tmp_leftover" | "profile_file";

export interface CleanupItem {
  item_id: string;
  kind: "source" | "short";
  group: 1 | 2;
  rules: CleanupRule[];
  profile_id: string;
  profile_name: string;
  job_id: string;
  title: string;
  file: string;
  size_bytes: number;
  downloaded_at: string;
  age_days: number;
  preselected: boolean;
  unpublished: boolean;
  has_pending_approved_cuts: boolean;
  can_redownload: boolean;
}

export interface CleanupPlan {
  plan_id: string;
  expires_at: string;
  synced_folder_warning: boolean;
  shortfall_bytes: number;
  all_protected: boolean;
  items: CleanupItem[];
  blocked: {
    job_id: string;
    title: string;
    reason: "processing" | "publishing" | "keep" | "clock" | "info_unreadable";
  }[];
  totals: { preselected_bytes: number; preselected_count: number };
}

export interface CleanupExecuteResult {
  deleted: { item_id: string; size_bytes: number }[];
  skipped: { item_id: string; reason: string }[];
  freed_bytes: number;
  folders_kept: number;
  summary: CleanupSummary;
}

export interface StoragePreflight {
  cleanup_enabled: boolean;
  estimated_bytes: number | null;
  limit_bytes: number | null;
  counted_bytes: number;
  exceeds_single: boolean;
  would_exceed_total: boolean;
  size_warning_active: boolean;
}

// Fases 5 e 6
export type PublicationStatus =
  | "queued" | "uploading" | "processing" | "published" | "sent_to_inbox"
  | "failed" | "needs_login" | "unconfirmed" | "paused" | "canceled";

export interface Publication {
  publication_id: string;
  profile_id: string;
  video_id: string;
  short_file: string;
  short_title?: string | null;
  account_id: string;
  account_display_name?: string | null;
  platform: PlatformName;
  status: PublicationStatus;
  created_at: string;
  updated_at: string;
  attempts: number;
  bytes_sent: number;
  bytes_total: number;
  requested_privacy?: string | null;
  retry_of?: string | null;
  paused_reason?: "restart" | "storage_read_only" | null;
  record_pending?: boolean;     // o resultado ainda não foi anotado na pasta
  confirmed_by_user?: boolean;  // "Já está no canal", sem confirmação da plataforma
  result?: { remote_id?: string | null; url?: string | null; privacy?: string | null } | null;
  error?: { code: string; message: string } | null;
}

export interface PublishDestinationRequest {
  account_id: string;
  title: string;
  description?: string;
  privacy: string;
  made_for_kids?: boolean;
  allow_repeat?: boolean;
  tiktok?: {
    mode: "inbox" | "direct";
    allow_comment: boolean;
    allow_duet: boolean;
    allow_stitch: boolean;
    commercial: { enabled: boolean; your_brand: boolean; branded_content: boolean };
  };
}

export interface PublishRequest {
  job_id: string;
  file: string;
  consent: true;
  destinations: PublishDestinationRequest[];
}

export interface PublishPrepareResponse {
  short: { job_id: string; file: string; url: string; duration_seconds: number; size_bytes: number; watermark: boolean | null };
  suggested: { title: string; description: string; hashtags: string };
  destinations: {
    account: LinkedAccount;
    can_publish: boolean;
    blocked_reason: string | null;
    already_published: { publication_id: string; status: string; url?: string | null; finished_at?: string | null }[];
    in_progress?: { publication_id: string; machine_name: string | null; started_at: string; stalled: boolean; here: boolean } | null;
    options: Record<string, unknown>;
  }[];
}
```

## 8. Inventário para o `AGENTS.md` (seção 4.1)

Cada fase acrescenta ao inventário as rotas que entregou. Lista completa:

- `/profiles` (`GET`, `POST`)
- `/profiles/:profile_id` (`GET`, `PUT`, `DELETE`)
- `/profiles/:profile_id/activate` (`POST`)
- `/profiles/:profile_id/watermark` (`GET`, `PUT`)
- `/profiles/:profile_id/watermark/image` (`GET`, `POST`, `DELETE`)
- `/profiles/:profile_id/accounts` (`GET`)
- `/profiles/:profile_id/accounts/link/start` (`POST`)
- `/profiles/:profile_id/accounts/:account_id` (`PUT`, `DELETE`)
- `/profiles/:profile_id/accounts/:account_id/avatar` (`GET`)
- `/profiles/:profile_id/accounts/:account_id/reconnect/start` (`POST`)
- `/profiles/:profile_id/accounts/:account_id/disconnect` (`POST`)
- `/accounts/link-sessions/:session_id` (`GET`)
- `/accounts/link-sessions/:session_id/choose` (`POST`)
- `/accounts/link-sessions/:session_id/cancel` (`POST`)
- `/platforms` (`GET`)
- `/platforms/:platform/client` (`PUT`, `DELETE`)
- `/storage` (`GET`)
- `/storage/root` (`POST`, `DELETE`)
- `/storage/root/validate` (`POST`)
- `/storage/retry` (`POST`)
- `/storage/first-run/dismiss` (`POST`)
- `/storage/lock/takeover` (`POST`)
- `/storage/conflicts/clear` (`POST`)
- `/storage/leftovers/clear` (`POST`)
- `/storage/folders/adopt` (`POST`)
- `/storage/migrations/:migration_id` (`GET`)
- `/storage/migrations/:migration_id/cancel` (`POST`)
- `/storage/preflight` (`POST`)
- `/videos/:job_id/info` (`GET`)
- `/videos/:job_id/info/recreate` (`POST`)
- `/videos/:job_id/flags` (`PUT`)
- `/cleanup/settings` (`GET`, `PUT`)
- `/cleanup/summary` (`GET`)
- `/cleanup/plan` (`POST`)
- `/cleanup/execute` (`POST`)
- `/cleanup/postpone` (`POST`)
- `/cleanup/log` (`GET`)
- `/events` (`GET` — Server-Sent Events)
- `/publications` (`GET`, `POST`)
- `/publications/prepare` (`POST`)
- `/publications/records/release` (`POST`)
- `/publications/:publication_id` (`GET`)
- `/publications/:publication_id/cancel` (`POST`)
- `/publications/:publication_id/retry` (`POST`)
- `/publications/:publication_id/resume` (`POST`)
- `/publications/:publication_id/resolve` (`POST`)

Cuidado de roteamento: `/videos/:job_id/info` e `/videos/:job_id/flags` não colidem com `/videos/archived` nem com `/videos/:job_id/archive`; `/publications/prepare` (`POST`) precisa ser registrada antes de qualquer rota `POST /publications/:publication_id/...` com o mesmo número de segmentos (não há nenhuma hoje). `/publications/records/release` tem o mesmo número de segmentos de `/publications/:publication_id/<ação>` e precisa ser registrada **antes** delas; `records` não é um `publication_id` válido (o formato é `pub_` + hex). `/videos/:job_id/info/recreate` não colide com nada.

Rotas existentes que ganham `require_local_ui` na fase 2, sem mudar de contrato (P22): `DELETE /videos/:job_id`, `DELETE /jobs/:job_id/renders/:file`, `POST /videos/:job_id/archive`, `POST /config/select-folder`. O inventário do `AGENTS.md` anota "(local)" ao lado delas.
