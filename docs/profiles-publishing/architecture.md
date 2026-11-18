# Arquitetura — dados e disco

> **Leia antes: [local-first.md](./local-first.md) ("Emenda: só neste computador").**
>
> Por decisão do dono (D49), a pasta sincronizada entre computadores está **adiada**. Este documento continua como foi escrito, mas para as fases 2 a 6 a emenda vence onde houver diferença. A fase 1 (seção 11, e o bloco `watermark` de 4.2) **não muda**.
>
> **Seções adiadas, que não devem ser implementadas:** 2 (a árvore RAIZ e as regras da raiz) e 2.1; 3.3; 4.1; 6 (6.1 a 6.4, menos a ideia de uma função `update` com trava por arquivo); 7; o item 2 de 8.2 e "Comprimento do caminho no Windows"; as linhas "modo raiz" de 8.3; 8.4; 8.5; 9.2 (substituída); os passos 1 a 3 de 10.4; a exceção 2 de 12.7 e "um arquivo por computador" de 12.8; o que depende de trava, de fusão ou de outra máquina em 12 e 13; os eventos `storage.status` e `migration.progress` de 14.1.
>
> **Valem com trocas descritas na emenda:** 1, 3.1, 3.2, 4.2 a 4.4, 5, 8.2 (itens 1 e 3), 8.3 (linhas locais), 12 e 13. **Valem como estão:** 8.1, 8.6, 9.1, 10 (o resto), 11, 14.2 e 15. A lista completa, seção por seção, está em `local-first.md`, 2.1.

Descreve onde cada coisa fica, em que formato e quem pode escrever. As rotas estão em [api-contracts.md](./api-contracts.md); as telas, em [ui.md](./ui.md).

Toda afirmação sobre o código atual cita o arquivo. Os números de linha são os do mapeamento de 18/11/2026; confira antes de editar.

## 1. Vocabulário

| Termo | Significado |
|---|---|
| **Raiz** | A pasta que o usuário escolhe. Costuma estar num disco sincronizado. Tudo o que viaja entre computadores fica nela. |
| **Modo local** | Nenhuma raiz escolhida. O app funciona como hoje. |
| **Modo raiz** | Há uma raiz escolhida e disponível. |
| **Perfil** | Um conjunto de preferências, uma marca d'água, uma pasta de vídeos e zero ou mais contas. |
| **Perfil local** | O único perfil que existe em modo local. Fica em `data/profile/`. |
| **Conta** | Um canal do YouTube ou uma conta do TikTok ligada a um perfil. Identificada pelo ID fixo da plataforma. |
| **Máquina** | Um computador. Tem um identificador próprio, gerado na primeira execução. |
| **Pasta de vídeos** | Em modo raiz, a pasta `videos/` de cada perfil. Em modo local, `media.base_dir`. |
| **Original** | O vídeo de origem (`video.<ext>`). |
| **Corte** | Um `.mp4` vertical já renderizado, dentro de `shorts/`. |
| **Arquivo de informações** | `video.info.json`, ao lado de cada vídeo. |
| **Publicação** | O envio de um corte para uma conta. |

## 2. O que fica onde

```
RAIZ (escolhida pelo usuário; viaja entre computadores)
│
├─ yts-root.json              marca a pasta como raiz; regras de limpeza (formato em 2.1)
├─ yts-lock.json              trava de "um por vez"
├─ limpeza/
│  └─ <machine_id>.jsonl      registro do que foi apagado; um arquivo por computador (12.8)
└─ perfis/
   └─ <pasta-do-perfil>/
      ├─ profile.json         nome, contas (sem token), preferências
      ├─ marca-dagua/
      │  └─ watermark.png
      ├─ contas/
      │  └─ <account_id>.jpg  foto da conta
      └─ videos/
         ├─ <video_name>/
         │  ├─ video.<ext>        o original
         │  ├─ video.info.json    arquivo de informações
         │  └─ shorts/
         │     └─ MM_SS-MM_SS.mp4 os cortes
         └─ _archived/
            └─ <video_name>/…     mesmo formato


MÁQUINA (fica em cada computador; nunca é copiada para a raiz)
│
├─ data/                          (YTS_DATA_DIR; hoje <repo>/data)
│  ├─ machine.json                identidade, raiz escolhida, perfil ativo      NOVO
│  ├─ settings.json               configuração da máquina                       existente
│  ├─ custom_settings.json        idem                                          existente
│  ├─ default_configs.json        idem                                          existente
│  ├─ saved_llm_prompts.json      idem                                          existente
│  ├─ profile/                    perfil local (só em modo local)               NOVO
│  ├─ publish/queue.json          fila de publicações                           NOVO
│  ├─ cleanup.log.jsonl           registro da limpeza (só em modo local)        NOVO
│  ├─ logs/                       logs (só em modo raiz)                        NOVO
│  ├─ work/                       arquivos de trabalho (só em modo raiz)        NOVO
│  └─ jobs/<job_id>/              estado em andamento                           existente
│     ├─ job.json, source.info.json, semantic.blocks.json,
│     │  topic.segments.json, cuts.suggested.json, artefatos da análise
│     ├─ transcription.*, audio_16k.wav   (em modo raiz passam a ficar aqui)
│     └─ attempts/
│
└─ cofre do sistema operacional   logins das contas e credenciais de aplicativo NOVO
```

Regras que valem para a raiz inteira:

- Só caminhos **relativos**, com `/`. Nunca letra de disco, nunca nome de usuário.
- Nomes de arquivo e de pasta criados por esta spec são ASCII, sem acento. O mapeamento apontou risco de nomes acentuados entre sistemas (a pasta `transcrições` de hoje); em modo raiz ela deixa de existir na raiz.
- Nenhum token, código, segredo de aplicativo ou endereço de sessão de envio.
- Nenhum arquivo que mude a cada segundo (log de execução, progresso, arquivo parcial). O registro de exclusões em `limpeza/` é a única exceção: só ganha linhas quando o usuário apaga algo.
- O diretório de dados da máquina (`data/`) **nunca** fica dentro da raiz, nem a raiz dentro dele (validação em 8.4).

### 2.1 `yts-root.json`

É o arquivo que faz de uma pasta uma raiz. Criado na fase 2; a fase 4 passa a gravar o bloco `cleanup`.

```json
{
  "schema_version": 1,
  "root_id": "r_1b22c9d04e7f4a10",
  "created_at": "2026-11-18T14:00:00Z",
  "created_by": { "machine_id": "m_3f9a0c1e8b7d4f52", "machine_name": "PC-SALA" },
  "revision": 3,
  "updated_at": "2026-11-20T09:15:40Z",
  "updated_by": { "machine_id": "m_3f9a0c1e8b7d4f52", "machine_name": "PC-SALA" },
  "cleanup": { "enabled": false, "max_age_days": null, "max_size_gb": null },
  "merged_conflict_files": []
}
```

| Campo | Significado |
|---|---|
| `schema_version` | Versão do formato deste arquivo. É o que a validação compara: maior que a versão que o app conhece → `newer_version`, e a raiz não é aberta. |
| `root_id` | `r_` + 16 hex aleatórios, gerado ao criar a raiz. Nunca muda. É o que `GET /storage` devolve em `root_id`. |
| `created_at`, `created_by` | Quando e por qual máquina a raiz foi criada. Nunca mudam. |
| `revision`, `updated_at`, `updated_by` | Como nos outros arquivos da raiz (6.3). |
| `cleanup` | Regras de limpeza (12.1). Nasce desligado. |
| `merged_conflict_files` | Cópias de conflito deste arquivo já fundidas (6.4). |

**Não existe índice de perfis.** Os perfis são descobertos lendo `perfis/*/profile.json` (só as pastas diretamente dentro de `perfis/`, sem recursão). O app monta em memória o mapa `profile_id` → nome da pasta, e é desse mapa que sai todo caminho de perfil; um `profile_id` recebido numa rota nunca vira nome de pasta. Regras:

- Pasta sem `profile.json`, ou com `profile.json` ilegível, não é perfil. A ilegível aparece na tela de armazenamento como "perfil que não pôde ser lido" e não é tocada (5.3).
- Duas pastas com o mesmo `profile_id` (o usuário copiou a pasta): vale a primeira em ordem alfabética. A outra é ignorada, com aviso na tela de armazenamento. Nada é regravado nem apagado.

Fusão (6.3): `root_id`, `created_at` e `created_by` nunca são trocados; o bloco `cleanup` inteiro vem do lado que venceu a regra "demais campos".

Arquivo existente e ilegível: a pasta **não** é tratada como raiz nova. A validação devolve `invalid` com `reason: "unreadable"` e nada é escrito (5.3).

## 3. Na máquina

### 3.1 `data/machine.json`

```json
{
  "schema_version": 1,
  "machine_id": "m_3f9a0c1e8b7d4f52",
  "machine_name": "PC-SALA",
  "storage": {
    "root_path": "G:\\Meu Drive\\Cortes",
    "first_run_answered": true
  },
  "active_profile_id": "p_8f3a2c1d",
  "cleanup_local": { "enabled": false, "max_age_days": null, "max_size_gb": null },
  "cleanup_postponed_until": null
}
```

| Campo | Significado |
|---|---|
| `machine_id` | Gerado uma vez (`m_` + 16 hex aleatórios). Identifica quem escreveu na raiz. Entra em nomes de arquivo (`limpeza/<machine_id>.jsonl`, `<m8>` dos temporários), então é conferido pelo formato ao carregar; fora do formato, o arquivo é tratado como ilegível (abaixo). |
| `machine_name` | Nome do computador (hostname), para mostrar ao usuário. |
| `storage.root_path` | Caminho absoluto da raiz **nesta** máquina, ou `null` em modo local. É o único caminho absoluto novo, e fica só aqui. |
| `storage.first_run_answered` | `true` depois que o usuário respondeu ao diálogo de primeira execução. |
| `active_profile_id` | Perfil em uso nesta máquina. Cada computador pode estar num perfil diferente. |
| `cleanup_local` | Regras de limpeza quando não há raiz. Com raiz, valem as de `yts-root.json`. |
| `cleanup_postponed_until` | Até quando o aviso de limite está adiado **nesta** máquina. Ao ler, um valor maior que agora + 24 h é tratado como agora + 24 h (12.9). |

Escrita atômica com o `AtomicJsonArtifactStore` que já existe (`backend/app/infrastructure/storage/atomic_store.py:26-44`).

Se o arquivo estiver ilegível, o app **não** o sobrescreve com padrões (o que `load_settings` faz hoje com `settings.json`, `backend/app/core/settings.py:203-209`). Ele renomeia para `machine.json.corrupt-<data>`, cria um novo e trata como primeira execução. A raiz não é tocada.

### 3.2 `.gitignore`

A fase 1 acrescenta: `data/profile/`. A fase 2 acrescenta: `data/machine.json`, `data/machine.json.corrupt-*`, `data/work/`, `data/logs/`, `data/cleanup.log.jsonl`. A fase 5 acrescenta: `data/publish/`.

### 3.3 Área de trabalho local (modo raiz)

Em modo raiz, arquivo incompleto não é escrito dentro da raiz:

| Operação | Hoje | Em modo raiz |
|---|---|---|
| Download | O `yt-dlp` escreve direto em `{base_dir}/{video_name}/` (`backend/app/domain/ingest/service.py:252-488`). | Baixa em `data/work/<job_id>/download/`. Ao terminar, cria `video.info.json` na pasta do vídeo e **só depois** copia o vídeo para lá com o nome `video.<ext>.<m8>.tmp`, confere o tamanho e faz `os.replace` para `video.<ext>`. O arquivo de informações vai na frente para que a pasta nunca fique, na raiz, com vídeo e sem identidade (8.3). |
| Envio de arquivo local | Grava em `{base_dir}/{stem}/video.<ext>` (`service.py:490-590`). | Mesmo caminho do download: primeiro na área de trabalho. |
| Renderização | Usa `{video_dir}/shorts/.work_<cut_id>/` e depois `os.replace` (`backend/app/domain/rendering/rendering_service.py:306-311,408-409`). | A pasta de trabalho passa a ser `data/work/<job_id>/render/<cut_id>/`. O `.mp4` pronto entra em `shorts/` com `<nome>.mp4.<m8>.tmp` + conferência + `os.replace`. |
| Transcrição e `audio_16k.wav` | `{video_dir}/transcrições/` (`backend/app/application/job_lifecycle.py:429-447`). | `data/jobs/<job_id>/`, que já é o local de leitura alternativo (`job_lifecycle.py:432-447`). |
| Logs | `{base_dir}/logs/` (`backend/app/core/paths.py:117-151`). | `data/logs/`. |

`<m8>` são os 8 primeiros hex do `machine_id`. Assim cada computador reconhece os temporários que são dele.

Em modo local nada disso muda.

**Temporários esquecidos.** Uma queda no meio da cópia pode deixar um `video.<ext>.<m8>.tmp` ou um `shorts/<nome>.mp4.<m8>.tmp` na raiz, ou uma pasta em `data/work/<job_id>/`. O app **não** os apaga sozinho. A varredura os conta em `total_bytes` (12.3) e a tela de armazenamento mostra "N arquivos temporários esquecidos (X GB)" com o botão "Remover" (`POST /storage/leftovers/clear`, clique explícito). A rota só apaga:

- na raiz, arquivos cujo nome casa exatamente com um dos dois padrões acima, com o `<m8>` **desta** máquina, com mais de uma hora e de um vídeo que não está em processamento;
- em `data/work/`, as pastas de jobs que não estão em processamento.

Cada arquivo apagado na raiz ganha uma linha no registro (12.8), com `kind: "tmp_leftover"`.

## 4. Perfil e contas

### 4.1 Pasta do perfil

O nome da pasta é criado **uma vez**, a partir do nome do perfil: minúsculas, ASCII, espaços viram `-`, no máximo 40 caracteres; se já existir, ganha `-2`, `-3`. Renomear o perfil **não** renomeia a pasta (renomear pasta em disco sincronizado é arriscado). A identidade do perfil é o `profile_id` dentro de `profile.json`; a ligação entre `profile_id` e pasta vem da leitura de `perfis/*/profile.json` (2.1).

### 4.2 `profile.json`

```json
{
  "schema_version": 1,
  "profile_id": "p_8f3a2c1d",
  "name": "Cortes do podcast",
  "created_at": "2026-11-18T14:02:11Z",
  "revision": 12,
  "updated_at": "2026-11-20T09:15:40Z",
  "updated_by": { "machine_id": "m_3f9a0c1e8b7d4f52", "machine_name": "PC-SALA" },
  "accounts": [
    {
      "account_id": "a_51c0e7aa",
      "platform": "youtube",
      "platform_account_id": "UCxxxxxxxxxxxxxxxxxxxxxx",
      "display_name": "Podcast Tal",
      "handle": null,
      "avatar_file": "contas/a_51c0e7aa.jpg",
      "client_fingerprint": null,
      "linked_at": "2026-11-19T10:00:00Z",
      "removed_at": null,
      "profile_refreshed_at": "2026-11-20T09:15:40Z",
      "publish_defaults": { "privacy": "private", "made_for_kids": null }
    }
  ],
  "preferences": {
    "settings": {
      "media": { "download_resolution": "1080p" },
      "preferences": { "ask_move_on_upload": true, "move_uploads": true, "ask_delete_cut_confirm": true },
      "whisper": { "formats": ["json", "vtt", "txt"] }
    },
    "tool_configs": {
      "whisper": { "language": null, "task": "transcribe", "initial_prompt": null },
      "ffmpeg": { "vertical_mode": "auto_reframe", "burn_subtitles": true, "subtitle_style": "word_highlight", "normalize_audio": true, "trim_internal_silence": false },
      "llm": { "target_cut_duration_seconds": 90, "max_suggested_cuts": 12 }
    },
    "watermark": {
      "mode": "never",
      "file": null,
      "opacity": 0.7,
      "position": "top-right",
      "size_percent": 18,
      "image": null
    },
    "publish": { "default_hashtags": "" }
  },
  "merged_conflict_files": []
}
```

Os valores de `tool_configs.llm` no exemplo são ilustrativos; os reais vêm da configuração ativa no momento da migração.

`merged_conflict_files` lista as cópias de conflito de `profile.json` já fundidas (6.4).

Campos de conta:

| Campo | Significado |
|---|---|
| `account_id` | Identificador interno (`a_` + 8 hex). Usado em rotas e no registro de publicação. |
| `platform` | `"youtube"` ou `"tiktok"`. |
| `platform_account_id` | O ID fixo. YouTube: o ID do canal devolvido por `channels.list?mine=true`. TikTok: o `open_id`. |
| `display_name` | Nome para mostrar. Atualizado a cada login e, no máximo uma vez por dia, quando uma máquina logada fala com a plataforma. |
| `handle` | Nome de usuário quando a plataforma informa (TikTok: `creator_username`). Pode ser `null`. |
| `avatar_file` | `"contas/<account_id>.jpg"` ou `null`. É uma cópia da foto; as URLs de foto das plataformas vencem (a do TikTok vale 2 horas). O valor é só informativo: o código **nunca** monta um caminho a partir deste campo. Para ler, gravar ou apagar a foto, o caminho é reconstruído no servidor como `contas/<account_id>.jpg`, com o `account_id` validado pelo formato `a_` + 8 hex. Um valor diferente disso no arquivo é tratado como `null`. |
| `client_fingerprint` | Só TikTok: os 12 primeiros hex do SHA-256 da chave pública do aplicativo (`client_key`). Não é segredo. Existe porque o `open_id` é único **por aplicativo** (R-TT-10): se o usuário trocar de aplicativo, o ID muda e a conta precisa ser religada à mão. |
| `linked_at` | Quando a conta foi ligada ao perfil (ou religada, depois de removida). |
| `removed_at` | Quando a conta foi removida do perfil, ou `null`. A conta **existe** se `removed_at` é `null` ou mais antigo que `linked_at`. |
| `publish_defaults` | Última escolha do usuário para aquela conta. `made_for_kids: null` significa "ainda não respondeu" (P19). |

**Não existe campo de token, de validade de login nem de estado de conexão.** Estado de conexão é por máquina e é calculado na hora (seção 10).

Uma conta (`platform` + `platform_account_id`) pertence a **um** perfil só. Ligar a mesma conta a outro perfil devolve erro e oferece mover.

**Remover uma conta não apaga a entrada.** A fusão por união (6.3) traria a conta de volta ao encontrar uma cópia antiga do arquivo. Por isso a remoção grava `removed_at`, limpa `display_name`, `handle` e `avatar_file` (P18) e apaga a foto. Sobram só os identificadores e as datas. As rotas e as telas ignoram contas removidas. Mover uma conta para outro perfil é remover de um e ligar no outro.

O mesmo cuidado vale para o campo `preferences.watermark.file`: é informativo, e o caminho real é sempre `marca-dagua/watermark.png`, reconstruído no servidor.

### 4.3 Perfil local

Em modo local existe exatamente um perfil, em `data/profile/profile.json`, com o mesmo formato e `profile_id` `p_local`. Nele, os blocos `preferences.settings` e `preferences.tool_configs` ficam **vazios**: em modo local essas chaves continuam nos arquivos de hoje (seção 9). Só os blocos novos (`watermark`, `publish`) e a lista `accounts` são usados.

O alias `active` nas rotas (`/profiles/active/...`) resolve para o perfil ativo, que em modo local é sempre o perfil local.

### 4.4 Perfil ativo e jobs

- Cada job ganha o campo extra `profile_id` (o modelo `Job` aceita campos extras, `backend/app/models/domain.py:28-39`).
- `/videos` lista só os vídeos do perfil ativo.
- Trocar de perfil ativo é **recusado** enquanto houver algo em processamento ou publicação em andamento. Assim a configuração lida durante um processamento é sempre a do perfil dono do vídeo.
- Excluir um perfil só é permitido quando a pasta `videos/` dele está **vazia**. Vazia quer dizer: nenhuma entrada dentro de `videos/` (arquivo ou pasta, conhecida ou não), a não ser uma pasta `_archived/` também sem nenhuma entrada. Uma pasta só com cortes, um vídeo arquivado ou um arquivo desconhecido contam como "não vazia". Apagar vídeos é trabalho da limpeza ou da exclusão manual, nunca da exclusão de perfil.
- A exclusão de perfil apaga **arquivo por arquivo**, por nomes fixos reconstruídos no servidor, nesta ordem: `contas/<account_id>.jpg` de cada conta do perfil; `marca-dagua/watermark.png`; as cópias de conflito listadas em `merged_conflict_files` (com as conferências de 6.4); e, **por último**, `profile.json`. Depois tenta `rmdir` em `contas/`, `marca-dagua/`, `videos/_archived/`, `videos/` e na pasta do perfil. Sem `rmtree`. Se sobrar um arquivo desconhecido, a pasta fica (sem `profile.json`, ela deixa de ser um perfil). Se algo falhar antes do último passo, `profile.json` continua lá e o perfil continua válido. Cada arquivo apagado ganha uma linha no registro (12.8), com `kind: "profile_file"`.

## 5. Arquivo de informações por vídeo

### 5.1 Nome e lugar

`video.info.json`, dentro da pasta do vídeo, ao lado de `video.<ext>`. Existe nos dois modos (em modo local fica em `{base_dir}/{video_name}/video.info.json`).

Não confundir com `source.info.json`, que é o retrato bruto do `yt-dlp`, fica em `data/jobs/<job_id>/` e não viaja.

### 5.2 Formato

```json
{
  "schema_version": 1,
  "video_id": "2747c40e027844d9908c9aded7d493c4",
  "revision": 7,
  "updated_at": "2026-11-20T09:15:40Z",
  "updated_by": { "machine_id": "m_3f9a0c1e8b7d4f52", "machine_name": "PC-SALA" },
  "title": "Episódio 42 — conversa com Fulano",
  "source": {
    "kind": "youtube",
    "url": "https://www.youtube.com/watch?v=XXXXXXXXXXX",
    "original_file_name": null,
    "channel": "Podcast Tal",
    "duration_seconds": 3725.4,
    "file_name": "video.mp4",
    "size_bytes": 1843200000,
    "downloaded_at": "2026-11-18T14:10:03Z",
    "downloaded_at_origin": "app",
    "deleted_at": null,
    "deleted_by_rule": null
  },
  "flags": {
    "keep": false,
    "keep_reason": null,
    "size_exception": false,
    "size_exception_at": null
  },
  "shorts": [
    {
      "file": "01_05-02_30.mp4",
      "cut_id": "c_0007",
      "start": 65.0,
      "end": 150.0,
      "title": "Por que ele largou tudo",
      "description": "Fulano conta o dia em que decidiu mudar de carreira.",
      "rendered_at": "2026-11-18T16:40:12Z",
      "deleted_at": null,
      "size_bytes": 28400000,
      "watermark": true,
      "publications": [
        {
          "publication_id": "pub_9d2e41",
          "platform": "youtube",
          "account_id": "a_51c0e7aa",
          "platform_account_id": "UCxxxxxxxxxxxxxxxxxxxxxx",
          "status": "published",
          "remote_id": "abcDEF12345",
          "url": "https://www.youtube.com/shorts/abcDEF12345",
          "privacy": "private",
          "started_at": "2026-11-19T10:05:00Z",
          "finished_at": "2026-11-19T10:06:31Z",
          "machine_id": "m_3f9a0c1e8b7d4f52",
          "machine_name": "PC-SALA"
        }
      ]
    }
  ],
  "merged_conflict_files": []
}
```

| Campo | Significado |
|---|---|
| `schema_version` | Versão do formato. Ver 5.3. |
| `video_id` | Identificador do vídeo em **todos** os computadores. É o `job_id` da máquina que criou o vídeo: 32 caracteres hexadecimais minúsculos (`^[0-9a-f]{32}$`, o `uuid4().hex` que `create_job` gera). É o único campo de arquivo sincronizado que vira nome de pasta (`data/jobs/<video_id>/`), e por isso é conferido antes de qualquer uso (5.3). |
| `revision` | Sobe 1 a cada gravação. Serve para notar que outro computador escreveu (seção 6). |
| `updated_at`, `updated_by` | Quando e por qual máquina. |
| `title` | Título do vídeo de origem. |
| `source.kind` | `"youtube"` (veio de link) ou `"upload"` (veio do computador do usuário). |
| `source.url` | Link de origem. `null` para envio local. |
| `source.original_file_name` | Nome do arquivo enviado. `null` para link. |
| `source.channel` | Canal de origem, quando o `yt-dlp` informa. |
| `source.duration_seconds` | Duração. |
| `source.file_name` | Nome do arquivo do original dentro da pasta. `null` depois que o original é apagado. |
| `source.size_bytes` | Tamanho do original. Mantido depois de apagado, para o registro. |
| `source.downloaded_at` | **A data que conta para a limpeza.** UTC, com `Z`. |
| `source.downloaded_at_origin` | `"app"` (gravada no fim do download ou do envio), `"job"` (herdada de `Job.created_at` na migração) ou `"migration"` (não havia job; é a data da migração). |
| `source.deleted_at`, `source.deleted_by_rule` | Preenchidos quando a limpeza apaga o original. Regra: `"age"`, `"size"` ou `"manual"`. |
| `flags.keep` | `true` = nunca entra na limpeza. Vale para o original **e** para os cortes do vídeo. |
| `flags.keep_reason` | `"upload"` (marcado por padrão por ser envio local), `"user"` (o usuário marcou) ou `null`. |
| `flags.size_exception` | `true` = o original não conta para o limite de tamanho. |
| `shorts[].file` | Nome do arquivo em `shorts/`. É a chave do corte neste arquivo. |
| `shorts[].cut_id`, `start`, `end` | De qual corte veio. Hoje o nome do arquivo só carrega início e fim (`rendering_service.py:93-97`) e o vínculo é por inferência; aqui fica gravado. `cut_id` pode ser `null` (5.5). |
| `shorts[].title`, `description` | Título e resumo do corte no momento da renderização. É de onde a publicação tira o texto num computador que não tem o estado local. Podem ser `null` (5.5). |
| `shorts[].rendered_at` | Quando o arquivo foi gerado pela última vez. Para um corte que já existia antes desta spec, é a data de modificação do arquivo (5.5). |
| `shorts[].deleted_at` | Quando o arquivo foi apagado pelo app, ou `null`. O corte **existe** se `deleted_at` é `null` ou mais antigo que `rendered_at` (gerar de novo "ressuscita" a entrada). |
| `shorts[].watermark` | `true` ou `false`: se o arquivo foi renderizado com marca d'água. `null`: não se sabe (corte anterior a esta spec). |
| `shorts[].publications[]` | Onde o corte já foi publicado, ou está sendo. `status`: `"in_progress"`, `"published"`, `"sent_to_inbox"` ou `"abandoned"` (o envio falhou, foi cancelado ou foi liberado; ver 13.6). `machine_name` existe para a tela poder dizer em qual computador o envio começou. |
| `merged_conflict_files` | Nomes de cópias de conflito já fundidas (seção 6.4), para não fundir duas vezes. |

**Uma entrada de `shorts[]` nunca é removida do arquivo.** A fusão por união (6.3) a traria de volta, e junto com ela se perderia o registro de onde o corte foi publicado. Apagar um corte (pela limpeza ou por `DELETE /jobs/:id/renders/:file`) grava `deleted_at`. As listas e as telas ignoram entradas apagadas; o histórico de publicação fica.

### 5.3 Versão e arquivo ilegível

- Campo desconhecido é **preservado** ao regravar. Um app mais antigo não apaga o que um mais novo escreveu.
- `schema_version` maior que a conhecida: o app lê o que entende e **não grava** naquele arquivo. A tela mostra "Este vídeo foi alterado por uma versão mais nova do app."
- Mudança incompatível sobe a versão e vem com conversor. A versão 1 não tem conversor.

**Arquivo que existe e não pode ser lido** (vazio, JSON cortado, baixado pela metade pela sincronização, sem os campos obrigatórios). Vale para `video.info.json`, `profile.json` e `yts-root.json`:

- **Nunca é sobrescrito, renomeado nem apagado sozinho.** Pode ser só a sincronização no meio do caminho; o app tenta ler de novo a cada varredura.
- **Não conta como "arquivo ausente".** A adoção (8.3) só acontece quando o arquivo **não existe**. Tratar o ilegível como ausente regravaria o arquivo com identificador novo e data de hoje, e apagaria a marca "manter" e o registro de publicações.
- **Nunca faz nascer um job.** Se esta máquina já tem um job para aquela pasta, o vídeo aparece na lista com `info_unreadable: true` e o aviso "Não foi possível ler as informações deste vídeo." Ele não entra na limpeza, não aceita publicação e não aceita "manter" nem exceção, até o arquivo voltar a ser lido. Se a máquina ainda não tem job para a pasta, nenhum é criado: a pasta fica entre as **não reconhecidas** (8.3) até o arquivo poder ser lido.
- Saída com clique, se o problema não passar: "Recriar as informações" (`POST /videos/:job_id/info/recreate`, com confirmação) para o vídeo que já tem job, ou "Adicionar ao app" para a pasta não reconhecida (8.3). Nos dois casos o arquivo ilegível é **renomeado** para `video.info.json.corrupt-<data>` (não apagado) e só então a pasta é adotada. A tela avisa que o histórico de publicações daquele vídeo não vem junto.
- O mesmo vale na execução da limpeza (12.7): arquivo de informações ilegível ou de versão mais nova → o item é pulado, nada é apagado.

**Identificador lido de arquivo sincronizado não é confiável.** Outro computador, uma versão antiga do app ou um conflito de sincronização podem ter escrito qualquer coisa ali. Cada identificador é conferido pelo formato **antes** de qualquer uso, e fora do formato o arquivo inteiro é tratado como ilegível (as regras acima):

| Campo | Formato aceito | Fora do formato |
|---|---|---|
| `video_id` (`video.info.json`) | `^[0-9a-f]{32}$` | O arquivo conta como ilegível (`info_unreadable`). O valor **nunca** é usado para criar um job nem para montar um caminho. |
| `profile_id` (`profile.json`) | `p_` + 8 hex (`p_local` só existe no perfil local, em `data/profile/`, que não é sincronizado) | O perfil conta como ilegível (`unreadable_profile`). Já não vira nome de pasta (2.1). |
| `root_id` (`yts-root.json`) | `r_` + 16 hex | A raiz conta como ilegível (`unreadable`). |
| `account_id` (`profile.json`) | `a_` + 8 hex | A conta é ignorada (4.2). |
| `publication_id` (`video.info.json`) | `pub_` + hex | O registro é preservado no arquivo e ignorado pelas rotas. |
| `machine_id` (em `updated_by`, na trava, no registro) | — | É só exibido e comparado como texto. Nunca vira parte de caminho. |

Só o `video_id` vira nome de pasta (`data/jobs/<video_id>/`, pelo `create_job` da reconciliação, 8.3). Hoje `create_job`, `save_job` e `job_dir` não conferem o id (`job_lifecycle.py:229-263`, `core/paths.py:65-76`): um `video_id` como `..\..\x` faria o app gravar `job.json` fora de `data/jobs/`, e o `DELETE /videos/:job_id` que já existe faria `rmtree` ali. Por isso:

- A reconciliação só chama `create_job(job_id=video_id)` depois da conferência de formato. Como segunda barreira, o caminho `data/jobs/<video_id>` é resolvido e conferido como **filho direto** de `paths.jobs_dir()` antes da primeira escrita.
- Exceção para ids antigos: um `video_id` fora do formato de 32 hex só é aceito quando **esta máquina já tem** um job com exatamente esse id (comparação de texto com os ids de `list_jobs()`, sem montar caminho) e o valor passa em `_validate_safe_segment` (`job_lifecycle.py:91`). É o caso de um job antigo, criado à mão ou por teste, cuja pasta foi adotada aqui. Um id assim **nunca** cria job em outro computador: lá o arquivo conta como ilegível.

### 5.4 Quem escreve e quando

| Momento | O que muda |
|---|---|
| Fim do download ou do envio local | Cria o arquivo. `downloaded_at` = agora. Envio local: `keep: true`, `keep_reason: "upload"`. Em modo raiz, o arquivo é criado **antes** de o vídeo ser copiado para a pasta (3.3). |
| Primeira listagem de um vídeo antigo, sem arquivo | Cria por adoção (seção 8.3). Em modo raiz, só para uma pasta que esta máquina já conhecia; as outras esperam um clique. |
| Listagem (fora de somente leitura) | Conferência de `shorts[]` com o disco (5.5). |
| Fim da renderização de um corte | Acrescenta a entrada em `shorts[]`, ou atualiza a que já existe (`rendered_at` novo; as `publications` ficam). |
| Exclusão de um corte | `deleted_at` na entrada. |
| Usuário marca ou desmarca "manter", abre exceção | `flags`. |
| Limpeza apaga o original | `source.deleted_at`, `deleted_by_rule`, `file_name: null`. |
| Publicação começa, termina, falha, é liberada | `shorts[].publications[]`. |
| Renomear o vídeo | `title`. |

### 5.5 Conferência de `shorts[]` com o disco

Entradas em `shorts[]` nascem no fim de uma renderização. Sem mais nada, todo corte gerado **antes** desta spec ficaria sem entrada: não poderia ser publicado (13.3) nem apareceria como "ainda não publicado". Por isso, a cada listagem de um vídeo (e logo depois da adoção e da migração), o app confere `shorts[]` contra os arquivos de `shorts/*.mp4`. Em somente leitura a conferência é feita só em memória, sem gravar.

| Situação | O que o app faz |
|---|---|
| Existe `shorts/<nome>.mp4` sem entrada | Cria a entrada. `start` e `end` saem do nome `MM_SS-MM_SS` (o formato de `rendering_service.py:93-97`); se o nome não segue o formato, ficam `0`. `cut_id`, `title` e `description` vêm de `cuts.suggested.json` do job local quando há um corte com o mesmo início e fim (tolerância de 1 s); senão, `null`. `rendered_at` é a data de modificação do arquivo. `size_bytes` é o tamanho real. `watermark: null`. `publications: []`. |
| Existe entrada com `deleted_at` e o arquivo voltou a existir | Trata como gerado de novo: `rendered_at` = data de modificação do arquivo. |
| Existe entrada viva e o arquivo **não está** no disco | **Não mexe no arquivo de informações.** Num disco sincronizado, o `.mp4` pode simplesmente não ter chegado ainda. Em memória, a entrada fica marcada como `missing`: aparece na tela com "Arquivo ainda não disponível", não pode ser publicada e não entra na limpeza. |
| Arquivo `.tmp` ou com outra extensão em `shorts/` | Ignorado (temporários esquecidos: 3.3). |

Um corte apagado pelo usuário no explorador de arquivos fica como `missing` para sempre. É um limite conhecido; a alternativa (apagar a entrada) perderia registros de publicação quando o arquivo só estava atrasado.

## 6. Escrita na raiz

### 6.1 O problema

`atomic_write_bytes` escreve `<nome>.<uuid>.tmp` na mesma pasta, faz `fsync` e `os.replace` (`atomic_store.py:26-44`), sem nova tentativa. Num disco sincronizado, o programa de sincronização pode estar com o arquivo aberto e o `os.replace` falhar com `PermissionError`; e o `.tmp` pode ser enviado para a nuvem. O comportamento exato de cada programa de sincronização **não foi verificado** e está em [manual-validation.md](./manual-validation.md).

### 6.2 Função de escrita para a raiz

Um módulo novo, `backend/app/infrastructure/storage/synced_store.py`, usado para **todo** JSON dentro da raiz. A interface é uma só: `update(caminho, mudar)`, onde `mudar` é uma função que recebe o conteúdo **relido do disco naquele instante** e devolve o novo. Ninguém grava um JSON da raiz por outro caminho, e ninguém grava um objeto inteiro montado a partir de uma leitura antiga. Toda `mudar` precisa poder ser aplicada de novo sobre um conteúdo mais recente sem estragar nada ("acrescente este corte", "marque `keep`", "ponha `deleted_at`", "troque o estado desta publicação").

**Uma trava por arquivo, dentro do processo.** O mesmo `video.info.json` é escrito por vários lados ao mesmo tempo: dois cortes terminando juntos no `RenderWorkerPool`, o trabalhador de publicação, `PUT /videos/:id/flags`, a conferência de cortes. Sem trava, dois deles leem o mesmo conteúdo, cada um grava a sua versão e um apaga a mudança do outro, inclusive um registro de publicação. Por isso `update` segura um `threading.Lock` indexado pelo caminho resolvido durante **todo** o ciclo abaixo. O dicionário de travas é do processo; não há trava entre computadores (para isso existem a seção 7 e a fusão).

Com a trava do arquivo na mão:

1. Lê o arquivo atual do disco. Não existe → é uma criação, e `mudar` recebe vazio. Existe e está ilegível, ou é de versão mais nova → erro, nada é escrito (5.3).
2. Aplica `mudar` ao que leu e soma 1 à `revision`.
3. Escreve um temporário de **nome único** na mesma pasta, `<nome>.<m8>.<6 hex aleatórios>.tmp` (`<m8>` = 8 primeiros hex do `machine_id`), com `fsync`. Dois escritores nunca compartilham o mesmo temporário.
4. `os.replace`. Se der `PermissionError` ou `OSError` de arquivo em uso, espera e tenta de novo: 5 tentativas, 0,1 s, 0,2 s, 0,4 s, 0,8 s, 1,6 s.
5. Relê o arquivo. Se o JSON é o que foi escrito: pronto. Se **não é** (a sincronização trocou o arquivo no meio, com a versão de outro computador): volta ao passo 1 e **aplica `mudar` de novo** sobre o conteúdo que está lá agora. Assim a mudança desta máquina não se perde e a do outro computador também não. No máximo 3 voltas; depois disso vale o passo 6.
6. Se falhar: o arquivo antigo fica como estava, o temporário é apagado, a operação devolve erro e a mudança (a função `mudar`, não um conteúdo pronto) entra numa lista de **escritas pendentes** em memória, reaplicada a cada 30 s e ao sair. A tela mostra "Não foi possível salvar na pasta agora. Tentando de novo…". O resultado de uma publicação tem uma garantia a mais: fica também no disco da máquina (13.6).

**Temporários de JSON esquecidos.** Ao abrir a raiz, o app apaga temporários de JSON que ele mesmo deixou para trás. É a **única exclusão sem clique** desta spec, e o alcance é fechado:

- Só nestes lugares, sem recursão além deles e sem seguir link simbólico nem junção: a própria raiz (`yts-root.json.*.tmp`, `yts-lock.json.*.tmp`); `perfis/*/` (`profile.json.*.tmp`); `perfis/*/videos/*/` e `perfis/*/videos/_archived/*/` (`video.info.json.*.tmp`).
- Só nomes no formato exato do passo 3, com o `<m8>` **desta** máquina. O temporário de outro computador pode estar sendo gravado agora; ele nunca é tocado.
- Só com mais de uma hora, e só arquivo comum.

Qualquer outro `.tmp` (de outro programa, de outro computador, em outra pasta, com outro nome) fica onde está. Há teste para isso: um `outro.json.tmp` antigo dentro da raiz sobrevive.

Em modo "somente leitura" (seção 7) a função recusa escrever, com uma exceção: as **escritas de conclusão** descritas na seção 7.

### 6.3 Revisão e fusão

Cada `video.info.json`, `profile.json` e `yts-root.json` tem `revision`.

Dentro de um computador não há o que fundir: a trava por arquivo e a interface `update` de 6.2 garantem que cada mudança é aplicada sobre o conteúdo mais recente. A **fusão** existe para o caso que a trava não alcança: **duas versões inteiras do mesmo arquivo**, escritas por computadores diferentes sem um ver o outro. Isso chega ao app como uma cópia de conflito criada pelo programa de sincronização (6.4). O app funde a cópia no arquivo oficial e grava com `max(as duas revisões) + 1`.

Se um programa de sincronização, em vez de criar a cópia, simplesmente descarta uma das versões, a mudança daquela versão se perde e o app não tem como saber. Como cada programa se comporta **não foi verificado** ([manual-validation.md](./manual-validation.md)). O que mais importa não depender disso é o registro de publicação, que por isso é guardado também no disco da máquina que publicou (13.6).

Regras de fusão, campo a campo:

| Campo | Regra |
|---|---|
| `shorts[]` | União pela chave `file`. Dentro da mesma entrada: `rendered_at` = o mais recente dos dois; `deleted_at` = o mais recente dos dois (preenchido vence `null`). A entrada existe se `deleted_at` é `null` ou mais antigo que `rendered_at`. Os outros campos da entrada vêm do lado com `rendered_at` mais recente. |
| `shorts[].publications[]` | União por `publication_id`. Entre duas entradas com o mesmo id: `published`/`sent_to_inbox` vence `abandoned`, que vence `in_progress`. **Um registro de publicação nunca é perdido.** |
| `source.deleted_at` | Preenchido vence `null`. |
| `flags.keep` | `true` vence `false` (na dúvida, proteger). |
| `flags.size_exception` | `true` vence. |
| `accounts[]` (perfil) | União por `platform` + `platform_account_id`. Dentro da mesma conta: `linked_at` = o mais recente; `removed_at` = o mais recente (preenchido vence `null`). A conta existe se `removed_at` é `null` ou mais antigo que `linked_at`. |
| `merged_conflict_files` | União. |
| `root_id`, `created_at`, `created_by`, `video_id`, `profile_id` | Nunca mudam. Vale o do arquivo oficial. |
| Demais campos | Vence o lado com `revision` **maior**. Empate: o `updated_at` mais recente. Empate de novo: o maior `machine_id` (só para o resultado ser sempre o mesmo). |

Por que as remoções são datas e não ausências: uma união nunca "desune". Se apagar um corte ou remover uma conta tirasse a entrada do arquivo, ela voltaria na primeira fusão com uma cópia antiga. Com `deleted_at`, `removed_at` e `abandoned`, a remoção é um dado que a fusão carrega.

`revision` vem antes de `updated_at` no desempate porque `updated_at` depende do relógio de cada computador, que pode estar errado.

### 6.4 Cópias de conflito

Programas de sincronização criam cópias quando dois computadores mudam o mesmo arquivo. O nome dessas cópias varia e **não foi verificado**. A regra é genérica:

| Arquivo oficial | É cópia de conflito todo arquivo, **na mesma pasta**, cujo nome… |
|---|---|
| `video.info.json` | começa com `video.info`, termina com `.json` e não é `video.info.json` |
| `profile.json` | começa com `profile`, termina com `.json` e não é `profile.json` |
| `yts-root.json` | começa com `yts-root`, termina com `.json` e não é `yts-root.json` |

- O app lê a cópia, funde no arquivo oficial pelas regras de 6.3 e anota o nome em `merged_conflict_files` do arquivo oficial. Cópia ilegível não é fundida nem anotada.
- **Não apaga a cópia.** A tela de armazenamento mostra "N arquivos de conflito já resolvidos" com um botão "Remover arquivos de conflito" (`POST /storage/conflicts/clear`, clique explícito).

`merged_conflict_files` é lido de um arquivo sincronizado, que outro computador, uma versão antiga do app ou a própria sincronização podem ter escrito. **O valor não é confiável como caminho.** Antes de apagar cada nome, e de novo no instante do `unlink`, a rota confere:

1. É um nome simples: sem `/`, sem `\`, sem `..`, sem caractere nulo.
2. Casa com o padrão da tabela acima para o arquivo oficial daquela pasta.
3. É **diferente** do nome do arquivo oficial.
4. O caminho resolvido fica diretamente dentro da mesma pasta do arquivo oficial.
5. É um arquivo comum (não é link simbólico, junção nem pasta).

Falhou em qualquer conferência: o nome é ignorado e nada é apagado. Cada cópia apagada ganha uma linha no registro (12.8), com `kind: "conflict_copy"`.

**Trava e registro.** Cópias de conflito de `yts-lock.json` (nome que começa com `yts-lock`, termina com `.json` e não é o oficial) nunca são lidas nem fundidas: a trava que vale é a do arquivo oficial. Elas contam direto como "já resolvidas" e saem pelo mesmo botão, com as conferências 1 a 5. O registro de exclusões não gera conflito entre computadores, porque cada máquina só escreve no próprio arquivo (12.8).

## 7. Trava de "um por vez"

`yts-lock.json`, na raiz:

```json
{
  "schema_version": 1,
  "machine_id": "m_3f9a0c1e8b7d4f52",
  "machine_name": "PC-SALA",
  "acquired_at": "2026-11-20T09:00:00Z",
  "heartbeat_at": "2026-11-20T09:15:00Z"
}
```

| Situação ao abrir a raiz | O que o app faz |
|---|---|
| Não há trava | Cria a trava e passa a ser o dono. |
| A trava é desta máquina | Renova. |
| A trava é de outra máquina e `heartbeat_at` tem menos de 10 minutos | Abre em **somente leitura**. Oferece "Usar neste computador". |
| A trava é de outra máquina e `heartbeat_at` tem mais de 10 minutos | Abre em **somente leitura** do mesmo jeito, com `lock.stale: true`. A tela pergunta: "O outro computador parece parado. Usar aqui?" |

**A trava nunca muda de dono sozinha.** Um `heartbeat_at` parado não prova que o outro computador parou: basta a sincronização **deste** computador estar pausada para o valor não mudar. Se o app tomasse a trava sozinho nesse caso, o outro computador, que está trabalhando, cairia em somente leitura no meio de um envio. Por isso a troca de dono é sempre um clique ("Usar neste computador" ou "Usar aqui"), com confirmação.

- O dono renova `heartbeat_at` a cada 60 segundos e apaga a trava ao fechar o app. O `yts-lock.json` é gravado com temporário de nome único e novas tentativas (passos 3 e 4 de 6.2), sem revisão nem fusão.
- A cada 60 segundos o dono também **relê** a trava. Se ela passou a ser de outra máquina (alguém clicou em "Usar neste computador"), ele entra em somente leitura e avisa.
- Os relógios dos dois computadores podem estar diferentes. Por isso a comparação de 10 minutos só vale na abertura; depois disso, quem está em somente leitura marca `lock.stale` quando o **valor** de `heartbeat_at` fica 10 minutos sem mudar, medido no próprio relógio.
- A trava de uma máquina que fechou à força (queda de energia, tampa do notebook) fica no disco. No mesmo computador, ela é só renovada na próxima abertura. Em outro computador, pede o clique.

**Somente leitura** significa: nenhuma operação **nova** escreve na raiz. Dá para ver vídeos, assistir cortes e ler preferências. Não dá para baixar, renderizar, apagar, publicar nem mudar preferência de perfil. As rotas que escreveriam devolvem `409` com `code: "storage_read_only"`.

**O que já estava em andamento quando a trava mudou de dono.** Derrubar na hora perderia trabalho e, pior, perderia o registro de um envio que já chegou à plataforma. A regra:

| Em andamento | O que acontece |
|---|---|
| Download, envio de arquivo local, renderização | **Terminam.** A entrega final na raiz (copiar o arquivo pronto e atualizar `video.info.json`) é uma **escrita de conclusão** e é permitida mesmo em somente leitura. Ela só acrescenta arquivo novo e atualiza o arquivo de informações por `update` (6.2), então não desfaz nada do outro computador. Etapas seguintes do mesmo fluxo (por exemplo, a renderização depois do download num "um clique") **não começam**. |
| Publicação `queued` (ainda não mandou nenhum byte) | Vai para `paused`, com o motivo "a pasta passou a ser usada em outro computador". Volta com "Retomar" quando esta máquina for dona de novo. |
| Publicação `uploading`, `processing` ou `unconfirmed` | **Termina.** Gravar o resultado no arquivo de informações é escrita de conclusão. Se nem assim der para gravar, o resultado fica guardado em `data/publish/queue.json` e é gravado depois (13.6). |
| Execução da limpeza | Os itens que faltam são pulados (o teste 5 de 12.4 é refeito por item). |
| Migração | Para, como num cancelamento. |

Escrita de conclusão é uma lista fechada no código (`synced_store`): fim de download, fim de envio local, fim de renderização, resultado de publicação. Nenhuma rota chamada pelo usuário em somente leitura entra nela.

A trava é um **aviso**, não uma garantia: a sincronização leva segundos ou minutos (tempo real não verificado) e dois computadores podem achar que são o dono ao mesmo tempo. O que segura esse caso é a escrita de 6.2 (cada mudança é aplicada sobre o que está no disco) e a fusão de 6.3 (quando a sincronização entrega duas versões).

## 8. Encaixe com o armazenamento atual

### 8.1 Como é hoje

| Coisa | Onde | Fonte |
|---|---|---|
| Pasta base dos vídeos | `media.base_dir`; padrão `~/Downloads/uploads` | `backend/app/core/settings.py:54-60` |
| Pasta de um vídeo | `{base_dir}/{video_name saneado}/` | `settings.py:244-253` |
| Original | `{video_dir}/video.<ext>` | `settings.py:256-264` |
| Transcrição | `{video_dir}/transcrições/` | `settings.py:267-277` |
| Cortes | `{video_dir}/shorts/` | `settings.py:280-290` |
| Arquivados | `{base_dir}/_archived/{video_name}/` | `settings.py:293-309` |
| Estado do job | `data/jobs/<job_id>/` | `backend/app/core/paths.py:61-92` |
| Tentativas arquivadas | `data/jobs/<job_id>/attempts/<attempt_id>/` | `job_lifecycle.py:745-792` |
| Logs | `{base_dir}/logs/` | `paths.py:117-151` |
| Caminho do original no job | `job.source_video_path`, **absoluto** | `ingest/service.py:441,542`; `videos.py:193`; `job_lifecycle.py:726` |

### 8.2 Resolvedor de caminhos

Um módulo novo, `backend/app/core/storage_layout.py`, passa a ser o único lugar que responde "onde fica":

| Função | Modo local | Modo raiz |
|---|---|---|
| `videos_dir(profile)` | `media.base_dir` | `<RAIZ>/perfis/<pasta>/videos` |
| `transcription_dir(job)` | `{video_dir}/transcrições/` | `data/jobs/<job_id>/` |
| `render_work_dir(job, cut)` | `{video_dir}/shorts/.work_<cut_id>/` | `data/work/<job_id>/render/<cut_id>/` |
| `download_work_dir(job)` | a própria pasta do vídeo | `data/work/<job_id>/download/` |
| `logs_dir()` | `{base_dir}/logs` | `data/logs` |
| `profile_dir(profile)` | `data/profile` | `<RAIZ>/perfis/<pasta>` |
| `cleanup_log_path()` | `data/cleanup.log.jsonl` | `<RAIZ>/limpeza/<machine_id>.jsonl` |

As funções de `settings.py:244-309` e `paths.py:117-151` passam a pedir a pasta base ao resolvedor em vez de ler `media.base_dir` direto. Em modo local o resultado é **byte a byte** o de hoje, com a única exceção do item 1 abaixo.

**Nome da pasta do vídeo.** Hoje `get_video_folder` (`settings.py:244-246`) só troca os caracteres `<>:"/\|?*` e corta em 200. Um `video_name` igual a `..` passa. Ele pode vir de `POST /jobs/:id/rename`, que move a pasta para `get_video_dir` (`job_lifecycle.py:707-728`). Com `..`, `get_video_dir` aponta para a pasta **de cima**, e `DELETE /videos/:id` (`videos.py:217-222`) faz `rmtree` nela: em modo local some a pasta acima de `base_dir`; em modo raiz some `perfis/<pasta>/` inteiro, em todos os computadores. O resolvedor passa a validar cada parte de caminho que monta:

1. **Nos dois modos**, um nome de pasta é recusado quando, depois do saneamento (e, em modo raiz, dos ajustes do item 2):
   - fica vazio, `.` ou `..`;
   - é um nome que o app reserva dentro da pasta de vídeos: `_archived` (a pasta dos arquivados, `settings.py:293-306`) e, em modo local, `logs` (`paths.py:122`);
   - **só no renomear:** já existe, na pasta de vídeos, uma entrada com esse nome que não é a pasta do próprio vídeo (a pasta de outro vídeo, ou qualquer outra pasta ou arquivo).

   Todas as comparações de nome são feitas **sem diferenciar maiúsculas de minúsculas, em qualquer sistema**: `Logs` é `logs`, e duas pastas que só diferem na caixa seriam uma só no Windows e no macOS de outro computador.

   No renomear, a rota devolve `400` "Escolha outro nome." e não move nada. Na ingestão, onde não há a quem perguntar, e para um job antigo que já tenha um nome vazio, `.`, `..` ou reservado gravado, o resolvedor usa o `job_id` como nome da pasta; ele nunca devolve um caminho com `.` ou `..`, nem um que aponte para `_archived` ou `logs`. Estas recusas são a única mudança, em modo local, no comportamento de algo que já existia, e são a correção de um defeito que apaga dados (seção 15).

   **Renomear nunca move uma pasta para dentro de outra.** Hoje `rename_video` faz `shutil.move(old_dir, new_dir)` (`job_lifecycle.py:715-720`), e quando `new_dir` já existe o `shutil.move` põe a pasta **dentro** dela. Renomear para o nome de outro vídeo, para `_archived` ou para `logs` deixa dois jobs na mesma pasta, ou faz da pasta do job a própria `_archived`; o `DELETE /videos/:id` que já existe faz então `rmtree` no outro vídeo ou em todos os arquivados, e em modo raiz isso se espalha pela sincronização. Por isso, além da recusa acima: a existência do destino é conferida de novo **imediatamente antes** de mover, e se ele existe nada é movido. Se o nome novo dá na **mesma** pasta de hoje (igual, ou só com a caixa diferente), a pasta não é movida: muda só o título.
2. **Só em modo raiz**, por causa do Windows e da sincronização entre sistemas, o saneamento do nome da pasta faz mais três ajustes (o nome mostrado ao usuário, `job.video_name`, não muda):
   - corta em **80** caracteres (em vez de 200);
   - tira ponto e espaço do fim;
   - põe `_` na frente de nome reservado do Windows (`CON`, `PRN`, `AUX`, `NUL`, `COM1` a `COM9`, `LPT1` a `LPT9`, com ou sem extensão).
   
   Depois dos ajustes vale o item 1. Na **ingestão**, dois vídeos cujo nome fica igual depois do corte em 80 caem na regra de colisão de sempre (a pasta já existe com outro `video_id` → sufixo ` (2)`, como na migração, 8.5). No **renomear** não há sufixo automático: vale a recusa do item 1.
3. Todo caminho montado é resolvido e conferido como descendente da pasta de vídeos do perfil antes de ser usado para escrever, mover ou apagar.

**Comprimento do caminho no Windows.** Em modo raiz o caminho ganha `perfis/<até 40>/videos/` na frente. O pior caso é `<RAIZ>\perfis\<40>\videos\_archived\<80>\shorts\<17>.mp4.<m8>.tmp`, que soma 184 caracteres depois da raiz. Para caber em 259, a raiz pode ter no máximo **75** caracteres. A validação da raiz confere isso no Windows (8.4). Se o FFmpeg e o programa de sincronização aguentam caminhos mais longos **não foi verificado** ([manual-validation.md](./manual-validation.md)); por isso o limite é conferido, não só recomendado.

O perfil usado é o do job (`job.profile_id`), não o ativo, para que um job endereçado pelo id ache o vídeo certo.

`job.source_video_path` continua existindo e continua absoluto, porque `job.json` é estado da máquina. Em modo raiz ele é **recalculado** a cada listagem a partir do resolvedor; deixa de ser a chave de reconciliação.

### 8.3 Reconciliação pasta ↔ job

`_list_videos_from_dir` (`videos.py:71-110`) ganha um passo antes do casamento por caminho.

Nesta seção, **"job que esta máquina já tem para a pasta"** é um job que já estava em `data/jobs/` antes desta varredura e cujo `source_video_path` aponta para dentro daquela pasta (o casamento por caminho de hoje). É o sinal de que o vídeo foi criado, baixado ou já reconhecido **neste** computador.

1. A pasta tem `video.info.json`?
   - **Sim, dá para ler e o `video_id` tem formato válido (5.3).** Usa `video_id`. Se existe job local com esse id, usa-o e corrige `source_video_path` e `profile_id` se mudaram. Se não existe, cria o job **com esse id** (`create_job` já aceita `job_id`, `job_lifecycle.py:229-241`; a reconciliação passa esse id, depois das conferências de 5.3), `status = DOWNLOADED`, `created_at = source.downloaded_at`, `youtube_url = source.url` (ou `"[Local Upload] <nome>"`, o formato de hoje, `ingest/service.py:539`), `profile_id` do perfil.
   - **Sim, mas está ilegível** (inclui `video_id` fora do formato). O arquivo **não** é tocado, a pasta **não** é adotada e o `video_id` que estiver lá **não** é usado para nada (5.3). Se esta máquina já tem job para a pasta, o vídeo aparece com esse job e com `info_unreadable: true`. Se não tem, **nenhum job é criado**, nos dois modos: a pasta fica entre as não reconhecidas (abaixo) e é lida de novo a cada varredura. Criar um job pelo caminho aqui deixaria dois jobs na mesma pasta quando o arquivo voltasse a ser lido (o do caminho e o do `video_id`), e o `DELETE /videos` do job velho faria `rmtree` na pasta do vídeo.
   - **Não existe.** Depende de a máquina já conhecer a pasta:

     | Situação | O que o app faz |
     |---|---|
     | Esta máquina já tem job para a pasta (qualquer modo) | **Adota:** cria `video.info.json` com `video_id = job_id`, `downloaded_at = Job.created_at` e `downloaded_at_origin = "job"`. `source.kind` é `"upload"` quando `youtube_url` começa com `[Local`, senão `"youtube"`. Para `"upload"`, `keep: true`. |
     | Não tem job, **modo local** | Vale a regra de hoje: cria o job pelo caminho e adota em seguida, com a data de agora e `downloaded_at_origin = "migration"`. |
     | Não tem job, **modo raiz** | **Nada é criado e nada é gravado.** A pasta fica entre as não reconhecidas (abaixo). |

     Logo depois de uma adoção vem a conferência de cortes (5.5), que cria as entradas de `shorts[]` para os `.mp4` que já estavam na pasta.

     Por que o modo raiz não adota sozinho: num segundo computador, o `video.<ext>` (ou os cortes) pode chegar pela sincronização **antes** do `video.info.json` verdadeiro. Adotar nessa hora criaria um arquivo de informações com `video_id` novo, data de hoje e origem adivinhada, que depois disputaria com o verdadeiro no programa de sincronização. Se a cópia adotada vencesse (o comportamento da sincronização não foi verificado), a marca "manter" e o histórico de publicações se perderiam, e o vídeo poderia entrar na limpeza por tamanho.
2. Pasta com `video.info.json` e **sem** arquivo de vídeo continua aparecendo. Hoje `_collect_video_files` só lista pastas com arquivo de vídeo direto dentro (`videos.py:34-64`); a listagem passa a aceitar também esse caso. Há duas situações, e a falta do arquivo **sozinha** não diz qual é:

   | `source.deleted_at` | Significado | Campo aditivo | Na tela |
   |---|---|---|---|
   | Preenchido | O app apagou o original (limpeza). | `source_missing: true` | "Original apagado". Oferece "Baixar de novo" se a origem é um link. |
   | `null` | O arquivo não está no disco, mas ninguém o apagou pelo app. Num disco sincronizado, o `video.info.json` (pequeno) costuma chegar antes do vídeo (grande). | `source_absent: true` | "O vídeo ainda não chegou a esta pasta." **Sem** "Baixar de novo": baixar agora criaria uma segunda cópia e, quando a primeira chegasse, uma cópia de conflito de vários GB. |

3. Duas pastas com o mesmo `video_id`. Fica com o id (e com o job) a pasta para onde o job local daquele id **já aponta**, se for uma das duas; senão, a primeira em ordem alfabética. Para a outra:

   | Modo | O que o app faz |
   |---|---|
   | Local | O usuário copiou a pasta. Ela recebe um id novo e tem o arquivo regravado, como um vídeo à parte. |
   | Raiz | **Nada é regravado sozinho.** Um renomear feito em outro computador pode mostrar os dois nomes de pasta ao mesmo tempo enquanto a sincronização não termina; trocar o id nessa hora mudaria a identidade do vídeo em todos os computadores e deixaria o estado de `data/jobs/` órfão. A outra pasta fica entre as não reconhecidas (abaixo) e, se era só a sincronização, some da lista sozinha. |

4. **Uma pasta, um job.** Quando uma pasta é reconhecida pelo `video_id` e existe **outro** job local, com outro id, ainda apontando para dentro dela, esse outro job é desligado da pasta: `source_video_path` e `video_name` dele passam a `null` (só o `job.json` da máquina muda; nada é apagado). Sem isso, o `DELETE /videos/:job_id` do job velho, que acha a pasta pelo nome, faria `rmtree` na pasta que agora é de outro job.

Em somente leitura a adoção não grava; o vídeo aparece sem data de download e nunca entra na limpeza.

**Pastas não reconhecidas.** São as pastas, dentro de uma pasta de vídeos, que o app não transforma em vídeo por conta própria:

| Motivo | Quando |
|---|---|
| `no_info` | Modo raiz: tem arquivo de vídeo, não tem `video.info.json` e esta máquina não tem job para ela. |
| `info_unreadable` | Qualquer modo: tem `video.info.json` ilegível e esta máquina não tem job para ela. |
| `duplicate_id` | Modo raiz: o `video_id` dela já é de outra pasta. |

- Não viram job, não aparecem em `/videos`, não entram na limpeza (12.4, item 1), não aceitam publicação e **nada é escrito nelas**. O espaço que ocupam conta em `total_bytes` (12.3).
- A lista vive só em memória, refeita a cada varredura, e guarda a hora em que esta máquina viu cada pasta pela primeira vez. Uma pasta sai da lista sozinha quando o arquivo de informações chega ou volta a ser lido.
- `GET /storage` informa `unrecognized_folders` (quantas são) e `unrecognized_folders_ready` (quantas já podem ser adicionadas). A seção Pasta das Configurações mostra o número e a explicação ([ui.md](./ui.md), 6.1).
- **Adicionar é sempre um clique** (`POST /storage/folders/adopt`, rota local, com confirmação), e só vale para a pasta que continua não reconhecida há **pelo menos 10 minutos** desde a primeira vez em que esta máquina a viu (relógio injetado nos testes; a contagem recomeça ao reabrir o app). Assim uma pasta que só estava no meio da sincronização nunca é oferecida.
- O que o clique faz, para cada pasta pronta, depois de **reler** o estado dela no disco (se o arquivo de informações chegou nesse meio tempo, vale o caminho normal do item 1):

  | Motivo | Efeito |
  |---|---|
  | `no_info` | Cria um job novo e adota a pasta: `video_id` = id do job novo, `downloaded_at` = agora, `downloaded_at_origin = "migration"`. A origem é desconhecida, então vale o lado que protege: `source.kind = "upload"`, `keep: true`, `keep_reason: "upload"`. |
  | `info_unreadable` | Renomeia o arquivo ilegível para `video.info.json.corrupt-<data>` (não apaga) e segue como em `no_info`. |
  | `duplicate_id` | Cria um job novo e regrava o `video_id` daquela pasta com o id dele, pela função de 6.2. O resto do arquivo fica. |

- Em somente leitura a rota devolve `409` `storage_read_only`.

### 8.4 Criar ou abrir uma raiz

Ao receber um caminho, o app valida (rota `POST /storage/root/validate`):

Os testes são feitos nesta ordem, sobre caminhos **resolvidos** (links e `..` desfeitos; no Windows, sem diferenciar maiúsculas). O primeiro que falha decide. Nenhum arquivo do app (`yts-root.json`, `perfis/`) é criado antes de todos passarem.

| # | Caso | Resultado (`reason`) |
|---|---|---|
| 1 | A pasta não existe | Erro (`not_found`). |
| 2 | É a raiz de um disco; a pasta do usuário (`~`) ou qualquer pasta **acima** dela (`C:\Users`, `/home`); ou uma das pastas gerais do usuário **em si**: Documentos, Área de Trabalho ou Downloads (lista abaixo). Uma subpasta delas, como `Documentos\Cortes`, é aceita. | Erro (`too_broad`). Uma raiz assim engoliria tudo o que o usuário tem: a varredura leria tudo e, num disco sincronizado, os arquivos do app se espalhariam no meio dos outros. |
| 3 | A raiz fica **dentro** do repositório (`project_root()`) ou do diretório de dados efetivo (`data_dir()`, que respeita `YTS_DATA_DIR`) | Erro (`inside_app`). |
| 4 | A raiz **contém** (ou é igual a) o repositório ou o diretório de dados efetivo | Erro (`contains_app`). É o caso de quem instala o app dentro do Drive para "abrir em outro computador", ou escolhe uma pasta alta como Documentos. Com uma raiz assim, `data/jobs/` (estado em andamento), `machine.json` e `data/publish/queue.json` (endereços de sessão de envio) seriam sincronizados, contra D4 e contra "segredo nunca na raiz". |
| 5 | A raiz é igual a `media.base_dir`, fica dentro dela ou a contém | Erro (`overlaps_local_videos`). Misturaria os vídeos de hoje com a estrutura nova e faria a migração mover pastas para dentro delas mesmas. |
| 6 | A pasta fica **dentro de outra raiz** (alguma pasta acima dela tem um arquivo `yts-root.json`, legível ou não), ou **contém** a raiz que está em uso nesta máquina | Erro (`overlaps_other_root`). Uma raiz dentro de outra poria `yts-root.json` e `perfis/` no meio da pasta de vídeos de um perfil, e as duas varreduras passariam a enxergar os arquivos uma da outra. Escolher de novo a **mesma** raiz em uso não é sobreposição: cai na linha 11. |
| 7 | No Windows, o caminho da raiz tem mais de 75 caracteres | Erro (`path_too_long`). Ver 8.2. |
| 8 | Não dá para escrever na pasta | Erro (`not_writable`). O teste grava e apaga um arquivo próprio, de nome único. |
| 9 | A pasta tem `yts-root.json` ilegível | Erro (`unreadable`). Não é tratada como raiz nova (2.1). |
| 10 | A pasta tem `yts-root.json` com `schema_version` maior que a conhecida | Erro (`newer_version`). |
| 11 | A pasta tem `yts-root.json` válido | É uma raiz existente. O app **abre**: lê perfis, tenta a trava, lista vídeos. Nada é migrado. |
| 12 | A pasta está vazia ou não tem `yts-root.json` | O app **cria** a raiz: `yts-root.json`, `perfis/`, e o primeiro perfil a partir do perfil local. |

**Pastas gerais do usuário (linha 2).** A lista é fixa, comparada com o caminho resolvido: `~/Documents`, `~/Documentos`, `~/Desktop`, `~/Área de Trabalho`, `~/Downloads` e, no Windows, as pastas `Documents`, `Desktop` e `Downloads` diretamente dentro de uma pasta apontada pelas variáveis de ambiente `OneDrive`, `OneDriveConsumer` ou `OneDriveCommercial` (é para onde o Windows costuma redirecionar essas pastas). É uma lista de nomes comuns, como a de `looks_synced`; uma pasta geral com outro nome não é detectada.

**Sobreposição com outra raiz (linha 6).** A procura por `yts-root.json` sobe pelas pastas acima da escolhida até a raiz do disco; não desce pelas subpastas (seria ler o disco inteiro). O caso "contém" só é conferido contra a raiz configurada em `machine.json`, esteja ela disponível ou não.

Avisos que não impedem (`warnings`): `not_empty` (a pasta nova já tem outros arquivos) e `looks_synced`.

**`looks_synced` é um palpite pelo nome do caminho.** Vale quando alguma parte do caminho resolvido, sem diferenciar maiúsculas, contém um destes textos: `google drive`, `googledrive`, `meu drive`, `my drive`, `drives compartilhados`, `shared drives`, `onedrive`, `dropbox`, `icloud`, `mobile documents`, `nextcloud`, `pcloud`, `megasync`, `proton drive`, `box sync`. (Nomes curtos e comuns demais, como `mega` ou `box` sozinhos, ficam de fora de propósito: marcariam pastas que não têm nada a ver.) No Windows vale também quando o caminho fica dentro de uma pasta apontada pelas variáveis de ambiente `OneDrive`, `OneDriveConsumer` ou `OneDriveCommercial`. A lista é de nomes comuns e **não foi conferida** com cada programa; uma pasta sincronizada com outro nome não é detectada, e por isso os avisos de exclusão em modo raiz dizem "se esta pasta for sincronizada" em vez de depender do palpite.

**Conferências ao iniciar, com a raiz já configurada.** A validação acima roda de novo, porque o app ou a pasta podem ter sido movidos depois:

- Os testes 3 ou 4 falhando: a raiz **não é aberta**. (Os testes 5 e 6 só importam ao escolher a pasta: depois disso `media.base_dir` não é usada em modo raiz, e a raiz em uso é a própria pasta.) O app entra no estado "pasta indisponível", `GET /storage` traz o aviso `app_overlaps_root` e a tela explica: "O aplicativo e a pasta dos vídeos não podem ficar um dentro do outro."
- O diretório de dados efetivo **parece sincronizado** (mesma regra de `looks_synced`), mesmo com a raiz em outro lugar: `GET /storage` traz o aviso `data_dir_synced`, a tela mostra "A pasta do aplicativo parece sincronizada. Mova o aplicativo para uma pasta só deste computador." e o endereço de sessão de envio **não é gravado em disco**: fica só em memória, e um envio interrompido recomeça do zero (13.1).
- (A partir da fase 5.) Um arquivo com nome `client_secret*.json` em algum dos lugares que a varredura já visita (a raiz, `perfis/*/`, as pastas de vídeo): aviso `credentials_file_in_root`, com o texto "Há um arquivo de credenciais na pasta dos vídeos. Guarde-o fora dela." O app não lê nem apaga o arquivo. O padrão do nome é conferido no passo zero da fase 5 ([platforms.md](./platforms.md), seção 3).

A raiz **nunca** é criada sozinha. Se o caminho guardado em `machine.json` não está disponível na inicialização (disco desligado, Drive fechado), o app **não** cria a pasta e **não** volta para o padrão em silêncio (o que `load_settings` faz hoje com `base_dir`, `settings.py:190-209`). Ele entra no estado "pasta indisponível", descrito em [ui.md](./ui.md), seção 2.

### 8.5 Migração dos dados existentes

Acontece uma vez, quando o usuário cria uma raiz e escolhe trazer os vídeos (P15).

1. Copiar `data/profile/` para `<RAIZ>/perfis/<pasta>/`, trocando `profile_id` por um novo e preenchendo `preferences.settings` e `preferences.tool_configs` com os valores atuais das chaves portáteis (seção 9).
2. Para cada pasta de vídeo em `media.base_dir`, e depois para cada uma em `media.base_dir/_archived`. Aqui conta como pasta de vídeo também a que só tem `video.info.json` (é o que sobra na origem quando uma migração no mesmo disco para logo antes do fim; ver o passo 5):
   1. Garantir `video.info.json` (adoção, 8.3, pela regra do modo local) e as entradas de `shorts[]` (5.5). Pasta cujo arquivo de informações existe e está ilegível **não é levada**: fica na origem, intacta, e conta em `skipped_videos`.
   2. Escolher o nome pretendido. Pasta ativa: `<RAIZ>/perfis/<pasta>/videos/<nome>/`. Pasta arquivada: `<RAIZ>/perfis/<pasta>/videos/_archived/<nome>/`. O estado de arquivado é mantido. `<nome>` é o nome da pasta de origem, ajustado pelas regras de modo raiz (8.2).
   3. Achar o destino **pelo `video_id`**, nesta ordem:
      1. **O `video_id` já está no destino?** O app lê o `video.info.json` de cada pasta de `videos/` e de `videos/_archived/` do perfil. Se alguma tem **este** `video_id`, é ela a pasta de destino, com o nome que tiver (inclusive um `<nome> (2)` de uma tentativa anterior). É a retomada de uma migração interrompida: seguir para o passo 4, pulando os arquivos que já estão lá com o mesmo tamanho. Se não falta nada, o vídeo já foi levado e conta em `skipped_videos`.
      2. **Senão**, olhar a pasta com o nome pretendido:

         | No destino | O que fazer |
         |---|---|
         | Não existe pasta com esse nome | Criar e seguir. |
         | Existe e está **vazia** (ou só com temporários de JSON desta máquina, 6.2) | Seguir, usando-a. É o que sobra de uma queda entre criar a pasta e gravar o arquivo de informações. |
         | Existe, com **outro** `video_id`, ou com arquivos e sem arquivo de informações legível | **Nunca fundir.** Usar outro nome: `<nome> (2)`, `(3)`… |

   4. Copiar o conteúdo de `transcrições/` para `data/jobs/<job_id>/`. Ele não vai para a raiz, e a migração não o apaga da origem.
   5. Levar só estes arquivos, **nesta ordem**. Nada mais é levado: `transcrições/`, pastas de trabalho e arquivos desconhecidos ficam na origem.
      1. **Primeiro, `video.info.json`.** O app grava no destino uma cópia do arquivo de informações da origem, pela função de 6.2 (é uma criação). Se o destino já tem o arquivo com o mesmo `video_id` (retomada), ele **não é sobrescrito**: o da origem é fundido nele pelas regras de 6.3, para não perder um corte gerado ou um "manter" marcado em modo local entre a interrupção e a retomada. O da origem **continua lá** até o fim.
      2. `shorts/*.mp4`.
      3. `video.<ext>`.

      Como cada arquivo é levado:
      - **Mesmo disco:** `os.replace` arquivo por arquivo (não da pasta inteira, que levaria `transcrições/` para dentro da raiz). Só depois de conferir que os cortes e o original chegaram, e que o `video.info.json` do destino existe, é legível e tem o mesmo `video_id`, o `video.info.json` da **origem** é removido. É o último passo da movimentação daquele vídeo: o conteúdo dele já está no destino.
      - **Outro disco:** copiar para `<nome do arquivo>.<m8>.tmp` no destino, conferir o tamanho e só então `os.replace` para o nome final. Um arquivo pela metade nunca aparece com o nome final, que é o que a sincronização enviaria. **A origem não é apagada**, nem o `video.info.json` dela.
   6. Atualizar `job.source_video_path` e gravar `job.profile_id`. (Se a migração parar antes deste passo, a reconciliação por `video_id` corrige os dois na primeira listagem em modo raiz, 8.3.)
   7. Mesmo disco: se a pasta de origem ficou vazia, `rmdir`. Se sobrou algo (em geral `transcrições/`), ela fica.
3. `logs/` não é migrada.
4. Gravar `storage.root_path` em `machine.json` **por último**.

**Por que o arquivo de informações vai primeiro.** É ele que diz de qual vídeo é a pasta de destino. Se fosse o último (como numa versão anterior desta spec), uma migração interrompida deixaria no destino uma pasta com cortes ou com o vídeo e **sem** identidade: na retomada ela cairia na linha "sem arquivo de informações legível", o vídeo iria para `<nome> (2)` e ficaria partido em duas pastas (mesmo disco) ou copiado duas vezes (outro disco), com a pasta órfã virando mais tarde um vídeo duplicado de vários GB. Com o arquivo na frente, o destino parcial sempre se identifica. Enquanto os arquivos não chegam, quem olhar a pasta de outro computador vê o estado certo: "O vídeo ainda não chegou" (`source_absent`, 8.3) e cortes "ainda não disponíveis" (5.5).

**Se a migração parar no meio** (erro, cancelamento, queda): o app continua em modo local e a migração pode ser retomada. A retomada acha o destino de cada vídeo pelo `video_id` gravado **na própria pasta de destino** (passo 2.3), então continua na mesma pasta: não nasce um `<nome> (2)` do mesmo vídeo, nada é copiado duas vezes e dois vídeos nunca são misturados. No mesmo disco, os vídeos que já foram levados **saíram** da pasta antiga e só voltam a aparecer quando a migração terminar; um vídeo interrompido no meio aparece na lista local sem os arquivos que já foram ("ainda não chegou"), até o "Continuar". A sessão de migração informa quantos originais já saíram da origem (`moved_videos`) e a tela diz onde eles estão, com o botão "Continuar".

Vídeo em processamento bloqueia a migração (a rota devolve `409`).

A migração roda em segundo plano, numa sessão com progresso, no mesmo padrão das sessões de instalação de dependência que já existem (`/config/dependencies/install-sessions/:sessionId`).

`media.base_dir` não é alterado.

**Voltar para o modo local** (`DELETE /storage/root`) só apaga o ponteiro em `machine.json`; nada é movido de volta e nada é apagado. Consequência que a tela precisa dizer: os vídeos que estão na raiz **continuam lá** e deixam de aparecer no app. Se a migração foi no mesmo disco, a pasta antiga está vazia (os vídeos foram movidos). Para vê-los de novo, o usuário escolhe a mesma pasta outra vez.

**Trocar de pasta** com uma raiz já em uso é **abrir outra raiz**: `POST /storage/root` com o caminho novo. Nada é levado da raiz atual para a nova, e `migrate` é ignorado (trazer vídeos só existe saindo do modo local). A pasta nova passa pela validação inteira de 8.4; em especial, ela não pode ficar dentro da raiz atual nem contê-la (linha 6, `overlaps_other_root`). Mover uma raiz de lugar é trabalho do usuário, no explorador de arquivos, com o app fechado.

### 8.6 Tentativas arquivadas

`data/jobs/<job_id>/attempts/` continua na máquina (`job_lifecycle.py:745-792`). Os `.mp4` guardados ali **não** viajam, **não** contam para o limite de tamanho e **não** entram na limpeza. É um limite conhecido desta versão.

## 9. Divisão das configurações

### 9.1 Chave por chave

`data/settings.json` (`backend/app/models/schemas.py:151-175`):

| Chave | Fica em | Observação |
|---|---|---|
| `media.base_dir` | Máquina | Caminho absoluto. |
| `media.download_resolution` | Perfil | |
| `preferences.ask_move_on_upload` | Perfil | Hoje não tem efeito no backend (D14). |
| `preferences.move_uploads` | Perfil | Idem. |
| `preferences.ask_delete_cut_confirm` | Perfil | |
| `whisper.device` | Máquina | GPU ou CPU. |
| `whisper.formats` | Perfil | |
| `llm.model` | Máquina | Depende do que está instalado. |

Configurações de ferramenta (`backend/app/core/tool_configs.py:66-142`):

| Seção | Vai para o perfil | Fica na máquina |
|---|---|---|
| `whisper` | `language`, `task`, `initial_prompt` | Todo o resto: `model`, `device`, `output_format`, `verbose`, `temperature`, `best_of`, `beam_size`, `patience`, `length_penalty`, `suppress_tokens`, `carry_initial_prompt`, `condition_on_previous_text`, `fp16`, `temperature_increment_on_fallback`, `compression_ratio_threshold`, `logprob_threshold`, `no_speech_threshold`, `word_timestamps`, `prepend_punctuations`, `append_punctuations`, `highlight_words`, `max_line_width`, `max_line_count`, `max_words_per_line`, `threads`, `clip_timestamps`, `hallucination_silence_threshold` |
| `ffmpeg` | `vertical_mode`, `burn_subtitles`, `subtitle_style`, `normalize_audio`, `trim_internal_silence` | Todo o resto: `format`, `video_codec`, `audio_codec`, `video_preset`, `video_bitrate`, `audio_bitrate`, `framerate`, `aspect_ratio`, `audio_sample_rate`, `audio_channels`, `disable_video`, `disable_audio`, `disable_subtitle`, `video_filter`, `audio_filter`, `metadata` |
| `llm` | `target_cut_duration_seconds`, `max_suggested_cuts`, `system_prompt`, `analysis_min_interest`, `auto_approve`, `auto_approve_min_interest` | Todo o resto: `model`, `provider`, `lmstudio_base_url`, `ollama_base_url`, `embedding_model`, `context_length`, `enable_boundary_lookaround`, `registered_embedding_models`, `registered_models`, `analysis_seed`, `disable_reasoning`, `analysis_pipeline`, `vision_model`, `analysis_v2` |

Outros:

| Coisa | Fica em |
|---|---|
| `data/saved_llm_prompts.json` | Máquina, nesta versão. |
| Preferências de interface no navegador (`ui.sidebarPinned`, `ui.sidebarSide`, `ui.dockCollapsed`, `ui.cutPreset`, `ui.reviewBeforeRender`) | Navegador. Não mudam. |
| Marca d'água, hashtags padrão, contas | Perfil (novos). |
| Regras de limpeza | Raiz (`yts-root.json`), ou máquina em modo local. |
| Raiz escolhida, perfil ativo, adiamento do aviso | Máquina (`machine.json`). |

Critério usado: vai para o perfil o que descreve **como o canal quer o resultado**; fica na máquina o que depende de **hardware, do que está instalado ou de caminho**.

### 9.2 Como funciona sem mudar as rotas

Uma lista única, `PORTABLE_KEYS`, num módulo novo (`backend/app/core/preferences_overlay.py`), contém exatamente as chaves da coluna "perfil" acima.

- **Leitura** (`load_settings`, `load_active_tool_configs`): monta o valor da máquina como hoje e, em modo raiz, sobrepõe as chaves portáteis com o que está em `profile.json`. Chave ausente no perfil: vale o valor da máquina.
- **Escrita** (`POST /config/settings`, `POST /config/tool-configs`, `/import`): em modo raiz, separa o que chegou. As chaves portáteis vão para `profile.json`; o resto segue o caminho de hoje.
- **Restauração** (`/config/settings/reset`, `/config/tool-configs/reset*`): em modo raiz, as chaves portáteis voltam ao padrão **no perfil**.
- **Modo local:** nenhuma separação. Tudo como hoje.
- **Somente leitura:** gravar chave portátil devolve `409` `storage_read_only`. Gravar chave de máquina funciona.

As respostas das rotas têm o mesmo formato de sempre. O frontend que existe hoje não percebe a diferença.

A renderização lê a configuração uma vez por execução (`rendering_service.py:270-276`); com a sobreposição ela recebe os valores do perfil sem mudança no código da renderização.

## 10. Credenciais

### 10.1 O que é segredo

| Segredo | Vida |
|---|---|
| Token de renovação de cada conta | Longo. Guardado. |
| Token de acesso | Curto. **Só em memória.** |
| Credenciais do aplicativo de desenvolvedor (identificador e segredo) | Longas. Guardadas. O Google diz que o segredo de aplicativo de computador não é confidencial (R-YT-6); mesmo assim é tratado como segredo. |
| Código de autorização, `state`, verificador PKCE | Minutos. **Só em memória.** |
| Endereço de sessão de envio (YouTube) e `upload_url` (TikTok) | Dão poder de enviar. Guardados **só** em `data/publish/queue.json` (máquina), nunca na raiz, em log ou em resposta de rota. Se o diretório de dados parecer sincronizado (8.4), nem ali: só em memória. |

### 10.2 Opções e escolha

| Opção | A favor | Contra |
|---|---|---|
| **Cofre do sistema, via biblioteca `keyring`** | Windows (Gerenciador de Credenciais), macOS (Chaves) e Linux (Secret Service) com um código só. O segredo é protegido pela conta do usuário. Gratuito. | Dependência nova. Em Linux sem ambiente gráfico pode não haver cofre. O Windows limita o tamanho de cada credencial (valor exato não verificado nesta spec). |
| Arquivo cifrado com a proteção de dados do Windows, chamada direto | Sem dependência. | Só Windows. Mais código sensível para manter. |
| Arquivo com permissão restrita fora do repositório | Simples. | Texto puro em disco. |
| Arquivo cifrado com senha do usuário | Portátil. | Pede senha a cada abertura; quebra o "um clique". |

**Escolha: cofre do sistema com `keyring`** (D5, P16). Para caber no limite do Windows, cada entrada guarda só o necessário, e o token de acesso nunca é guardado.

Entradas (serviço `youtube-shorts`):

| Nome da entrada | Conteúdo (JSON) |
|---|---|
| `client:youtube`, `client:tiktok` | `{ "client_id", "client_secret" }` |
| `account:<platform>:<platform_account_id>` | `{ "refresh_token", "scopes", "client_fingerprint", "obtained_at" }` |

O acesso passa por um adaptador no container, `secret_store`, com implementação falsa em memória nos testes (mesmo padrão de `folder_opener`, `backend/tests/conftest.py:67-71`).

Se não houver cofre disponível, o adaptador usa memória: o login vale até fechar o app. `GET /storage` informa `secret_store: "memory"` e a tela avisa.

**Como saber se há cofre.** A biblioteca `keyring` escolhe o backend sozinha, e alguns backends gravam em arquivo de texto (por exemplo, os do pacote `keyrings.alt`, ou o que a variável `PYTHON_KEYRING_BACKEND` apontar). Aceitar qualquer backend poderia pôr o token em texto puro no disco sem ninguém perceber. Por isso:

- O adaptador só considera `"os"` quando o backend ativo está numa **lista fixa**: o do Gerenciador de Credenciais do Windows, o das Chaves do macOS, o do Secret Service/libsecret e o do KWallet. Os nomes das classes são conferidos na versão instalada da biblioteca por quem implementa a fase 3. Qualquer outro backend (o "fail", o "null", um encadeador vazio, qualquer um de `keyrings.alt`, um desconhecido) → `"memory"`.
- A detecção faz uma gravação, uma leitura e uma remoção de uma entrada de teste. Falhou ou demorou → `"memory"`.
- Toda chamada ao cofre é bloqueante, e no Linux pode abrir um pedido de desbloqueio e ficar esperando. Nenhuma rota `async` chama o cofre direto: as chamadas vão para uma thread (`run_in_threadpool`), com tempo limite de 10 segundos. Estourou o tempo → erro "Não foi possível acessar o cofre de senhas.", e o app não fica travado.

**Renovação de token, uma por vez por conta.** O token de acesso válido fica em memória e é reutilizado por todo mundo (preparar a publicação, trabalhador da fila) até perto de vencer. A renovação segura uma trava por conta: quem chega durante uma renovação espera e usa o token novo. Sem isso, duas renovações com o mesmo token antigo podem sair ao mesmo tempo, e numa plataforma que troca o token de renovação a cada uso a segunda falha e derruba a conta para "entrar de novo" sem motivo.

O token de renovação do TikTok **muda a cada renovação** (R-TT-9). A gravação do novo valor acontece antes de o antigo ser descartado da memória; se a gravação falhar, a conta vai para "entrar de novo".

### 10.3 Estado de conexão (por máquina)

| Estado | Quando |
|---|---|
| `connected` | Há entrada no cofre e a última renovação funcionou. |
| `login_required` | Não há entrada no cofre nesta máquina (computador novo), ou a renovação foi recusada (login vencido ou revogado). |
| `client_missing` | Falta a credencial de aplicativo nesta máquina. |

### 10.4 Computador novo

1. O usuário aponta para a raiz. Perfis, contas, vídeos e cortes aparecem. Tudo dá para ver e editar.
2. Cada conta aparece como "Entrar neste computador".
3. Para publicar: informar a credencial de aplicativo (se for o caso) e entrar.
4. Depois do login, o app pergunta à plataforma qual é a conta e compara com `platform_account_id`. Igual: conectada. Diferente: o login é descartado e a tela diz "Você entrou com outra conta." O token recém-obtido é revogado, **menos** no caso abaixo.

**Cuidado ao revogar.** Se revogar um token no Google derruba só aquele token ou toda a autorização daquele login naquele aplicativo **não foi confirmado** (a página lida só diz que revogar o token de acesso revoga também o de renovação correspondente). Vários canais podem estar atrás do mesmo login (R-YT-13). O comportamento é seguro nos dois casos:

- Na reconexão com a "conta errada": se o ID devolvido é o de **outra conta já conectada nesta máquina**, o token novo é só descartado, **sem revogar**. Revogar poderia desconectar aquela outra conta em silêncio.
- Em "Sair": se há outras contas da mesma plataforma conectadas nesta máquina, a confirmação avisa que elas podem ser desconectadas junto ([ui.md](./ui.md), 5.2). Depois de sair, o app confere o estado das outras e mostra "entrar de novo" nas que caíram.
- O teste real está em [manual-validation.md](./manual-validation.md), fase 5.

**Conta com envio em andamento.** "Sair", "Remover do perfil", "Mover para outro perfil" e remover a credencial de aplicativo são recusados com `409` `busy_publishing` enquanto houver publicação daquela conta em `queued`, `uploading`, `processing`, `paused`, `needs_login` ou `unconfirmed`. O usuário cancela os envios (ou espera) e tenta de novo. Nada é cancelado por tabela.

### 10.5 Onde segredo não pode aparecer

- Nenhum arquivo dentro da raiz.
- Nenhum arquivo de `data/`, exceto o endereço de sessão de envio em `data/publish/queue.json` (e nem ali, se o diretório de dados parecer sincronizado; 8.4).
- Nenhuma linha de log. Os módulos de contas e de publicação passam toda mensagem por uma função `redact()` que troca por `***` qualquer valor conhecido de token, código, segredo ou endereço de sessão.
- Nenhum log **de biblioteca**. O `redact()` não alcança os registradores do cliente HTTP. O endereço da sessão de envio do YouTube leva um identificador na própria URL, e uma URL com segredo acabaria no log e nas mensagens de exceção. Por isso: os registradores `httpx`, `httpcore` e `urllib3` ficam no nível `WARNING` ou acima e passam por um filtro que aplica `redact()`; e segredo **nunca** vai na URL de um pedido quando há alternativa (a revogação manda o token no corpo, se a plataforma aceitar; ver [platforms.md](./platforms.md), 2.1).
- Nenhuma mensagem de erro montada com `str(exc)` de uma exceção HTTP. `error.message` de uma publicação e `detail` de uma rota vêm de uma tabela de textos fixos, escolhidos pelo tipo do erro. A exceção original só vai para o log, já passada por `redact()`.
- Nenhuma resposta de rota e nenhum evento de `GET /events`. As rotas devolvem `client_configured: true/false`, nunca o valor. `Publication` sai sem `resume`.
- Nenhum parâmetro de URL do próprio app.

## 11. Marca d'água

### 11.1 Imagem

| Item | Valor |
|---|---|
| Formatos aceitos | PNG, JPEG, WebP. |
| Recusados | GIF, SVG, imagem animada, qualquer outro. |
| Tamanho máximo do arquivo | 5 MB. |
| Dimensões | De 16 a 4096 px em cada lado. |
| Validação | Pelos primeiros bytes do arquivo (não pela extensão) e por decodificação com OpenCV (`opencv-python-headless` já é dependência, `backend/pyproject.toml`). |
| Como é guardada | Sempre regravada como PNG com transparência, em `marca-dagua/watermark.png` dentro da pasta do perfil. O arquivo enviado pelo usuário nunca é guardado como veio, e o nome original é descartado. |
| Uma por perfil | Enviar outra substitui (escrita atômica). |

### 11.2 Preferência

Bloco `preferences.watermark` de `profile.json`:

| Campo | Valores | Padrão |
|---|---|---|
| `mode` | `"always"` (todos os vídeos), `"never"` (nenhum), `"ask"` (perguntar antes de cada renderização) | `"never"` |
| `file` | Caminho relativo à pasta do perfil, ou `null` | `null` |
| `opacity` | 0,05 a 1,0. A tela mostra "Transparência" = `1 − opacity` | 0,7 |
| `position` | `top-left`, `top-center`, `top-right`, `middle-left`, `center`, `middle-right`, `bottom-left`, `bottom-center`, `bottom-right` | `top-right` |
| `size_percent` | 5 a 50: largura da caixa da marca, em % da largura do vídeo | 18 |
| `image` | `{ "width", "height", "updated_at" }` da imagem guardada, ou `null` | `null` |

Regras:

- Enviar a imagem **não muda** `mode`. Quem escolhe o modo é o usuário. Com a primeira imagem enviada e o modo ainda em `"never"`, a tela destaca o bloco "Quando usar" e diz que a marca ainda está desligada ([ui.md](./ui.md), 4). Se o envio da primeira imagem deveria já ligar a marca em todos os vídeos é a pergunta P21.
- Ao remover a imagem, `mode` volta para `"never"` e `file` para `null`.
- `mode` diferente de `"never"` sem imagem é recusado.

Posição e tamanho estão em P7. A margem é fixa: 4% da largura (44 px em 1080). Nenhuma verificação foi feita sobre que áreas a interface do YouTube ou do TikTok cobre; fica em [manual-validation.md](./manual-validation.md).

### 11.3 Decisão por renderização

A renderização ganha um campo opcional `watermark` (`true`, `false` ou ausente) em `POST /jobs/:id/render`, `POST /jobs/:id/run` e nas opções do lote.

| `watermark` no pedido | `mode` do perfil | Resultado |
|---|---|---|
| `true` | qualquer | Aplica. Sem imagem: erro `400`. |
| `false` | qualquer | Não aplica. |
| ausente | `always` | Aplica. |
| ausente | `never` | Não aplica. |
| ausente | `ask` | **Não aplica**, e registra no log do job que ninguém respondeu. Perguntar é papel da tela. |

Antes de renderizar qualquer corte, se a marca vai ser aplicada, o serviço confere que o arquivo existe e decodifica. Se não, a renderização **não começa** e o erro é: "A imagem da marca d'água não foi encontrada." Não renderiza metade com e metade sem.

**A conferência acontece em dois momentos.** Em `POST /jobs/:id/run` e `POST /jobs/batch/run` a renderização só começa depois do download, da transcrição e da análise (e, no lote e em `POST /jobs/:id/render`, depois de a rota já ter respondido). Conferir só "antes de renderizar" deixaria o usuário baixar e analisar por uma hora para descobrir no fim que a imagem não existe.

| Momento | Onde | Se a imagem falta |
|---|---|---|
| **No pedido** | `POST /jobs/:id/render`; `POST /jobs/:id/run` (quando o fluxo inclui renderização); `POST /jobs/batch/run` (quando o lote inclui renderização). A rota resolve a decisão pela tabela acima e, se a marca vai ser aplicada, confere a imagem **antes de iniciar ou enfileirar qualquer coisa**. | `400` `watermark_missing`. Nada começa. |
| **De novo, antes do primeiro corte** | No serviço de renderização. A imagem pode ter sido removida entre o pedido e a renderização. | Nenhum corte é renderizado e a etapa falha como qualquer falha de renderização: o job vai para o estado de erro que a renderização já usa, com a mensagem fixa "A imagem da marca d'água não foi encontrada." no evento de estado e no log `render` do job. Não é uma falha silenciosa. Num lote, o vídeo falha e o lote segue a regra de falha que já tem. |

O campo `watermark` segue do pedido até a renderização **como veio** (`true`, `false` ou ausente), e a tabela acima é aplicada de novo no segundo momento. Com o campo ausente, vale o modo do perfil na hora de renderizar: se o usuário trocou o modo durante um processamento longo, a escolha mais recente é a que conta. Com `watermark` ausente e modo `ask`, o resultado é "não aplicar" nos dois momentos, e a conferência da imagem não é feita.

O resultado é gravado em `shorts[].watermark` no arquivo de informações.

### 11.4 No FFmpeg

Hoje há uma entrada só e o script termina em legenda → `format=yuv420p` (`ffmpeg_executor.py:55-104`; `filter_script_builder.py:345-352`). O tamanho final é sempre 1080×1920 (`rendering_service.py:373-374`).

**Comando**, nos dois construtores (`build_ffmpeg_nvenc_command` e `build_ffmpeg_cpu_fallback_command`, `ffmpeg_executor.py:71-104,121-150`): a imagem entra como segunda entrada, **logo depois** da entrada do vídeo e **antes** de `-t`:

```
ffmpeg -y -hwaccel cuda -ss <inicio> -i <video> -i <watermark.png> -t <dur> -filter_complex_script <script> ...
```

**Script**, entre a linha da legenda e o `format=yuv420p`:

```
[1:v]format=rgba,scale=w=<CAIXA_L>:h=<CAIXA_A>:force_original_aspect_ratio=decrease,colorchannelmixer=aa=<OPACIDADE>[wm];
[v_cur][wm]overlay=x=<X>:y=<Y>:eof_action=repeat[v_wm];
[v_wm]format=yuv420p[v_out]
```

| Valor | Cálculo |
|---|---|
| `CAIXA_L` | `1080 × size_percent / 100`, arredondado para par |
| `CAIXA_A` | 480 (25% de 1920): impede que uma imagem alta ocupe a tela |
| `OPACIDADE` | `opacity`, com 2 casas |
| `X` | esquerda: `44`; centro: `(W-w)/2`; direita: `W-w-44` |
| `Y` | topo: `44`; meio: `(H-h)/2`; base: `H-h-44` |

- A marca fica **por cima** da legenda.
- `FilterScriptOptions` (`filter_script_builder.py:102-114`) ganha um campo opcional com esses valores já calculados. Campo ausente = nenhuma linha nova.
- O caminho da imagem é argumento de entrada, não entra no texto do filtro; não precisa do escape de `filter_script_builder.py:29-38`.
- **Sem marca d'água, o comando e o script ficam idênticos aos de hoje.** Há teste para isso.
- Se uma imagem estática sem `-loop` se mantém pelo corte inteiro com `eof_action=repeat`, inclusive com `trim_internal_silence`, precisa ser conferido com FFmpeg real. Alternativa já prevista: `-loop 1` na entrada da imagem e `shortest=1` no `overlay`. Está em [manual-validation.md](./manual-validation.md).

A pré-visualização na tela de configurações é feita no navegador (a imagem sobre um quadro vertical), sem FFmpeg.

## 12. Motor de limpeza

Módulo novo, `backend/app/domain/cleanup/`. Duas metades separadas:

- **Calcular** (`scan`, `summary`, `build_plan`): só lê. Pode rodar quantas vezes quiser.
- **Executar** (`execute_plan`): apaga. É chamada por **uma única** rota, `POST /cleanup/execute`. Nenhum temporizador, nenhuma tarefa de inicialização e nenhum outro módulo a chama.

### 12.1 Regras

Guardadas em `yts-root.json` → `cleanup` (modo raiz) ou `machine.json` → `cleanup_local` (modo local):

| Campo | Significado | Padrão |
|---|---|---|
| `enabled` | Liga as regras | `false` |
| `max_age_days` | Idade máxima em dias, ou `null` para não usar | `null` (a tela sugere 30) |
| `max_size_gb` | Tamanho máximo em GB, ou `null` para não usar | `null` (a tela sugere 50) |

Com `enabled: false` nada é calculado, nenhum aviso aparece e nenhuma rota existente muda de comportamento.

### 12.2 O que é varrido

Todas as pastas de vídeo de todos os perfis (em modo local, `media.base_dir`), inclusive `_archived`. Para cada pasta: o arquivo de informações, o original (se existir) e os `.mp4` de `shorts/`.

Dois tipos de item:

| Tipo | O que é apagado |
|---|---|
| `source` | `video.<ext>`. Em modo local, também `transcrições/audio_16k.wav` da mesma pasta, que só serve com o original. |
| `short` | Um `.mp4` de `shorts/`. |

**Transcrição em modo local.** Em modo local os arquivos de transcrição ficam dentro da pasta do vídeo (`transcrições/`). Eles **não** são itens da limpeza: são pequenos e continuam úteis enquanto o vídeo existir (para "Baixar de novo" sem transcrever outra vez). Eles saem junto com o estado do job, no momento em que o vídeo some por inteiro (12.7, "Depois"). Em modo raiz o equivalente é `data/jobs/<job_id>/`.

### 12.3 Conta do tamanho

| Número | Cálculo |
|---|---|
| `total_bytes` | Soma de todos os arquivos dentro de todas as pastas de vídeo, inclusive transcrição (modo local), temporários esquecidos (3.3) e arquivos que o app não reconhece. É o uso real, e pode ser maior do que a limpeza consegue liberar. |
| `excepted_bytes` | Soma dos originais com `size_exception: true`. |
| `counted_bytes` | `total_bytes − excepted_bytes`. É o que se compara com o limite. |
| `protected_bytes` | Soma do que está em pastas com `keep: true`. Conta para o limite (P4). |
| `limit_bytes` | `max_size_gb × 1024³`. |
| `over_bytes` | `max(0, counted_bytes − limit_bytes)`. |

A tela mostra `counted_bytes` e `total_bytes` lado a lado.

A varredura é guardada em memória por 60 segundos e descartada quando termina um download, uma renderização ou uma exclusão.

### 12.4 Quem pode ser apagado

Um item é **elegível** se todas valem:

1. A pasta do vídeo tem `video.info.json` **legível**, de versão conhecida, com `downloaded_at`. Arquivo ilegível ou de versão mais nova: fora (5.3). `downloaded_at` mais de um dia **no futuro** (relógio errado em algum computador): fora, e o vídeo aparece em `blocked` com o motivo `"clock"`.
2. `flags.keep` é `false`.
3. O vídeo **não está em uso**:
   - o job não está em processamento (`runtime.is_job_actively_processing`, usado hoje em `videos.py:105`), não faz parte de um lote em andamento e não está renderizando;
   - nenhuma publicação de um corte dele está, na fila **desta** máquina, em `queued`, `uploading`, `processing`, `paused`, `needs_login` ou `unconfirmed`;
   - nenhum corte dele tem, no arquivo de informações, um registro `in_progress` **de qualquer computador** que ainda não esteja parado (13.3). Outro computador pode estar enviando aquele arquivo agora.
4. O caminho, depois de resolvido, está dentro da pasta de vídeos, é um arquivo comum e não é link simbólico nem junção (ponto de montagem). No Windows, arquivo "só na nuvem" de um programa de sincronização também aparece para o sistema como um tipo especial de arquivo; **esse é aceito**. A conferência recusa só link simbólico e junção, não "qualquer arquivo especial". Como cada programa de sincronização marca esses arquivos não foi verificado e está em [manual-validation.md](./manual-validation.md).
5. O armazenamento não está em somente leitura: esta máquina é a dona da trava.
6. O arquivo existe no disco. Corte ou original que ainda não chegou pela sincronização (`missing`, `source_absent`) não é item.

### 12.5 O que venceu

**Regra de idade** (`max_age_days`): vencido é o vídeo com `agora − downloaded_at > max_age_days`.

`downloaded_at` vem do relógio do computador que baixou. Um relógio muito errado faz um vídeo vencer cedo demais ou nunca vencer. O app não tem como saber a hora certa; o que ele faz é: recusar data no futuro (12.4, item 1), mostrar a data e a idade de cada item na lista de confirmação, e nunca apagar sem o clique. É um limite conhecido.

- O original elegível entra no grupo 1, **marcado**.
- Os cortes elegíveis do mesmo vídeo entram no grupo 2, **desmarcados** (P11).

**Regra de tamanho** (`max_size_gb`), quando `over_bytes > 0`:

1. Ordena os originais elegíveis por `downloaded_at`, do mais antigo para o mais novo. Pula os que têm `size_exception` (apagá-los não baixa a conta).
2. Vai marcando até a soma liberada alcançar `over_bytes`.
3. Só se **acabarem os originais** e ainda faltar: ordena os cortes elegíveis pela `downloaded_at` do vídeo e depois pelo nome do arquivo, e marca até alcançar.
4. Se nem assim alcança: o plano informa `shortfall_bytes`. Se não há **nenhum** item elegível e existe conteúdo protegido, informa `all_protected: true` (texto de P4).

Um item que venceu pelas duas regras aparece uma vez, com as duas regras.

### 12.6 Destaques

| Destaque | Condição |
|---|---|
| Corte **ainda não publicado** | A entrada do corte em `shorts[]` não tem publicação `published` nem `sent_to_inbox`. |
| Original com **cortes aprovados ainda não gerados** | O job local tem cortes `approved` sem arquivo correspondente. Só é sabido no computador que tem o estado local. |

Itens destacados aparecem em primeiro lugar na lista, com selo. No grupo de cortes, os não publicados vêm sempre desmarcados, mesmo na regra de tamanho; para apagá-los o usuário marca um a um.

### 12.7 Plano e execução

`POST /cleanup/plan` devolve um plano: `plan_id`, validade de 10 minutos, itens com `item_id`, tipo, regra, tamanho, datas, perfil, destaques e `preselected`. O plano fica em memória. Para cada item o plano guarda também, só no servidor: o `video_id`, a pasta do perfil, o nome da pasta do vídeo, o nome do arquivo e o tamanho do arquivo no momento do plano.

O plano só enxerga o que **já chegou a este computador**. Uma marca "manter" feita em outro computador e ainda não sincronizada não é vista. A lista de confirmação avisa isso em modo raiz ([ui.md](./ui.md), 8). É um limite que a spec não resolve; a defesa é a lista, o clique e a exigência de ser dono da trava.

`POST /cleanup/execute` recebe `plan_id`, a lista de `item_id` que o usuário deixou marcada e `confirm: true`.

Antes de começar, a execução marca os jobs dos itens como **em limpeza**. Enquanto a marca existe, `POST /jobs/:id/ingest`, `/render` e `/run` daquele job devolvem `409` `busy_cleanup`. Assim uma renderização não começa entre a conferência e o `unlink`. A marca é tirada no fim, com sucesso ou com erro.

Para cada item, nesta ordem (originais antes de cortes):

1. O `item_id` existe no plano? Senão: recusado.
2. Refaz **todos** os testes de 12.4. O estado pode ter mudado desde o plano.
3. Reconstrói o caminho **no servidor**, a partir da pasta do perfil, do nome da pasta do vídeo e do nome do arquivo guardados no plano. Nenhum caminho vem do cliente.
4. Confere que a pasta ainda é **do mesmo vídeo**: o `video_id` lido agora do `video.info.json` é o do plano, e o tamanho do arquivo é o do plano. Um renomear entre o plano e a execução trocaria o alvo; se algo não bate, o item é pulado (`changed`).
5. Confere que o nome do arquivo casa com o esperado: `video.<ext de vídeo>` para `source`; `<nome>.mp4` diretamente dentro de `shorts/` para `short`.
6. Confere que o `video.info.json` pode ser regravado: legível e de versão conhecida. Senão, o item é pulado (`info_unreadable`) **antes** de qualquer exclusão.
7. Grava a linha no registro (12.8). **Se o registro não puder ser gravado, para tudo.**
8. Apaga com `unlink`. Sem lixeira. Sem `rmtree`.
9. Atualiza `video.info.json`: para `source`, preenche `deleted_at`, `deleted_by_rule` e `file_name: null`; para `short`, preenche `deleted_at` na entrada (5.2).
10. Falha em qualquer passo: o item volta em `skipped` com o motivo, e os outros continuam.

Depois, para cada vídeo que teve algum item apagado:

- **Original apagado, cortes restando.** O job ganha o campo extra `source_deleted: true`. O vídeo continua na lista, com os cortes assistíveis e publicáveis, sem poder gerar cortes novos. Se a origem é um link, a tela oferece "Baixar de novo". Em modo raiz, `data/jobs/<job_id>/audio_16k.wav` é removido (só serve com o original); é a exceção 2 abaixo.
- **O vídeo acabou.** Quem decide isso é o **arquivo de informações**, relido do disco depois do passo 9, e não a simples falta de arquivos na pasta. O vídeo só acabou quando valem as três:
  1. `source.deleted_at` está preenchido (o original foi apagado **pelo app**);
  2. **toda** entrada de `shorts[]` tem `deleted_at` valendo (preenchido e não mais antigo que `rendered_at`, 5.2);
  3. no disco não há `video.<ext>` nem `.mp4` em `shorts/`.

  Um original `source_absent` (não está no disco, mas `source.deleted_at` é `null`) ou um corte vivo `missing` **mantêm o vídeo e o arquivo de informações**, mesmo com a pasta sem nenhum arquivo de vídeo: num disco sincronizado eles podem só não ter chegado ainda. Apagar o arquivo de informações nessa hora faria os arquivos atrasados virarem, ao chegar, uma pasta sem identidade, e a marca "manter", a exceção de tamanho e o histórico de publicações se perderiam. Se a condição 3 falha (apareceu um arquivo que o arquivo de informações dá como apagado), o vídeo também não acabou; a conferência de 5.5 cuida dele na próxima listagem.

  Quando o vídeo acabou, nesta ordem:
  1. Em modo local, apaga de `transcrições/` só os arquivos de nome conhecido: `transcription.segments.json`, `transcription.words.json`, `transcription.txt`, `transcription.vtt` e `audio_16k.wav` (este já saiu com o original). Cada um com `unlink`, e os nomes vão no campo `also_removed` da linha de registro do último item daquele vídeo.
  2. Apaga `video.info.json`, com linha própria no registro (12.8, `kind: "video_info"`), gravada **antes** do `unlink`. Se a linha não puder ser gravada, o arquivo fica e os passos 3 e 4 não acontecem.
  3. Tenta `rmdir` em `transcrições/` (modo local), em `shorts/` e na pasta do vídeo. Só sai pasta **vazia**. Se houver arquivo desconhecido, a pasta e o arquivo ficam; ela deixa de aparecer em `/videos` (não tem mais vídeo nem arquivo de informações), a resposta da execução conta em `folders_kept` e a tela avisa.
  4. Libera o estado local do job, pela função nova descrita abaixo (exceção 1).

**As duas únicas exclusões da limpeza fora da pasta de vídeos.** A regra geral é: a limpeza só apaga dentro da pasta de vídeos. O estado do job, porém, fica em `data/` (máquina) e seria lixo eterno depois que o vídeo some. São permitidas exatamente estas duas, cada uma com teste próprio:

| # | O que | Quando | Como |
|---|---|---|---|
| 1 | `data/jobs/<job_id>/` (a pasta inteira) | O vídeo acabou (as três condições acima). | Função **nova** `JobLifecycleService.release_local_job_state(job_id)`: valida o `job_id` com `_validate_safe_segment` (`job_lifecycle.py:91`), resolve o caminho, confere que é filho direto de `paths.jobs_dir()` e que não é link, e só então remove a pasta e invalida os caches daquele job. |
| 2 | `data/jobs/<job_id>/audio_16k.wav` | Modo raiz, original apagado com cortes restando. | `unlink` do arquivo de nome fixo, com as mesmas conferências de `job_id` e de caminho. |

**A rotina que existe hoje não serve e não pode ser chamada.** O código de `DELETE /videos/:job_id` (`videos.py:201-229`) não é uma rotina de ciclo de vida: é o corpo da rota. Ele faz `shutil.rmtree(..., ignore_errors=True)` na pasta pai de `job.source_video_path`, na pasta ativa do vídeo, na pasta arquivada e, por `delete_render_outputs` (`job_lifecycle.py:738-742`), em `shorts/`, e só então remove `data/jobs/<id>`. Reusá-lo apagaria a pasta do vídeo que o passo 3 acima promete manter quando há arquivo desconhecido, e pode apagar outra cópia do vídeo se `source_video_path` apontar para outro lugar. O pacote `app/domain/cleanup/` **não chama** `delete_video`, `delete_render_outputs` nem `rename_video`, e o teste estrutural da fase 4 confere isso.

A resposta lista o que foi apagado, o que foi pulado, o total liberado e `folders_kept`.

### 12.8 Registro

Uma linha JSON por arquivo apagado, acrescentada ao fim de:

- modo raiz: `<RAIZ>/limpeza/<machine_id>.jsonl`, **um arquivo por computador**;
- modo local: `data/cleanup.log.jsonl`.

```json
{"at":"2026-12-20T18:02:11Z","machine_id":"m_3f9a0c1e8b7d4f52","machine_name":"PC-SALA","plan_id":"plan_77aa","rule":["age"],"kind":"source","profile_id":"p_8f3a2c1d","video_id":"2747c40e027844d9908c9aded7d493c4","title":"Episódio 42 — conversa com Fulano","path":"perfis/cortes-do-podcast/videos/Episodio 42/video.mp4","size_bytes":1843200000,"downloaded_at":"2026-11-18T14:10:03Z","had_unpublished":false}
```

- O caminho é relativo à raiz (ou a `base_dir` em modo local).
- `kind`: `"source"`, `"short"` (limpeza); `"video_info"` (o `video.info.json` de um vídeo que acabou, 12.7; a linha leva a mesma `rule` e o mesmo `plan_id` do último item daquele vídeo, e `size_bytes` do próprio arquivo); `"conflict_copy"` (6.4); `"tmp_leftover"` (3.3); `"profile_file"` (4.4). `rule` é `["age"]`, `["size"]`, as duas, ou `["manual"]` (12.10 e as exclusões que não vêm de regra).
- Se o `unlink` falhar depois da linha gravada, entra uma segunda linha com `"event": "failed"` e o motivo.

**Por que um arquivo por computador.** Dois computadores acrescentando linhas ao mesmo arquivo num disco sincronizado geram cópias de conflito. Com um arquivo por `machine_id`, cada máquina só escreve no seu e nunca há dois escritores. A leitura (`GET /cleanup/log`) junta todos os `limpeza/*.jsonl`, ordena por `at` e descarta linha repetida.

**Escrita.** O registro é só acréscimo, então não usa o ciclo `.tmp` + `os.replace` (que reescreveria o arquivo inteiro a cada linha). Cada linha é montada inteira em memória e gravada com uma única chamada de escrita em modo de acréscimo, seguida de `fsync`. Se o `fsync` falhar, a exclusão não acontece. Uma queda no meio pode deixar a **última** linha pela metade; a leitura ignora qualquer linha que não seja um JSON completo, e a próxima escrita começa numa linha nova.

### 12.9 Adiar

Só existe para o aviso de **tamanho**. `POST /cleanup/postpone` grava `cleanup_postponed_until = agora + 24 h` em `machine.json`. Enquanto vale, `size_warning_active` é `false` e o aviso não aparece; o contador da barra lateral continua visível. Depois, o aviso volta. Ao ler, um valor maior que agora + 24 h é cortado para agora + 24 h: mexer no relógio do computador não estica o adiamento além de um dia.

Por padrão (P2), adiar deixa a operação que causou o aviso seguir. O backend **não bloqueia** download nem renderização por causa do total. Se o dono responder "não" a P2: `POST /jobs/:id/ingest` e `POST /jobs/:id/render` passam a devolver `409` `storage_limit_reached` enquanto `over_bytes > 0`, e "adiar" deixa de existir.

### 12.10 Um vídeo maior que o limite

`POST /storage/preflight` responde, antes de baixar ou enviar, se o vídeo sozinho passa do limite e se o total passaria.

| Origem | De onde vem o tamanho |
|---|---|
| Arquivo local | `file.size`, conhecido no navegador, e conferido no backend ao receber. |
| Link | Consulta de metadados do `yt-dlp` **sem baixar**, lendo o tamanho do formato que seria escolhido. Pode vir vazio. |

- Tamanho conhecido e maior que o limite: o app pergunta. Com a exceção, `size_exception: true` é gravado no job e depois no arquivo de informações, e o download segue. Sem ela, o download não começa. Como defesa, com a regra de tamanho ligada, `POST /jobs/:id/ingest` devolve `409` `size_exception_required` se a estimativa passa do limite e a exceção não foi aberta.
- Tamanho desconhecido: o download segue. Ao terminar, se o arquivo é maior que o limite, o job ganha `size_exception_pending: true` e a tela pergunta "manter com exceção" ou "apagar este vídeo". **O app não apaga sozinho.**

As duas respostas têm caminho definido, e nenhuma usa `DELETE /videos/:job_id` (que faz `rmtree`, não registra e responde `ok` mesmo quando falha):

| Resposta | Caminho |
|---|---|
| "Manter com exceção" | `PUT /videos/:job_id/flags` com `{ "size_exception": true }`. Grava a exceção no arquivo de informações e tira `size_exception_pending` do job. |
| "Apagar este vídeo" | **Plano manual de um vídeo só:** `POST /cleanup/plan` com `{ "rule": "manual", "job_id": "<id>" }`, seguido de `POST /cleanup/execute` com esse plano. É a mesma função de exclusão, com os mesmos testes de 12.4, o mesmo registro (`rule: ["manual"]`, que é de onde vem `deleted_by_rule: "manual"`) e a mesma resposta. O original vem marcado; se o vídeo já tiver cortes, eles vêm desmarcados. |

O plano manual só é aceito para um job com `size_exception_pending: true`; para qualquer outro, `400`. Ele funciona mesmo que as regras tenham sido desligadas depois do download. Não é uma segunda rota de "apagar vídeo": o "Remover" da barra lateral continua sendo o `DELETE /videos/:job_id` de hoje.

### 12.11 Quando o cálculo roda

Ao iniciar o app, ao terminar um download, uma renderização ou uma exclusão, ao mudar as regras, e a cada 30 minutos com o app aberto. Cada cálculo publica `cleanup.summary` no canal global (seção 14). **Nenhum desses momentos apaga nada.**

## 13. Publicação

Módulos novos: `backend/app/domain/publishing/` (fila, estados, regras) e `backend/app/infrastructure/platforms/` (um adaptador por plataforma, mais o fluxo de login).

### 13.1 Modelo

Uma **publicação** é o envio de **um** corte para **uma** conta. Publicar o mesmo corte em duas contas cria duas publicações.

```json
{
  "publication_id": "pub_9d2e41",
  "profile_id": "p_8f3a2c1d",
  "video_id": "2747c40e027844d9908c9aded7d493c4",
  "short_file": "01_05-02_30.mp4",
  "account_id": "a_51c0e7aa",
  "platform": "youtube",
  "status": "uploading",
  "created_at": "2026-11-19T10:05:00Z",
  "updated_at": "2026-11-19T10:05:40Z",
  "consented_at": "2026-11-19T10:05:00Z",
  "metadata": {
    "title": "Por que ele largou tudo",
    "description": "Fulano conta o dia em que decidiu mudar de carreira.\n\n#podcast #cortes",
    "privacy": "private",
    "made_for_kids": false
  },
  "attempts": 1,
  "next_retry_at": null,
  "bytes_sent": 12582912,
  "bytes_total": 28400000,
  "resume": { "kind": "youtube_session" },
  "result": null,
  "error": null
}
```

Guardada em `data/publish/queue.json` (máquina, atômico). O endereço da sessão de envio fica dentro de `resume`, **só** nesse arquivo; nunca é devolvido por rota nem por evento. Se o diretório de dados parecer sincronizado (8.4), `resume` nem é gravado: fica só em memória, e um envio interrompido por reinício recomeça do zero ao ser retomado.

A fila guarda mais dois campos internos, que não saem por rota: `record_pending` (o resultado ainda não foi gravado no arquivo de informações; 13.6) e `paused_reason`.

### 13.2 Estados

```
queued ──► uploading ──► processing ──► published
   │           │              │     └──► sent_to_inbox   (rascunho do TikTok)
   │           │              │
   │           ├──► failed ◄──┘
   │           ├──► needs_login
   │           ├──► unconfirmed   (tudo foi enviado, mas a resposta se perdeu)
   │           └──► paused        (app reiniciou no meio)
   ├──► paused       (a pasta passou a ser usada em outro computador)
   └──► canceled     (de qualquer estado não final)
```

| Estado | Significado |
|---|---|
| `queued` | Aguardando a vez. |
| `uploading` | Enviando o arquivo. |
| `processing` | A plataforma recebeu e ainda está processando; o app consulta o resultado. |
| `published` | Publicado. `result` tem `remote_id`, `url` e a privacidade **devolvida pela plataforma**. |
| `sent_to_inbox` | Enviado como rascunho. O usuário termina no app do TikTok. |
| `failed` | Desistiu depois das tentativas, ou erro sem conserto automático. `error` tem `code` e `message` em linguagem simples. |
| `needs_login` | O login venceu no meio. Volta para a fila depois de reconectar. |
| `unconfirmed` | Todos os bytes foram enviados, mas a confirmação da plataforma não chegou e não dá mais para consultá-la. O vídeo **pode** estar publicado. O app não reenvia sozinho; o usuário confere no canal e decide (13.5). |
| `paused` | O app reiniciou durante o envio, ou a pasta passou a ser usada em outro computador antes de o envio começar (seção 7). Espera o usuário clicar em "Retomar". |
| `canceled` | O usuário cancelou. |

Estados finais: `published`, `sent_to_inbox`, `failed`, `canceled`. "Tentar de novo" numa publicação `failed` cria uma publicação **nova** (outro `publication_id`, com `retry_of` apontando para a antiga); a antiga continua `failed`. Assim o registro `abandoned` da tentativa antiga (13.6) nunca briga com o registro da nova na fusão.

`Job.status` **não** ganha estado novo. Publicar não mexe na máquina de estados do job (`domain.py:11-22`).

### 13.3 Antes de entrar na fila

`POST /publications` valida, para cada destino:

1. `consent: true` no pedido. Sem isso, nada é criado (R-YT-12, R-TT-6).
2. O arquivo existe no disco, está dentro de `shorts/` do vídeo, e tem entrada viva em `shorts[]`. Cortes gerados antes desta spec ganham a entrada pela conferência de 5.5, então também podem ser publicados. Arquivo de informações ilegível: recusado (5.3).
3. A conta pertence ao perfil do vídeo e está `connected` nesta máquina.
4. O armazenamento não está em somente leitura.
5. O arquivo de informações é **relido do disco**. Para a mesma conta:

   | Registro que o corte já tem | O pedido |
   |---|---|
   | `published` ou `sent_to_inbox` | Recusado (`already_published`), a menos que venha `allow_repeat: true` (o usuário confirmou na tela que quer publicar de novo). |
   | `in_progress` **vivo** | Recusado (`publish_in_progress`). `allow_repeat` **não** vale aqui. |
   | `in_progress` **parado** | Recusado (`publish_in_progress`), até o usuário liberar o registro (abaixo). |
   | `abandoned`, ou nenhum | Aceito. |

6. Regras da plataforma conhecidas de antemão (duração máxima da conta no TikTok, por exemplo).

Passou: grava a entrada `in_progress` no arquivo de informações e cria a publicação `queued`.

**Registro `in_progress` parado.** Um computador que travou, foi desligado ou nunca mais abriu o app deixa um `in_progress` para trás. Sem regra, aquele corte nunca mais poderia ir para aquela conta a partir de outro computador. Um registro `in_progress` é **parado** quando:

- é de **outra** máquina (`machine_id` diferente) e `started_at` tem mais de 24 horas; ou
- é **desta** máquina e não existe publicação ativa com aquele `publication_id` na fila local (a fila foi perdida).

Registro parado aparece na tela como "Envio interrompido em <nome do computador>", com a ação "Liberar". A liberação (`POST /publications/records/release`, com confirmação: "Confira no canal se o vídeo já foi publicado. Liberar permite enviar de novo.") troca o registro para `abandoned`, com `finished_at` e a máquina que liberou. É uma troca de estado, não uma remoção, então a fusão a carrega (6.3). Se o outro computador na verdade terminou o envio, o `published` dele vence o `abandoned` na fusão e o registro certo aparece.

O prazo de 24 horas usa o relógio de dois computadores e é só um palpite para não oferecer "Liberar" cedo demais. A decisão é sempre do usuário.

### 13.4 Execução

- Semáforo novo `PublishQueue`, tamanho 1, no `HardwareResourceScheduler` (`scheduler.py:453-490`), com `publish_slot()`. Não usa `io_slot()`, para não tomar as vagas do download (D19).
- Um trabalhador `asyncio`, iniciado com o app, consome a fila.
- O progresso sai pelo canal global (seção 14) como texto de estado. A tela principal não mostra percentual.
- Cancelar usa o `CancelToken` que já existe (`runtime_service.py:483-500`), com a chave `(publication_id, "publish")`.

### 13.5 Novas tentativas

| Situação | O que acontece |
|---|---|
| Falha de rede; HTTP 500, 502, 503, 504 | Tenta de novo sozinho: até 5 vezes, esperando 2, 4, 8, 16, 32 s (com variação aleatória). O YouTube retoma do ponto em que parou (R-YT-14). |
| A consulta "onde parou?" responde que o envio **já terminou** | Sucesso. O YouTube devolve nesse caso a mesma resposta que mandou quando o envio terminou (confirmado na página do envio retomável; ver [platforms.md](./platforms.md), 2.1): o app lê o ID e a privacidade e vai para `published`. É o caso de um tempo esgotado que, na verdade, deu certo. |
| Sessão de envio vencida (YouTube 404; TikTok 403 no envio) **antes** de todos os bytes terem sido enviados | Recomeça o envio do zero, contando como tentativa. |
| Sessão vencida, ou falha sem conserto, **depois** de todos os bytes terem sido enviados (`bytes_sent == bytes_total`) | `unconfirmed`. **Não recomeça sozinho**: recomeçar poderia publicar o vídeo duas vezes. No TikTok, antes de cair aqui, o app consulta o resultado pelo `publish_id`. |
| Login recusado | `needs_login`. Não conta como tentativa. |
| Limite de chamadas por minuto (TikTok `rate_limit_exceeded`) | Espera 60 s e tenta de novo. |
| Cota diária esgotada, bloqueio por excesso de posts, conta impedida de postar | `failed` na hora, com a mensagem própria. Não insiste. |
| Recusa por regra (privacidade inválida, vídeo longo demais) | `failed` na hora. |
| App reiniciou | `paused`. O usuário decide. Se o reinício foi depois de todos os bytes enviados: `unconfirmed`. |

**Saídas de `unconfirmed`**, todas com clique ([ui.md](./ui.md), 13.4):

| Ação | Efeito |
|---|---|
| "Já está no canal" | A publicação vai para `published`, com `remote_id` e `url` vazios e `confirmed_by_user: true`. O registro do arquivo de informações vira `published`. |
| "Não está; enviar de novo" | Pede confirmação. A publicação atual vai para `failed`, o registro vira `abandoned` e nasce uma publicação nova, como em "Tentar de novo". |
| "Cancelar" | `canceled`; o registro vira `abandoned`. |

### 13.6 Ao terminar

- Sucesso: a entrada `in_progress` do arquivo de informações vira `published` ou `sent_to_inbox`, com `remote_id`, `url`, `privacy` e `finished_at`.
- `failed` ou `canceled`: a entrada `in_progress` vira `abandoned`, com `finished_at`. Ela **não é removida**: uma remoção voltaria na fusão com uma cópia antiga (6.3). `abandoned` não bloqueia uma nova publicação.
- `needs_login`, `paused` e `unconfirmed` não são finais: a entrada continua `in_progress`.
- Publicações em estado final ficam na fila local por 30 dias e depois são descartadas dela. O registro que vale é o do arquivo de informações.

**O resultado de um envio nunca depende só da memória.** Gravar `published` no arquivo de informações pode falhar: a pasta sumiu, o arquivo está preso pela sincronização, a máquina perdeu a trava. Se o registro se perdesse, outro computador não saberia do envio e publicaria de novo. Por isso:

1. Assim que a plataforma confirma, o resultado é gravado **primeiro** em `data/publish/queue.json` (disco da máquina), com `record_pending: true`.
2. Depois o app grava no arquivo de informações. É uma escrita de conclusão: vale mesmo em somente leitura (seção 7).
3. Deu certo: `record_pending` vira `false`.
4. Não deu: a publicação já aparece como `published` na fila, com o aviso "Ainda não foi possível anotar este envio na pasta." O app tenta de novo a cada 30 s, ao reabrir e sempre que a raiz voltar a ficar disponível. Publicação com `record_pending` não é descartada da fila pelo prazo de 30 dias.

### 13.7 Adaptadores

Cada plataforma implementa a mesma interface (`PlatformProvider`): montar a URL de login, trocar o código, renovar, revogar, identificar a conta, consultar opções da conta, enviar, consultar resultado. Cada adaptador recebe um cliente HTTP injetado pelo container; nos testes, o cliente é falso e responde com respostas gravadas à mão.

O que cada plataforma exige está em [platforms.md](./platforms.md) e nas fases 5 e 6.

### 13.8 Conta ou pasta mudam no meio

| O que muda | O que acontece com os envios |
|---|---|
| O usuário tenta "Sair", "Remover do perfil" ou "Mover" uma conta com envio ativo, ou remover a credencial de aplicativo | Recusado: `409` `busy_publishing` (10.4). |
| O login é revogado **fora** do app (nas configurações da conta, na plataforma) | O envio falha na renovação e vai para `needs_login`. |
| A máquina perde a trava | Seção 7: os `queued` pausam; os que já enviam terminam e anotam o resultado. |
| A raiz fica indisponível | Os envios em andamento terminam (o arquivo já está sendo lido; se a leitura falhar, é falha de rede/arquivo comum). O resultado fica com `record_pending` até a raiz voltar. |

## 14. Canal global e proteção das rotas

### 14.1 `GET /events`

Fluxo SSE novo, no mesmo formato de `GET /jobs/:id/events` (`event: <nome>\ndata: {json}`, `runtime_service.py:120-122`), usando o `JobEventBus` existente com a chave reservada `_app`.

| Evento | Quando |
|---|---|
| `storage.status` | A raiz ficou indisponível, voltou, mudou de dono da trava. |
| `cleanup.summary` | Todo recálculo da limpeza. |
| `publication.state` | Mudança de estado de uma publicação. |
| `publication.progress` | Bytes enviados, no máximo uma vez por segundo. |
| `account.state` | Uma conta mudou de estado de conexão. |
| `migration.progress` | Andamento da migração. |

O frontend abre **um** `EventSource` para o app inteiro, além do que já abre para o vídeo ativo.

Os eventos seguem a mesma regra das respostas de rota: nenhum segredo. `publication.state` leva o objeto `Publication` **sem** `resume`, e `error.message` vem da tabela de textos fixos (10.5). A varredura de segredos dos testes lê também tudo o que saiu por este fluxo.

### 14.2 `require_local_ui`

Dependência FastAPI aplicada às rotas marcadas como "local" em [api-contracts.md](./api-contracts.md):

1. O endereço de quem chamou precisa ser `127.0.0.1` ou `::1`. Senão: `403`.
2. Se o pedido traz `Origin`, o host dele precisa ser `localhost` ou `127.0.0.1` (qualquer porta). Senão: `403`.

Motivo em D18.

**Rotas que já existem.** A regra geral desta spec é não mexer nas rotas existentes. Quatro delas, porém, ficam mais perigosas com este trabalho, e a spec assume como padrão aplicar `require_local_ui` a elas a partir da fase 2 (pergunta P22, decisão D29):

| Rota existente | Por que |
|---|---|
| `DELETE /videos/:job_id` | Faz `rmtree`. Em modo raiz, o que ela apaga some em todos os computadores. Hoje qualquer site aberto no navegador e qualquer aparelho da rede consegue chamá-la (CORS aberto, `0.0.0.0`). |
| `DELETE /jobs/:job_id/renders/:file` | Idem, para um corte. |
| `POST /videos/:job_id/archive` | Apaga o destino se já existir (`videos.py:187-189`). |
| `POST /config/select-folder` | A partir da fase 2, abre uma janela nativa no computador onde o backend roda. |

O contrato dessas rotas não muda para o frontend, que roda na própria máquina: mesmos caminhos, mesmos corpos, mesmas respostas. Muda só que uma chamada vinda de outro aparelho ou de outro site passa a receber `403` `local_only`. Se o dono responder "não" a P22, as quatro ficam como estão e o risco continua registrado na seção 15.

## 15. Defeitos antigos e limites conhecidos

O mapeamento encontrou os pontos abaixo. **Não são corrigidos por esta spec**, a não ser onde uma fase diz o contrário. Estão aqui para ninguém ser surpreendido.

| Ponto | Onde | Efeito neste trabalho |
|---|---|---|
| Arquivar apaga o destino se já existir uma pasta com o mesmo nome | `videos.py:187-189` | Em modo raiz, a exclusão se propaga pela sincronização. Fora de escopo; anotado em [manual-validation.md](./manual-validation.md). |
| `DELETE /videos/:id` usa `rmtree(ignore_errors=True)` em quatro lugares (pasta pai de `source_video_path`, pasta ativa, pasta arquivada e `shorts/`) e responde `ok` mesmo se falhar | `videos.py:201-229`; `job_lifecycle.py:738-742` | A limpeza **não chama** esse código nem `delete_render_outputs` (12.7). O "Remover" da barra lateral continua usando a rota; em modo raiz ele ganha uma confirmação com o aviso de pasta sincronizada ([ui.md](./ui.md), 11). |
| Um `video_name` igual a `..` passa pelo saneamento, e renomear para `..` seguido de `DELETE /videos/:id` apaga a pasta de cima | `settings.py:244-246`; `job_lifecycle.py:707-728`; `videos.py:217-222` | **Corrigido na fase 2**, nos dois modos: o resolvedor recusa `.`, `..` e nome vazio (8.2). É, com a linha abaixo, a única correção de defeito antigo que muda o modo local. |
| Renomear para o nome de uma pasta que já existe (outro vídeo, `_archived`, `logs`) move a pasta **para dentro** dela; o `DELETE /videos/:id` seguinte apaga o outro vídeo ou todos os arquivados | `job_lifecycle.py:715-720` (`shutil.move`); `settings.py:293-306`; `paths.py:122`; `videos.py:201-229` | **Corrigido na fase 2**, nos dois modos: o renomear recusa nome reservado e nome de pasta que já existe, sem diferenciar maiúsculas, e nunca move para dentro de uma pasta existente (8.2, item 1). |
| `create_job`, `save_job` e `job_dir` não conferem o `job_id` | `job_lifecycle.py:229-263`; `core/paths.py:65-76` | Hoje o id é sempre gerado pelo app. Com a reconciliação, ele passa a vir de um arquivo sincronizado: a fase 2 confere o formato do `video_id` e o caminho antes de criar o job (5.3). |
| Em modo raiz, uma pasta de vídeo que chega sem `video.info.json` não vira vídeo sozinha | — | Fica entre as "não reconhecidas" e espera um clique (8.3). É o preço de não adotar uma pasta cujas informações ainda estão chegando de outro computador. |
| As rotas destrutivas existentes aceitam chamada de qualquer site e de qualquer aparelho da rede | `main.py:28-38` (CORS `*` com credenciais, `0.0.0.0`) | Em modo raiz o estrago se espalha pela sincronização. Padrão assumido: `require_local_ui` nessas rotas a partir da fase 2 (14.2, P22). Se o dono disser não, o risco fica aqui registrado. |
| `POST /config/select-folder` chama o seletor de forma síncrona dentro de uma rota `async` | `config.py:969-973` | Hoje é inofensivo (o seletor não existe). Com um seletor de verdade, travaria o servidor inteiro enquanto a janela estivesse aberta. A fase 2 passa a esperar o seletor fora do laço de eventos. |
| O envio local carrega o arquivo inteiro na memória | `jobs_ingest.py:33` | Vídeo de vários GB pode esgotar a RAM. Fora de escopo. |
| `load_settings` sobrescreve `settings.json` com padrões quando algo falha | `settings.py:190-209` | A raiz não depende de `settings.json` (D10). |
| `data/settings.json` versionado com o caminho do usuário | `git ls-files data` | Nada novo é gravado ali. |
| O fluxo SSE do job nunca fecha por estado final | `jobs_ingest.py:116` usa `JobStatus` sem importar | `GET /events` é código novo e não herda o defeito. |
| O nome do corte só carrega início e fim; dois cortes iguais colidem | `rendering_service.py:93-97` | `shorts[].file` é a chave; a colisão continua possível. |
| Rotas que existem e não estão no inventário 4.1 do `AGENTS.md` | `/jobs/{id}/cancel`, `/jobs/{id}/attempts*`, `/cuts/approve-all`, `/cuts/reject-all`, `/config/settings/reset` | Ao acrescentar as rotas novas ao inventário, acrescente essas também. |
| CORS aberto e backend em `0.0.0.0` | `backend/app/main.py:28-38` | As rotas novas sensíveis têm trava própria (14.2). |
| `frontend/src/api/client.ts` escreve no console o corpo de toda chamada | `client.ts:5-7` | O segredo do aplicativo passaria por ali em `PUT /platforms/:platform/client`. A fase 3 altera o arquivo para não registrar corpo nem cabeçalhos dessas chamadas. |
| Um corte ou um original apagado pelo usuário no explorador de arquivos | — | Fica como "arquivo ainda não disponível" (ou "ainda não chegou") para sempre (5.5, 8.3). O app não distingue "apagado por fora" de "ainda não sincronizado". Por isso a limpeza nunca dá esse vídeo como acabado: o `video.info.json` e o estado do job ficam (12.7). |
| O plano de limpeza só vê o que já chegou a este computador | — | Um "manter" marcado em outro computador e ainda não sincronizado não protege o vídeo aqui (12.7). |
| `downloaded_at` depende do relógio de quem baixou | — | Relógio errado adianta ou atrasa o vencimento (12.5). |
| `upload_dir()` e `archived_dir()` sem uso | `paths.py:95-108` | Ignorar. |
| Tentativas arquivadas guardam `.mp4` em `data/` | `job_lifecycle.py:745-792` | Não viajam, não contam no limite (8.6). |
| Arquivos "só na nuvem" (sem cópia local) num disco sincronizado | — | Ler um vídeo assim dispara o download pelo programa de sincronização e pode demorar ou falhar. O app não controla isso. A tela recomenda manter a pasta disponível sem internet. |
