# Emenda: só neste computador

Este documento muda o plano das fases 2 a 6. **Quem implementa ou revisa uma dessas fases lê este arquivo antes dos outros.** Onde ele diz uma coisa e [architecture.md](./architecture.md), [api-contracts.md](./api-contracts.md), [ui.md](./ui.md), [review-checklist.md](./review-checklist.md), [manual-validation.md](./manual-validation.md) ou um arquivo de fase dizem outra, **vale este**.

A fase 1 (marca d'água) não muda em nada. Ela continua sendo implementada por [phases/phase-1.md](./phases/phase-1.md), pelas seções de marca d'água de `architecture.md` (11), pelas rotas da fase 1 de `api-contracts.md` (seção 2) e pelas telas de marca d'água de `ui.md` (4 e 12).

Nada foi apagado dos outros documentos. O que está adiado continua escrito lá, para o dia em que voltar.

## 1. A decisão

O dono decidiu, em 18/11/2026: **a parte de sincronizar as coisas entre vários computadores fica escrita, mas não é implementada. Não é urgente nem necessária.** Registro em [decisions.md](./decisions.md), D49.

Consequências:

- Tudo o que existe **só** para o app funcionar em vários computadores por uma pasta sincronizada fica **adiado**: a pasta escolhida como "raiz", `yts-root.json`, a migração dos vídeos para a raiz, a sobreposição que leva preferências para dentro da raiz, a trava de "um por vez" e o modo somente leitura, o número de revisão e a fusão de cópias de conflito, o estado "entrar de novo neste computador" como passo de um computador novo, os avisos de que apagar se espalha para outros computadores, e tudo o que é decidido por "outra máquina".
- Todo o resto continua pedido e passa a funcionar **em um computador**, com o armazenamento de hoje: o diretório de dados do app (`data/`) e a pasta de vídeos que o usuário já escolhe (`media.base_dir`).
- O trabalho de segurança que as revisões acharam e que não depende da raiz **não** é adiado: o defeito do nome `.`/`..`, o renomear que move uma pasta para dentro de outra, a conferência do `video_id` antes de virar job, o arquivo ilegível que nunca é sobrescrito e a trava "só neste computador" nas rotas que apagam (P22).

## 2. O que fica adiado e o que continua valendo

"Adiado" quer dizer: **não implementar, não testar, não criar arquivo, rota, campo de tela nem texto.** Se uma fase precisar de algo desta lista para funcionar, pare e registre em `decisions.md`.

### 2.1 Em `architecture.md`

| Seção | Situação |
|---|---|
| 1 Vocabulário | "Raiz", "Modo raiz" e "Máquina" (com identificador) ficam adiados. Só existe o **modo local**. "Perfil local" passa a ser o **primeiro perfil** (3.4 deste documento). |
| 2 O que fica onde (a árvore RAIZ e as regras da raiz) | **Adiado.** A árvore MÁQUINA vale com as mudanças da seção 3.2 daqui. |
| 2.1 `yts-root.json` | **Adiado** inteiro. |
| 3.1 `data/machine.json` | Vale reduzido: seção 3.3 daqui. `machine_id`, `machine_name` e `storage.*` ficam adiados. |
| 3.2 `.gitignore` | Vale com a lista da seção 3.2 daqui. `data/work/` e `data/logs/` ficam adiados. |
| 3.3 Área de trabalho local e temporários esquecidos | **Adiado** inteiro. Download, envio, renderização, transcrição e logs ficam onde estão hoje. |
| 4.1 Pasta do perfil (nome criado a partir do nome do perfil, dentro de `perfis/`) | **Adiado.** Vale a seção 3.4 daqui. |
| 4.2 `profile.json` | **Vale**, com os campos reservados da seção 3.4 daqui. |
| 4.3 Perfil local | Substituído pela seção 3.4 daqui. |
| 4.4 Perfil ativo e jobs | Valem os três primeiros itens. Os dois últimos (excluir só com `videos/` vazia; ordem da exclusão) são substituídos pela seção 3.4 daqui. |
| 5.1, 5.2, 5.4, 5.5 Arquivo de informações | **Valem**, com os campos reservados e as trocas da seção 3.7 daqui. Tudo o que começa com "em modo raiz" ou "em somente leitura" fica adiado. |
| 5.3 Versão e arquivo ilegível | **Vale** para `video.info.json` e `profile.json`. As linhas de `root_id` e `machine_id` da tabela de formatos ficam adiadas. |
| 6 Escrita na raiz (6.1 a 6.4) | **Adiado**: temporário com `<m8>`, novas tentativas, releitura, escritas pendentes, varredura de temporários de JSON, revisão, fusão e cópias de conflito. **Fica** só a ideia central de 6.2: uma função `update(caminho, mudar)` com trava por arquivo dentro do processo (3.7 daqui). |
| 7 Trava de "um por vez" e somente leitura | **Adiado** inteiro. |
| 8.1 Como é hoje | Vale (são fatos). |
| 8.2 Resolvedor de caminhos | Vale a coluna "Modo local" da tabela, o **item 1** (nomes recusados e "renomear nunca move para dentro de outra") e o **item 3** (todo caminho conferido como descendente da pasta de vídeos). O **item 2** (80 caracteres, ponto e espaço no fim, nomes reservados do Windows) e "Comprimento do caminho no Windows" ficam adiados. A pasta base por perfil está na seção 3.5 daqui. |
| 8.3 Reconciliação pasta ↔ job | Vale: o passo 1 (com as linhas "já tem job" e "não tem job, modo local"), o passo 2, a linha "Local" do passo 3 e o passo 4. Ficam adiados: as linhas "modo raiz", os motivos `no_info` e `duplicate_id`, a espera de 10 minutos e "em somente leitura". Detalhe em 3.6 e 3.7 daqui. |
| 8.4 Criar ou abrir uma raiz | **Adiado** inteiro. A validação da pasta de vídeos de um perfil é a da seção 3.5 daqui. A lista de nomes de `looks_synced` só é reusada na fase 5, para o aviso `data_dir_synced`. |
| 8.5 Migração | **Adiado** inteiro. Não há migração: os vídeos de hoje ficam onde estão. |
| 8.6 Tentativas arquivadas | Vale. |
| 9.1 Chave por chave | **Vale** como classificação: a coluna "Perfil" é preferência do perfil, a coluna "Máquina" é global. Repetida na seção 4 daqui. |
| 9.2 Como funciona sem mudar as rotas | Substituído pela seção 4 daqui. |
| 10 Credenciais | **Vale.** De 10.4, ficam adiados os passos 1 a 3 ("Computador novo"); o passo 4 e "Cuidado ao revogar" valem. Onde 10.5 diz "nenhum arquivo dentro da raiz", leia "nenhum `profile.json` nem `video.info.json`". |
| 11 Marca d'água | Fase 1. **Não muda.** |
| 12 Motor de limpeza | **Vale**, com as trocas do cartão da fase 4 (seção 6.4 daqui). Ficam adiados: regras em `yts-root.json`; o item 5 de 12.4 (somente leitura); o registro `in_progress` "de qualquer computador" de 12.4; o parágrafo "o plano só enxerga o que já chegou a este computador" de 12.7; a exceção 2 de 12.7 (`audio_16k.wav` em `data/jobs/`); "um arquivo por computador" e os tipos `conflict_copy`, `tmp_leftover` e `profile_file` de 12.8. |
| 13 Publicação | **Vale**, com as trocas do cartão da fase 5 (seção 6.5 daqui). Ficam adiados: o item 4 de 13.3; a metade "de outra máquina" do registro parado; a pausa "a pasta passou a ser usada em outro computador" de 13.2; "escrita de conclusão em somente leitura" de 13.6; as linhas "a máquina perde a trava" e "a raiz fica indisponível" de 13.8. |
| 14.1 `GET /events` | Vale. Os eventos `storage.status` e `migration.progress` ficam adiados. O canal nasce na fase 2 (Base local). |
| 14.2 `require_local_ui` | **Vale**, inclusive nas quatro rotas existentes (P22). O motivo deixa de ser a sincronização: hoje qualquer site aberto no navegador e qualquer aparelho da rede consegue mandar apagar um vídeo. |
| 15 Defeitos antigos | Vale como informação. As correções marcadas "corrigido na fase 2" continuam na fase 2 (Base local). As linhas que falam de modo raiz não se aplicam. |

### 2.2 Em `api-contracts.md`

Rotas **adiadas** (não criar, não pôr no inventário do `AGENTS.md`):

- `POST /storage/root/validate`
- `POST /storage/root` e `DELETE /storage/root`
- `GET /storage/migrations/:migration_id` e `POST /storage/migrations/:migration_id/cancel`
- `POST /storage/retry`
- `POST /storage/first-run/dismiss`
- `POST /storage/lock/takeover`
- `POST /storage/conflicts/clear`
- `POST /storage/leftovers/clear`

Outros pontos adiados:

| Onde | O que |
|---|---|
| Seção 1 | A convenção "Somente leitura" e os códigos `storage_read_only`, `storage_unavailable` e `root_required`. Nenhuma rota os devolve. `profile_not_empty` e `last_profile` também não são devolvidos (seção 3.4 daqui). |
| Seção 3, `GET /storage` | Fica **reduzida** (seção 3.8 daqui). |
| Seção 3, `POST /storage/folders/adopt` | Vale, sem a espera de 10 minutos e só com o motivo `info_unreadable`. |
| Seção 4, `GET /profiles`, `POST /profiles`, `PUT /profiles/:id`, `DELETE /profiles/:id` | Valem com as trocas da seção 3.4 e 3.5 daqui. |
| Seção 5 | `scope` é sempre `"local"`; `synced_folder_warning` é sempre `false`; o motivo `read_only` nunca aparece; `GET /cleanup/log` lê um arquivo só. O evento `migration.progress` e `storage.status` ficam adiados. |
| Seção 6 | `in_progress.machine_name` vem `null` e `here` vem sempre `true`; `POST /publications/:id/resume` nunca devolve `storage_read_only`. |
| Seção 7 | Os tipos `RootInvalidReason`, `RootValidation` e `StorageMigration` não entram em `shared/contracts.ts`. `StorageStatus`, `VideoInfo` e `ShortPublicationRecord` entram com as trocas das seções 3.7 e 3.8 daqui. |

Todas as outras rotas e campos das seções 3 a 6 **valem como estão**.

Códigos de erro novos desta emenda:

| `code` | HTTP | Quando |
|---|---|---|
| `invalid_videos_dir` | 400 | A pasta de vídeos de um perfil foi recusada. Vem com `reason` (seção 3.5). |
| `videos_dir_unavailable` | 409 | A pasta de vídeos do perfil não está disponível agora (disco desligado, pasta sumiu). |
| `first_profile` | 409 | Tentativa de remover o primeiro perfil. |

### 2.3 Em `ui.md`

| Seção | Situação |
|---|---|
| 1 Primeira execução, "Onde guardar seus vídeos?" | **Adiado** inteiro. Não há pergunta nova na primeira abertura. |
| 2 Pasta indisponível, somente leitura, escrita pendente (2.1, 2.2, 2.3) | **Adiado** inteiro. |
| 0.3, peças `StorageFirstRunDialog`, `StorageUnavailableDialog`, `DeleteVideoConfirmDialog` | **Adiadas.** `FolderField` passa a nascer na fase 3; `NoticePill` e `AppNotices`, na fase 4. |
| 5.1 Perfis | Vale, com os textos da seção 5 daqui. A linha "Modo local" e a linha "Remover perfil com vídeos" da tabela de estados deixam de existir. |
| 6.1 Pasta | Fica reduzida (seção 5 daqui). Adiados: os botões "Escolher uma pasta para levar entre computadores", "Trocar pasta" e "Deixar de usar esta pasta"; o bloco "OUTROS COMPUTADORES"; os dois "avisos fixos"; os cartões de arquivos de conflito e de temporários esquecidos; os avisos `credentials_file_in_root`. |
| 7.2 `AppNotices` | Vale. As duas linhas de somente leitura da tabela ficam adiadas. |
| 8 Lista da limpeza | Vale. A "faixa extra" de pasta sincronizada e a linha "Somente leitura" da tabela de estados ficam adiadas. |
| 10 Exceção de tamanho | Vale. A frase "em modo raiz a confirmação ganha a linha…" fica adiada. |
| 11 "Manter" e estados sem original | Vale, com os textos da seção 5 daqui. |
| 11.1 "Remover" em modo raiz | **Adiado.** "Remover" e o `DeleteCutConfirmDialog` ficam idênticos aos de hoje. |
| 13.2 e 13.4 | Valem. As linhas "sendo publicado em outro computador", "Somente leitura" e a pausa "a pasta está em uso em outro computador" ficam adiadas. |
| 3, 4, 5.2 a 5.4, 6.2, 7.1, 9, 12, 13.1, 13.3, 13.5, 14, 15, 16 | **Valem como estão.** Os textos que dizem "neste computador" ficam como estão. |

### 2.4 Em `review-checklist.md`

O revisor das fases 2 a 6 recebe também este arquivo. Itens **adiados** (responder "não se aplica"):

- Seção A: "a validação da raiz recusa pasta que contém o repositório…" (só a primeira frase; a parte do diretório de dados sincronizado vale na fase 5).
- Seção B, "Sem clique": os dois itens da migração; "a migração nunca funde duas pastas"; "em modo raiz, nenhuma pasta é adotada sozinha…"; cópias de conflito; temporários esquecidos; "a única exclusão sem clique é a de temporários de JSON" (**em modo local não existe nenhuma exclusão sem clique**); "a trava nunca muda de dono".
- Seção B, "Travessia": o item de `POST /storage/root`.
- Seção B, "Registro": "as outras exclusões com clique dentro da raiz" e "um arquivo por computador".
- Seção D: "raiz configurada e indisponível"; o diálogo de primeira execução na lista de efeitos.
- Seção E: "dentro da raiz, passa por `synced_store.update`".
- Seção F: "dois computadores…" e "a fusão tem teste para remoção".
- Seção G: a parte "em somente leitura" do item do resultado gravado.
- Seção H: a pergunta dos dois computadores donos da trava.

Itens que **mudam de leitura**:

| Item | Em modo local |
|---|---|
| A: "nenhum modelo gravado na raiz…" | Vale para `profile.json`, `video.info.json`, `machine.json` e o registro da limpeza. |
| B: "só duas exclusões da limpeza acontecem fora da pasta de vídeos" | **Só uma**: `data/jobs/<job_id>/`, por `release_local_job_state`. |
| B: "`profile_id` nunca é usado direto como nome de pasta: a pasta vem do mapa montado ao ler `perfis/*/profile.json`" | O mapa é montado ao ler `data/profile/profile.json` e `data/profiles/*/profile.json`. |
| B: "`DELETE /profiles/:id` apaga arquivo por arquivo… 'vazio' é nenhuma entrada em `videos/`" | Arquivo por arquivo continua valendo. A pasta de vídeos do perfil **não é tocada**: há teste que compara a árvore dela antes e depois (seção 3.4). |
| D: "nenhum caminho absoluto dentro da raiz" | Nenhum caminho absoluto em `profile.json` nem em `video.info.json`. |
| E: "toda escrita de `.json` é atômica" | Toda escrita de `video.info.json` passa pela função `update` da seção 3.7; busque escritas que não passem por ela. |

Todos os outros itens **valem como estão**.

### 2.5 Em `manual-validation.md`

Ficam **adiados** todos os itens marcados **[Drive]** ou **[2 PCs]**, em qualquer fase, e mais estes da fase 2: "Aplicativo dentro do Drive", "Migração real", "Migração interrompida", "Pasta indisponível", "Migração com arquivados", "Voltar para o modo local", "Caminho longo" e "Escolher como pasta".

Continuam valendo, da fase 2: "Seletor de pasta nativo", "Biblioteca que já existia", "Renomear um vídeo para `..`" (sem a parte do nome reservado `CON`) e "Renomear um vídeo para o nome de outro vídeo". Das fases 3 a 6, todos os itens **[PC]**, **[Google]** e **[TikTok]** sem **[2 PCs]**.

Itens novos, todos **[PC]**:

- Fase 2: baixar dois vídeos com o mesmo título, um depois do outro. O segundo fica numa pasta `<título> (2)` e o primeiro continua intacto, com os cortes dele.
- Fase 3: criar um segundo perfil numa pasta de outro disco; trocar de perfil; os vídeos, a marca d'água e as preferências de corte mudam, e os do primeiro perfil estão iguais ao voltar.
- Fase 3: remover um perfil que tem vídeos. A pasta dele continua no disco com tudo dentro. Criar outro perfil apontando para a mesma pasta traz os mesmos vídeos, com os mesmos cortes.
- Fase 3: desligar o disco da pasta de um perfil e abrir o app. O perfil aparece com "Pasta não encontrada", nada é criado no caminho, e ao religar o disco os vídeos voltam.
- Fase 5: com o app instalado dentro de uma pasta sincronizada, o aviso "A pasta do aplicativo parece sincronizada" aparece.

### 2.6 Em `platforms.md`

Nada é adiado nas regras das plataformas. Só o aviso `credentials_file_in_root` (seção 3, último parágrafo) deixa de ser implementado. Os textos do passo a passo ficam como estão.

## 3. Modelo de armazenamento local

### 3.1 Vocabulário

| Termo | Significado nesta emenda |
|---|---|
| **Diretório de dados** | `data/` (ou `YTS_DATA_DIR`). Guarda estado e perfis. Não guarda vídeo. |
| **Primeiro perfil** | O "perfil local" que a fase 1 cria em `data/profile/`, com `profile_id` `p_local`. Continua lá, com o mesmo id e os mesmos dados. |
| **Perfil** | Nome, preferências, marca d'água, uma pasta de vídeos própria e zero ou mais contas. |
| **Pasta de vídeos do perfil** | Uma pasta deste computador, escolhida pelo usuário para aquele perfil. A do primeiro perfil é `media.base_dir`. |
| **Arquivo de informações** | `video.info.json`, dentro da pasta de cada vídeo. |

### 3.2 O que fica onde

```
data/                                   (YTS_DATA_DIR; hoje <repo>/data)
├─ settings.json, custom_settings.json,
│  default_configs.json, saved_llm_prompts.json     existentes; não ganham chave nova
├─ machine.json                          perfil ativo, pasta de cada perfil, limpeza      fase 2 (módulo) / 3 (primeira gravação)
├─ profile/                              o primeiro perfil (p_local)                      fase 1
│  ├─ profile.json
│  ├─ marca-dagua/watermark.png
│  └─ contas/<account_id>.jpg            foto de conta                                    fase 3
├─ profiles/                             os outros perfis                                 fase 3
│  └─ <profile_id>/                      mesmo conteúdo de profile/
├─ cleanup.log.jsonl                     registro da limpeza                              fase 4
├─ publish/queue.json                    fila de publicações                              fase 5
└─ jobs/<job_id>/                        estado em andamento                              existente

PASTA DE VÍDEOS DE CADA PERFIL (uma por perfil; a do primeiro é media.base_dir)
├─ <video_name>/
│  ├─ video.<ext>                        o original
│  ├─ video.info.json                    arquivo de informações                           fase 2
│  ├─ transcrições/                      como hoje
│  └─ shorts/MM_SS-MM_SS.mp4             os cortes
└─ _archived/<video_name>/…              mesmo formato

{media.base_dir}/logs/                   logs, como hoje, para todos os perfis

cofre do sistema operacional             logins e credenciais de aplicativo               fase 3
```

`.gitignore`: a fase 1 acrescenta `data/profile/`. A fase 2 acrescenta `data/machine.json` e `data/machine.json.corrupt-*`. A fase 3, `data/profiles/`. A fase 4, `data/cleanup.log.jsonl`. A fase 5, `data/publish/`.

### 3.3 `data/machine.json`

```json
{
  "schema_version": 1,
  "active_profile_id": "p_local",
  "profile_dirs": { "p_8f3a2c1d": "D:\\Cortes\\Canal de games" },
  "cleanup_local": { "enabled": false, "max_age_days": null, "max_size_gb": null },
  "cleanup_postponed_until": null
}
```

| Campo | Significado | Fase que passa a gravar |
|---|---|---|
| `active_profile_id` | Perfil em uso. Ausente ou desconhecido: `p_local`. | 3 |
| `profile_dirs` | Caminho absoluto da pasta de vídeos de cada perfil **que não é o primeiro**. O primeiro perfil nunca aparece aqui: a pasta dele é `media.base_dir`. É o único lugar com esses caminhos; `profile.json` nunca guarda caminho absoluto. | 3 |
| `cleanup_local`, `cleanup_postponed_until` | Como em `architecture.md`, 3.1 e 12. | 4 |

- O módulo (`backend/app/core/machine_state.py`) nasce na fase 2. O **arquivo** só nasce na primeira gravação; arquivo ausente vale os padrões acima.
- Escrita atômica, com o `AtomicJsonArtifactStore` que já existe. Campo desconhecido é preservado.
- Arquivo ilegível: como em `architecture.md`, 3.1. É renomeado para `machine.json.corrupt-<data>` e nasce um novo com os padrões. Consequência: os perfis além do primeiro aparecem **sem pasta** (estado "pasta não encontrada", 3.5) até o usuário apontar a pasta de novo. Nada é apagado.
- `machine_id`, `machine_name` e `storage` ficam **reservados**: não são gravados nem lidos.
- A fase 5 acrescenta a este arquivo a contagem de envios do dia, como o arquivo da fase descreve.

### 3.4 Perfis

**Onde ficam.** O primeiro perfil fica em `data/profile/`. Cada outro perfil fica em `data/profiles/<profile_id>/`. O formato de `profile.json` é o de `architecture.md`, 4.2.

**Como o app acha os perfis.** Lendo `data/profile/profile.json` e `data/profiles/*/profile.json` (só as pastas diretamente dentro de `profiles/`). O app monta em memória o mapa `profile_id` → pasta, e todo caminho de perfil sai desse mapa. Um `profile_id` recebido numa rota é conferido pelo formato e procurado no mapa; **nunca vira nome de pasta direto**. Não existe índice de perfis.

- Pasta sem `profile.json`: não é perfil.
- `profile.json` ilegível ou de versão mais nova: não é perfil; `GET /storage` traz o aviso `unreadable_profile`; o arquivo não é tocado (`architecture.md`, 5.3).
- Duas pastas com o mesmo `profile_id`: vale a primeira em ordem alfabética (`data/profile/` sempre vence para `p_local`); a outra é ignorada, com o aviso `duplicate_profile`. Nada é regravado.

**Formato do `profile_id`.** `p_local` para o primeiro; `p_` + 8 hex para os outros, gerado pelo servidor.

**Campos reservados em `profile.json`.** `revision` continua subindo 1 a cada gravação e `updated_at` continua sendo gravado, como a fase 1 já faz; nenhum código decide nada por eles. `updated_by` é gravado `null` e `merged_conflict_files` é gravado `[]`; nenhum dos dois é lido. Remover uma conta continua gravando `removed_at` em vez de tirar a entrada (`architecture.md`, 4.2): assim o arquivo não precisa de conversão quando a spec adiada voltar.

**Criar** (`POST /profiles`, local). Corpo: `{ "name": "Canal de games", "videos_dir"?: "D:\\Cortes\\Games" }`.

1. Nome: 1 a 60 caracteres depois de tirar espaços das pontas; senão `400`.
2. Pasta de vídeos: escolhida e validada pela seção 3.5. Inválida: `400` `invalid_videos_dir`, e nada é criado.
3. O servidor gera o `profile_id` e cria `data/profiles/<profile_id>/profile.json` com: o nome; `accounts: []`; `preferences.settings` e `preferences.tool_configs` preenchidos com os **valores em vigor no perfil ativo** de todas as chaves de perfil (seção 4); `preferences.publish` copiado do perfil ativo; `preferences.watermark` com os padrões (sem imagem).
4. Só então grava `profile_dirs[<profile_id>]` em `machine.json`.
5. O perfil novo **não** vira o ativo sozinho.

Resposta `201`: `Profile`, com os campos novos de 3.5.

**Renomear** (`PUT /profiles/:profile_id`, local, com `name`). Muda só o nome em `profile.json`. Nenhuma pasta muda de nome.

**Perfil ativo** (`POST /profiles/:profile_id/activate`, local). Fica em `machine.json`. A troca é recusada com `409` `busy_processing` enquanto houver algo em processamento ou publicação em andamento. Depois de trocar, o servidor descarta os caches de configurações. `/videos` e `/videos/archived` listam só a pasta do perfil ativo. O alias `active` das rotas resolve para o perfil ativo.

**Remover** (`DELETE /profiles/:profile_id`, local). **Remover um perfil nunca apaga nem move um vídeo.** A pasta de vídeos do perfil fica no disco exatamente como estava, com tudo dentro; o app só deixa de mostrá-la. (É a pergunta P24; a alternativa "só remover perfil sem vídeos" obrigaria o usuário a apagar vídeos para se livrar de um perfil.)

Recusas, nesta ordem:

| Caso | Resposta |
|---|---|
| É o primeiro perfil (`p_local`) | `409` `{ "detail": "O primeiro perfil não pode ser removido.", "code": "first_profile" }` (P25) |
| É o perfil ativo | `409`, como em `api-contracts.md`, seção 4 |
| Algum vídeo dele está em processamento | `409` `busy_processing` |
| Alguma conta dele tem envio em andamento | `409` `busy_publishing` |

Depois, nesta ordem:

1. **Desliga os jobs do perfil.** Para cada job com esse `profile_id`: `source_video_path` e `video_name` passam a `null` (só o `job.json` muda). Sem isso, um `DELETE /videos/:job_id` antigo acharia a pasta pelo nome. O estado em `data/jobs/<job_id>/` fica.
2. Sai de cada conta do perfil (revoga e apaga do cofre, como em "Sair").
3. Apaga **arquivo por arquivo**, por nomes fixos reconstruídos no servidor: `contas/<account_id>.jpg` de cada conta; `marca-dagua/watermark.png`; e, **por último**, `profile.json`. Depois tenta `rmdir` em `contas/`, `marca-dagua/` e na pasta do perfil. Sem `rmtree`. Arquivo desconhecido faz a pasta ficar. Nenhum caminho vem de campo do JSON (`avatar_file`, `watermark.file`).
4. Tira `profile_dirs[<profile_id>]` de `machine.json`.

Em nenhum passo o código lista, lê para apagar, move ou faz `rmdir` na pasta de vídeos do perfil.

Se o usuário criar depois outro perfil apontando para a mesma pasta, os vídeos voltam com os **mesmos** ids: cada pasta tem o seu `video.info.json`, e a reconciliação religa o job que já existe (3.6).

Resposta `200`: `{ "ok": true, "profile_id": "..." }`. Os códigos `profile_not_empty` e `last_profile` não são usados: o primeiro perfil sempre existe.

### 3.5 Pasta de vídeos de cada perfil

**Primeiro perfil.** A pasta é `media.base_dir`, lida de `settings.json` como hoje. Os vídeos que já existem **ficam onde estão**; não há migração. Ela continua sendo trocada pela rota de hoje (`POST /config/settings`), em Configurações → Aplicação. `PUT /profiles/p_local` com `videos_dir` é recusado com `400` `{ "detail": "A pasta do primeiro perfil é alterada em Configurações, na seção Aplicação." }`.

**Outros perfis.** O usuário escolhe uma pasta para cada um.

- `POST /profiles` com `videos_dir`: usa a pasta informada.
- `POST /profiles` sem `videos_dir`: o servidor usa a **pasta sugerida**, `<pasta-mãe de media.base_dir>/<nome do perfil>` (P26). O nome é saneado pela regra de pasta de vídeo de hoje (`get_video_folder`, `backend/app/core/settings.py:244-246`) e passa pelas recusas do item 1 de `architecture.md`, 8.2; se a pasta já existe, ganha ` (2)`, ` (3)`. Se `media.base_dir` não tem pasta-mãe (é a raiz de um disco), não há sugestão e a resposta é `400` `invalid_videos_dir` com `reason: "required"`.
- `PUT /profiles/:profile_id` com `videos_dir` (P27): aponta o perfil para outra pasta. **Nada é movido nem apagado**; os vídeos da pasta antiga ficam nela e deixam de aparecer. Recusado com `409` `busy_processing` se algum vídeo do perfil está em processamento, e com `409` `busy_publishing` se há envio em andamento. Antes de trocar, os jobs do perfil são desligados da pasta antiga (como no passo 1 de "Remover"); a reconciliação religa os que existirem na pasta nova.

**Validação**, sobre caminhos resolvidos (links e `..` desfeitos; no Windows, sem diferenciar maiúsculas). O primeiro teste que falha decide. Nada é criado antes de todos passarem.

| # | Caso | `reason` |
|---|---|---|
| 1 | Caminho vazio, não absoluto, de outro sistema (`is_foreign_os_path`, `settings.py:63-78`), que aponta para um arquivo, ou cuja pasta-mãe não existe | `not_found` |
| 2 | A raiz de um disco; a pasta do usuário ou qualquer pasta acima dela; ou uma pasta geral do usuário **em si** (a lista fixa de `architecture.md`, 8.4, linha 2). Uma subpasta delas é aceita. | `too_broad` |
| 3 | Fica dentro do repositório (`project_root()`) ou do diretório de dados efetivo (`data_dir()`) | `inside_app` |
| 4 | Contém o repositório ou o diretório de dados efetivo, ou é igual a um deles | `contains_app` |
| 5 | É igual à pasta de vídeos de outro perfil, fica dentro dela ou a contém. A pasta do primeiro perfil (`media.base_dir`) entra na comparação. | `overlaps_profile` |
| 6 | Não dá para escrever (o teste grava e apaga um arquivo próprio, de nome único; se a pasta ainda não existe, o teste é feito na pasta-mãe) | `not_writable` |

Passou em tudo: se a pasta não existe, o app a cria (como já faz com `media.base_dir`, `settings.py:111-114`).

**Troca de `media.base_dir`.** `POST /config/settings` continua aceitando qualquer pasta, como hoje, com uma única recusa nova, que só pode acontecer quando há mais de um perfil: se a pasta nova cai na linha 5 da tabela, a rota devolve `400` `{ "detail": "Esta pasta já é usada por outro perfil." }` e não grava nada. Com um perfil só, a rota se comporta exatamente como hoje.

**Pasta indisponível.** Se a pasta de um perfil que não é o primeiro não existe no disco (ou o perfil não tem entrada em `profile_dirs`), o app **não cria a pasta** e não troca por outra:

- `GET /profiles` devolve `videos_dir_available: false` para ele;
- `/videos` e `/videos/archived` devolvem lista vazia;
- `POST /jobs`, `POST /jobs/upload` e `POST /jobs/:id/ingest` devolvem `409` `{ "detail": "A pasta deste perfil não está disponível.", "code": "videos_dir_unavailable" }`;
- a limpeza pula a pasta: ela não entra no plano nem nos totais.

Quando a pasta volta, tudo volta, sem clique. (A pasta do primeiro perfil continua com o comportamento de hoje de `load_settings`.)

**Campos novos em `GET /profiles`** (aditivos):

```json
{
  "active_profile_id": "p_local",
  "can_create": true,
  "default_videos_parent": "C:\\Users\\fulano\\Downloads",
  "profiles": [
    {
      "profile_id": "p_local", "name": "Perfil local",
      "videos_count": 14, "accounts_count": 0, "has_watermark": true,
      "is_first": true,
      "videos_dir": "C:\\Users\\fulano\\Downloads\\uploads",
      "videos_dir_available": true
    }
  ]
}
```

`can_create` é sempre `true`. `default_videos_parent` é `null` quando não há sugestão. `videos_dir` é `null` para um perfil sem pasta configurada. `Profile` (resposta de `GET`, `POST` e `PUT /profiles/:id`) ganha os mesmos `is_first`, `videos_dir` e `videos_dir_available`.

Em `shared/contracts.ts`, na fase 3: `ProfileSummary` e `Profile` ganham `is_first?: boolean`, `videos_dir?: string | null`, `videos_dir_available?: boolean`; `ProfilesResponse` ganha `default_videos_parent?: string | null`; e entra `export type VideosDirInvalidReason = "required" | "not_found" | "too_broad" | "inside_app" | "contains_app" | "overlaps_profile" | "not_writable";`.

### 3.6 Vídeo e perfil

- **Um vídeo é do perfil em cuja pasta de vídeos a pasta dele está.** O `video.info.json` não guarda perfil.
- Cada job guarda `profile_id` (campo extra, `backend/app/models/domain.py:28-39`). **`profile_id` ausente quer dizer `p_local`**: todo job de hoje é do primeiro perfil, e nenhum `job.json` é regravado só para ganhar o campo. A partir da fase 3, job novo nasce com o `profile_id` do perfil ativo.
- O resolvedor (`backend/app/core/storage_layout.py`) responde `videos_dir(profile_id)`: `media.base_dir` para `p_local`; `profile_dirs[<id>]` para os outros. As funções de `settings.py:244-309` passam a pedir a pasta base a ele, usando o perfil **do job**, não o ativo.
- **O resolvedor nunca cai para a pasta de outro perfil.** Job com `profile_id` que não está no mapa de perfis, ou cujo perfil está sem pasta: o resolvedor não devolve caminho e a rota responde `404` `"Video not found"` (ou `409` `videos_dir_unavailable` nas rotas de ingestão). Se caísse para `media.base_dir`, o `DELETE /videos/:job_id` de um job órfão apagaria um vídeo de mesmo nome do primeiro perfil.
- `logs_dir()` continua `{media.base_dir}/logs`, para todos os perfis.

**Reconciliação com mais de um perfil** (complementa `architecture.md`, 8.3). A listagem varre só a pasta do perfil ativo. Para cada pasta reconhecida:

| Situação | O que o app faz |
|---|---|
| O job daquele `video_id` aponta para **esta** pasta | Nada. |
| O job aponta para outra pasta (deste ou de outro perfil) que **ainda existe** no disco com o mesmo `video_id` no arquivo de informações | A pasta foi copiada. Vale a linha "Local" do passo 3 de 8.3: esta pasta recebe um id novo, como um vídeo à parte. |
| O job aponta para um caminho que **não existe mais**, ou está desligado (`source_video_path` nulo) | A pasta foi movida, ou o perfil foi removido e a pasta voltou num perfil novo. O job é religado: `source_video_path`, `video_name` (o nome da pasta) e `profile_id` são corrigidos. |

O app não tem botão para mover um vídeo de um perfil para outro (continua fora de escopo).

### 3.7 Arquivo de informações por vídeo

**Onde fica.** `<pasta de vídeos do perfil>/<video_name>/video.info.json`, ao lado de `video.<ext>`. Para vídeo arquivado, dentro de `_archived/<video_name>/`. O nome do arquivo e os nomes dos campos são os de `architecture.md`, 5.2, para a spec adiada poder adotar o mesmo arquivo sem conversão.

**Formato em modo local.** Igual ao exemplo de `architecture.md`, 5.2, com estas diferenças:

| Campo | Em modo local |
|---|---|
| `schema_version` | `1`. Vale 5.3. |
| `revision` | Sobe 1 a cada gravação. **Reservado:** nenhum código decide nada por ele. |
| `updated_at` | Gravado a cada mudança. |
| `updated_by` | **Reservado.** Gravado `null`. |
| `merged_conflict_files` | **Reservado.** Gravado `[]`. |
| `shorts[].publications[].machine_id`, `machine_name` | **Reservados.** Gravados `null`. |
| `source.downloaded_at_origin` | `"app"`, `"job"` ou `"migration"`. O nome `"migration"` é mantido; em modo local quer dizer "adotado sem job, na data da adoção". |
| Todos os outros campos (`video_id`, `title`, `source.*`, `flags.*`, `shorts[]` com `file`, `cut_id`, `start`, `end`, `title`, `description`, `rendered_at`, `deleted_at`, `size_bytes`, `watermark`, `publications[]`) | Como em 5.2, com o mesmo significado. |

Continua valendo de 5.2: uma entrada de `shorts[]` nunca é removida (apagar grava `deleted_at`); um registro de publicação nunca é removido (falha vira `abandoned`). Campo desconhecido é preservado ao regravar.

Em `shared/contracts.ts` (fase 2), os tipos de `api-contracts.md`, seção 7, entram com três trocas: em `VideoInfo`, `updated_by?: { machine_id: string; machine_name: string } | null`; em `ShortPublicationRecord`, `machine_id?: string | null` (e `machine_name` como já está). `merged_conflict_files?: string[]` não precisa aparecer no tipo.

**Escrita.** Uma função só, `update(caminho, mudar)`, em `backend/app/domain/storage/video_info.py`. Ninguém grava `video.info.json` por outro caminho.

1. Segura um `threading.Lock` indexado pelo caminho resolvido durante todo o ciclo. O mesmo arquivo é escrito por vários lados ao mesmo tempo (dois cortes terminando juntos, o trabalhador de publicação, `PUT /videos/:id/flags`, a conferência de cortes).
2. Lê o arquivo do disco naquele instante. Não existe: é uma criação. Existe e está ilegível ou é de versão mais nova: erro, nada é escrito (5.3).
3. Aplica `mudar` ao que leu, soma 1 a `revision`, grava `updated_at`.
4. Grava com a escrita atômica que já existe (`AtomicJsonArtifactStore`: `.tmp` + `fsync` + `os.replace`).
5. Se a gravação falhar: o arquivo antigo fica como estava e a operação devolve erro. Não há fila de escritas pendentes. Um corte cuja entrada não pôde ser gravada ganha a entrada na conferência seguinte (5.5); o resultado de uma publicação tem a garantia própria de `architecture.md`, 13.6 (`record_pending`).

**Arquivo ausente.** A pasta é **adotada** na primeira listagem do perfil dela (ativos ou arquivados):

| Situação | O arquivo criado |
|---|---|
| Este computador já tem job para a pasta (o casamento por caminho de hoje) | `video_id = job_id`; `downloaded_at = Job.created_at`; `downloaded_at_origin = "job"`. `source.kind` é `"upload"` quando `youtube_url` começa com `[Local`, senão `"youtube"`. Para `"upload"`: `keep: true`, `keep_reason: "upload"`. |
| Não tem job | Vale a regra de hoje: o job é criado pelo caminho (`videos.py:86-94`) e a pasta é adotada em seguida, com `downloaded_at` = agora e `downloaded_at_origin = "migration"`. Como o job nasce com `youtube_url` `"[Local Video] <nome>"`, vale `source.kind = "upload"` e `keep: true`. |

Logo depois da adoção vem a conferência de cortes (5.5): cada `shorts/*.mp4` que já estava no disco ganha entrada em `shorts[]`, com `watermark: null` e `publications: []`. **É isso que deixa os cortes de hoje publicáveis** na fase 5.

Enquanto a pasta não foi adotada (o perfil dela ainda não foi listado), o vídeo **não entra na limpeza**: sem arquivo de informações, nunca vence (12.4, item 1).

**Arquivo ilegível** (vazio, JSON cortado, sem os campos obrigatórios, `video_id` fora do formato). Vale 5.3 inteiro:

- nunca é sobrescrito, renomeado nem apagado sozinho; não conta como ausente; nunca faz nascer um job;
- se este computador já tem job para a pasta: o vídeo aparece com `info_unreadable: true` ("Informações ilegíveis"), **não entra na limpeza**, não aceita publicação, "manter" nem exceção. Saída com clique: "Recriar as informações" (`POST /videos/:job_id/info/recreate`);
- se não tem job: nenhum é criado. A pasta fica entre as **não reconhecidas** (motivo `info_unreadable`, o único que existe em modo local), contada em `GET /storage`. Saída com clique: "Adicionar ao app" (`POST /storage/folders/adopt`), que renomeia o arquivo para `video.info.json.corrupt-<data>` e adota como "não tem job". **Sem espera de 10 minutos**: `unrecognized_folders_ready` é sempre igual a `unrecognized_folders`.

**Arquivo de versão mais nova** (`schema_version` maior que 1): o app lê o que entende e não grava; o vídeo não entra na limpeza.

**Conferência do `video_id`.** Vale a regra de 5.3 e D43: só `^[0-9a-f]{32}$` chega a `create_job`, e `data/jobs/<video_id>` é conferido como filho direto de `paths.jobs_dir()` antes da primeira escrita. O arquivo está no disco do usuário e pode ter sido copiado ou editado.

**Original que não está no disco.** `source_missing` (o app apagou: `source.deleted_at` preenchido) e `source_absent` (não está lá e o app não apagou) continuam sendo dois estados. Em um computador, `source_absent` quer dizer que o arquivo foi apagado ou movido por fora do app. A limpeza continua sem dar esse vídeo como acabado (`architecture.md`, 12.7; D46).

### 3.8 `GET /storage` reduzida

A rota fica, com menos campos. Resposta `200`:

```json
{
  "mode": "local",
  "videos_dir": "C:\\Users\\fulano\\Downloads\\uploads",
  "local_base_dir": "C:\\Users\\fulano\\Downloads\\uploads",
  "read_only": false,
  "unrecognized_folders": 0,
  "unrecognized_folders_ready": 0,
  "warnings": [],
  "secret_store": "os"
}
```

| Campo | Valor em modo local |
|---|---|
| `mode` | Sempre `"local"`. |
| `videos_dir` | Pasta de vídeos do perfil ativo. |
| `local_base_dir` | `media.base_dir`. |
| `read_only` | Sempre `false`. |
| `unrecognized_folders`, `unrecognized_folders_ready` | Sempre iguais (3.7). Contam as pastas do perfil ativo, vistas na última listagem. |
| `warnings` | `"duplicate_profile"` e `"unreadable_profile"` (fase 3); `"data_dir_synced"` (fase 5). Nenhum outro. |
| `secret_store` | A partir da fase 3. |

Em `shared/contracts.ts` (fase 2), `StorageStatus` entra assim; os campos da spec adiada (`root_path`, `root_available`, `root_id`, `lock`, `machine`, `first_run_pending`, `pending_writes`, `conflict_files`, `leftover_tmp_*`) **não** entram:

```ts
export interface StorageStatus {
  mode: "local" | "root";          // "root" fica reservado
  videos_dir: string;
  local_base_dir: string;
  read_only: boolean;
  unrecognized_folders?: number;
  unrecognized_folders_ready?: number;
  warnings?: StorageWarning[];
  secret_store?: "os" | "memory";
}

export type StorageWarning = "data_dir_synced" | "duplicate_profile" | "unreadable_profile";
```

### 3.9 Nomes de pasta seguros

Vale o item 1 de `architecture.md`, 8.2, em toda pasta de vídeos de todo perfil:

- nome que, depois do saneamento, fica vazio, `.` ou `..`: recusado;
- nomes reservados: `_archived` e `logs` (em toda pasta de vídeos, para a regra ser uma só);
- no renomear: nome de uma entrada que já existe na pasta de vídeos do perfil e não é a pasta do próprio vídeo: recusado;
- comparações sem diferenciar maiúsculas, em qualquer sistema;
- no renomear, a rota devolve `400` "Escolha outro nome." e não move nada; a existência do destino é conferida de novo logo antes de mover; trocar só a caixa do próprio nome muda o título e não move a pasta;
- na ingestão, e para um job antigo com nome inválido gravado, o resolvedor usa o `job_id` como nome da pasta; ele nunca devolve um caminho com `.` ou `..`, nem um que aponte para `_archived` ou `logs`;
- todo caminho montado é resolvido e conferido como descendente da pasta de vídeos do perfil antes de escrever, mover ou apagar.

**Ingestão com nome que já existe** (P28). Hoje, baixar um vídeo com o mesmo título de um que já está na pasta faz o download ir para a pasta do primeiro: o arquivo novo substitui o antigo quando a extensão é a mesma, e os dois jobs passam a apontar para a mesma pasta (`backend/app/domain/ingest/service.py:414-435`; no envio de arquivo, `:499-507`). Com um arquivo de informações por pasta isso não pode continuar: uma pasta tem um vídeo só. A partir da fase 2, no download e no envio, quando a pasta de destino já existe e **não é a pasta do próprio job**, o vídeo novo vai para `<nome> (2)`, `(3)`…, e `job.video_name` recebe esse nome. É a mesma regra de colisão que `architecture.md`, 8.2 e 8.5, já descrevia. Refazer a ingestão do **mesmo** job continua usando a pasta dele.

## 4. Preferências: o que é do perfil e o que é do computador

A classificação é a de `architecture.md`, 9.1, sem nenhuma troca.

`data/settings.json`:

| Chave | Fica em |
|---|---|
| `media.base_dir` | Computador. É também a pasta de vídeos do primeiro perfil. |
| `media.download_resolution` | Perfil |
| `preferences.ask_move_on_upload` | Perfil |
| `preferences.move_uploads` | Perfil |
| `preferences.ask_delete_cut_confirm` | Perfil |
| `whisper.device` | Computador |
| `whisper.formats` | Perfil |
| `llm.model` | Computador |

Configurações de ferramenta (`backend/app/core/tool_configs.py:66-142`):

| Seção | Do perfil | Do computador |
|---|---|---|
| `whisper` | `language`, `task`, `initial_prompt` | Todo o resto (a lista de `architecture.md`, 9.1) |
| `ffmpeg` | `vertical_mode`, `burn_subtitles`, `subtitle_style`, `normalize_audio`, `trim_internal_silence` | Todo o resto |
| `llm` | `target_cut_duration_seconds`, `max_suggested_cuts`, `system_prompt`, `analysis_min_interest`, `auto_approve`, `auto_approve_min_interest` | Todo o resto |

Outros: `saved_llm_prompts.json` é do computador. As preferências de interface do navegador não mudam. Marca d'água, hashtags padrão e contas são do perfil (`profile.json`). Regras de limpeza, perfil ativo, pastas dos perfis e adiamento do aviso são do computador (`machine.json`).

### 4.1 Como funciona sem mudar as rotas

Um módulo novo, `backend/app/core/preferences_overlay.py` (fase 3), com a lista única `PORTABLE_KEYS`, que contém exatamente as chaves da coluna "Perfil" acima.

**As chaves de perfil do primeiro perfil continuam nos arquivos de hoje.** `preferences.settings` e `preferences.tool_configs` de `data/profile/profile.json` ficam **vazios para sempre**. Por isso, quem tem um perfil só não vê nenhuma diferença: os mesmos arquivos, com o mesmo conteúdo, byte a byte.

**Os outros perfis guardam as suas chaves de perfil no próprio `profile.json`**, em `preferences.settings` e `preferences.tool_configs`, preenchidas na criação (3.4).

| Operação | Perfil ativo é o primeiro | Perfil ativo é outro |
|---|---|---|
| Leitura (`load_settings`, `load_active_tool_configs`) | Como hoje. | Monta o valor como hoje e sobrepõe as chaves de perfil com o que está no `profile.json` do perfil ativo. Chave ausente no perfil: vale o valor dos arquivos de hoje. |
| Escrita (`POST /config/settings`, `POST /config/tool-configs`, `/import`) | Como hoje. | Separa o que chegou: as chaves de perfil vão para o `profile.json` do perfil ativo e **não** tocam os arquivos de `data/`; as outras seguem o caminho de hoje. |
| Restauração (`/config/settings/reset`, `/config/tool-configs/reset`, `/reset/:section`) | Como hoje. | As chaves de perfil recebem o **valor padrão, gravado no perfil** (não são removidas: removidas, voltariam a valer as do primeiro perfil). As outras seguem o caminho de hoje. |

- As respostas têm o formato de sempre: `AppSettings` para `/config/settings`; `{ "source", "defaults", "active" }` para `/config/tool-configs`, com `active` já sobreposto, e `source` e `defaults` calculados como hoje. O frontend atual não percebe a diferença.
- `AppSettings` não muda em `shared/contracts.ts`. Nenhum arquivo de `data/` ganha chave nova.
- A configuração lida durante um processamento é a do perfil dono do vídeo, porque a troca de perfil é recusada com algo em processamento (3.4).
- `media.base_dir` continua sendo gravado por `POST /config/settings` com qualquer perfil ativo, com a única recusa nova de 3.5.
- O cache de `load_settings` e o de configurações de ferramenta são descartados ao trocar de perfil e ao gravar no perfil.

## 5. Telas: o que troca de texto

Vale `ui.md`, com estas trocas. Texto que não está aqui fica como está.

**Perfis (`ui.md`, 5.1; fase 3)**

- "Novo perfil" está sempre disponível. O campo em linha passa a ter duas partes: "Nome do perfil" e, abaixo, "Pasta dos vídeos" (`FolderField`, criado nesta fase), com a linha de ajuda `text-sm text-text-2`: "Cada perfil guarda os vídeos numa pasta própria. Se você não escolher, o app cria <pasta sugerida>." Sem sugestão (`default_videos_parent` nulo), a linha diz só a primeira frase e "Criar" espera a pasta.
- Cada `PickTile` de "TODOS OS PERFIS" ganha uma terceira linha, em mono `text-xs text-text-3`: o caminho da pasta de vídeos.
- Menu ⋮ de cada perfil: "Renomear", "Trocar pasta…" e "Remover". No primeiro perfil não há "Remover", e "Trocar pasta…" abre a seção de Aplicação que já tem o campo de pasta (`AppFoldersSection`).

| Estado | O que aparece |
|---|---|
| Pasta recusada (`invalid_videos_dir`) | Linha `text-sm text-danger` sob o campo, conforme `reason` (tabela abaixo). |
| Pasta não encontrada (`videos_dir_available: false`) | Na `PickTile`, selo `bg-warning-bg text-warning text-xs rounded-pill px-2`: "Pasta não encontrada". Com esse perfil ativo, a lista de vídeos fica vazia e o aviso do topo diz: "A pasta deste perfil não está disponível. Verifique se o disco está conectado." |
| "Trocar pasta…" | Confirmação presa ao botão: "O app passa a mostrar os vídeos da pasta nova. Os vídeos da pasta atual ficam onde estão; nada é movido nem apagado." / "Cancelar" / "Trocar". |
| Remover perfil | "Remover o perfil <nome>?" / "Os vídeos deste perfil continuam em <pasta>. O app só deixa de mostrá-los. As contas ligadas a ele serão desconectadas." / "Cancelar" / "Remover". |
| Remover ou trocar pasta com algo em processamento | Aviso de erro do topo: "Espere o processamento terminar." |

As linhas "Modo local" e "Remover perfil com vídeos" da tabela de `ui.md`, 5.1, deixam de existir. As outras ficam.

| `reason` | Texto |
|---|---|
| `required` | "Escolha uma pasta para os vídeos deste perfil." |
| `not_found` | "Não encontramos esta pasta." |
| `too_broad` | "Escolha uma pasta só para os vídeos, não o disco inteiro nem uma pasta geral, como a sua pasta de usuário, Documentos ou Downloads." |
| `inside_app` | "Escolha uma pasta fora da pasta do aplicativo." |
| `contains_app` | "Escolha uma pasta que não contenha o aplicativo." |
| `overlaps_profile` | "Esta pasta já é usada por outro perfil, ou fica dentro da pasta de outro perfil. Escolha uma pasta separada." |
| `not_writable` | "Não dá para gravar nesta pasta." |

**Pasta (`ui.md`, 6.1; fase 2, completada nas fases 4 e 5)**

A seção `StorageFolderSection` fica com:

- Bloco "PASTA DOS SEUS VÍDEOS": um cartão com o título "Neste computador" e o caminho de `videos_dir` em mono. Sem botão.
- Cartão "Pastas não reconhecidas", quando `unrecognized_folders > 0`: título "N pastas não reconhecidas", descrição "São pastas de vídeo com informações que não puderam ser lidas.", botão "Adicionar ao app" sempre habilitado. Confirmação presa ao botão: "Adicionar como vídeos novos? O histórico de publicações dessas pastas não vem junto. O arquivo antigo fica guardado na pasta." / "Cancelar" / "Adicionar".
- Bloco "ESPAÇO USADO": entra na fase 4, como em `ui.md`, 6.1.
- Avisos de `warnings`, no topo da seção, com a faixa de `ui.md`, 6.1:

  | `warnings` | Fase | Texto |
  |---|---|---|
  | `duplicate_profile` | 3 | "Há duas pastas com o mesmo perfil. O app está usando a primeira." |
  | `unreadable_profile` | 3 | "Um perfil não pôde ser lido." |
  | `data_dir_synced` | 5 | "A pasta do aplicativo parece sincronizada. Mova o aplicativo para uma pasta só deste computador. Até lá, um envio interrompido recomeça do início." |

**Vídeo sem original e corte sem arquivo (`ui.md`, 11; fase 2)**

| Campo | Sob o título | No palco |
|---|---|---|
| `source_missing` | Como em `ui.md`. | Como em `ui.md`. |
| `source_absent` | "Arquivo não encontrado" | "O arquivo do vídeo não está mais nesta pasta. Os cortes continuam aqui." Sem "Baixar de novo". |
| `info_unreadable` | "Informações ilegíveis" | Faixa de aviso: "Não foi possível ler as informações deste vídeo." com o link "Recriar as informações" (a confirmação é a de `ui.md`). |

Corte `missing`: `title` "Arquivo não encontrado".

**Limpeza (`ui.md`, 6.2 e 8; fase 4).** No histórico, os tipos são só "Original", "Corte" e "Informações do vídeo", e não há coluna de computador. Na lista de confirmação, o perfil de cada item aparece quando há mais de um perfil.

**Publicar (`ui.md`, 13.2 e 13.4; fase 5).** O envio parado aparece como "Envio interrompido" (sem nome de computador) com "Liberar"; a confirmação é a de `ui.md`.

## 6. Plano de fases depois da emenda

A ordem passa a ser fixa: 1 → 2 → 3 → 4 → 5 → 6. Cada fase depende das anteriores.

| Fase | Entrega | Arquivo | Depende de |
|---|---|---|---|
| 1 | Marca d'água (**não muda**) | [phases/phase-1.md](./phases/phase-1.md) | P7, P17, P21 |
| 2 | **Base local:** arquivo de informações por vídeo, adoção da biblioteca atual, nomes de pasta seguros, rotas que apagam só neste computador, canal de eventos | [phases/phase-2-local.md](./phases/phase-2-local.md) | 1, P22, P28 |
| — | Pasta sincronizada entre computadores (**adiada, não implementar**) | [phases/phase-2.md](./phases/phase-2.md) | — |
| 3 | Perfis e contas (sem login ainda), neste computador | [phases/phase-3.md](./phases/phase-3.md) | 2, P1, P16, P24, P25, P26, P27 |
| 4 | Limpeza e notificação | [phases/phase-4.md](./phases/phase-4.md) | 2, 3, P2, P3, P4, P10, P11, P12 |
| 5 | Publicação no YouTube | [phases/phase-5.md](./phases/phase-5.md) | 2, 3, 4, P8, P13, P18, P19 |
| 6 | Publicação no TikTok | [phases/phase-6.md](./phases/phase-6.md) | 5, P14, P23 |

Para as fases 3 a 6, o arquivo da fase continua sendo o roteiro de quem implementa. Cada um tem, no topo, a seção "Em modo local (vale esta seção)", que diz o que troca na lista de arquivos e nos testes. Os cartões abaixo são o resumo; a lista item por item está no arquivo da fase.

### 6.1 Fase 2 — Base local

- **Objetivo.** Entregar só o que as fases 3 a 6 precisam: um arquivo de informações ao lado de cada vídeo (data de download, "manter", exceção de tamanho, cortes e onde foram publicados), a adoção dos vídeos e cortes que já existem, nomes de pasta seguros (a correção do defeito `.`/`..` e do renomear para dentro de outra pasta), as rotas que apagam aceitando só chamadas deste computador, e o canal de eventos do app.
- **Depende de.** Fase 1. P22 e P28.
- **Entregas de backend.** Módulo de `machine.json`; `video.info.json` (modelo, função `update`, ilegível nunca sobrescrito, `info/recreate`); criação no fim do download e do envio; entrada em `shorts[]` no fim da renderização e `deleted_at` ao apagar um corte; conferência de cortes com o disco; reconciliação e adoção (regras locais); pastas não reconhecidas e `POST /storage/folders/adopt`; `source_missing`, `source_absent`, `info_unreadable` em `VideoRecord`; `GET /videos/:job_id/info`; resolvedor com os nomes seguros de 3.9 e a regra de colisão na ingestão; `require_local_ui` nas quatro rotas de P22; `POST /config/select-folder` esperando fora do laço de eventos; seletor nativo (opcional, O3); `GET /storage` reduzida; `GET /events` (só o canal).
- **Entregas de frontend.** Os estados de vídeo sem original e de corte sem arquivo; "Recriar as informações"; a entrada "Armazenamento e limpeza" → "Pasta" reduzida (seção 5); `api/storage.ts` e `hooks/useStorage.ts`.
- **Vale como está.** `architecture.md`: 5.1 a 5.5 (com 3.7 daqui), 8.1, 8.2 (itens 1 e 3), 8.3 (linhas locais), 8.6, 14.1 (formato do fluxo), 14.2 e 15. `api-contracts.md`: seção 1; da seção 3, `POST /storage/folders/adopt`, `GET /videos/:job_id/info`, `POST /videos/:job_id/info/recreate`, "Seletor de pasta", "Rotas existentes que passam a ser locais" e "Campos acrescentados a rotas existentes"; `GET /events` da seção 5. `ui.md`: 0, 3, 11 (com a seção 5 daqui), 15 e 16.
- **Muda.** `GET /storage` (3.8); sem espera de 10 minutos; colisão de nome na ingestão (3.9); `GET /events` e `machine_state.py` passam a nascer aqui.
- **Fica de fora.** Tudo de 2.1 a 2.3 marcado como adiado; vários perfis e sobreposição de preferências (fase 3); limpeza (fase 4); publicação (fase 5).
- **Testes.** Arquivo de informações (criação, cortes, ilegível com e sem job, `video_id` adulterado, conferência, escritores ao mesmo tempo); adoção com e sem job; nome `..`; nome de pasta que já existe; colisão na ingestão; "uma pasta, um job"; as quatro rotas locais; seletor que demora; canal de eventos; regressão.
- **Critério de pronto.** `pytest` verde; build do frontend; capturas; os arquivos-sentinela dos testes de nome sobrevivem; revisão sem ressalva na seção B.

### 6.2 Fase 2 original — Pasta sincronizada entre computadores

**Adiada. Não implementar.** O texto continua em [phases/phase-2.md](./phases/phase-2.md), como foi escrito.

### 6.3 Fase 3 — Perfis e contas, neste computador

- **Objetivo.** Vários perfis em `data/`, cada um com nome, preferências, marca d'água, pasta de vídeos e lista de contas. A estrutura de contas fica pronta e testada com uma plataforma falsa.
- **Depende de.** Fases 1 e 2. P1, P16, P24, P25, P26 e P27.
- **Entregas de backend.** Perfis como em 3.4 (descobrir, criar, renomear, ativar, remover); pasta de vídeos por perfil com a validação de 3.5; resolvedor por perfil e `profile_id` nos jobs (3.6); sobreposição de preferências (seção 4); rotas de marca d'água aceitando qualquer perfil; e, como no arquivo da fase, cofre de segredos, `PlatformProvider`, sessão de login, contas, estado de conexão, credenciais de aplicativo, `redact()` e `GET /platforms`.
- **Entregas de frontend.** Como no arquivo da fase, mais `FolderField` e os textos da seção 5.
- **Vale como está.** `architecture.md`: 4.2, 4.4 (três primeiros itens), 9.1, 10 (menos os passos 1 a 3 de 10.4), 13.7 e 14.2. `api-contracts.md`: seções 1 e 4, com as trocas de 3.4 e 3.5. `ui.md`: 0, 5 (com a seção 5 daqui), 14, 15 e 16.
- **Muda.** Onde os perfis ficam; `can_create` sempre `true`; pasta por perfil; remover não exige perfil vazio e não toca a pasta de vídeos; a sobreposição de preferências passa a ser desta fase; `FolderField` nasce aqui.
- **Fica de fora.** `perfis/` na raiz; fusão de `profile.json`; "máquina B"; registro `profile_file`; qualquer chamada a YouTube ou TikTok; mover vídeos entre perfis.
- **Testes.** Perfis (criação, validação da pasta, remoção sem tocar na pasta, primeiro perfil, pasta indisponível, resolvedor que não cai para outro perfil); sobreposição; contas e segredos como no arquivo da fase, sem os casos de segundo computador e de fusão.
- **Critério de pronto.** Como no arquivo da fase, mais: com um perfil só, os arquivos de `data/` ficam byte a byte como antes; a árvore da pasta de vídeos é idêntica antes e depois de remover um perfil.

### 6.4 Fase 4 — Limpeza e notificação

- **Objetivo.** O mesmo do arquivo da fase, sobre as pastas de vídeos de todos os perfis deste computador.
- **Depende de.** Fases 2 e 3. P2, P3, P4, P10, P11 e P12.
- **Entregas de backend.** Como no arquivo da fase, com: regras só em `machine.json`; varredura das pastas de todos os perfis disponíveis; registro em `data/cleanup.log.jsonl` (o módulo `deletion_log.py` nasce aqui); **uma** exclusão fora da pasta de vídeos (`release_local_job_state`); evento `cleanup.summary` no canal que já existe.
- **Entregas de frontend.** Como no arquivo da fase, mais `NoticePill` e `AppNotices`, que passam a nascer aqui.
- **Vale como está.** `architecture.md`: 12.1 a 12.11 (menos o que 2.1 marca como adiado) e 14.1. `api-contracts.md`: seções 1 e 5. `ui.md`: 0, 6.2, 7, 8, 9, 10, 11, 15 e 16.
- **Muda.** `scope` sempre `"local"`; `synced_folder_warning` sempre `false`; o caminho no registro é relativo à pasta de vídeos do perfil do item; "em uso por publicação" olha só a fila deste computador.
- **Fica de fora.** Regras em `yts-root.json`; somente leitura; registro por computador; a exceção 2; avisos de pasta sincronizada.
- **Testes.** Os do arquivo da fase, sem os de trava, de registro por computador, de `audio_16k.wav` em `data/jobs/` e de registro `in_progress` de outra máquina; mais um teste com dois perfis.
- **Critério de pronto.** Como no arquivo da fase.

### 6.5 Fase 5 — Publicação no YouTube

- **Objetivo.** O mesmo do arquivo da fase. O registro de onde cada corte foi publicado impede publicar duas vezes **neste computador**.
- **Depende de.** Fases 2, 3 e 4. P8, P13, P18 e P19.
- **Entregas.** Como no arquivo da fase, sem a perda da trava, sem o aviso `credentials_file_in_root` e sem o registro parado de outra máquina. O aviso `data_dir_synced` fica.
- **Vale como está.** `platforms.md`: 1, 2, 3 e 6. `architecture.md`: 10, 13 (menos o que 2.1 marca como adiado) e 14. `api-contracts.md`: seções 1 e 6. `ui.md`: 0, 5.2 a 5.4, 7.2, 13.1 a 13.4, 15 e 16.
- **Muda.** Registro parado é só o desta máquina sem envio na fila; `paused_reason` é só `"restart"`; `machine_id` e `machine_name` gravados `null`.
- **Fica de fora.** Tudo o que depende de trava, fusão ou segundo computador.
- **Testes.** Os do arquivo da fase, sem os de "máquina B", de trava perdida, de fusão e de somente leitura.
- **Critério de pronto.** Como no arquivo da fase.

### 6.6 Fase 6 — Publicação no TikTok

- **Objetivo, portão, entregas, testes e critério de pronto.** Como no arquivo da fase. Nada da fase depende da pasta sincronizada.
- **Depende de.** Fase 5. P14 e P23. O portão.
- **Vale como está.** O arquivo da fase inteiro; `platforms.md`: 1, 4, 5 e 6.
- **Muda.** Nada.
- **Fica de fora.** Só o item de validação manual com dois computadores.

## 7. Regras do README em modo local

As treze "Regras para quem implementa" do [README](./README.md) continuam valendo. Estas mudam de leitura:

**Regra 1.** Não existe raiz. O que vale é: **com um perfil só e nada ligado, só muda o que está nesta lista.** Todo teste de fase inclui esse caso.

- `data/profile/` existe (fase 1). `data/machine.json` passa a existir na primeira gravação (fases 3 a 5).
- Cada pasta de vídeo ganha um `video.info.json` (fase 2).
- Renomear um vídeo para um nome que vira `.`, `..` ou vazio, para `_archived` ou `logs`, ou para o nome de uma pasta que já existe é recusado; na ingestão, um título que vira um desses nomes usa o `job_id` como pasta (fase 2).
- Baixar ou enviar um vídeo cujo nome de pasta já existe cria `<nome> (2)` em vez de gravar por cima do outro (fase 2; P28).
- Uma pasta cujo `video.info.json` existe, não pode ser lido e que este computador ainda não conhecia não vira vídeo sozinha: aparece em Configurações → Pasta como "não reconhecida" (fase 2).
- Quatro rotas existentes recusam chamadas de fora do computador (fase 2; P22).

O diálogo "Onde guardar seus vídeos?" **não existe**. Qualquer outro efeito é erro.

**Regra 3.** Em modo local **não existe nenhuma exclusão sem clique**. As exclusões com clique são: a limpeza; a imagem da marca d'água; os arquivos de um perfil removido (nunca os vídeos dele); a foto de uma conta.

**Regra 4.** A limpeza só apaga dentro das pastas de vídeos dos perfis. É permitida **uma** exclusão fora delas: `data/jobs/<job_id>/`, por `release_local_job_state`.

**Regra 5.** Onde diz "nunca toca a raiz", leia "nunca toca `profile.json` nem `video.info.json`".

**Regra 6.** `profile.json` e `video.info.json` nunca guardam caminho absoluto. As pastas dos perfis ficam só em `machine.json`. Nenhum caminho é montado a partir de campo lido desses arquivos; o único identificador lido de arquivo que vira nome de pasta é o `video_id`, depois de conferido.

**Regra 7.** Toda escrita de `.json` é atômica. `video.info.json` só é escrito pela função `update` de 3.7.

**Regra 13.** Um arquivo de informações ilegível nunca faz nascer um job. Uma pasta tem um job só. Renomear nunca move uma pasta para dentro de outra. A limpeza só dá um vídeo como acabado pelo que o arquivo de informações diz.

## 8. Perguntas para o dono

### 8.1 Perguntas que deixam de existir (adiadas junto com a pasta sincronizada)

| # | Pergunta | Por que sai |
|---|---|---|
| P5 | Avisar que apagar numa pasta sincronizada apaga em todos os computadores? | Não há pasta sincronizada. |
| P6 | Dois computadores na mesma pasta: basta uma trava? | Não há trava. |
| P9 | Uma pasta só para vídeos e preferências? | Não há raiz. Preferências ficam em `data/`; vídeos, na pasta de cada perfil. |
| P15 | O que acontece com os vídeos ao escolher a pasta pela primeira vez? | Não há migração. Os vídeos ficam onde estão. |
| P20 | A pergunta "Onde guardar seus vídeos?" aparece para todo mundo? | O diálogo não existe. |

### 8.2 Perguntas que continuam, com o mesmo padrão

P1, P2, P3, P4, P7, P8, P11, P12, P13, P14, P16, P17, P19, P21 e P23 não mudam.

Três continuam com outra leitura:

| # | Pergunta, relida | Padrão |
|---|---|---|
| P10 | O limite de tamanho vale para cada perfil ou para a soma das pastas de todos os perfis? | **A soma.** Atenção: com as pastas em discos diferentes, a soma não corresponde ao espaço de um disco só. |
| P18 | Nome e foto da conta podem ficar gravados neste computador, em `data/`? | **Sim**, atualizados a cada login e apagados ao remover a conta. |
| P22 | As rotas antigas que apagam e a que abre o seletor de pasta podem recusar chamadas de outro aparelho ou de outro site? | **Sim, a partir da fase 2.** O risco não depende de sincronização: hoje um site aberto no navegador pode mandar excluir um vídeo. |

### 8.3 Perguntas novas

| # | Pergunta | Padrão assumido | Bloqueia |
|---|---|---|---|
| P24 | Remover um perfil que ainda tem vídeos: pode? | **Pode. Os vídeos ficam na pasta, intactos;** o app só deixa de mostrá-los. Criar depois um perfil na mesma pasta traz todos de volta. Se a resposta for "não", remover passa a exigir a pasta vazia, e o usuário teria de apagar os vídeos antes. | Fase 3 |
| P25 | O primeiro perfil (o de hoje) pode ser removido? | **Não.** Pode ser renomeado. A pasta dele é a pasta de vídeos de hoje, e as preferências dele são as dos arquivos de hoje; por isso ele sempre existe. | Fase 3 |
| P26 | Ao criar um perfil, o app sugere e cria a pasta de vídeos se o usuário não escolher? | **Sim:** uma pasta com o nome do perfil, ao lado da pasta de vídeos atual. O usuário pode trocar antes de criar. Se "não", escolher a pasta passa a ser obrigatório. | Fase 3 |
| P27 | Dá para apontar um perfil para outra pasta depois de criado? | **Sim, sem mover nada:** os vídeos da pasta antiga ficam nela e deixam de aparecer. É o que já acontece hoje ao trocar a pasta em Configurações. | Fase 3 |
| P28 | Baixar um vídeo com o mesmo título de um que já existe passa a criar a pasta `<título> (2)`? | **Sim.** Hoje o segundo vídeo vai para a pasta do primeiro e pode substituir o arquivo dele. Se "não", a fase 2 precisa de outra regra antes de começar, porque uma pasta só pode ter um arquivo de informações. | Fase 2 |

## 9. O que foi mantido para a pasta sincronizada poder voltar

- `video.info.json` e `profile.json` têm o mesmo nome e os mesmos campos da spec original; os campos de revisão, de máquina e de fusão existem, reservados.
- Remoções continuam sendo datas (`deleted_at`, `removed_at`, `abandoned`), não ausências.
- Nenhum desses arquivos guarda caminho absoluto.
- O resolvedor de caminhos é o único lugar que responde "onde fica".
- Os documentos originais não foram alterados além de uma nota no topo.
