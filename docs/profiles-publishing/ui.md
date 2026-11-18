# Interface

> **Leia antes: [local-first.md](./local-first.md) ("Emenda: só neste computador").**
>
> Por decisão do dono (D49), a pasta sincronizada entre computadores está **adiada**. Este documento continua como foi escrito, mas para as fases 2 a 6 a emenda vence onde houver diferença. As telas da fase 1 (seções 4 e 12, e as peças da fase 1 em 0.3) **não mudam**.
>
> **Seções adiadas, que não devem ser implementadas:** 1 (primeira execução, "Onde guardar seus vídeos?"); 2 (pasta indisponível, somente leitura, escrita pendente); 11.1 ("Remover" em modo raiz); em 6.1, os botões de escolher, trocar e deixar de usar a pasta, o bloco "OUTROS COMPUTADORES", os avisos fixos e os cartões de arquivos de conflito e de temporários esquecidos; em 7.2, 8, 10, 13.2 e 13.4, as linhas de somente leitura, de pasta sincronizada e de outro computador. Em 0.3, as peças `StorageFirstRunDialog`, `StorageUnavailableDialog` e `DeleteVideoConfirmDialog` não são criadas; `FolderField` passa a nascer na fase 3 e `NoticePill`/`AppNotices`, na fase 4.
>
> **Valem com textos trocados pela emenda:** 5.1, 6.1 (reduzida), 11 e 13.2. As outras seções **valem como estão**. A lista completa e os textos novos estão em `local-first.md`, 2.3 e seção 5.

Cada tela e diálogo novo, descrito com os componentes que **já existem** e o texto exato. Nada aqui muda a identidade visual: vidro escuro, um único acento azul, pílulas, ícones Phosphor de linha.

Fontes: `docs/redesign/DESIGN.md`, `frontend/src/lib/tokens.css` (os valores reais, que prevalecem) e `frontend/tailwind.config.ts`.

## 0. Regras gerais

### 0.1 O que não pode

- Tema claro, gradiente, brilho, neon, emoji, animação de quique.
- Percentual, "9:16", resolução, taxa de bits, nome de modelo ou qualquer termo técnico **fora** das Configurações.
- Cor escrita à mão. Use as classes dos tokens (`bg-glass`, `border-line`, `text-text-2`, `bg-accent`, `text-danger`, `bg-warning-bg`...).
- `AppDialog`, `AppButton`, `AppInput`, `AppSelect`, `GlassButton`, `GlassToast`: são do estilo antigo (cores fixas, cantos `rounded-xl`, brilho). **Não usar em tela nova.**
- Um terceiro botão ou um terceiro campo "genérico". Botões e campos novos são classes Tailwind em linha, iguais às dos componentes citados abaixo.

### 0.2 Peças que já existem e devem ser reusadas

| Para | Usar | Onde está |
|---|---|---|
| Diálogo | Padrão do `NewVideoModal`: fundo `fixed inset-0 z-modal bg-black/55 backdrop-blur-sm p-4`; painel `rounded-panel glass--strong p-5 shadow-panel`; título `text-base font-medium`; botão X de 28 px em pílula; fecha com Esc e clique fora | `frontend/src/components/redesign/NewVideoModal.tsx:94-218` |
| Confirmação com "Não perguntar novamente" | `DeleteCutConfirmDialog` | `frontend/src/components/redesign/DeleteCutConfirmDialog.tsx` |
| Botão primário | `h-9 px-4 rounded-pill bg-accent text-accent-fg text-base font-medium hover:bg-accent-hover active:bg-accent-active disabled:opacity-45` | `NewVideoModal.tsx` |
| Botão secundário | `h-9 px-4 rounded-pill bg-white/[0.06] border border-line text-text-1 hover:bg-white/[0.12]` | idem |
| Botão de perigo | `bg-danger-bg text-danger border border-danger/30` em pílula | `DeleteCutConfirmDialog.tsx` |
| Botão das Configurações | `GhostButton` (`variant: "default" \| "accent"`, `leadingIcon`) | `frontend/src/components/redesign/settings/settingsShared.tsx:184-217` |
| Interruptor | `SettingsSwitch` | `settingsShared.tsx:411-446` |
| Escolha por cartões | `PickTile` / `PickTileGroup` | `settingsShared.tsx:245-324` |
| Escolha por etiquetas | `FormatChip` | `settingsShared.tsx` |
| Bolinha de estado | `StatusDot` (`tone: success \| warning \| danger \| neutral`) | `settingsShared.tsx:379` |
| Rótulo de seção | `SettingsSectionLabel` | `settingsShared.tsx` |
| Cartão de configuração | A constante real é `const CARD_CLASS = "rounded-card border border-line bg-glass"`, usada como `${CARD_CLASS} flex items-center gap-4 px-4 py-3.5`. Ela é **privada** do módulo e não pode ser importada. A fase 1 cria `SETTINGS_CARD_CLASS` em `settingsShared.tsx`, com a mesma cadeia de classes, e as seções novas usam essa. `AppAndDepsSections.tsx` não é alterado. | `settings/AppAndDepsSections.tsx:54` |
| Campo de texto | `h-9 rounded-pill bg-white/[0.06] border border-line text-text-1 placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-accent-ring`, ícone Phosphor à esquerda | `NewVideoModal.tsx:119-130` |
| Caminho de pasta | Texto mono clicável que vira campo; Enter confirma, Esc cancela; botão "Alterar pasta" | `AppFoldersSection` em `AppAndDepsSections.tsx` |
| Menu suspenso | `fixed z-popover w-40 rounded-card glass--strong p-1`, itens `px-2.5 py-1.5 rounded-thumb`, via `createPortal` | `ArcSidebar.tsx:517-560` (o bloco `createPortal` do menu ⋮) |
| Confirmação presa a um botão | `RestoreDefaultsButton` | `settingsShared.tsx:476-703` |
| Linha de lista | Linha de vídeo da `ArcSidebar`: `rounded-item`, `hover:bg-glass-hover` | `ArcSidebar.tsx:391-487` (a linha começa em l.396) |
| Aviso de erro curto | O aviso do topo que já existe (`role="alert"`, some em 6 s) | `frontend/src/App.tsx:2368-2384` |
| Salvar | Salvamento automático com `persist(save, patch, reporter)`. **Sem botão "Salvar".** | `AppAndDepsSections.tsx:38-52` |

### 0.3 Peças novas (não existem hoje)

Todas com as classes dos tokens. Os caminhos abaixo são relativos a `frontend/src/components/redesign/` e são os **mesmos** das listas de arquivos das fases. Se um nome daqui divergir do arquivo da fase, vale o arquivo da fase e a divergência é um erro desta spec a corrigir.

| Peça | Arquivo | Fase |
|---|---|---|
| `GlassDialog` | `GlassDialog.tsx` | 1 |
| `SettingsSlider`, `SegmentedChoice`, `PositionGrid`, `SETTINGS_CARD_CLASS` | `settings/settingsShared.tsx` (arquivo existente; só acréscimos) | 1 |
| `WatermarkSection` | `settings/WatermarkSection.tsx` | 1 |
| `WatermarkAskDialog` (seção 12) | `WatermarkAskDialog.tsx` | 1 |
| `FolderField` | `FolderField.tsx` | 2 |
| `NoticePill`, `AppNotices` | `AppNotices.tsx` (as duas no mesmo arquivo) | 2 |
| `StorageFirstRunDialog` (seção 1) | `StorageFirstRunDialog.tsx` | 2 |
| `StorageUnavailableDialog` (seção 2.1) | `StorageUnavailableDialog.tsx` | 2 |
| `DeleteVideoConfirmDialog` (seção 11.1) | `DeleteVideoConfirmDialog.tsx` | 2 |
| `StorageFolderSection`, `StorageCleanupSection` | `settings/StorageSections.tsx` (as duas no mesmo arquivo; a segunda entra na fase 4) | 2 e 4 |
| `ProfilesSection`, `AccountsSection` | `settings/ProfilesSections.tsx` (as duas no mesmo arquivo) | 3 |
| `ProfileSwitcher` (seção 14), `AccountLinkDialog` (seções 5.3 e 5.4) | `ProfileSwitcher.tsx`, `AccountLinkDialog.tsx` | 3 |
| `CleanupDialog` (seção 8), `StorageLimitDialog` (seção 9), `SizeExceptionDialog` (seção 10) | `CleanupDialog.tsx`, `StorageLimitDialog.tsx`, `SizeExceptionDialog.tsx` | 4 |
| `PublishDialog` (seção 13.2), `PublishQueueDialog` (seção 13.4) | `PublishDialog.tsx`, `PublishQueueDialog.tsx` | 5 |
| `PublishTikTokOptions` (seção 13.5) | `PublishTikTokOptions.tsx` | 6 |

Os diálogos da tabela são todos montados sobre `GlassDialog`; a confirmação de somente leitura (2.2) e as confirmações presas a botão não têm arquivo próprio.

| Peça | Para quê | Como é |
|---|---|---|
| `GlassDialog` | Casca dos diálogos novos | **Extração exata** da marcação do `NewVideoModal` (fundo, painel, título, X, Esc, clique fora, `role="dialog" aria-modal`). Props: `open`, `title`, `onClose`, `width?` (padrão 460 px), `disableClose?`, `footer?`, `children`. Só os diálogos novos a usam; os existentes **não** são refeitos. É uma exceção consciente à regra de "não criar outro modal": sem ela, a mesma marcação seria copiada em nove diálogos. |
| `SettingsSlider` | Transparência e tamanho da marca d'água | Em `settingsShared.tsx`. Trilha de 4 px `rgba(255,255,255,.18)`, preenchimento `bg-accent`, botão de 12 px branco, igual ao controle de volume do `GlassDock`. `<input type="range">` por baixo, com `aria-label` e setas do teclado. Valor ao lado em `text-sm text-text-2 tabular-nums`. |
| `SegmentedChoice` | Escolhas de 3 opções | Em `settingsShared.tsx`. Uma fileira de `FormatChip`, com `role="radiogroup"`. |
| `FolderField` | Caminho de pasta | **Cópia** do que `AppFoldersSection` já faz, para reusar na raiz. `AppFoldersSection` não é alterado nem passa a usar a peça nova. |
| `NoticePill` / `AppNotices` | Avisos que não bloqueiam | Seção 7. |
| `PositionGrid` | Posição da marca d'água | Em `settingsShared.tsx`. Grade 3×3 de botões de 28 px `rounded-thumb border border-line`; o escolhido usa o estilo `[data-pick-tile]` selecionado. `role="radiogroup"`, cada botão com `aria-label` ("Canto superior direito"). |

### 0.4 Estado e dados

Não existe store nem contexto; tudo vive em `App.tsx` e nos hooks (`frontend/src/hooks/`). O padrão continua: um hook por assunto (`useStorage`, `useProfiles`, `useWatermark`, `useCleanup`, `usePublications`, `useAppEvents`), chamado em `App.tsx`, com props passadas adiante. Cada chamada nova de API ganha um arquivo em `frontend/src/api/` e reexportação em `api/index.ts`.

**Não acrescente campo em `AppSettings.preferences`.** O `App.tsx` reconstrói esse objeto à mão em três lugares e apagaria o campo novo. As preferências novas têm rotas próprias.

### 0.5 Tom do texto

Português do Brasil, frases curtas, sem jargão. Andamento com reticências ("Enviando…"). Erro em linguagem de gente, com ação ("Tentar de novo"). O app usa "apagar" para excluir; mantenha.

## 1. Primeira execução — "Onde guardar seus vídeos?"

Aparece uma vez, quando `GET /storage` devolve `first_run_pending: true`. `GlassDialog`, 520 px, sem X; fecha só pelos botões.

**Quem vê este diálogo é a pergunta P20.** O padrão assumido: todo usuário, uma única vez, na primeira abertura depois desta fase (inclusive quem já usava o app). É a única pergunta nova no caminho de quem só cola um link; "Agora não" resolve com um clique e ela não volta. A alternativa é não mostrar nada e deixar a escolha só em Configurações.

- **Título:** "Onde guardar seus vídeos?"
- **Texto** (`text-sm text-text-2`): "Escolha uma pasta para os vídeos, os cortes e as suas preferências. Se ela estiver num disco sincronizado, como o Google Drive, você abre o app em outro computador e encontra tudo igual."
- **Opções** (`PickTileGroup`, duas `PickTile`):
  1. "Escolher uma pasta" — "Recomendado se você usa mais de um computador."
  2. "Usar a pasta padrão deste computador" — mostra o caminho atual em mono, `text-text-3`.
- Com a opção 1: aparece `FolderField` com "Escolher pasta" e campo para colar o caminho.
- **Botões:** "Agora não" (secundário) e "Continuar" (primário).

"Agora não" e a opção 2 chamam `POST /storage/first-run/dismiss`. O app segue como hoje e o diálogo não volta; a escolha continua disponível em Configurações.

Depois de validar o caminho (`POST /storage/root/validate`), o diálogo mostra uma destas telas:

| Resultado | Tela |
|---|---|
| Pasta com dados do app | Título "Esta pasta já tem os seus vídeos". Texto: "Encontramos N perfis e M vídeos. Vamos abrir tudo como estava." Botão "Abrir". |
| Pasta nova, sem vídeos locais | Texto: "Vamos preparar esta pasta." Botão "Usar esta pasta". |
| Pasta nova, com vídeos locais | Título "Trazer os vídeos que você já tem?" Texto: "Você tem N vídeos (X GB) neste computador." Botões "Começar vazio" (secundário) e "Trazer os vídeos" (primário). Se for outro disco, linha extra em `text-text-3`: "Os vídeos serão copiados. Os originais continuam em <caminho>." |
| `looks_synced` | Faixa `rounded-card bg-warning-bg text-warning text-sm px-3 py-2`, com ícone `Warning`: "Esta pasta parece sincronizada. O que você apagar aqui some em todos os seus computadores." |
| Inválida | Linha `text-sm text-danger` sob o campo, conforme `reason` (tabela abaixo). |

| `reason` | Texto |
|---|---|
| `not_found` | "Não encontramos esta pasta." |
| `too_broad` | "Escolha uma pasta só para os vídeos, não o disco inteiro nem uma pasta geral, como a sua pasta de usuário, Documentos ou Downloads." |
| `inside_app` | "Escolha uma pasta fora da pasta do aplicativo." |
| `contains_app` | "Escolha uma pasta que não contenha o aplicativo." |
| `overlaps_local_videos` | "Escolha uma pasta diferente da pasta atual dos vídeos." |
| `overlaps_other_root` | "Esta pasta fica dentro de outra pasta do app, ou contém a pasta que você já usa. Escolha uma pasta separada." |
| `path_too_long` | "O caminho desta pasta é longo demais. Escolha uma pasta com um caminho mais curto." |
| `not_writable` | "Não dá para gravar nesta pasta." |
| `unreadable` | "Esta pasta tem dados do app que não puderam ser lidos. Se ela é sincronizada, espere a sincronização terminar e tente de novo." |
| `newer_version` | "Esta pasta foi criada por uma versão mais nova do app. Atualize para abrir." |

**Migração em andamento:** o mesmo diálogo, sem botões de fechar. Texto "Trazendo seus vídeos…", abaixo "N de M" e o título do vídeo atual em `text-text-3`. Botão "Cancelar".

| Fim da migração | Texto |
|---|---|
| Concluída, vídeos movidos (mesmo disco) | "Pronto. Seus vídeos estão na nova pasta." Se sobrou algo na pasta antiga: "Na pasta antiga ficaram só arquivos que o app não leva (como transcrições). Você pode apagá-la quando quiser." |
| Concluída, vídeos copiados (outro disco) | "Pronto. Seus vídeos estão na nova pasta. Os originais continuam em <caminho>. Você pode apagá-los quando quiser." |
| Erro ou cancelamento, **nada movido** (`moved_videos` = 0) | "Não foi possível trazer todos os vídeos. Nada foi apagado e os seus vídeos continuam onde estavam." Botões "Continuar" e "Fechar". |
| Erro ou cancelamento, **com vídeos já movidos** (`moved_videos` > 0) | "K vídeos já estão na nova pasta (<destino>) e não aparecem na lista até você terminar. Nada foi apagado." Botões "Continuar" (primário) e "Fechar". Enquanto isso, a seção Pasta das Configurações mostra o mesmo aviso com o mesmo botão. |

"Continuar" retoma de onde parou; o que já foi levado é pulado.

## 2. Pasta indisponível e somente leitura

### 2.1 Pasta indisponível

Quando `root_available` é `false`. `GlassDialog`, sem X.

- **Título:** "Não encontramos a sua pasta"
- **Texto:** "A pasta <caminho> não está disponível. Verifique se o disco está conectado ou se o programa de sincronização está aberto."
- **Botões:** "Tentar de novo" (primário, `POST /storage/retry`), "Escolher outra pasta" (secundário), "Usar a pasta deste computador por enquanto" (texto, `text-accent-soft`).

A terceira opção vale só até fechar o app; não altera a pasta configurada. O app **nunca** cria a pasta sozinho.

Variação quando `warnings` traz `app_overlaps_root` (o aplicativo foi movido para dentro da pasta, ou o contrário): o texto é "O aplicativo e a pasta dos vídeos não podem ficar um dentro do outro. Mova o aplicativo para outro lugar ou escolha outra pasta." e não há "Tentar de novo".

### 2.2 Somente leitura

Quando `read_only` é `true`. `NoticePill` fixa (seção 7), tom neutro, ícone `LockSimple`:

- Texto: "Em uso em <nome do outro computador>"
- Ação: "Usar neste computador"

Clique abre confirmação (`GlassDialog`, 420 px):

- **Título:** "Usar a pasta neste computador?"
- **Texto:** "O outro computador vai passar a só visualizar. Faça isso apenas se ele não estiver trabalhando agora."
- **Botões:** "Cancelar" / "Usar aqui".

**Quando o outro computador parece parado** (`lock.stale`): a pílula muda para "O outro computador parece parado" com a ação "Usar aqui", e a confirmação diz: "O outro computador (<nome>) não dá sinal há algum tempo. Se ele estiver trabalhando com a sincronização pausada, vai passar a só visualizar. Usar a pasta aqui?" / "Cancelar" / "Usar aqui". **O app nunca assume a pasta sozinho**, nem neste caso.

Em somente leitura: "Novo vídeo", "Gerar cortes", "Publicar", "Apagar" e os controles de preferência do perfil ficam `disabled:opacity-45`, com `title` "Esta pasta está em uso em outro computador."

**Quando este computador perde a pasta no meio de um trabalho** (o outro clicou em "Usar neste computador"): aviso do topo, "A pasta passou a ser usada em <nome>. O que estava em andamento vai terminar; nada novo começa aqui." Downloads, renderizações e envios que já estavam rodando terminam; envios que ainda estavam na fila ficam "Interrompido" ([architecture.md](./architecture.md), 7).

### 2.3 Escrita pendente

Quando `pending_writes > 0` por mais de 10 segundos: `NoticePill` tom aviso, "Não foi possível salvar na pasta agora. Tentando de novo…". Some sozinha.

## 3. Configurações — navegação

A Central de Configurações (`SettingsHubModal.tsx`) ganha três entradas na árvore da esquerda, abaixo de "Aplicação":

| Grupo | Ícone (Phosphor) | Filhos (`SectionId`) | Fase |
|---|---|---|---|
| "Perfis e contas" | `UserCircle` | `profiles` "Perfis"; `profile-accounts` "Contas" | 3 |
| "Marca d'água" | `Stamp` | folha `watermark` | 1 |
| "Armazenamento e limpeza" | `HardDrives` | `storage-folder` "Pasta"; `storage-cleanup` "Limpeza" | 2 e 4 |

Como acrescentar (os seis pontos que o código já segue):

1. `settingsShared.tsx`: id no tipo `SectionId` (l.18-33); grupo em `SETTINGS_NAV_GROUPS` (l.54-101); nome do ícone em `NavIconName` (l.35).
2. `SettingsHubModal.tsx`: `case` do ícone em `renderNavIcon` (l.143-157).
3. Componente da seção em `components/redesign/settings/`, no molde de `AppFoldersSection`: `<div className="flex flex-col gap-7">` com blocos `<section>` + `SettingsSectionLabel` + cartões `SETTINGS_CARD_CLASS` (a constante nova de `settingsShared.tsx`, 0.2; a `CARD_CLASS` de `AppAndDepsSections.tsx` é privada e não é importada).
4. `case "<id>"` em `renderSection` (l.383-541).
5. Props novas em `SettingsHubModalProps` (l.61-139), repassadas em `App.tsx` (l.2134-2205).
6. Carregar ao entrar: `prepareSettingsSection` (`App.tsx:1602`).

"Restaurar padrões" (`RESTORABLE_SECTIONS`, l.461): só `watermark` entra, e restaura transparência, posição e tamanho. Não há rota própria: o frontend chama `PUT /profiles/:id/watermark` com `{ "opacity": 0.7, "position": "top-right", "size_percent": 18 }`. **Não** muda o modo, **não** apaga a imagem, não mexe em perfis, contas, pasta nem regras de limpeza.

O título de cada seção nova mostra, à direita, em `text-xs text-text-3`, "Perfil: <nome>" quando há mais de um perfil.

## 4. Configurações — Marca d'água

Arquivo: `settings/WatermarkSection.tsx` (fase 1).

### Bloco "IMAGEM"

Cartão com a miniatura à esquerda (64×64, `rounded-thumb`, fundo quadriculado discreto feito com `bg-white/[0.04]` para mostrar a transparência) e, à direita:

- Sem imagem: título "Nenhuma imagem", descrição "Envie o seu logotipo em PNG, JPG ou WebP. PNG com fundo transparente fica melhor." Botão `GhostButton variant="accent"` "Enviar imagem".
- Com imagem: título "Imagem enviada", descrição "L × A px". Botões "Trocar imagem" e "Remover" (`GhostButton`; "Remover" pede confirmação presa ao botão, no padrão do `RestoreDefaultsButton`: "Remover a marca d'água?" / "Cancelar" / "Remover").
- A área também aceita arrastar e soltar (mesma zona tracejada do `NewVideoModal`).

Estados: enviando → o botão mostra `SpinnerGap animate-spin` e "Enviando…". Erro → `text-sm text-danger` com o `detail` da rota ("Use uma imagem PNG, JPG ou WebP.", "A imagem passa de 5 MB.").

### Bloco "QUANDO USAR"

`SegmentedChoice` com três opções, desabilitado sem imagem:

| Opção | Valor | Descrição abaixo (`text-sm text-text-2`) |
|---|---|---|
| "Em todos os vídeos" | `always` | "Todo corte gerado sai com a marca d'água." |
| "Em nenhum" | `never` | "Os cortes saem sem marca d'água." |
| "Perguntar antes" | `ask` | "O app pergunta toda vez que for gerar os vídeos." |

Sem imagem, a linha de ajuda diz: "Envie uma imagem para ativar."

**Enviar a imagem não liga a marca d'água** (P21). O modo continua "Em nenhum" até o usuário escolher. Logo depois do primeiro envio, enquanto o modo for "Em nenhum", o bloco "QUANDO USAR" ganha um contorno `ring-2 ring-accent-ring` e a linha de ajuda vira, em `text-sm text-warning`: "A marca d'água ainda está desligada. Escolha quando usar." O destaque some quando o usuário escolhe qualquer opção (inclusive "Em nenhum") ou sai da seção.

### Bloco "APARÊNCIA"

Duas colunas. À esquerda, os controles; à direita, a prévia.

- "Transparência" — `SettingsSlider`, 0% a 95%, passo 5. Mostra "30%". Grava `opacity = 1 − valor`.
- "Tamanho" — `SettingsSlider`, 5% a 50%, passo 1. Mostra "18%".
- "Posição" — `PositionGrid`.

**Prévia:** um quadro vertical de 180×320 px, `rounded-card border border-line bg-bg-2` (o token `bg-bg-elevated` não existe; `tailwind.config.ts` só tem `bg-bg-0` a `bg-bg-4`), com uma faixa cinza no terço de baixo fazendo as vezes da legenda e a imagem sobreposta na posição, no tamanho e na transparência escolhidos. Feita só com CSS. Se há um vídeo aberto, o fundo do quadro é o quadro atual do vídeo. Legenda sob a prévia, `text-xs text-text-3`: "Prévia aproximada."

Aqui, dentro das Configurações, percentuais são permitidos.

Salvamento automático a cada mudança (com espera de 300 ms nos controles deslizantes).

## 5. Configurações — Perfis e contas

### 5.1 Perfis (componente `ProfilesSection`, em `settings/ProfilesSections.tsx`)

**Bloco "PERFIL EM USO"** — um cartão: nome em `text-base text-text-1`, abaixo "N vídeos · M contas" em `text-sm text-text-2`. À direita, "Renomear" (`GhostButton`; o nome vira campo, Enter confirma, Esc cancela).

**Bloco "TODOS OS PERFIS"** — `PickTileGroup`, uma `PickTile` por perfil: nome, "N vídeos · M contas", selo "Em uso" no ativo (`text-xs text-accent-soft`). Clicar numa não ativa troca o perfil. No canto de cada uma (`topRightAction`), menu ⋮ com "Renomear" e "Remover".

Abaixo, `GhostButton variant="accent"` com ícone `Plus`: "Novo perfil". Abre um campo em linha: "Nome do perfil", botões "Cancelar" / "Criar".

Linha de ajuda no fim, `text-sm text-text-2`: "Cada perfil tem os seus vídeos, a sua marca d'água e as suas contas. Use um perfil para cada canal ou assunto."

| Estado | O que aparece |
|---|---|
| Modo local | No lugar de "Novo perfil": "Para ter mais de um perfil, escolha uma pasta em Armazenamento e limpeza." com botão "Escolher pasta". |
| Trocar com algo em processamento | Aviso de erro do topo: "Espere o processamento terminar para trocar de perfil." |
| Remover perfil com vídeos | Confirmação presa ao botão: "Este perfil ainda tem vídeos. Apague os vídeos deste perfil antes de removê-lo." Só "Entendi". (Mover vídeo entre perfis não existe nesta versão.) |
| Remover perfil com envio em andamento (`busy_publishing`) | "Há um envio em andamento para uma conta deste perfil. Espere terminar ou cancele o envio." Só "Entendi". |
| Remover perfil vazio | "Remover o perfil <nome>?" / "As contas ligadas a ele serão desconectadas deste computador." / "Cancelar" / "Remover". |
| Carregando | Três cartões-esqueleto `bg-white/[0.04] animate-pulse` (respeitando `prefers-reduced-motion`). |
| Erro ao carregar | "Não foi possível carregar os perfis." + "Tentar de novo". |

### 5.2 Contas (componente `AccountsSection`, em `settings/ProfilesSections.tsx`)

Um bloco por plataforma: "YOUTUBE" e "TIKTOK". Um bloco só aparece quando `GET /platforms` diz `available: true`.

Cada conta é um cartão `SETTINGS_CARD_CLASS`:

- Foto 36×36 `rounded-pill` (ou ícone `UserCircle` se não houver).
- Nome em `text-base text-text-1`; abaixo, `StatusDot` + texto:

| `connection` | `StatusDot` | Texto | Botão |
|---|---|---|---|
| `connected` | `success` | "Conectada" | "Sair" |
| `login_required` | `warning` | "Entre para publicar neste computador" | "Entrar" (`accent`) |
| `client_missing` | `neutral` | "Falta preparar este computador" | "Preparar" (`accent`) |

- Menu ⋮: "Remover do perfil", "Mover para outro perfil…".

Abaixo dos cartões: `GhostButton variant="accent"`, ícone `Plus`, "Conectar conta do YouTube" (ou "do TikTok").

| Estado | O que aparece |
|---|---|
| Nenhuma conta | Cartão com `text-text-3`: "Nenhuma conta conectada." e, abaixo, "Você só precisa conectar para publicar. Ver e editar os vídeos funciona sem conta." |
| Nenhuma plataforma disponível (fase 3, antes da 5) | A seção inteira mostra só: "A publicação ainda não está disponível nesta versão." |
| "Sair" | Confirmação presa ao botão: "Sair desta conta neste computador?" / "Cancelar" / "Sair". |
| "Sair", com outras contas da mesma plataforma conectadas neste computador | A confirmação ganha a linha `text-sm text-text-2`: "Outras contas do mesmo login podem ser desconectadas junto. Se acontecer, é só entrar de novo nelas." (Se isso acontece mesmo não foi confirmado; ver [architecture.md](./architecture.md), 10.4.) |
| "Sair", "Remover do perfil" ou "Mover" com envio em andamento (`busy_publishing`) | Aviso de erro do topo: "Há um envio em andamento para esta conta. Espere terminar ou cancele o envio." Nada muda. |
| "Remover do perfil" | "Remover <nome> deste perfil?" / "O registro do que já foi publicado continua nos vídeos." / "Cancelar" / "Remover". |
| Envios de hoje (YouTube, quando `uploads_today` > 0) | Linha `text-xs text-text-3` sob o título do bloco: "N envios hoje neste computador." Nunca "N de 100": outro computador com a mesma chave divide o mesmo limite e não entra nesta conta. |
| Sem cofre do sistema (`secret_store: "memory"`) | Faixa de aviso no topo da seção: "Este computador não tem um cofre de senhas disponível. Você vai precisar entrar de novo cada vez que abrir o app." |

### 5.3 Conectar uma conta

`GlassDialog`, 520 px, em passos. O texto dos passos de cada plataforma está em [platforms.md](./platforms.md).

**Passo "Preparar este computador"** (só quando `client_configured` é `false`):

- **Título:** "Preparar o YouTube neste computador"
- **Texto:** "O YouTube pede que cada pessoa use uma chave própria e gratuita. Você faz isso uma vez por computador. Leva uns 10 minutos."
- Lista numerada dos passos (de [platforms.md](./platforms.md), seção 3), cada um com botão "Abrir" (link externo, ícone `ArrowSquareOut`).
- Dois campos: "ID do cliente" e "Chave secreta do cliente" (este com `type="password"`), ou botão "Importar arquivo .json" (lido no navegador; só os dois valores são enviados).
- Botões: "Cancelar" / "Continuar".
- Erro: "Esses dados não parecem corretos. Confira e tente de novo."

**Passo "Entrar":**

- **Título:** "Conectar conta do YouTube"
- **Texto:** "Vamos abrir o YouTube numa nova aba. Entre com a conta do canal e autorize o envio de vídeos."
- Botão primário: "Abrir o YouTube". Depois do clique: `SpinnerGap` + "Aguardando você autorizar…" e link "Cancelar".

**Passo "Escolher o canal"** (`status: "choose_account"`): `PickTileGroup` com os canais. Título "Qual canal você quer conectar?".

**Fim:** "Conta conectada: <nome>" com `StatusDot success`. Botão "Concluir".

| Erro (`error.code`) | Texto |
|---|---|
| `account_mismatch` | "Você entrou com outra conta. Entre com <nome> para reconectar." |
| `account_in_other_profile` | "Esta conta já está no perfil <nome>." + botão "Mover para este perfil" |
| `denied` | "A autorização foi cancelada." |
| `expired` | "O tempo acabou. Tente de novo." |
| outro | "Não foi possível conectar. Tente de novo." |

Todos com "Tentar de novo".

A página que o navegador mostra ao voltar do login é servida pelo backend, sem estilo do app além de fundo `#0a0b0d` e texto claro: "Conta conectada. Você já pode fechar esta aba." ou "Não foi possível conectar. Volte ao app e tente de novo."

### 5.4 "Entrar de novo neste computador"

Não é erro; é o estado normal num computador novo e quando o login vence (no YouTube em modo de teste, a cada 7 dias).

- Na seção Contas: linha da tabela de 5.2 (`login_required`).
- No diálogo Publicar: o destino aparece desabilitado com "Entre para publicar" e botão "Entrar" na própria linha.
- Clique em "Entrar" abre o passo "Entrar" de 5.3 com o título "Entrar de novo em <nome>".
- Se uma publicação parar por isso: `NoticePill` tom aviso, "Entre de novo em <nome> para continuar o envio", ação "Entrar".

## 6. Configurações — Armazenamento e limpeza

### 6.1 Pasta (componente `StorageFolderSection`, em `settings/StorageSections.tsx`)

**Bloco "PASTA DOS SEUS VÍDEOS"**

- Modo local: cartão com título "Neste computador", o caminho em mono, e `GhostButton variant="accent"` "Escolher uma pasta para levar entre computadores". Abre o fluxo da seção 1 a partir da validação.
- Modo raiz: `FolderField` com o caminho; `StatusDot success` "Disponível"; botões "Trocar pasta" e "Deixar de usar esta pasta".

| Botão | O que faz | Confirmação presa ao botão |
|---|---|---|
| "Deixar de usar esta pasta" | Volta para a pasta deste computador (`DELETE /storage/root`). | "O app volta a usar a pasta deste computador (<caminho local>). Os vídeos que estão em <raiz> **continuam lá**, mas deixam de aparecer no app. Nada é apagado nem movido de volta. Para vê-los de novo, escolha esta pasta outra vez." / "Cancelar" / "Confirmar" |
| "Trocar pasta" | **Abre outra pasta.** Mesmo fluxo de validação da seção 1, sem a pergunta "Trazer os vídeos?". | "Os vídeos desta pasta ficam nela. O app passa a mostrar os da pasta nova. Para mudar a pasta de lugar, feche o app e mova-a pelo explorador de arquivos." / "Cancelar" / "Escolher outra pasta" |

**Bloco "OUTROS COMPUTADORES"** (só em modo raiz)

Cartão: "Este computador: <nome>". Abaixo, "Em uso aqui" (`StatusDot success`) ou "Em uso em <outro>" (`StatusDot warning`) com botão "Usar neste computador".

Texto de ajuda: "Use a pasta em um computador de cada vez. Se abrir em dois ao mesmo tempo, o segundo só visualiza."

**Bloco "ESPAÇO USADO"**

Cartão com dois números em `tabular-nums`:

- "Contado no limite" — `counted_bytes`
- "Total no disco" — `total_bytes`

Quando são diferentes, linha `text-sm text-text-2`: "N vídeos com exceção de tamanho não entram na conta." Quando há limite, uma barra fina (4 px, mesma do controle deslizante) mostra `counted / limit`; a barra fica `bg-warning` acima de 100%.

**Avisos fixos** (`text-sm text-text-2`, só em modo raiz):

- "Se esta pasta for sincronizada, o que você apagar aqui some em todos os seus computadores."
- "Mantenha a pasta disponível sem internet, para o app não esperar o download de cada vídeo."

**Arquivos de conflito:** se `conflict_files > 0`, cartão "N arquivos de conflito já resolvidos" com `GhostButton` "Remover arquivos de conflito".

**Arquivos temporários esquecidos:** se `leftover_tmp_files > 0`, cartão "N arquivos temporários esquecidos (X GB)", descrição "Sobraram de um download ou de uma geração interrompida neste computador.", com `GhostButton` "Remover" (confirmação presa ao botão: "Remover de vez?" / "Cancelar" / "Remover"; `POST /storage/leftovers/clear`).

**Pastas não reconhecidas** (nos dois modos): se `unrecognized_folders > 0`, cartão "N pastas ainda não reconhecidas", descrição "São pastas de vídeo sem as informações do app, ou com informações que não puderam ser lidas. Se a pasta é sincronizada, espere a sincronização terminar: elas costumam aparecer sozinhas.", com `GhostButton` "Adicionar ao app". Enquanto `unrecognized_folders_ready` é 0, o botão fica desabilitado (`disabled:opacity-45`), com `title` "Aguardando a sincronização." Confirmação presa ao botão: "Adicionar como vídeos novos? Se as informações ainda estiverem chegando de outro computador, a marca 'manter' e o histórico de publicações de lá podem se perder." / "Cancelar" / "Adicionar" (`POST /storage/folders/adopt`). O app **nunca** adiciona essas pastas sozinho ([architecture.md](./architecture.md), 8.3). Em somente leitura o botão segue a regra geral da seção 2.2.

**Avisos de `warnings`** (faixa `rounded-card bg-warning-bg text-warning text-sm px-3 py-2`, uma por aviso, no topo da seção):

| `warnings` | Texto |
|---|---|
| `data_dir_synced` | "A pasta do aplicativo parece sincronizada. Mova o aplicativo para uma pasta só deste computador. Até lá, um envio interrompido recomeça do início." |
| `credentials_file_in_root` | "Há um arquivo de credenciais na pasta dos vídeos. Guarde-o fora dela." |
| `duplicate_profile` | "Há duas pastas com o mesmo perfil. O app está usando a primeira." |
| `unreadable_profile` | "Um perfil desta pasta não pôde ser lido. Se a pasta é sincronizada, espere a sincronização terminar." |

### 6.2 Limpeza (componente `StorageCleanupSection`, em `settings/StorageSections.tsx`)

**Bloco "LIMPEZA"**

Cartão com `SettingsSwitch` "Avisar quando houver vídeos para apagar". Descrição: "O app nunca apaga nada sozinho. Ele avisa e você decide."

Com o interruptor desligado, os blocos abaixo ficam `opacity-45` e inativos.

**Bloco "REGRAS"**

- Cartão "Vídeos antigos": `SettingsSwitch` + campo numérico em pílula (`w-20`, `tabular-nums`) + "dias". Padrão sugerido ao ligar: 30. Descrição: "Conta a partir do dia em que o vídeo entrou no app."
- Cartão "Tamanho da pasta": `SettingsSwitch` + campo numérico + "GB". Padrão sugerido ao ligar: 50. Descrição: "Quando passar disso, o app avisa. Os mais antigos são sugeridos primeiro."

Validação em linha, `text-sm text-danger`: "Use um número entre 1 e 3650." / "Use um número a partir de 1."

**Bloco "O QUE NUNCA É APAGADO"**

Lista em `text-sm text-text-2`:

- "Vídeos marcados como 'manter'."
- "Arquivos que você enviou do computador (já entram como 'manter')."
- "Vídeos que estão sendo processados ou publicados."

**Bloco "HISTÓRICO"**

Cartão "Últimos itens apagados" com as 5 entradas mais recentes de `GET /cleanup/log`: título, tipo ("Original", "Corte", "Informações do vídeo", "Arquivo de conflito", "Arquivo temporário", "Arquivo de perfil"), tamanho, data, motivo ("por idade", "por tamanho", "por você") e, em modo raiz, o computador que apagou. Botão "Ver tudo" abre um `GlassDialog` com a lista completa rolável (`arc-scroll`). Vazio: "Nada foi apagado ainda."

**Botão:** `GhostButton` "Ver o que pode ser apagado agora" — abre a lista da seção 8.

## 7. Aviso na barra lateral e pílula global

### 7.1 Na barra lateral

Linha nova no **rodapé** da `ArcSidebar` (`frontend/src/components/redesign/ArcSidebar.tsx`), entre a lista (l.490) e o bloco "Novo vídeo / engrenagem" (l.493). Só existe quando `due_count > 0`.

- Botão de largura total, mesmas classes do "Novo vídeo": `h-8 rounded-item text-base text-text-2 hover:bg-glass-hover`, alinhado à esquerda.
- Ícone `Broom` 16 px; texto "N itens para apagar"; à direita, um ponto de 6 px `bg-warning`.
- Com cortes não publicados na lista, o texto vira "N itens para apagar · K não publicados".
- `aria-label`: "N itens para apagar. Abrir a lista."
- Clique: abre a lista da seção 8.

### 7.2 Fora da barra lateral

A barra lateral fica escondida por padrão; um aviso só dentro dela não seria visto. Por isso existe `AppNotices`: um contêiner `fixed top-4 z-chrome flex flex-col gap-2`, com no máximo duas `NoticePill`. A pílula do modo imersivo fica no centro e a engrenagem flutuante foi removida, então os cantos de cima estão livres, **menos** o lado onde a barra lateral aparece.

A barra lateral pode ficar à esquerda ou à direita (`ui.sidebarSide`, `App.tsx:208`). `AppNotices` recebe `sidebarSide` e `sidebarVisible` (fixada ou aberta) e escolhe o canto:

| Barra lateral | `AppNotices` |
|---|---|
| À esquerda (padrão), visível ou não | `right-4 items-end` |
| À direita, escondida | `right-4 items-end` |
| À direita, **visível** (fixada ou aberta) | `left-4 items-start`, para não ficar por cima dela |

`NoticePill`: `h-8 px-3 rounded-pill glass text-sm text-text-1 flex items-center gap-2 shadow-card`.

| Parte | Regra |
|---|---|
| Ícone | Phosphor 14 px, à esquerda |
| Tom | `neutral` (sem borda extra), `warning` (`border border-warning/40`, ícone `text-warning`), `danger` (`border border-danger/40`) |
| Ação | Um botão de texto `text-accent-soft hover:text-accent-hover` |
| Dispensar | X de 20 px, opcional |
| Acessibilidade | `role="status"`; `role="alert"` só no tom `danger` |

Avisos e prioridade (do mais para o menos importante; os que não cabem esperam):

| Aviso | Tom | Texto | Ação | Dispensar |
|---|---|---|---|---|
| Limite de tamanho | `warning` | "A pasta passou do limite" | "Ver" (abre a seção 9) | Não |
| Vídeo acima do limite aguardando decisão | `warning` | "Um vídeo passou do limite da pasta" | "Decidir" (abre a seção 10) | Não |
| Login vencido durante o envio | `warning` | "Entre de novo em <nome> para continuar o envio" | "Entrar" | Não |
| Envios interrompidos | `neutral` | "N envios interrompidos" | "Ver" (abre a fila, seção 13.4) | Sim |
| Envio sem confirmação | `warning` | "Confira um envio em <conta>" | "Ver" (abre a fila, seção 13.4) | Não |
| Somente leitura | `neutral` | "Em uso em <computador>" | "Usar neste computador" | Não |
| Somente leitura, outro computador parado (`lock.stale`) | `neutral` | "O outro computador parece parado" | "Usar aqui" | Não |
| Itens para apagar | `neutral` | "N itens para apagar" | "Ver" | Sim, até fechar o app |
| Envio em andamento | `neutral` | "Enviando para <plataforma>…" | "Ver" | Não; some ao terminar |
| Envio concluído, público | `neutral` | "Publicado em <conta>" | "Abrir" (link externo) | Sim; some em 8 s |
| Envio concluído, com outra privacidade, **igual** à pedida | `neutral` | "Publicado como <privacidade> em <conta>" (por exemplo, "Publicado como privado em <conta>") | "Abrir" | Sim; some em 8 s |
| Envio concluído, com privacidade **diferente** da pedida | `warning` | "Publicado como <privacidade> em <conta>" | "Ver" (abre a fila, que explica) | Sim, só pelo X |
| Rascunho enviado (TikTok) | `neutral` | "Enviado para o TikTok de <conta>" | "Ver" | Sim; some em 8 s |

No modo imersivo ocioso (`immersiveIdle`), `AppNotices` esmaece junto com o resto da interface.

A privacidade na pílula é sempre a **devolvida pela plataforma** (`result.privacy`), comparada com a pedida (`requested_privacy`). A pílula nunca diz só "Publicado" para um vídeo que ficou privado, não listado ou "Só eu". Nomes: `private` → "privado"; `unlisted` → "não listado"; `SELF_ONLY` → "Só eu".

Os dados chegam por `GET /events` (`useAppEvents`), com `GET /cleanup/summary` e `GET /publications` na abertura.

## 8. Lista de confirmação da limpeza

`GlassDialog`, 640 px, altura máxima `min(640px, 100vh − 32px)`, corpo rolável com `arc-scroll`.

- **Título:** "Apagar vídeos antigos"
- **Faixa de aviso** (sempre): `bg-danger-bg text-danger text-sm rounded-card px-3 py-2`, ícone `Warning`: "Os itens são apagados de vez. Eles não vão para a lixeira."
- **Faixa extra** (se `synced_folder_warning`, isto é, em modo raiz): `bg-warning-bg text-warning`, duas linhas:
  - "Se esta pasta é sincronizada, o que for apagado some em todos os seus computadores."
  - "A lista só conhece o que já chegou a este computador. Se você marcou 'manter' em outro, espere a sincronização antes de apagar."

**Grupo 1 — "VÍDEOS ORIGINAIS"** (`SettingsSectionLabel`), com "Marcar todos" à direita.

**Grupo 2 — "CORTES"**, com a linha de ajuda "Os cortes só são apagados se você marcar."

Cada linha (`rounded-item hover:bg-glass-hover px-2.5 py-2 flex items-center gap-3`):

- Caixa de seleção nativa com `accent-[var(--accent)]`, como no `DeleteCutConfirmDialog`.
- Título (`text-base text-text-1`, `line-clamp-1`).
- Abaixo, `text-sm text-text-2`: "há 32 dias · 1,7 GB · <perfil>" (o perfil só aparece com mais de um).
- Selos à direita, `text-xs rounded-pill px-2 h-5`:
  - "Ainda não publicado" — `bg-warning-bg text-warning`
  - "Tem cortes aprovados" — `bg-warning-bg text-warning`
  - "Dá para baixar de novo" — `bg-white/[0.06] text-text-2`
- Menu ⋮ por linha: "Manter este vídeo" (marca "manter" e tira o item da lista).

Itens com selo de aviso vêm no topo do grupo.

**Bloco "FICOU DE FORA"** (recolhido por padrão, se `blocked` não está vazio): "N vídeos em uso ou marcados como 'manter'." Expandido, lista título + motivo ("Em processamento", "Sendo publicado", "Marcado como 'manter'", "Data de download no futuro: confira o relógio do computador", "Não foi possível ler as informações deste vídeo").

**Rodapé:** à esquerda, `text-sm text-text-2 tabular-nums`: "N itens · X GB". À direita: "Cancelar" (secundário) e "Apagar N itens" (perigo; desabilitado com zero marcados).

**Segunda confirmação**, quando há item com selo "Ainda não publicado" ou "Tem cortes aprovados" entre os marcados: confirmação presa ao botão, "K itens marcados ainda não foram publicados. Apagar mesmo assim?" / "Cancelar" / "Apagar".

| Estado | O que aparece |
|---|---|
| Carregando o plano | `SpinnerGap` + "Verificando a pasta…" |
| Nada para apagar | Ícone `CheckCircle` em `text-text-3`, "Nada para apagar agora." Botão "Fechar". |
| Tudo protegido (`all_protected`) | "A pasta passou do limite, mas tudo o que resta está marcado como 'manter'. Desmarque algum vídeo ou aumente o limite." Botões "Abrir configurações" / "Fechar". |
| Não basta (`shortfall_bytes > 0`) | Linha `text-sm text-warning` acima do rodapé: "Mesmo apagando tudo o que está marcado, a pasta continua X GB acima do limite." |
| Apagando | Botões desabilitados; "Apagando…" com `SpinnerGap`. Sem percentual. |
| Concluído | "N itens apagados. X GB liberados." Se houve pulados: "K itens não foram apagados porque estavam em uso ou mudaram desde a lista." Se `folders_kept` > 0: "J pastas ficaram no disco porque têm arquivos que o app não reconhece." Botão "Fechar". |
| Plano vencido (`plan_expired`) | "A lista ficou desatualizada." + "Atualizar". |
| Somente leitura | Lista visível, botão de apagar desabilitado, linha "Esta pasta está em uso em outro computador." |
| Erro | "Não foi possível apagar. Nada foi alterado." + "Tentar de novo". |

Não existe "desfazer".

## 9. Aviso de limite de tamanho

Aparece quando `size_warning_active` é `true`: ao tentar baixar, enviar ou gerar cortes com a pasta acima do limite, e ao clicar em "Ver" na pílula. `GlassDialog`, 460 px.

- **Título:** "A pasta passou do limite"
- **Texto:** "Você definiu X GB e a pasta está com Y GB. Quer apagar vídeos antigos agora?"
- Linha `text-sm text-text-2`, se houver exceções: "Fora da conta: Z GB em vídeos com exceção."
- **Botões:** "Adiar por um dia" (secundário) e "Apagar agora" (primário).

| Ação | Efeito |
|---|---|
| "Apagar agora" | Abre a lista da seção 8 com `rule: "size"`. Ao fechá-la, a operação que estava esperando continua. |
| "Adiar por um dia" | `POST /cleanup/postpone`. O aviso some por 24 horas. A operação que estava esperando continua. |
| Esc ou X | Fecha. A operação que estava esperando **não** começa. |

Variação "tudo protegido": o texto é o de P4 e os botões são "Abrir configurações" e "Adiar por um dia".

## 10. Exceção de tamanho

`GlassDialog`, 460 px, no padrão do `DeleteCutConfirmDialog`.

**Antes de baixar ou enviar** (`exceeds_single`):

- **Título:** "Este vídeo é maior que o limite da pasta"
- **Texto:** "O vídeo tem cerca de X GB e o seu limite é Y GB. Quer abrir uma exceção para ele?"
- Linha `text-sm text-text-2`: "Com a exceção, este vídeo não entra na conta do limite."
- **Botões:** "Não baixar" (secundário) e "Abrir exceção" (primário). Para arquivo local: "Não enviar".

**Depois de baixar** (o tamanho não era conhecido; `size_exception_pending`):

- **Título:** "Um vídeo passou do limite da pasta"
- **Texto:** "<título> tem X GB e o seu limite é Y GB."
- **Botões:** "Apagar este vídeo" (perigo) e "Manter com exceção" (primário). "Apagar este vídeo" pede a confirmação presa ao botão: "Apagar de vez?". Em modo raiz a confirmação ganha a linha "Se esta pasta é sincronizada, ele some em todos os seus computadores."

| Botão | Chamadas |
|---|---|
| "Manter com exceção" | `PUT /videos/:job_id/flags` com `{ "size_exception": true }`. A pendência some. |
| "Apagar este vídeo" | `POST /cleanup/plan` com `{ "rule": "manual", "job_id" }` e, com o plano devolvido, `POST /cleanup/execute` com os itens marcados (o original) e `confirm: true`. É a mesma exclusão da limpeza: registrada, arquivo por arquivo. **Nunca** `DELETE /videos/:job_id`. Se a execução devolver o item em `skipped`, o diálogo mostra "Não foi possível apagar agora." e continua aberto. |

No `NewVideoModal`, a linha de cada arquivo selecionado (l.180-204) que passa do limite ganha o selo `bg-warning-bg text-warning text-xs rounded-pill px-2`: "Maior que o limite". O diálogo aparece ao clicar em "Enviar". O mesmo vale para a entrada direta do `ImmersiveVideoStage` (l.61).

**Na lista de vídeos:** vídeo com exceção ganha, no menu ⋮ da barra lateral, o item "Remover exceção de tamanho".

## 11. "Manter" na barra lateral

O menu ⋮ de cada vídeo na `ArcSidebar` (hoje com "Transcrição" e "Remover") ganha, entre os dois:

- "Manter este vídeo" (ícone `PushPinSimple`) quando `keep` é `false`.
- "Deixar de manter" quando `keep` é `true`.

Vídeo com `keep: true` mostra um `PushPinSimple` de 12 px, `text-text-3`, ao lado do título, com `title` "Este vídeo não entra na limpeza".

Vídeo sem o arquivo do original: a miniatura vira um quadro `bg-white/[0.04]` com o ícone `FilmSlate`, e "Gerar cortes" fica desabilitado. O texto depende de **por que** o arquivo não está lá:

| Campo | Sob o título (`text-xs text-text-3`) | No palco |
|---|---|---|
| `source_missing` (o app apagou) | "Original apagado" | "O vídeo original foi apagado. Os cortes continuam aqui." Se a origem é um link, botão "Baixar de novo" (entrega opcional O2). |
| `source_absent` (não está no disco e ninguém apagou pelo app) | "Ainda não chegou" | "O vídeo ainda não chegou a esta pasta. Se ela é sincronizada, espere a sincronização terminar." **Sem** "Baixar de novo": baixar agora criaria uma segunda cópia. |
| `info_unreadable` | "Informações ilegíveis" | Faixa de aviso: "Não foi possível ler as informações deste vídeo. Se a pasta é sincronizada, espere a sincronização terminar." com o link "Recriar as informações" (confirmação: "O app cria as informações de novo. O histórico de publicações deste vídeo não vem junto. O arquivo antigo fica guardado na pasta." / "Cancelar" / "Recriar"). "Publicar", "Manter" e a exceção ficam desabilitados para este vídeo. |

Corte cujo arquivo não está no disco (`missing`): o cartão do corte no dock aparece esmaecido (`opacity-45`), com `title` "Arquivo ainda não disponível", e "Publicar" fica desabilitado para ele.

Os itens de "manter" só aparecem com a limpeza ligada. Os três estados da tabela acima aparecem sempre.

### 11.1 "Remover" em modo raiz

Hoje "Remover" no menu ⋮ apaga na hora, sem pergunta (`App.tsx:2007`), e em modo local continua assim. **Em modo raiz** a exclusão se espalha para os outros computadores, então o clique passa a abrir uma confirmação (arquivo `DeleteVideoConfirmDialog.tsx`, fase 2; `GlassDialog`, 420 px, no padrão do `DeleteCutConfirmDialog`, sem a caixa "Não perguntar novamente"):

- **Título:** "Apagar este vídeo?"
- **Texto:** "O vídeo e os cortes dele são apagados de vez."
- **Linha** `text-sm text-warning`: "Se esta pasta é sincronizada, eles somem em todos os seus computadores."
- **Botões:** "Cancelar" (secundário) e "Apagar" (perigo).

A rota chamada é a mesma de hoje (`DELETE /videos/:job_id`).

O `DeleteCutConfirmDialog` (apagar um corte) ganha, **só em modo raiz**, a mesma linha de aviso sob o texto que já tem. Em modo local o diálogo fica idêntico. Quem marcou "Não perguntar novamente" continua sem ver o diálogo; a escolha é dele.

## 12. Pergunta de marca d'água por renderização

Só quando o modo do perfil é "Perguntar antes" e existe imagem. Aparece ao clicar em "Gerar cortes" (com renderização no mesmo fluxo), em "Renderizar aprovados" e ao iniciar um lote com renderização. Uma pergunta por clique, não por corte.

Arquivo: `WatermarkAskDialog.tsx` (fase 1). `GlassDialog`, 420 px, cópia do `DeleteCutConfirmDialog`:

- **Título:** "Adicionar a marca d'água?"
- Miniatura da imagem (48×48) ao lado do texto: "Os vídeos gerados agora vão sair com a sua marca."
- Caixa "Não perguntar novamente".
- **Botões:** "Sem marca d'água" (secundário) e "Adicionar" (primário).

Com a caixa marcada, a resposta vira o modo do perfil: "Adicionar" → `always`; "Sem marca d'água" → `never`. Esc ou X cancela o clique original; nada é gerado.

A resposta vai no campo `watermark` do pedido.

## 13. Publicar

### 13.1 Onde fica o botão

- **Rodapé de ações do `GlassDock`** (`GlassDock.tsx:1314-1387`), depois de "Descartar": botão em pílula `h-7`, ícone `PaperPlaneTilt`, texto "Publicar". Habilitado quando o corte selecionado tem `renderedFileName`. Desabilitado, `title`: "Gere o vídeo antes de publicar."
- **Menu ⋮ do cartão do corte** (l.1472-1520): item "Publicar…", acima de "Abrir pasta".
- O botão só existe quando o perfil tem ao menos uma plataforma disponível. Sem nenhuma conta ligada, o clique abre o diálogo no estado vazio.

### 13.2 Diálogo "Publicar"

`GlassDialog`, 720 px, duas colunas.

**Coluna esquerda (200 px):** o corte tocando em `<video>` mudo, em laço, `rounded-card`. Abaixo, título do corte e duração em `text-sm text-text-2 tabular-nums`. Selo "Com marca d'água" quando `watermark` é `true`; nenhum selo quando é `false` ou `null` (corte antigo, não se sabe). Corte antigo sem título guardado: o campo "Título" vem vazio e o botão de publicar espera o usuário preencher.

**Coluna direita:**

**"ONDE PUBLICAR"** — uma linha por conta do perfil, com caixa de seleção, foto, nome e plataforma (ícone `YoutubeLogo` / `TiktokLogo`). Nada vem marcado na primeira vez; depois, o app lembra as contas marcadas da última publicação (em `localStorage`).

| Situação da conta | Na linha |
|---|---|
| Pode publicar | Caixa habilitada |
| Já publicado ali | Selo `bg-white/[0.06] text-text-2`: "Já publicado em 19/11" + link "Ver". Caixa desmarcada. Marcar pede confirmação: "Este corte já foi publicado nesta conta. Publicar de novo?" |
| Sendo publicado neste computador | "Envio em andamento", caixa desabilitada |
| Sendo publicado em outro computador, registro recente | "Envio em andamento em <computador>", caixa desabilitada |
| Envio **parado** (`in_progress.stalled`: de outro computador há mais de um dia, ou deste computador sem envio na fila) | "Envio interrompido em <computador>" + botão de texto "Liberar". Caixa desabilitada até liberar. Clique em "Liberar" pede confirmação presa ao botão: "Confira em <conta> se o vídeo já foi publicado. Liberar permite enviar de novo." / "Cancelar" / "Liberar" (`POST /publications/records/release`). Depois de liberar, a caixa fica habilitada. |
| `login_required` | "Entre para publicar" + botão "Entrar" |
| `client_missing` | "Falta preparar este computador" + botão "Preparar" |
| `quota_exceeded` | "O YouTube avisou que o limite de envios de hoje foi atingido." (Só aparece depois de a plataforma devolver o erro; a contagem deste computador não bloqueia.) |
| `creator_cannot_post` | "Esta conta não pode publicar agora. Tente mais tarde." |
| `video_too_long` | "Este corte é longo demais para esta conta." |

**"TEXTO"**

- "Título" — campo em pílula, preenchido com o título do corte. Contador `text-xs text-text-3 tabular-nums` à direita.
- "Descrição" — `<textarea>` `rounded-card bg-white/[0.06] border border-line`, 4 linhas, preenchida com o resumo do corte, uma linha em branco e as hashtags padrão do perfil.
- Link `text-accent-soft text-sm`: "Usar um texto diferente em cada conta" — troca os dois campos por um par por conta marcada.

**Opções por conta marcada** (um bloco recolhível por conta, com o nome dela no cabeçalho):

YouTube:

- "Quem pode ver" — `SegmentedChoice`: "Privado", "Não listado", "Público". Vem na última escolha daquela conta; na primeira vez, "Privado", com a linha de ajuda "Na primeira vez, publique como privado e confira no YouTube."
- "Este vídeo é feito para crianças?" — `SegmentedChoice` "Não" / "Sim", **sem nada marcado** até a pessoa responder uma vez para aquela conta.

TikTok: ver 13.5.

**Rodapé:** `text-xs text-text-3`: "Ao publicar, você envia este vídeo para as contas marcadas." Botões "Cancelar" e "Publicar em N contas" (primário; "Publicar" quando N = 1).

O botão fica desabilitado enquanto: nenhuma conta marcada; título vazio; uma opção obrigatória sem resposta.

| Estado | O que aparece |
|---|---|
| Carregando (`/publications/prepare`) | Esqueleto das linhas de conta; `SpinnerGap`. |
| Perfil sem conta | "Nenhuma conta conectada a este perfil." + botão "Conectar conta" (abre 5.3). |
| Somente leitura | Botão desabilitado; "Esta pasta está em uso em outro computador." |
| Erro ao preparar | "Não foi possível preparar a publicação." + "Tentar de novo". |
| Erro ao enviar o pedido | O `detail` da rota em `text-sm text-danger` acima do rodapé; o diálogo continua aberto. |
| Pedido aceito | O diálogo fecha. O andamento segue pela pílula e pelo cartão. |

### 13.3 Estado no cartão do corte

No cartão do `GlassDock`, ao lado do ícone `DownloadSimple` que já marca "pronto" (l.995), um segundo ícone de 14 px:

| Estado | Ícone | `title` |
|---|---|---|
| Na fila ou enviando | `SpinnerGap animate-spin`, `text-text-2` | "Enviando…" |
| Publicado em ao menos uma conta | `PaperPlaneTilt weight="fill"`, `text-accent-soft` | "Publicado em N contas" |
| Falhou | `WarningCircle`, `text-danger` | "O envio falhou" |

No texto de estado do dock, com o corte selecionado: "Enviando para o YouTube…", "Publicado no YouTube", "O envio falhou" + "Tentar de novo". Sem percentual.

### 13.4 Fila de envios

Aberta por "Ver" na pílula. `GlassDialog`, 520 px, título "Envios".

Uma linha por publicação: título do corte, conta, e o estado em texto:

| `status` | Texto | Ação |
|---|---|---|
| `queued` | "Na fila" | "Cancelar" |
| `uploading` | "Enviando…" | "Cancelar" |
| `processing` | "A plataforma está processando…" | — |
| `published` | "Publicado" + privacidade ("Privado") | "Abrir" |
| `sent_to_inbox` | "Enviado para o TikTok. Abra o app do TikTok para terminar a postagem." | — |
| `failed` | a mensagem do erro | "Tentar de novo" |
| `needs_login` | "Entre de novo para continuar" | "Entrar" |
| `unconfirmed` | "Enviado, mas sem confirmação. Confira em <conta> se o vídeo apareceu." | "Já está no canal" / "Não está; enviar de novo" / "Cancelar" |
| `paused` (`paused_reason: "restart"`) | "Interrompido" | "Retomar" / "Cancelar" |
| `paused` (`paused_reason: "storage_read_only"`) | "Interrompido: a pasta está em uso em outro computador" | "Retomar" (desabilitado enquanto somente leitura) / "Cancelar" |
| `canceled` | "Cancelado" | — |

"Não está; enviar de novo" pede confirmação presa ao botão: "Confira antes em <conta>. Se o vídeo já estiver lá, enviar de novo publica duas vezes." / "Cancelar" / "Enviar de novo". O app **nunca** reenvia sozinho um vídeo cujo envio pode ter dado certo.

Linha com `record_pending` (publicado, mas ainda não anotado na pasta): sob o estado, `text-xs text-warning`: "Ainda não foi possível anotar este envio na pasta. O app continua tentando."

Depois de publicar no YouTube, se a privacidade devolvida for diferente da pedida, a linha mostra em `text-warning`: "O YouTube deixou este vídeo como privado. Confira no YouTube Studio."

Mensagens de erro:

| `error.code` | Texto |
|---|---|
| `quota_exceeded` | "Você atingiu o limite de envios de hoje. Tente amanhã." |
| `network` | "A conexão caiu. Tente de novo." |
| `file_missing` | "O arquivo do corte não foi encontrado." |
| `rejected` | "A plataforma recusou o vídeo." |
| `too_many_posts` | "A plataforma bloqueou novos envios por enquanto. Tente mais tarde." |
| `private_account_required` | "O TikTok só aceita este envio com a conta em modo privado." |
| outro | "Não foi possível enviar." |

Vazio: "Nenhum envio por aqui."

### 13.5 Opções do TikTok (fase 6)

Seguem as regras de interface do TikTok (R-TT-6). **Não simplifique.**

- Cabeçalho do bloco: o apelido do criador, vindo da consulta feita ao abrir o diálogo.
- **"Publicar direto" é a entrega opcional O1 (pergunta P23; padrão: fica fora).** Sem ela, não há escolha de modo: o bloco mostra só o apelido, a ajuda do rascunho e o aviso de processamento, e os itens marcados "Só em 'Publicar direto'" abaixo não são implementados.
- Modo de envio (só com O1): `SegmentedChoice` "Enviar como rascunho" / "Publicar direto". Padrão: rascunho. Ajuda do rascunho: "O vídeo vai para a caixa de entrada do TikTok. Você termina a postagem no app do TikTok."
- Só em "Publicar direto":
  - "Quem pode ver" — lista só com as opções que a conta devolveu, **sem nenhuma pré-marcada**.
  - "Permitir" — três caixas: "Comentários", "Duetos", "Costuras", **todas desmarcadas**. As que a conta tem desativadas aparecem cinza e inativas.
  - "Divulgar conteúdo comercial" — `SettingsSwitch` desligado. Ligado, mostra duas caixas, "Sua marca" e "Conteúdo de marca"; pelo menos uma precisa ser marcada. Rótulos exibidos conforme a escolha: "Promotional content" / "Paid partnership". Com "Conteúdo de marca", a opção de privacidade "Só eu" fica inativa.
  - Antes do botão, a frase exigida, com link: "By posting, you agree to TikTok's Music Usage Confirmation." A pesquisa só encontrou a frase em inglês; se existe redação oficial em português **não foi confirmado**. Use a frase em inglês até confirmar.
- Aviso `text-sm text-text-2`: "Depois de enviado, o TikTok pode levar alguns minutos para processar."

## 14. Seletor de perfil

Só aparece quando há **mais de um** perfil. Quem tem um perfil só não vê nada novo.

Na linha de topo da `ArcSidebar` (onde ficam "Arquivados/Ativos", trocar lado e fixar), à esquerda: pílula `h-7 px-2.5 rounded-pill bg-white/[0.06] border border-line text-sm text-text-1`, com o nome do perfil (`max-w-[120px] truncate`) e `CaretDown` de 12 px.

Clique abre um menu suspenso no padrão do menu ⋮: um `menuitem` por perfil (o ativo com `Check` à direita), separador `border-line`, e "Gerenciar perfis…" (abre Configurações em `profiles`, com `openSettingsAt`, `App.tsx:1615`).

Trocar com algo em processamento: aviso de erro do topo, "Espere o processamento terminar para trocar de perfil."

## 15. Acessibilidade

- Todo diálogo: `role="dialog"`, `aria-modal`, foco preso, Esc fecha (exceto onde dito), foco volta ao botão que abriu.
- Botão só com ícone tem `aria-label`.
- `SegmentedChoice` e `PositionGrid`: `role="radiogroup"` e setas do teclado.
- Controles deslizantes: setas mudam um passo; `aria-valuetext` em palavras ("30 por cento").
- Selos de aviso têm texto, não só cor.
- `prefers-reduced-motion`: sem giro nem pulso (já tratado em `tokens.css:240-284`; use `animate-spin` e `animate-pulse`, que essas regras desligam).
- Nenhum atalho global novo. Os atalhos existentes (`App.tsx:1041-1212`) não podem disparar com um diálogo novo aberto.

## 16. Capturas de tela por fase

Como não há testes de frontend, cada fase entrega capturas em `docs/redesign/screenshots/profiles-publishing/fase-N/`, uma por estado listado nas tabelas "Estado" deste documento para as telas da fase. A partir da fase 2, uma captura a mais: `AppNotices` com a barra lateral **fixada à direita** (as pílulas vão para a esquerda e não cobrem a barra). O revisor compara com as capturas existentes em `docs/redesign/screenshots/`.
