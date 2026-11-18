# Fase 5 — Publicação no YouTube

> Detalhada até onde a pesquisa permite. Começa por um passo zero, que fecha o que ficou sem confirmação. Nenhum agente cria projeto no Google, faz login ou envia vídeo: tudo com respostas falsas.

## Em modo local (vale esta seção)

Por decisão do dono (D49), a pasta sincronizada entre computadores está adiada. Esta fase é feita **em um computador**. Leia [local-first.md](../local-first.md) antes do resto. **Onde esta seção e o resto do arquivo divergem, vale esta seção.** O que ela não cita (o passo zero inteiro, o provedor do YouTube, o cliente HTTP, as rotas, as telas) vale como está escrito abaixo.

O objetivo é o mesmo. O registro de onde cada corte foi publicado impede publicar duas vezes **neste computador**; a parte "inclusive a partir de outro computador" fica adiada.

**Depende de:** fases 2 (Base local), 3 e 4, nessa ordem. P8, P13, P18 e P19. Se o dono quiser esta fase antes da 4, pare e registre em `decisions.md`: `NoticePill`, `AppNotices`, `useAppEvents` e `api/events.ts` teriam de passar para cá.

**Leitura obrigatória:** a lista abaixo, mais `local-first.md` inteiro e `decisions.md` D49 e D50. De `architecture.md`, 13, **não são tarefa**: o item 4 de 13.3, a metade "de outra máquina" do registro parado, a pausa por outro computador de 13.2, "escrita de conclusão em somente leitura" de 13.6 e as linhas de trava e de raiz de 13.8. D32 não se aplica.

### O que troca nas entregas de backend

| Item abaixo | Em modo local |
|---|---|
| 3. Fila | Como abaixo. `paused_reason` só tem o valor `"restart"`. A regra do diretório de dados que parece sincronizado (`data_dir_synced`) **fica**: é proteção de segredo e não depende da pasta sincronizada. A função que dá o palpite usa a lista de nomes de `architecture.md`, 8.4 (`looks_synced`), aplicada a `data_dir()`. |
| 4. Registro no arquivo de informações | Gravado pela função `update` de `local-first.md`, 3.7. `machine_id` e `machine_name` do registro são gravados `null`. A releitura do disco antes de aceitar uma publicação fica. |
| 4. Resultado nunca só em memória | Fica: primeiro em `queue.json` com `record_pending`, depois no arquivo de informações, repetido até dar certo (a cada 30 s e ao reabrir). Sai só a parte "vale em somente leitura". |
| 4. Registro parado | Um `in_progress` é **parado** só quando não existe publicação ativa com aquele `publication_id` na fila deste computador (a fila foi perdida). Não existe o caso "de outra máquina há mais de 24 horas". `POST /publications/records/release` fica. Na resposta de `prepare`, `in_progress.machine_name` vem `null` e `here` vem `true`. |
| 4. Perda da trava | **Não existe.** |
| 5. Aviso `credentials_file_in_root` | **Não existe.** O item 10 do passo zero (nome do arquivo de credenciais) deixa de ser necessário. |
| 5. Contagem de envios do dia | Como abaixo, em `machine.json`. |
| 8. Eventos | `publication.state`, `publication.progress` e `account.state`, no canal que já existe. |
| 9. Limpeza | A consulta "está sendo publicado?" da fase 4 passa a olhar a fila deste computador. |
| 1, 2, 6, 7, 10 | Como abaixo. |

Se a pasta de vídeos do perfil ficar indisponível durante um envio: o envio em andamento termina ou falha como falha de arquivo comum; o resultado fica com `record_pending` até a pasta voltar.

### O que troca nas entregas de frontend

- Diálogo "Publicar" (`ui.md`, 13.2): não existem as linhas "sendo publicado em outro computador" e "Somente leitura". O envio parado aparece como "Envio interrompido", sem nome de computador, com "Liberar".
- Fila de envios (`ui.md`, 13.4): não existe a linha `paused` por `storage_read_only`.
- O aviso `data_dir_synced` aparece na seção Pasta (`local-first.md`, seção 5).
- O resto fica como abaixo. Os textos "neste computador" ficam.

### O que troca na lista de arquivos

**Saem** de "Alterar": `backend/app/domain/storage/merge.py`, `backend/app/domain/storage/root.py` e `backend/app/infrastructure/storage/synced_store.py`. Eles não existem em modo local.

**Entram** em "Alterar": `backend/app/core/storage_layout.py` (a função do palpite `looks_synced`), `backend/app/api/routers/storage.py` (o aviso `data_dir_synced`), `frontend/src/components/redesign/settings/StorageSections.tsx` (mostrar o aviso).

### O que troca nos testes

**Saem** (adiados): "Máquina B, lendo o arquivo de informações gravado por A, recusa a segunda publicação"; "Trava perdida no meio"; "Em somente leitura: `409`"; a frase "fundir com uma cópia antiga em que o registro era `in_progress` deixa `abandoned`"; no teste "Registro parado", a parte de A e B e a frase "se A grava `published` depois da liberação, a fusão fica com `published`".

**Mudam:**

- **Registro parado:** um `in_progress` gravado no arquivo de informações sem publicação correspondente na fila (a fila foi apagada) → `prepare` devolve `stalled: true` e `here: true`; `POST /publications` ainda recusa; `records/release` troca para `abandoned` e a publicação seguinte é aceita. Com a publicação ainda ativa na fila: `release` devolve `409`.
- **Resultado guardado:** fica como está, sem a parte de somente leitura.
- Na varredura de segredos, onde diz "na raiz", leia "em `profile.json`, em `video.info.json` e nas pastas de vídeos".

**Entram:**

- A segunda publicação do mesmo corte na mesma conta é recusada depois de **reiniciar o container** (o registro vem do arquivo de informações, não da memória).
- O registro gravado tem `machine_id` e `machine_name` nulos.
- Dois perfis: `POST /publications` com uma conta de outro perfil é recusado; `prepare` lista só as contas do perfil do vídeo.

### Critério de pronto e validação manual

Como abaixo. Nas capturas, "Envio interrompido" aparece sem nome de computador. Em [manual-validation.md](../manual-validation.md), fase 5, saem os quatro itens **[Google + 2 PCs]** e entra o item novo do aviso de pasta do aplicativo sincronizada.

---

*O texto abaixo é o original. Vale no que a seção acima não troca.*

## Objetivo

O usuário conecta um ou mais canais do YouTube a um perfil e publica um corte já gerado, escolhendo os destinos, o texto e a privacidade. O app registra onde cada corte foi publicado, para não publicar duas vezes, inclusive a partir de outro computador.

## Depende de

- Fases 2 e 3 concluídas. Da fase 4 esta fase só usa o canal `GET /events` e a consulta "está sendo publicado?" da limpeza; se a 5 vier antes da 4, o canal `/events` entra nesta fase e a consulta fica para a 4.
- P8, P13, P18 e P19 respondidas.
- O dono ter um projeto de teste no Google Cloud **não** é necessário para implementar; é necessário para a validação manual.

## Leitura obrigatória

- [platforms.md](../platforms.md): seções 1, 2, 3 e 6.
- [architecture.md](../architecture.md): seções 5, 10, 13 e 14.
- [api-contracts.md](../api-contracts.md): seções 1 e 6, e os tipos das fases 5 e 6.
- [ui.md](../ui.md): seções 0, 5.2 a 5.4, 7.2, 13.1 a 13.4, 15 e 16.
- [decisions.md](../decisions.md): D19, D20, D26, D31, D32, D38, D41, e as linhas R-YT-1 a R-YT-15.

## Passo zero — fechar o que a pesquisa deixou aberto

Antes de escrever código, quem implementa **lê no navegador** as páginas abaixo e registra o resultado em `decisions.md` (uma entrada nova por item), com o endereço e a data. Só leitura; nada de criar conta ou projeto.

| # | O que conferir | Onde |
|---|---|---|
| 1 | Limite de caracteres de `snippet.title` e `snippet.description`. | Referência de `videos` |
| 2 | Valores válidos de `snippet.categoryId` e se há um padrão quando omitido. | Referência de `videos` e de `videoCategories` |
| 3 | Qual `part` precisa ser enviado para `paidProductPlacementDetails`. | Referência de `videos.insert` |
| 4 | Escopo mínimo de `channels.list?mine=true`. | Referência de `channels.list` e página de escopos (a seção do YouTube ficou fora da leitura) |
| 5 | Nome e formato do erro de cota esgotada em `videos.insert`. | Página de erros da API |
| 6 | Passos atuais da tela de consentimento e de usuário de teste no console. | Ajuda do Google Cloud |
| 7 | Formato do link público de um vídeo/Short a partir do ID. | Ajuda do YouTube |
| 8 | Se a página "Videos locked as private" foi atualizada depois de 02/11/2026. | https://support.google.com/youtube/answer/7300965 |
| 9 | Se a revogação aceita o token **no corpo** do pedido (formulário). A página lida só mostra o token na URL. | Página de OAuth para aplicativo de computador e referência do ponto de revogação |
| 10 | Nome do arquivo de credenciais baixado do console (o padrão `client_secret*.json` usado no aviso `credentials_file_in_root`). | Ajuda do Google Cloud |
| 11 | Se revogar o token de um canal afeta outros tokens do mesmo login no mesmo aplicativo. | Mesma página do item 9 |

O que continuar sem resposta depois da leitura vira comportamento **seguro nos dois casos** e item de [manual-validation.md](../manual-validation.md). Exemplo: se o item 4 não fechar, o código tenta com `youtube.upload` e, se a consulta ao canal for recusada por falta de permissão, mostra "Não foi possível identificar o canal" em vez de travar.

## Entregas

### Backend

1. **Provedor do YouTube** em `infrastructure/platforms/youtube.py`, implementando `PlatformProvider`:
   - URL de autorização com PKCE `S256`, `state`, retorno em `http://127.0.0.1:<porta>/oauth/callback` (R-YT-6).
   - Troca do código, renovação, revogação (`https://oauth2.googleapis.com/revoke`). A revogação manda o token **no corpo** do pedido; só usa a URL se o item 9 do passo zero mostrar que o corpo não é aceito, e isso fica registrado em `decisions.md`. A renovação segura a trava por conta de `architecture.md`, 10.2.
   - Identidade: `channels.list?mine=true&part=snippet`; mais de um canal → escolha.
   - Envio retomável conforme `platforms.md`, 2.1: abrir a sessão, `PUT` do arquivo lido em blocos do disco (nunca o arquivo inteiro na memória), consulta do ponto de retomada, tratamento de `308`, `404`, `5xx`.
   - A consulta do ponto de retomada trata a resposta de **envio já concluído** como sucesso (lê o ID e a privacidade). Sessão vencida ou falha depois de **todos** os bytes enviados → `unconfirmed`, nunca recomeço automático (`architecture.md`, 13.5).
   - Metadados sempre explícitos: `privacyStatus`, `selfDeclaredMadeForKids`, `hasPaidProductPlacement: false`, `categoryId`.
   - Leitura de `status.privacyStatus` da resposta.
2. **Cliente HTTP injetado** pelo container (`platform_http`), com falso padrão nos testes. Nenhuma chamada de rede fora dele. Os registradores `httpx`, `httpcore` e `urllib3` ficam em `WARNING` ou acima e passam por um filtro com `redact()`; nenhuma `error.message` é montada com `str(exc)` (`architecture.md`, 10.5).
3. **Fila de publicação** (`architecture.md`, 13): modelo, estados (inclusive `unconfirmed`), persistência em `data/publish/queue.json`, trabalhador, `PublishQueue(1)` no escalonador, novas tentativas, cancelamento, pausa depois de reinício. "Tentar de novo" numa publicação `failed` cria uma publicação **nova**. Com o diretório de dados parecendo sincronizado (`data_dir_synced`), `resume` não é gravado em disco.
4. **Registro no arquivo de informações** (`in_progress` → `published`; em falha ou cancelamento vira `abandoned`, **não é removido**), com a releitura do disco antes de aceitar uma publicação.
   - **Resultado nunca só em memória** (`architecture.md`, 13.6): gravado primeiro em `queue.json` com `record_pending`, depois no arquivo de informações como escrita de conclusão (vale em somente leitura); repetido até dar certo.
   - **Registro parado** (`architecture.md`, 13.3): cálculo de `stalled`, rota `POST /publications/records/release`.
   - **Perda da trava** (`architecture.md`, 7): os `queued` vão para `paused` com `paused_reason: "storage_read_only"`; os que já enviam terminam.
   - Rota `POST /publications/:id/resolve` para sair de `unconfirmed`.
5. **Contagem de envios do dia** por máquina, em `machine.json`. Ela é só informativa ("neste computador") e nunca bloqueia: a cota é do projeto do Google, não do computador. O bloqueio `quota_exceeded` nasce do **erro de cota devolvido pela plataforma** e vale até o fim do dia local.
   - A função "esta conta tem envio em andamento?" da fase 3 passa a responder de verdade (`busy_publishing`).
   - Aviso `credentials_file_in_root` (`architecture.md`, 8.4).
6. **`GET /platforms`** passa a devolver `available: true` para o YouTube.
7. **Rotas** da seção 6 de `api-contracts.md`, no inventário. `POST /publications/prepare` monta o texto sugerido (P8): título e resumo de `shorts[]` no arquivo de informações; se faltarem, do corte no estado local; hashtags do perfil.
8. **Eventos** `publication.state`, `publication.progress` e `account.state` no canal global.
9. **Limpeza:** a consulta "está sendo publicado?" da fase 4 passa a responder de verdade.
10. `.gitignore`: `data/publish/`.

### Frontend

1. Bloco "YOUTUBE" na seção Contas, agora alcançável; diálogo de preparar o computador com o passo a passo de `platforms.md`, seção 3, e importação do arquivo `.json`.
2. Botão "Publicar" no dock e no menu do cartão; diálogo "Publicar" com as opções do YouTube (`ui.md`, 13.1 e 13.2), inclusive "Envio interrompido em <computador>" com "Liberar".
3. Estado no cartão do corte e no texto do dock (`ui.md`, 13.3).
4. Fila de envios e os avisos correspondentes em `AppNotices` (`ui.md`, 13.4 e 7.2): o estado "sem confirmação" com as três ações; a pílula que diz a privacidade quando o vídeo não saiu público; a linha "N envios hoje neste computador" na seção Contas.
5. Fluxo "entrar de novo" (`ui.md`, 5.4).
6. `api/publications.ts`, `hooks/usePublications.ts`.

## Arquivos que pode tocar

Criar:

- `backend/app/infrastructure/platforms/youtube.py`, `http.py`
- `backend/app/domain/publishing/__init__.py`, `models.py`, `queue.py`, `worker.py`, `service.py`
- `backend/app/api/routers/publications.py`
- `backend/tests/test_pp_phase5_youtube_provider.py`, `test_pp_phase5_publish_queue.py`, `test_pp_phase5_publish_routes.py`, `fakes/fake_youtube_http.py`
- `frontend/src/api/publications.ts`, `frontend/src/hooks/usePublications.ts`
- `frontend/src/components/redesign/PublishDialog.tsx`, `PublishQueueDialog.tsx`

Alterar:

- `backend/app/infrastructure/platforms/base.py`, `__init__.py`
- `backend/app/application/scheduler.py` (semáforo novo), `runtime_service.py` (adaptadores, trabalhador)
- `backend/app/domain/storage/video_info.py`, `merge.py`, `root.py` (aviso de arquivo de credenciais), `backend/app/domain/cleanup/scan.py`
- `backend/app/infrastructure/storage/synced_store.py` (o resultado de publicação entra na lista de escritas de conclusão)
- `backend/app/domain/profiles/accounts.py` (a função "tem envio em andamento?")
- `backend/app/infrastructure/secrets/redact.py` (filtro para os registradores do cliente HTTP)
- `backend/app/core/machine_state.py`
- `backend/app/api/routers/platforms.py`, `accounts.py`, `events.py`
- `backend/app/models/schemas.py`, `backend/app/main.py` (início e parada do trabalhador)
- `backend/tests/conftest.py`
- `shared/contracts.ts`
- `frontend/src/api/index.ts`, `frontend/src/hooks/index.ts`, `useAppEvents.ts`
- `frontend/src/components/redesign/GlassDock.tsx`, `AppNotices.tsx`, `AccountLinkDialog.tsx`
- `frontend/src/components/redesign/settings/ProfilesSections.tsx`
- `frontend/src/App.tsx`
- `.gitignore`, `AGENTS.md`, `DESIGN.md` da raiz

Não pode alterar: `JobStatus`, a máquina de estados do job, `VALID_TASK_NAMES`, o modelo `Cut`.

## Fora de escopo

- Agendar, miniatura, playlists, legendas, editar ou apagar um vídeo já publicado.
- Publicar o vídeo original (só cortes).
- Publicação automática ao fim da renderização. Toda publicação nasce de um clique no diálogo.
- Aplicativo único embutido, verificação do Google, pedido de aumento de cota.
- Gerar texto com IA.
- TikTok (fase 6).

## Testes

Com o HTTP falso respondendo o que as páginas oficiais descrevem, o cofre em memória e o relógio injetado. Nenhum endereço real é contatado; o teste falha se algo tentar abrir conexão.

**Provedor**

- URL de autorização: escopo, `state`, `code_challenge` em `S256` (base64url), retorno em `127.0.0.1` com a porta do ouvinte.
- Troca e renovação; token de renovação recusado → conta em `login_required`.
- Identidade: um canal; vários canais; nenhum canal (erro claro).
- Envio feliz: sessão aberta com os dois cabeçalhos, corpo com todos os metadados explícitos, `PUT`, `201`, ID e privacidade lidos da resposta.
- Privacidade devolvida diferente da pedida: `result.privacy` guarda a devolvida.
- Queda no meio: `503` → espera → consulta do ponto → retoma de onde parou. `404` **antes** de todos os bytes → recomeça. Cinco falhas seguidas → `failed`.
- **Tempo esgotado que deu certo:** todos os bytes enviados, a resposta final se perde, a consulta do ponto devolve a resposta de envio concluído → `published`, com o ID lido, e **nenhum** segundo envio.
- **Sem confirmação:** todos os bytes enviados, a resposta se perde e a consulta devolve `404` → `unconfirmed`; nenhuma sessão nova é aberta sozinha. `resolve` com `published` → `published` com `confirmed_by_user`; com `resend` → a antiga vira `failed`, o registro vira `abandoned` e nasce uma publicação nova.
- Revogação: o token vai no corpo do pedido e **não** aparece na URL registrada pelo falso de HTTP.
- Cota esgotada → `failed` com `quota_exceeded`, sem insistir.
- O arquivo é lido em blocos (o teste usa um arquivo maior que o bloco e confere as leituras).

**Fila**

- Dois destinos → duas publicações; uma por vez (`PublishQueue`).
- Um download em andamento **não** é bloqueado por um envio, e o contrário (vagas de `IOQueue` livres durante o envio).
- Cancelar em `queued` e em `uploading`.
- Reiniciar o container com uma publicação em `uploading` → `paused`; **nenhuma** chamada de envio acontece até `resume`. Reiniciar depois de todos os bytes enviados → `unconfirmed`.
- Login vencido no meio → `needs_login`; depois de reconectar e `retry`, volta para a fila.
- Arquivo de informações: `in_progress` ao aceitar; `published` com link ao terminar; `abandoned` (ainda presente) ao falhar ou cancelar. Fundir com uma cópia antiga em que o registro era `in_progress` deixa `abandoned`.
- "Tentar de novo" de uma `failed`: publicação nova, com outro `publication_id` e `retry_of`; a antiga continua `failed`.
- Publicar de novo o mesmo corte na mesma conta: `409` `already_published` sem `allow_repeat`; aceito com. Com um `in_progress` vivo: `409` `publish_in_progress` **mesmo com** `allow_repeat`.
- Máquina B, lendo o arquivo de informações gravado por A, recusa a segunda publicação.
- **Registro parado:** `in_progress` de A com `started_at` de 25 horas atrás → B vê `stalled: true`, `POST /publications` ainda recusa, `records/release` troca para `abandoned` e a publicação seguinte é aceita. Com 1 hora: `release` devolve `409`. Se A grava `published` depois da liberação, a fusão fica com `published`.
- **Corte anterior a esta spec** (entrada criada pela conferência, sem `cut_id` e com `watermark: null`): `prepare` responde e a publicação é aceita.
- **Resultado guardado:** a plataforma confirma e a escrita no arquivo de informações falha (falso que recusa) → a publicação aparece `published` com `record_pending: true`; reiniciar o container e liberar a escrita → o registro `published` aparece no arquivo de informações e `record_pending` vira `false`.
- **Trava perdida no meio:** com uma publicação `uploading` e outra `queued`, a máquina perde a trava → a primeira termina e o `published` dela é gravado no arquivo de informações mesmo em somente leitura; a segunda vai para `paused` e nenhum byte dela é enviado.
- **Conta com envio ativo:** "Sair", "Remover", "Mover" e `DELETE /platforms/youtube/client` devolvem `409` `busy_publishing`; depois de cancelar o envio, passam.
- **Contagem não bloqueia:** com `uploads_today` em 500, `prepare` devolve `can_publish: true`. Depois de a plataforma devolver o erro de cota, devolve `quota_exceeded`.
- Sem `consent: true`: `400`, nada criado, **nenhuma** chamada à plataforma.
- Um destino inválido entre dois: nada é criado.
- Em somente leitura: `409`.
- Vídeo com corte na fila não entra no plano de limpeza.

**Segredos**

- A varredura da fase 3, repetida depois de um envio completo: token, segredo e **endereço da sessão de envio** não aparecem na raiz, em log nem em resposta. O endereço da sessão aparece só em `data/publish/queue.json`.
- `GET /publications` não devolve `resume`.
- **Eventos:** a varredura lê também tudo o que saiu por `GET /events` durante o envio (`publication.state`, `publication.progress`, `account.state`): nenhum dos valores aparece.
- **Erro com URL:** o falso de HTTP levanta uma exceção cuja mensagem contém o endereço da sessão e o token → `error.message` da publicação e o `detail` das rotas não contêm nenhum dos dois; o log capturado também não.
- **Registradores de biblioteca:** com os registradores `httpx` e `httpcore` capturados durante um envio e uma revogação, nenhum valor de segredo aparece.
- **Diretório de dados sincronizado:** com `data_dir_synced`, `queue.json` não contém o endereço da sessão; depois de reiniciar, "Retomar" abre uma sessão nova.

**Regressão**

- Suíte inteira. Sem conta conectada, nada muda para o usuário além de um botão "Publicar".

## Critério de pronto

1. Passo zero registrado em `decisions.md`.
2. `pytest` verde, a suíte inteira.
3. `cd frontend && bun run build` sem erro.
4. Capturas em `docs/redesign/screenshots/profiles-publishing/fase-5/`: preparar o computador, conectar (cada passo e cada erro), Contas nos três estados, diálogo Publicar (cada linha da tabela de situação da conta, inclusive "Envio interrompido"), cartão nos três estados, fila em cada estado (inclusive "sem confirmação" e "ainda não anotado na pasta"), a pílula "Publicado como privado em <conta>".
5. Varredura de segredos verde.
6. Revisão aprovada.
7. A fase fica `[~]` até a validação manual da fase 5 ser feita pelo dono. Ela só vira `[x]` depois do primeiro envio real conferido.

## Validação manual

Em [manual-validation.md](../manual-validation.md), fase 5. É a mais longa da lista.

## Modelos

Passo zero: Fable. Implementação e testes: Sonnet. Revisão: Opus.
