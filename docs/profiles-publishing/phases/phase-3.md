# Fase 3 — Perfis e contas (sem login ainda)

## Em modo local (vale esta seção)

Por decisão do dono (D49), a pasta sincronizada entre computadores está adiada. Esta fase é feita **em um computador**, sobre a Base local ([phase-2-local.md](./phase-2-local.md)). Leia [local-first.md](../local-first.md) antes do resto: as seções 3.3 a 3.6, 4, 5 e 7 são o centro desta fase. **Onde esta seção e o resto do arquivo divergem, vale esta seção.** O que ela não cita vale como está escrito abaixo.

**Depende de:** fases 1 e 2 (Base local). P1, P16, P24, P25, P26 e P27.

**Leitura obrigatória, no lugar da lista abaixo:** `local-first.md` inteiro; `architecture.md` 4.2, 4.4 (só os três primeiros itens), 9.1, 10 (menos os passos 1 a 3 de 10.4), 13.7 e 14.2; `api-contracts.md` seções 1 e 4, com as trocas de `local-first.md`, 3.4 e 3.5; `ui.md` 0, 5 (com `local-first.md`, seção 5), 14, 15 e 16; `decisions.md` D1, D5, D6, D18, D31, D49, D50. **Não são tarefa:** `architecture.md` 2.1, 4.1, 6.3 e 12.8.

### O que troca nas entregas de backend

| Item abaixo | Em modo local |
|---|---|
| 1. Vários perfis | Os perfis ficam em `data/`: o primeiro em `data/profile/` (`p_local`, o da fase 1, com o mesmo id e os mesmos dados) e os outros em `data/profiles/<profile_id>/`. O mapa `profile_id` → pasta vem de ler `data/profile/profile.json` e `data/profiles/*/profile.json`. Criar, renomear, ativar e remover seguem `local-first.md`, 3.4. `can_create` é sempre `true`; `root_required` não existe. |
| 1. Remover | **Não exige perfil vazio e nunca toca a pasta de vídeos** (P24). O primeiro perfil não pode ser removido (`409` `first_profile`; P25). Ordem: desligar os jobs do perfil, sair das contas, apagar arquivo por arquivo (`contas/<account_id>.jpg`, `marca-dagua/watermark.png`, `profile.json` por último), `rmdir` nas pastas do perfil, tirar a entrada de `machine.json`. Sem `rmtree`. **Sem linha no registro**: o registro de exclusões nasce na fase 4 e só registra a limpeza. |
| 2. Perfil ativo | Como abaixo. `machine.json` é gravado pela primeira vez nesta fase. A troca descarta os caches de configurações. |
| — (novo) Pasta de vídeos por perfil | A do primeiro é `media.base_dir`. A dos outros é escolhida na criação (ou sugerida; P26), validada pela tabela de `local-first.md`, 3.5, e guardada em `machine.json` → `profile_dirs`. `PUT /profiles/:id` com `videos_dir` troca a pasta sem mover nada (P27). `POST /config/settings` recusa um `media.base_dir` que se sobreponha à pasta de outro perfil. Pasta indisponível: `videos_dir_available: false`, lista vazia, `409` `videos_dir_unavailable` na ingestão; o app não cria a pasta. |
| — (novo) Resolvedor por perfil | `storage_layout.videos_dir(profile_id)`; as funções de `settings.py:244-309` usam o perfil **do job**; `profile_id` ausente no job quer dizer `p_local`; job com perfil desconhecido não recebe caminho de outro perfil (`local-first.md`, 3.6). A reconciliação religa a pasta movida e dá id novo à pasta copiada (tabela de 3.6). |
| — (novo) Preferências por perfil | `backend/app/core/preferences_overlay.py`, com `PORTABLE_KEYS` igual à coluna "Perfil" de `architecture.md`, 9.1. As chaves de perfil do primeiro perfil continuam nos arquivos de hoje; as dos outros ficam no `profile.json` de cada um. Leitura, escrita e restauração pela tabela de `local-first.md`, 4.1. As rotas `/config/settings` e `/config/tool-configs` não mudam de formato. |
| 4. Cofre de segredos | Como abaixo. `secret_store` sai em `GET /storage` (formato reduzido de `local-first.md`, 3.8), junto com os avisos `duplicate_profile` e `unreadable_profile`. |
| 8. Contas | Como abaixo, inclusive `removed_at` em vez de remoção. A foto fica em `<pasta do perfil em data/>/contas/<account_id>.jpg`. A fusão com cópia antiga não existe. A exclusão da foto não é registrada. |
| 8. "Depois de 'Sair'… publica `account.state`" | Publica no canal `GET /events` que a fase 2 já criou. |
| 3, 5, 6, 7, 9, 10, 11, 12, 13 | Como abaixo. |

### O que troca nas entregas de frontend

- "Novo perfil" pede nome e pasta, com `FolderField` (criado **nesta** fase); cada perfil mostra a pasta; menu ⋮ com "Renomear", "Trocar pasta…" e "Remover". Textos e estados em `local-first.md`, seção 5.
- A linha "Modo local" e a linha "Remover perfil com vídeos" de `ui.md`, 5.1, não existem.
- Os avisos `duplicate_profile` e `unreadable_profile` aparecem na seção Pasta.
- O resto (Contas, diálogo de conectar, seletor de perfil, "Perfil: <nome>", `api/client.ts`) fica como abaixo.

### O que troca na lista de arquivos

Criar, **além** da lista abaixo:

- `backend/app/core/preferences_overlay.py`
- `backend/tests/test_pp_phase3_overlay.py`
- `frontend/src/components/redesign/FolderField.tsx`

Alterar, **além** da lista abaixo:

- `backend/app/core/settings.py`, `tool_configs.py` (só para consultar o resolvedor e a sobreposição)
- `backend/app/api/routers/config.py` (a recusa de `media.base_dir` sobreposto; a restauração por perfil)
- `backend/app/api/routers/jobs.py`, `jobs_ingest.py` (`profile_id` no job novo; `videos_dir_unavailable`)
- `backend/app/api/routers/events.py` (evento `account.state`)
- `frontend/src/components/redesign/settings/StorageSections.tsx` (os dois avisos)
- `.gitignore` (`data/profiles/`)

**Sair** da lista de "Alterar": `backend/app/domain/storage/deletion_log.py` e `merge.py`. Eles não existem em modo local.

Não pode alterar: `data/settings.json` e os outros JSON versionados de `data/`; o formato de resposta de `/config/settings` e `/config/tool-configs`.

### O que troca nos testes

**Saem** (adiados): "Em modo local: um perfil só, `can_create: false`, criar devolve `409 root_required`"; "Remover com vídeos: `409`"; o teste "'Vazio' de verdade"; "Cada arquivo apagado na exclusão de perfil tem uma linha no registro"; "Máquina B vê os perfis criados por A"; "Máquina B (cofre vazio) vê a conta como `login_required`" (fica só a parte "sem credencial de aplicativo: `client_missing`" e "depois de 'Sair': `login_required`"); a frase "fundir com uma cópia antiga do arquivo não traz a conta de volta".

**Mudam:**

- "Remover vazio" vira **remover com vídeos**: com dois vídeos, cortes e um `notas.txt` na pasta de vídeos do perfil, remover devolve `200`; a árvore da pasta de vídeos é **idêntica** antes e depois (nomes, tamanhos e conteúdo); somem `profile.json`, a marca d'água e as fotos; a entrada some de `profile_dirs`; os jobs do perfil ficam sem `source_video_path` e sem `video_name`, e `data/jobs/<id>/` continua lá.
- "Exclusão arquivo por arquivo" fica como está, sem a linha de registro. `shutil.rmtree` não aparece em `app/domain/profiles/`.
- Na varredura de segredos, onde diz "dentro da raiz nem de `data/`", leia "de `data/` nem das pastas de vídeos dos perfis".

**Entram** (em `test_pp_phase3_profiles.py` e `test_pp_phase3_overlay.py`):

- **Primeiro perfil intacto:** depois de criar um segundo perfil, `data/profile/profile.json` tem o mesmo `profile_id` (`p_local`) e o mesmo conteúdo; o perfil novo está em `data/profiles/<p_ + 8 hex>/`; `machine.json` passou a existir, com `profile_dirs`.
- **Primeiro perfil não sai:** `DELETE /profiles/p_local` devolve `409` `first_profile` e nada muda.
- **Pasta do perfil:** uma linha de teste por `reason` da tabela de `local-first.md`, 3.5 (`required`, `not_found`, `too_broad`, `inside_app`, `contains_app`, `overlaps_profile` nos três sentidos: igual, dentro, contém; `not_writable`). Em nenhum caso inválido nasce `profile.json` nem pasta. Sem `videos_dir`: a pasta sugerida é criada ao lado de `media.base_dir`; com ela já existindo, vira `<nome> (2)`.
- **`media.base_dir` sobreposto:** com dois perfis, `POST /config/settings` com `media.base_dir` igual à pasta do segundo devolve `400` e `settings.json` fica idêntico. Com um perfil só, a mesma chamada é aceita como hoje.
- **Trocar a pasta de um perfil:** `PUT` com `videos_dir` novo → a árvore da pasta antiga é idêntica antes e depois; `/videos` passa a listar a nova; `PUT /profiles/p_local` com `videos_dir` devolve `400`.
- **Pasta indisponível:** apagar a pasta do segundo perfil por fora → `videos_dir_available: false`, `/videos` vazio, `POST /jobs` devolve `409` `videos_dir_unavailable`, e a pasta **não** é recriada.
- **Vídeo e perfil:** job criado com o segundo perfil ativo tem `profile_id` dele e a pasta nasce na pasta dele; job antigo sem `profile_id` continua resolvendo para `media.base_dir`, e o `job.json` dele não é regravado.
- **Resolvedor não cai para outro perfil:** com um vídeo `X` no primeiro perfil (com um sentinela dentro) e um job órfão de um perfil removido, de mesmo `video_name` `X` gravado à mão, `DELETE /videos/<órfão>` devolve `404` e o sentinela sobrevive.
- **Pasta que volta:** remover o perfil e criar outro apontando para a mesma pasta → a listagem mostra os **mesmos** `job_id`, religados ao perfil novo; nenhum job novo nasce.
- **Pasta copiada:** a pasta de um vídeo do primeiro perfil copiada para a pasta do segundo → a cópia recebe `video_id` novo; o original não muda.
- **`machine.json` ilegível:** é renomeado para `.corrupt-…`; o segundo perfil aparece com `videos_dir: null`; nenhuma pasta de vídeos é tocada.
- **Sobreposição, um perfil só:** `/config/settings` e `/config/tool-configs` leem e gravam nos arquivos de hoje, **byte a byte**; `preferences.settings` e `preferences.tool_configs` de `data/profile/profile.json` continuam `{}`.
- **Sobreposição, segundo perfil ativo:** gravar uma chave de perfil (`media.download_resolution`, `ffmpeg.vertical_mode`) muda o `profile.json` do segundo e **não** muda `settings.json` nem `custom_settings.json`; gravar uma chave do computador (`whisper.device`) faz o contrário; a resposta tem o formato de sempre. Voltar ao primeiro perfil mostra os valores dele.
- **Criação copia as preferências:** o perfil novo nasce com os valores em vigor no perfil ativo para todas as chaves de `PORTABLE_KEYS`.
- **Restauração no segundo perfil:** as chaves de perfil recebem o valor padrão **no perfil** (e não o valor do primeiro).
- `PORTABLE_KEYS` bate, chave por chave, com `local-first.md`, seção 4.
- Depois de ativar outro perfil, `load_settings` devolve os valores dele na chamada seguinte (o cache foi descartado).

### O que troca no critério de pronto

Como abaixo, mais: (a) com um perfil só, `settings.json`, `custom_settings.json` e `data/profile/profile.json` ficam byte a byte como antes de um ciclo de leitura e gravação pelas rotas `/config/*`; (b) o teste de remover perfil com vídeos está verde; (c) capturas a mais: "Novo perfil" com a pasta sugerida, cada erro de pasta, "Pasta não encontrada", as confirmações de "Trocar pasta…" e de "Remover".

### Validação manual

Em [manual-validation.md](../manual-validation.md), fase 3, sem o item **[2 PCs]**, mais os três itens novos de `local-first.md`, 2.5.

---

*O texto abaixo é o original. Vale no que a seção acima não troca.*

## Objetivo

Vários perfis na mesma raiz, cada um com seus vídeos, suas preferências, sua marca d'água e sua lista de contas. Toda a estrutura de contas fica pronta e testada com uma plataforma **falsa**: modelo, cofre de segredos, sessão de login, estado de conexão por máquina. As plataformas de verdade entram nas fases 5 e 6.

Ao fim desta fase o usuário já usa perfis. Ainda não conecta conta nenhuma.

## Depende de

- Fase 2 concluída.
- P1 (perfil agrupa contas) e P16 (dependência `keyring`) respondidas. Se P1 for "não", esta fase precisa ser redesenhada antes de começar.

## Leitura obrigatória

- [architecture.md](../architecture.md): seções 2.1, 4, 6.3, 9.2, 10, 12.8, 13.7 e 14.2.
- [api-contracts.md](../api-contracts.md): seções 1 e 4, e os tipos da fase 3.
- [ui.md](../ui.md): seções 0, 5, 14, 15 e 16.
- [decisions.md](../decisions.md): D1, D5, D6, D18, D31, D34.

## Entregas

### Backend

1. **Vários perfis:** criar (copiando as preferências do perfil ativo, sem marca d'água e sem contas), renomear (sem renomear a pasta), remover (só vazio), listar com contagem de vídeos e de contas. A pasta de cada perfil vem do mapa montado ao ler `perfis/*/profile.json` (`architecture.md`, 2.1); nenhum `profile_id` de rota vira nome de pasta.
   - **Remover** segue `architecture.md`, 4.4: "vazio" é nenhuma entrada em `videos/` (nem pasta só com cortes, nem arquivado, nem arquivo desconhecido); a exclusão é arquivo por arquivo, por nomes fixos reconstruídos no servidor, com `profile.json` por último; pastas saem com `rmdir`; cada arquivo apagado é registrado. Sem `rmtree`.
2. **Perfil ativo** em `machine.json`. Troca recusada com algo em processamento. `/videos` passa a listar só o perfil ativo. Jobs novos gravam `profile_id`.
3. **Rotas de marca d'água** da fase 1 passam a aceitar qualquer `profile_id`.
4. **Cofre de segredos:** adaptador `secret_store` no container, com implementação `keyring` e implementação em memória. `GET /storage` passa a devolver `secret_store`. Conforme `architecture.md`, 10.2:
   - só conta como `"os"` um backend da **lista fixa**; qualquer outro (arquivo de texto, nulo, falho, desconhecido) → `"memory"`;
   - a detecção grava, lê e remove uma entrada de teste;
   - toda chamada ao cofre roda numa thread, com tempo limite de 10 s; nenhuma rota `async` chama o cofre direto.
5. **Dependência:** `keyring` em `backend/pyproject.toml`.
6. **Interface `PlatformProvider`** (`architecture.md`, 13.7) com os métodos de login e identidade. Os de envio ficam declarados e sem uso até a fase 5. O token de acesso fica em memória e é reutilizado; a renovação segura **uma trava por conta** (`architecture.md`, 10.2).
7. **Sessão de login** (`api-contracts.md`, seção 4): `session_id` com 128 bits aleatórios; ouvinte HTTP local só em `127.0.0.1`, em porta livre, por no máximo 5 minutos; `state`; PKCE; página de retorno simples. Chamada com `state` errado é **ignorada** e não encerra o ouvinte nem a sessão; o ouvinte encerra na primeira chamada com o `state` certo. `auth_url` só sai na resposta de `link/start` e `reconnect/start`; `GET /accounts/link-sessions/:id` é rota local e nunca a devolve. O ouvinte é injetado pelo container; nos testes, é falso.
8. **Contas:** ligar (via sessão), escolher entre várias, reconectar com conferência de ID, sair nesta máquina, remover do perfil, mover entre perfis. Uma conta pertence a um perfil só.
   - **Remover** grava `removed_at` e limpa nome, usuário e foto; a entrada continua em `profile.json` (`architecture.md`, 4.2). Religar a mesma conta depois a "ressuscita" com `linked_at` novo.
   - A foto é sempre lida, gravada e apagada em `contas/<account_id>.jpg`. O campo `avatar_file` do JSON nunca é usado para montar caminho.
   - Reconexão com outra conta: o token novo é revogado, **a não ser** que o ID devolvido seja o de outra conta já conectada nesta máquina; nesse caso é só descartado (`architecture.md`, 10.4).
   - Depois de "Sair", o estado das outras contas da mesma plataforma nesta máquina é recalculado.
   - "Sair", "Remover", "Mover" e remover a credencial de aplicativo consultam uma função "esta conta tem envio em andamento?" e devolvem `409` `busy_publishing` quando sim. Nesta fase a função devolve sempre "não"; a fase 5 a preenche.
9. **Estado de conexão** calculado por máquina (`architecture.md`, 10.3).
10. **Credenciais de aplicativo** por plataforma, no cofre (`PUT`/`DELETE /platforms/:platform/client`).
11. **`redact()`** e seu uso em toda mensagem de log dos módulos de contas. `detail` e `error.message` vêm de uma tabela de textos fixos, nunca de `str(exc)` (`architecture.md`, 10.5).
12. **`GET /platforms`** devolve `available: false` para YouTube e TikTok. Nenhum provedor real é registrado nesta fase.
13. Rotas da seção 4 de `api-contracts.md`, no inventário.

### Frontend

1. Entrada "Perfis e contas" nas Configurações, com "Perfis" completo (`ui.md`, 5.1).
2. "Contas" (`ui.md`, 5.2) implementado por inteiro, mas mostrando só "A publicação ainda não está disponível nesta versão." enquanto nenhuma plataforma estiver disponível.
3. Diálogo de conectar (`ui.md`, 5.3) implementado por inteiro contra as rotas; só fica alcançável quando uma plataforma estiver disponível.
4. Seletor de perfil na barra lateral, visível com mais de um perfil (`ui.md`, 14).
5. "Perfil: <nome>" no cabeçalho das seções de marca d'água e de perfis.
6. `api/profiles.ts`, `api/accounts.ts`, `hooks/useProfiles.ts`.
7. **`api/client.ts` deixa de escrever segredo no console.** Hoje `request()` faz `console.log` do corpo e dos cabeçalhos de toda chamada (`client.ts:5-7`), e o segredo do aplicativo passaria por ali em `PUT /platforms/:platform/client`. A mudança exigida: não registrar corpo nem cabeçalhos quando o caminho começa com `/platforms/`, e não registrar o corpo de nenhuma resposta dessas rotas. O resto do registro fica como está. `api/accounts.ts` usa `request()` normalmente.

## Arquivos que pode tocar

Criar:

- `backend/app/domain/profiles/accounts.py`, `link_sessions.py`
- `backend/app/infrastructure/secrets/__init__.py`, `secret_store.py`, `redact.py`
- `backend/app/infrastructure/platforms/__init__.py`, `base.py`, `oauth_listener.py`
- `backend/app/api/routers/accounts.py`, `platforms.py`
- `backend/tests/test_pp_phase3_profiles.py`, `test_pp_phase3_accounts.py`, `fakes/fake_platform.py`
- `frontend/src/api/profiles.ts`, `accounts.ts`
- `frontend/src/hooks/useProfiles.ts`
- `frontend/src/components/redesign/ProfileSwitcher.tsx`, `AccountLinkDialog.tsx`
- `frontend/src/components/redesign/settings/ProfilesSections.tsx` (os componentes `ProfilesSection` e `AccountsSection`, os dois neste arquivo; são os nomes usados em `ui.md`, 5.1 e 5.2)

Alterar:

- `backend/pyproject.toml`
- `backend/app/domain/profiles/profile_store.py`, `backend/app/core/machine_state.py`, `storage_layout.py`
- `backend/app/api/routers/profiles.py`, `videos.py`, `storage.py`
- `backend/app/application/runtime_service.py` (adaptadores no container), `job_lifecycle.py` (`profile_id` no job)
- `backend/app/models/schemas.py`, `backend/app/main.py`
- `backend/tests/conftest.py`
- `shared/contracts.ts`
- `backend/app/domain/storage/deletion_log.py` (tipo `profile_file`), `merge.py` (contas com `removed_at`)
- `frontend/src/api/index.ts`, `frontend/src/api/client.ts` (só a mudança do item 7), `frontend/src/hooks/index.ts`
- `frontend/src/components/redesign/settings/settingsShared.tsx`, `WatermarkSection.tsx`, `SettingsHubModal.tsx`, `ArcSidebar.tsx`
- `frontend/src/App.tsx`
- `AGENTS.md`, `DESIGN.md` da raiz

## Fora de escopo

- Qualquer chamada a YouTube ou TikTok. Nenhum endereço dessas plataformas aparece no código desta fase.
- Publicar.
- Mover vídeos entre perfis.
- Vários perfis em modo local (exige raiz).
- Preferências diferentes por conta, além de `publish_defaults`.

## Testes

Com a plataforma falsa (`fakes/fake_platform.py`), o cofre em memória, o ouvinte falso e o relógio injetado.

**Perfis**

- Criar copia as preferências e não copia marca d'água nem contas. Dois nomes iguais geram pastas diferentes.
- Renomear não muda o nome da pasta.
- Remover com vídeos: `409`. Remover o único: `409`. Remover o ativo: `409`. Remover vazio: some `profile.json`, marca d'água e fotos; nada dentro de `videos/` é tocado (a pasta precisa estar vazia para chegar aqui).
- **"Vazio" de verdade:** perfil cuja `videos/` tem só uma pasta com cortes (sem original), ou só um vídeo em `_archived/`, ou só um arquivo `notas.txt` → `409` `profile_not_empty` nos três casos, e nada é apagado.
- **Exclusão arquivo por arquivo:** um arquivo desconhecido dentro da pasta do perfil sobrevive, e a pasta fica. `profile.json` adulterado com `avatar_file: "../../outro/video.mp4"` e `watermark.file: "../x.png"`: remover o perfil não apaga nenhum desses alvos (arquivos-sentinela conferidos no fim). Falha ao apagar a marca d'água: `profile.json` continua lá e o perfil continua listado. `shutil.rmtree` não aparece em `app/domain/profiles/` (busca no código-fonte).
- Cada arquivo apagado na exclusão de perfil tem uma linha no registro.
- `profile_id` de rota com `..` ou com `/`: recusado antes de tocar o disco. Um `profile_id` válido que não está no mapa: `404`.
- Ativar com job em processamento: `409`. Depois de ativar, `/videos` lista só o perfil novo e as rotas `/config/*` devolvem as preferências dele.
- Em modo local: um perfil só, `can_create: false`, criar devolve `409 root_required`.
- Máquina B vê os perfis criados por A e pode ter outro perfil ativo.

**Contas**

- Fluxo completo de ligação: iniciar → retorno com `state` certo → conta no perfil com ID, nome e foto copiada → entrada no cofre.
- Sessão vencida, retorno repetido depois do sucesso, autorização negada: nada é gravado.
- **`state` errado não gasta a sessão:** uma chamada ao ouvinte com `state` errado recebe erro, a sessão continua `pending` e uma chamada seguinte com o `state` certo conclui a ligação.
- `GET /accounts/link-sessions/:id` não devolve `auth_url` em nenhum estado, e recusa cliente de fora. O `session_id` tem 32 hex e dois inícios seguidos geram ids diferentes.
- Login que devolve duas contas: `choose_account` → escolher → sucesso.
- Reconectar com outra conta: `account_mismatch`, token recém-obtido revogado, cofre intacto.
- Reconectar com uma conta que **já está conectada nesta máquina**: `account_mismatch`, e a revogação **não** é chamada; a outra conta continua `connected`.
- Conta já em outro perfil: `account_in_other_profile`; mover funciona.
- Máquina B (cofre vazio) vê a conta como `login_required`. Sem credencial de aplicativo: `client_missing`.
- Sair: revoga, apaga do cofre, a conta continua no perfil. Revogação falhando: apaga do cofre mesmo assim.
- Remover do perfil: nome e foto apagados; registros de publicação nos vídeos continuam. A entrada fica em `profile.json` com `removed_at`; as rotas não a listam. Fundir com uma cópia antiga do arquivo (em que a conta ainda existia) **não** traz a conta de volta. Religar a conta depois funciona.
- Com a função "tem envio em andamento?" forçada a responder sim: "Sair", "Remover", "Mover" e `DELETE /platforms/:platform/client` devolvem `409` `busy_publishing` e nada muda.
- Duas renovações de token pedidas ao mesmo tempo para a mesma conta: o provedor falso recebe **uma** chamada de renovação.

**Segredos**

- Depois de um fluxo completo, **nenhum** arquivo dentro da raiz nem de `data/` contém o token, o código, o verificador ou o segredo do aplicativo (busca pelos valores usados na fixture em todos os arquivos).
- Nenhuma linha de log capturada contém esses valores.
- Nenhuma resposta de rota contém esses valores (`PUT /platforms/:platform/client` inclusive).
- Com o cofre indisponível: `secret_store: "memory"`; reiniciar o container deixa a conta em `login_required`.
- **Backend de texto puro:** com um backend falso do tipo "arquivo de texto" injetado como o ativo da biblioteca, o adaptador escolhe `"memory"` e nenhum arquivo é criado. Idem para um backend desconhecido.
- Cofre que não responde (falso que bloqueia): a rota devolve erro em até o tempo limite e outras rotas continuam respondendo.
- Todas as rotas marcadas "local" recusam cliente de fora.

**Regressão**

- A suíte inteira passa. Com um perfil só, nada muda para o usuário.

## Critério de pronto

1. `pytest` verde, a suíte inteira.
2. `cd frontend && bun run build` sem erro.
3. Capturas em `docs/redesign/screenshots/profiles-publishing/fase-3/`: Perfis (um, vários, criando, erros), seletor na barra lateral, Contas no estado "ainda não disponível". Com a plataforma falsa ligada por uma variável de ambiente só de desenvolvimento: lista de contas nos três estados e o diálogo de conectar em cada passo.
4. Teste de varredura de segredos verde.
5. Revisão aprovada, com atenção às seções (a) e (d) do [review-checklist.md](../review-checklist.md).

A variável de desenvolvimento do item 3 só registra a plataforma falsa; ela não pode existir no caminho normal de inicialização nem mudar nenhum outro comportamento.

## Validação manual

Em [manual-validation.md](../manual-validation.md), fase 3: cofre real do Windows, tamanho máximo de uma entrada, segundo computador.

## Modelos

Implementação e testes: Sonnet. Revisão: Opus.
