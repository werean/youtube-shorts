# Redesign — interface imersiva com barra lateral estilo Arc

> **Status:** material de referência. Nenhum código do app foi alterado neste PR ainda. A implementação será enviada para **esta mesma branch** (`design/redesign-arc`) pelo Antigravity.

## 0. Imagens de referência

| Arquivo | O que mostra |
|---|---|
| `01-sidebar-fixada.jpg` | Barra lateral **fixada** (docada). Setas voltar/avançar + fixar no topo, lista de vídeos, "Novo vídeo" e engrenagem embaixo. Dock inferior expandido com timeline e cortes. Velocidade ao lado do volume. |
| `02-painel-acoes-corte.jpg` | Barra lateral **oculta**. Dock aberto, corte selecionado com `Assistir`, `Aprovar`, `Descartar`. Setinha embaixo para recolher o dock. |
| `03-modo-imersivo.jpg` | Corte tocando como **vídeo principal**. Pílula "Corte: …" + "Voltar ao vídeo original", dock recolhido em faixa fina, filete na borda esquerda. |

As imagens são **referência de layout, proporção, blur e clima**. Não são pixel‑perfect. Veja a seção 12 (artefatos para ignorar).

---

## 1. Direção

- App **web (navegador)**, **sempre dark mode**. Remover o tema claro (`[data-theme="light"]` em `frontend/src/lib/tokens.css`) ou deixá-lo inalcançável.
- Inspiração Apple em **clareza e contenção**: poucos elementos, muito respiro, efeitos usados com parcimônia. **Não imitar** semáforo de janela do macOS, ícones SF Symbols nem chrome de janela. É uma página de navegador.
- **Vídeo imersivo em tela cheia.** Todo o resto flutua por cima como **vidro fosco** (blur forte + translucidez).
- Cores calmas, um único acento azul suave. Transições suaves e curtas.
- **Nada técnico na tela principal** (sem porcentagens, logs, resoluções, "9:16", nomes de modelo, VRAM etc.). Isso fica atrás da engrenagem.
- **Sem nome nem logo do app** (nome ainda não decidido). Nenhum texto de marca no topo.
- Sem card externo ao redor do app. Nada de cantos arredondados na janela inteira.
- Estrutura **diferente do layout atual de 3 colunas**.

## 2. Mapa do código atual (para você se localizar; confirme lendo o código)

- Tokens atuais: `frontend/src/lib/tokens.css`, `frontend/src/styles/variables.css`, `frontend/tailwind.config.ts` (cores `bg-0..4`, `border-1..3`, `text-1..3`, `accent` branco, fonte Geist, raios 4–10px).
- Estilos globais: `frontend/src/styles/*.css`, `frontend/src/styles.css`, `frontend/src/components/ui/ui.css`. Guia atual: `frontend/UI_DESIGN_SYSTEM.md`, `frontend/FRONT-END-GUIDE.md`.
- Layout: `frontend/src/components/layout/{MainShell,Sidebar,Topbar}.tsx` — provável ponto de partida para a nova casca.
- Lista de vídeos: `components/VideoListSection.tsx` → vira o conteúdo da barra lateral.
- Player: `components/VideoPlayerSection.tsx`, `components/features/clips/ClipPlayer.tsx`.
- Cortes: `components/app/SuggestedCutsList.tsx`, `components/features/clips/{ClipCard,ClipList}.tsx`, `components/ui/ClipCard.tsx`.
- Workspace do vídeo selecionado: `components/app/SelectedVideoWorkspace.tsx`.
- Transcrição/blocos: `components/features/transcript/*`, `components/dialogs/{TranscriptionContentDialog,BlocksDialog}.tsx`.
- Configurações: `components/ConfigurationSection.tsx`, `components/dialogs/ConfigureAppDialog.tsx` e demais dialogs de config.
- Estado: `frontend/src/App.tsx` (coordenador grande) e `frontend/src/hooks/*`. **Não mudar a lógica**, só a apresentação e o mínimo de estado de UI (sidebar fixada, dock recolhido, corte tocando).
- Diretório `components/ui/` tem duplicações (ex.: `Button.tsx` e `actions/Button/Button.tsx`). Reaproveite o que existir e não crie uma terceira versão.

Regras do `AGENTS.md`: leia o código antes de editar, mudanças mínimas e incrementais, preserve comportamento, **não mude rotas, formatos de resposta, intervalos de polling, comandos de processo nem caminhos de artefatos**. Validar com `cd frontend && bun run build`.

---

## 3. Layout geral

Viewport inteira (`100dvh × 100vw`), `overflow: hidden`, sem padding externo e sem card.

```
┌────────────────────────────────────────────────────────────────┐
│ [‹ ›] (pílula, só com barra oculta)      [pílula do corte]  ⚙ │  z: chrome
│┃                                                               │
│┃            VÍDEO (cover/contain sobre fundo escuro)           │  z: vídeo
│┃                                                               │
│ ┌──────────────── DOCK de vidro (mesma largura) ────────────┐ │
│ │ ▶ ⏮ 14:37 / 58:21 ━━━━●━━━━━━━━ [1x] ⏭ 🔊                 │ │  z: dock
│ │ [Transcrição]  régua 10:00 20:00 …  cartões dos cortes    │ │
│ │                    [Podcast ▾] [Revisar antes ◯] [Gerar]  │ │
│ └────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────┘
 ┃ = filete da borda esquerda (hot zone da barra lateral)
```

- **Vídeo:** `position: fixed; inset: 0` quando a barra está oculta. Quando fixada, a área de conteúdo ganha `margin-left` igual à largura da barra + gap, e o vídeo/dock se ajustam (ver 4.3). Use `object-fit: contain` num fundo `--bg-canvas` (vídeos verticais ficam centralizados sem cortar; `cover` só se o usuário preferir). Fundo atrás do vídeo: o próprio quadro desfocado (`filter: blur(60px) brightness(.4)` num `<video>`/`<img>` duplicado, `transform: scale(1.2)`) para preencher laterais com cor coerente.
- **Dock inferior:** mesma largura do conteúdo (mesmas margens laterais, `16px`), ancorado embaixo com `16px` de distância. Largura = `calc(100% - 32px)` (ou menos a barra fixada).
- Barra superior: **não existe como barra**. Só elementos soltos flutuantes (pílula de setas, pílula do corte, engrenagem).

## 4. Barra lateral de vídeos (estilo Arc)

### 4.1 Comportamento
- **Oculta por padrão.** Aparece ao passar o mouse na **zona ativa** da borda esquerda (`8px` de largura, altura total, invisível, `position: fixed; left: 0; top: 0; bottom: 0; z-index` acima do vídeo).
- Aparece **sobreposta** ao vídeo (flutuante, vidro), com `delay` de entrada ~80ms para evitar abrir sem querer e `delay` de saída ~250ms ao tirar o mouse (permitir mover o mouse em diagonal).
- Botão **fixar** (pin) no topo: ao fixar, a barra vira **docada** (altura total da viewport, empurra o conteúdo para a direita). Estado persistido em `localStorage` (`ui.sidebarPinned`).
- Fixada, ela não some ao tirar o mouse. Clicar de novo no pin desafixa e ela volta a ser overlay.
- Atalho opcional: `Ctrl/Cmd + B` alterna fixada.
- Teclado: foco em qualquer item dentro da barra a mantém aberta (`:focus-within`).

### 4.2 Conteúdo (de cima para baixo)
1. **Linha de navegação:** seta voltar, seta avançar (navegam pelo histórico de vídeos abertos), espaço flexível, botão **fixar**. Botões 28×28, ícone 16px, sem rótulo.
2. **Lista de vídeos salvos** (rolável, scrollbar fina e quase invisível):
   - Item: miniatura **pequena** (`44×28px`, raio 6px, `object-fit: cover`, vinda do vídeo real) + título (13px, 1–2 linhas com `line-clamp`).
   - Ativo: fundo `--glass-item-active` + borda hairline + leve brilho interno.
   - Hover: fundo `--glass-item-hover`.
   - Processando: spinner pequeno (14px, traço fino) no lado direito. **Sem porcentagem** e sem texto técnico.
   - Menu de contexto de cada item (renomear, arquivar, excluir) via botão `…` que aparece só no hover — reaproveitar as ações que já existem em `VideoListSection.tsx` / `menuOpenId`.
3. **Rodapé:** botão `+ Novo vídeo` (abre o fluxo de upload/URL existente em `UploadSection.tsx`, dentro de um popover/modal de vidro) e botão de engrenagem (configurações avançadas).

### 4.3 Medidas
- Largura: `260px` (min 240, max 300). Altura overlay: `calc(100dvh - 24px)` com `12px` de distância das bordas (flutuante). Altura fixada: `100dvh`, sem distância, raio só no lado direito.
- Padding interno `12px`; gap entre itens `2px`; item `padding: 8px 10px`, raio `10px`.
- Raio do painel overlay: `18px`.

### 4.4 Dica de que a barra existe (quando oculta) — **MUITO IMPORTANTE**
O usuário rejeitou explicitamente um cartão/botão grande. A dica é **somente um filete**:
- Linha vertical de **2px de largura × 40px de altura**, raio `1px`, `left: 6px`, centralizada verticalmente.
- Cor `rgba(255,255,255,0.20)`; no hover da zona ativa vai para `0.55` e cresce para `56px` de altura (transição 220ms).
- **Sem** caixa, **sem** seta/chevron, **sem** fundo, **sem** texto, **sem** blur próprio.
- Some (`opacity: 0`) quando a barra está aberta/fixada e no modo imersivo com mouse parado por 2s (reaparece no movimento do mouse).
- Observação: na `02-painel-acoes-corte.jpg` o filete não aparece por erro do gerador. Ele deve existir em todos os estados com a barra oculta.

### 4.5 Barra oculta: controles que ficam visíveis
- **Pílula de setas** no canto superior esquerdo: `top: 16px; left: 16px`, vidro, altura 32px, contém voltar e avançar (ícones 16px). Some junto com o filete quando a barra fixada está visível (as setas passam a viver dentro da barra).
- **Engrenagem** no canto superior direito: `top: 16px; right: 16px`, botão circular 32px de vidro.

---

## 5. Dock inferior de vidro

### 5.1 Estados
- **Expandido** (padrão): altura ~`236px` (playback `44px` + timeline `~124px` + rodapé de ações `44px` + paddings). Todos os controles visíveis.
- **Recolhido:** faixa fina `~56px`: play, tempo `0:42 / 2:42`, scrubber fino (4px), velocidade. Sem timeline nem ações.
- Alternância por **setinha discreta** (chevron 16px, ícone puro, sem caixa; `opacity .5`, `.9` no hover) centrada na borda superior do dock quando expandido (aponta para baixo) e no centro da faixa quando recolhido (aponta para cima). Transição: `height` + `transform` 320ms com `--ease-out`, conteúdo faz fade 150ms.
- Estado persistido em `localStorage` (`ui.dockCollapsed`). No **modo imersivo (corte tocando)** começa recolhido.

### 5.2 Linha de reprodução (expandido)
Da esquerda para a direita: **play/pause**, **anterior**, tempo `14:37 / 58:21` (`font-variant-numeric: tabular-nums`), **scrubber** (flexível), **pílula de velocidade** (`1x → 1.25x → 1.5x → 2x → 1x` ao clicar; mostra o valor atual), **próximo**, **volume**.
- Scrubber: trilha 4px (`rgba(255,255,255,.18)`), preenchimento branco `.9`, thumb 12px branco que só aparece no hover (sempre visível no foco). Em hover a trilha cresce para 6px.
- **Marcadores dos cortes permanecem na barra de progresso** (esta é regra do produto): segmentos azuis translúcidos (`--accent-soft`) sobre a trilha, posicionados por `start/duration` e `end/duration` de cada corte. Clicar num segmento ou no cartão salta para o início do corte.

### 5.3 Timeline com cartões de corte
- Fileira horizontal com **régua de tempo** em cima (marcas a cada 10:00, tipografia 11px, `--text-3`) e, abaixo, uma faixa de segmentos azuis (altura 8px, raio full, `rgba(91,156,255,.35)`).
- **Cartões pequenos** posicionados pelo **tempo real** do corte, ligados ao segmento por um ponto azul (6px) e uma linha de 1px.
- Cartão: `~108px` de largura, miniatura `108×60px` no topo (raio 8px, vinda do frame real do corte), título (12px, 2 linhas máx.), duração (11px, tabular-nums), **bolinha de status** + rótulo (11px).
  - **Sugerido:** bolinha verde `--success`. 
  - **Aprovado:** bolinha azul `--accent`.
  - **Pronto:** bolinha azul/verde e ícone de **download** no canto (aparece quando o MP4 já foi gerado — hoje isso vem do cruzamento com a pasta de saída; reaproveitar essa lógica).
  - **Descartado:** `opacity .35` + `grayscale`, ou oculto (alternável por um botão "mostrar descartados" dentro da transcrição/painel; padrão: oculto).
- Se dois cartões colidirem, empilhar com leve deslocamento horizontal e permitir scroll horizontal da timeline (`scroll-snap-type: x proximity`, scrollbar escondida). Sem sobreposição que esconda título.
- **Cartão selecionado:** contorno azul suave (`box-shadow: 0 0 0 1.5px var(--accent-ring)`), elevação sutil (`translateY(-2px)`), e **ações inline** abaixo do cartão: `▶ Assistir`, `✓ Aprovar`, `✕ Descartar` (botões pequenos, 28px de altura, estilo "ghost" de vidro, ícones 14px).
  - **Assistir:** toca o corte como **vídeo principal** (seção 6).
  - **Aprovar / Descartar:** alteram o estado do corte (sugerido/aprovado/rejeitado) usando as chamadas que já existem (`updateCuts`, `hooks/useCuts*.ts`). O ajuste de início/fim (±1s) e o título editável continuam existindo, mas atrás de um clique duplo no título / menu `…` do cartão, não na tela principal.
- Botão **Transcrição** (vidro, ícone documento + texto 12px) à esquerda da régua. Abre um **painel/popover de vidro** (≈ `min(560px, 90vw)`, altura até `60vh`) ancorado acima do dock, com abas **Transcrição** e **Blocos** (blocos semânticos), botões **Copiar** e **Baixar**. Transcrição e blocos **nunca** aparecem por padrão.

### 5.4 Rodapé de ações (canto inferior direito do dock)
- **Seletor de preset** (ex.: `Podcast ▾`): pílula de vidro com menu. Presets são uma camada nova no frontend (hoje não existem); começar com 2–3 opções fixas que mapeiam para as opções já existentes do pipeline.
- **Toggle `Revisar antes`**: mapeia para a opção "Revisar antes" do modo em lote.
- **Botão primário `Gerar cortes`**: azul sólido `--accent`, texto branco, altura 36px, raio full.
- **Configurações avançadas** ficam atrás da engrenagem (modelo, whisper, ffmpeg, LLM, dependências, etc.). Nada disso na tela principal.
- Estados de job (baixando, transcrevendo, analisando, aguardando aprovação, renderizando, concluído, erro) aparecem como **texto curto em linguagem natural** dentro do dock ou da pílula do item processando (ex.: "Transcrevendo…"), **sem percentuais**. Erro: mensagem humana + ação ("Tentar de novo"), em vidro com acento vermelho discreto.

---

## 6. Assistindo um corte como vídeo principal

- Pílula de vidro **centralizada no topo** (`top: 16px`): `Corte: <título>` + link/botão **`Voltar ao vídeo original`** (cor `--accent-soft`). Sem fundo grande.
- O vídeo principal passa a ser o trecho do corte; **o scrubber fica limitado ao intervalo do corte** (tempo mostra `0:42 / 2:42`, relativo ao corte).
- O dock entra **recolhido** (faixa fina) por padrão; a setinha o expande.
- Ao voltar ao original, retomar na posição em que o usuário estava antes (ou no início do corte, se preferir; documente a escolha).
- Se o corte estiver "Pronto" (MP4 renderizado), pode tocar o arquivo renderizado; caso contrário, tocar o vídeo original limitado ao `start`/`end` (`timeupdate` + pausa no `end`).

---

## 7. Tokens de design

### 7.1 CSS custom properties (substituir/estender `tokens.css`)
```css
:root {
  color-scheme: dark;

  /* Base */
  --bg-canvas: #0a0b0d;
  --bg-elevated: #101216;

  /* Vidro */
  --glass-bg: rgba(20, 22, 28, 0.55);
  --glass-bg-strong: rgba(20, 22, 28, 0.72);   /* menus, popovers (mais legível) */
  --glass-blur: 28px;
  --glass-saturate: 150%;
  --glass-border: rgba(255, 255, 255, 0.08);
  --glass-border-strong: rgba(255, 255, 255, 0.14);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.06);  /* brilho interno no topo */
  --glass-item-hover: rgba(255, 255, 255, 0.06);
  --glass-item-active: rgba(255, 255, 255, 0.10);

  /* Texto */
  --text-1: rgba(255, 255, 255, 0.92);
  --text-2: rgba(255, 255, 255, 0.60);
  --text-3: rgba(255, 255, 255, 0.40);

  /* Acento (um só, azul suave) */
  --accent: #3b82f6;
  --accent-hover: #5b9cff;
  --accent-active: #2f6fe0;
  --accent-soft: #5b9cff;                       /* texto/links sobre vidro */
  --accent-seg: rgba(91, 156, 255, 0.35);       /* segmentos dos cortes */
  --accent-ring: rgba(91, 156, 255, 0.85);
  --accent-fg: #ffffff;

  /* Status */
  --success: #34d399;
  --danger: #f87171;
  --danger-bg: rgba(248, 113, 113, 0.12);

  /* Raios */
  --radius-panel: 18px;   /* sidebar overlay e dock: 16–20px */
  --radius-card: 10px;    /* cartões de corte: 10–12px */
  --radius-item: 10px;
  --radius-thumb: 6px;
  --radius-pill: 999px;

  /* Espaçamento (base 4px) */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px;

  /* Sombras */
  --shadow-panel: 0 12px 40px rgba(0, 0, 0, 0.45), 0 2px 8px rgba(0, 0, 0, 0.30);
  --shadow-card: 0 4px 14px rgba(0, 0, 0, 0.35);
  --shadow-pop: 0 18px 60px rgba(0, 0, 0, 0.55);

  /* Dimensões */
  --sidebar-w: 260px;
  --sidebar-gap: 12px;
  --edge-hot: 8px;
  --dock-h: 236px;
  --dock-h-collapsed: 56px;
  --dock-gap: 16px;
  --card-w: 108px;
  --card-thumb-h: 60px;
  --item-thumb-w: 44px;
  --item-thumb-h: 28px;

  /* Tipografia */
  --font-sans: "Inter", "Geist", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --fs-xs: 11px;  --fs-sm: 12px;  --fs-base: 13px;  --fs-md: 15px;
  --fw-regular: 400; --fw-medium: 500; --fw-semibold: 600;

  /* Camadas */
  --z-video: 0;
  --z-dock: 20;
  --z-edge: 30;
  --z-sidebar: 40;
  --z-chrome: 50;     /* pílulas e engrenagem */
  --z-popover: 60;
  --z-modal: 80;

  /* Movimento */
  --dur-fast: 150ms;
  --dur-base: 220ms;
  --dur-slow: 320ms;
  --ease-out: cubic-bezier(0.32, 0.72, 0, 1);
}
```
Remover o tema claro, o texto `uppercase` com `letter-spacing` forte dos labels atuais (`.ds-label`, `label` em `tokens.css`) na nova UI e o acento branco.

### 7.2 Extensão do Tailwind (`frontend/tailwind.config.ts`)
```ts
theme: {
  extend: {
    colors: {
      canvas: "var(--bg-canvas)",
      glass: { DEFAULT: "var(--glass-bg)", strong: "var(--glass-bg-strong)",
               hover: "var(--glass-item-hover)", active: "var(--glass-item-active)" },
      line: { DEFAULT: "var(--glass-border)", strong: "var(--glass-border-strong)" },
      text: { 1: "var(--text-1)", 2: "var(--text-2)", 3: "var(--text-3)" },
      accent: { DEFAULT: "var(--accent)", hover: "var(--accent-hover)", active: "var(--accent-active)",
                soft: "var(--accent-soft)", seg: "var(--accent-seg)", fg: "var(--accent-fg)" },
      success: "var(--success)", danger: "var(--danger)",
    },
    borderRadius: { panel: "var(--radius-panel)", card: "var(--radius-card)",
                    item: "var(--radius-item)", thumb: "var(--radius-thumb)", pill: "var(--radius-pill)" },
    boxShadow: { panel: "var(--shadow-panel)", card: "var(--shadow-card)", pop: "var(--shadow-pop)" },
    fontFamily: { sans: ["Inter", "Geist", "system-ui", "-apple-system", "sans-serif"] },
    fontSize: { xs: ["11px", "1.3"], sm: ["12px", "1.4"], base: ["13px", "1.5"], md: ["15px", "1.4"] },
    transitionDuration: { fast: "150ms", base: "220ms", slow: "320ms" },
    transitionTimingFunction: { out: "cubic-bezier(0.32,0.72,0,1)" },
    backdropBlur: { glass: "28px" },
    zIndex: { dock: "20", edge: "30", sidebar: "40", chrome: "50", popover: "60", modal: "80" },
  },
}
```
(Mantenha os nomes existentes que ainda forem usados por telas que você não for refazer agora, para não quebrar o build; depois migre.)

### 7.3 Ícones
- Biblioteca única de **linha**, traço `1.5`, tamanhos `16px` (padrão), `14px` (botões pequenos) e `20px` (play principal). Sugestão: **Phosphor Icons** (peso `regular`) ou **Heroicons outline**. O projeto não usa Lucide/shadcn; **não** instalar essas. Todos os ícones da mesma família e mesmo traço. Nada de emojis como ícone.
- Ícones necessários: play, pause, skip‑back, skip‑forward, volume, arrow‑left, arrow‑right, push‑pin, plus, gear, file‑text (transcrição), caret‑down/up, check, x, download, dots‑three, spinner.

### 7.4 Fonte
Inter (self‑host via `@fontsource-variable/inter`, evitando requisição externa) com fallback para Geist/system‑ui. `font-feature-settings: "tnum"` nos tempos.

---

## 8. Movimento

- Curva padrão: `cubic-bezier(0.32, 0.72, 0, 1)`. Durações: `150ms` (hover/cor), `220ms` (opacidade, filete, pílulas), `320ms` (barra lateral e dock).
- Barra lateral overlay: entra com `translateX(-12px) → 0` + `opacity 0 → 1` + `blur(8px) → 0` (no vidro, via `backdrop-filter` interpolado ou só fade). Sai o inverso.
- Barra fixada ↔ overlay: o `margin-left` do conteúdo anima em 320ms.
- Dock recolher/expandir: `height` (ou `grid-template-rows: 1fr → 0fr`) + fade do conteúdo.
- Cartão: hover `translateY(-1px)`, selecionado `-2px`. Nada de bounce, nada de parallax, nada de glow chamativo.
- Troca de vídeo: crossfade 220ms.
- **`prefers-reduced-motion: reduce`**: remover translate/scale e blur animado; manter só fades de 100ms.

---

## 9. Snippets de CSS

### 9.1 Vidro base
```css
.glass {
  background: var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
          backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight), var(--shadow-panel);
  color: var(--text-1);
}
.glass--strong { background: var(--glass-bg-strong); }

/* Fallback sem backdrop-filter: fundo mais opaco para manter legibilidade */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: rgba(20, 22, 28, 0.92); }
}
```

### 9.2 Barra lateral (oculta / hover / fixada)
```css
.edge-zone {            /* zona ativa invisível */
  position: fixed; inset: 0 auto 0 0;
  width: var(--edge-hot);
  z-index: var(--z-edge);
}
.edge-hint {            /* o ÚNICO indício quando oculta: um filete */
  position: fixed; left: 6px; top: 50%;
  width: 2px; height: 40px; border-radius: 1px;
  transform: translateY(-50%);
  background: rgba(255, 255, 255, 0.20);
  transition: height var(--dur-base) var(--ease-out),
              background var(--dur-base) var(--ease-out),
              opacity var(--dur-base) var(--ease-out);
  pointer-events: none;
  z-index: var(--z-edge);
}
.edge-zone:hover + .edge-hint,
.sidebar[data-open="true"] ~ .edge-hint { background: rgba(255,255,255,.55); height: 56px; }
.sidebar[data-open="true"] ~ .edge-hint,
.sidebar[data-pinned="true"] ~ .edge-hint { opacity: 0; }

.sidebar {
  position: fixed; z-index: var(--z-sidebar);
  top: var(--sidebar-gap); bottom: var(--sidebar-gap); left: var(--sidebar-gap);
  width: var(--sidebar-w);
  display: flex; flex-direction: column; gap: var(--space-2);
  padding: var(--space-3);
  border-radius: var(--radius-panel);
  opacity: 0; transform: translateX(-12px); pointer-events: none;
  transition: opacity var(--dur-slow) var(--ease-out),
              transform var(--dur-slow) var(--ease-out);
}
.sidebar[data-open="true"],
.sidebar:focus-within { opacity: 1; transform: none; pointer-events: auto; }

/* Fixada: docada, altura total, empurra o conteúdo */
.sidebar[data-pinned="true"] {
  top: 0; bottom: 0; left: 0;
  border-radius: 0 var(--radius-panel) var(--radius-panel) 0;
  opacity: 1; transform: none; pointer-events: auto;
}
.app-content {
  position: fixed; inset: 0;
  transition: left var(--dur-slow) var(--ease-out);
}
body[data-sidebar-pinned="true"] .app-content { left: calc(var(--sidebar-w) + var(--sidebar-gap)); }
```

### 9.3 Itens da barra lateral
```css
.video-item {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: var(--radius-item);
  color: var(--text-2); font-size: var(--fs-base);
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease;
}
.video-item:hover { background: var(--glass-item-hover); color: var(--text-1); }
.video-item[aria-current="true"] {
  background: var(--glass-item-active); color: var(--text-1);
  box-shadow: inset 0 0 0 1px var(--glass-border-strong);
}
.video-item__thumb {
  width: var(--item-thumb-w); height: var(--item-thumb-h);
  border-radius: var(--radius-thumb); object-fit: cover; flex: none;
}
.video-item__title { flex: 1; min-width: 0; display: -webkit-box;
  -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.spinner-sm { width: 14px; height: 14px; border-radius: 50%;
  border: 1.5px solid rgba(255,255,255,.2); border-top-color: var(--text-1);
  animation: spin 0.9s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
```

### 9.4 Pílulas flutuantes e engrenagem
```css
.pill { display: inline-flex; align-items: center; gap: 4px; height: 32px;
  padding: 0 10px; border-radius: var(--radius-pill); font-size: var(--fs-sm); }
.floating-tl { position: fixed; top: var(--space-4); left: var(--space-4); z-index: var(--z-chrome); }
.floating-tr { position: fixed; top: var(--space-4); right: var(--space-4); z-index: var(--z-chrome); }
.floating-tc { position: fixed; top: var(--space-4); left: 50%; transform: translateX(-50%); z-index: var(--z-chrome); }
.icon-btn { width: 32px; height: 32px; display: grid; place-items: center;
  border-radius: var(--radius-pill); color: var(--text-2);
  transition: background var(--dur-fast) ease, color var(--dur-fast) ease; }
.icon-btn:hover { background: var(--glass-item-hover); color: var(--text-1); }
```

### 9.5 Dock (expandido / recolhido)
```css
.dock {
  position: fixed; z-index: var(--z-dock);
  left: var(--dock-gap); right: var(--dock-gap); bottom: var(--dock-gap);
  height: var(--dock-h);
  border-radius: var(--radius-panel);
  padding: var(--space-3) var(--space-4);
  display: grid; grid-template-rows: auto 1fr auto; gap: var(--space-3);
  overflow: hidden;
  transition: height var(--dur-slow) var(--ease-out);
}
body[data-sidebar-pinned="true"] .dock { left: calc(var(--sidebar-w) + var(--sidebar-gap) + var(--dock-gap)); }
.dock[data-collapsed="true"] { height: var(--dock-h-collapsed); grid-template-rows: auto 0fr 0fr; }
.dock__timeline, .dock__actions { transition: opacity var(--dur-base) ease; }
.dock[data-collapsed="true"] .dock__timeline,
.dock[data-collapsed="true"] .dock__actions { opacity: 0; pointer-events: none; }
.dock__toggle { position: absolute; left: 50%; bottom: 4px; transform: translateX(-50%);
  width: 28px; height: 16px; display: grid; place-items: center;
  color: var(--text-3); background: none; border: 0; }
.dock__toggle:hover { color: var(--text-1); }
.dock[data-collapsed="true"] .dock__toggle { bottom: auto; top: 2px; }
.dock[data-collapsed="true"] .dock__toggle svg { transform: rotate(180deg); }
```

### 9.6 Scrubber com marcadores de corte
```css
.scrubber { position: relative; height: 4px; border-radius: 2px;
  background: rgba(255,255,255,.18); cursor: pointer;
  transition: height var(--dur-fast) ease; }
.scrubber:hover { height: 6px; }
.scrubber__fill { position: absolute; inset: 0 auto 0 0; border-radius: inherit; background: rgba(255,255,255,.9); }
.scrubber__cut { position: absolute; top: 0; bottom: 0; border-radius: inherit;
  background: var(--accent-seg); /* left/width em % calculados por start/end */ }
.scrubber__thumb { position: absolute; top: 50%; width: 12px; height: 12px; border-radius: 50%;
  background: #fff; transform: translate(-50%, -50%) scale(0);
  transition: transform var(--dur-fast) var(--ease-out); box-shadow: 0 1px 4px rgba(0,0,0,.4); }
.scrubber:hover .scrubber__thumb, .scrubber:focus-visible .scrubber__thumb { transform: translate(-50%,-50%) scale(1); }
```

### 9.7 Cartão de corte
```css
.cut-card {
  position: absolute;             /* left em % pelo tempo real */
  width: var(--card-w); padding: 6px; border-radius: var(--radius-card);
  background: rgba(255,255,255,.05); border: 1px solid var(--glass-border);
  box-shadow: var(--shadow-card); cursor: pointer;
  transition: transform var(--dur-base) var(--ease-out),
              box-shadow var(--dur-base) var(--ease-out),
              background var(--dur-fast) ease, opacity var(--dur-base) ease;
}
.cut-card:hover { transform: translateY(-1px); background: rgba(255,255,255,.08); }
.cut-card[aria-selected="true"] { transform: translateY(-2px);
  box-shadow: 0 0 0 1.5px var(--accent-ring), var(--shadow-card); background: rgba(91,156,255,.10); }
.cut-card[data-status="descartado"] { opacity: .35; filter: grayscale(1); }
.cut-card__thumb { width: 100%; height: var(--card-thumb-h); border-radius: 8px; object-fit: cover; }
.cut-card__title { margin-top: 6px; font-size: var(--fs-sm); font-weight: var(--fw-medium);
  color: var(--text-1); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.cut-card__meta { display: flex; justify-content: space-between; align-items: center; margin-top: 4px;
  font-size: var(--fs-xs); color: var(--text-2); font-variant-numeric: tabular-nums; }
.status-dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 6px; }
.status-dot[data-status="sugerido"] { background: var(--success); }
.status-dot[data-status="aprovado"],
.status-dot[data-status="pronto"]   { background: var(--accent-soft); }
.cut-card__actions { display: flex; gap: 6px; margin-top: 6px; }
```

### 9.8 Botões, pílula de seleção e toggle
```css
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  height: 36px; padding: 0 16px; border-radius: var(--radius-pill);
  font: var(--fw-medium) var(--fs-base)/1 var(--font-sans); cursor: pointer; border: 1px solid transparent;
  transition: background var(--dur-fast) ease, transform var(--dur-fast) ease, border-color var(--dur-fast) ease; }
.btn--primary { background: var(--accent); color: var(--accent-fg); }
.btn--primary:hover  { background: var(--accent-hover); }
.btn--primary:active { background: var(--accent-active); transform: scale(.98); }
.btn--primary:disabled { opacity: .45; cursor: not-allowed; }
.btn--ghost { height: 28px; padding: 0 10px; font-size: var(--fs-sm);
  background: rgba(255,255,255,.06); border-color: var(--glass-border); color: var(--text-1); }
.btn--ghost:hover { background: rgba(255,255,255,.12); }
.btn--ghost.btn--danger:hover { background: var(--danger-bg); color: var(--danger); }
.pill-select { height: 36px; padding: 0 14px; border-radius: var(--radius-pill);
  background: rgba(255,255,255,.06); border: 1px solid var(--glass-border); color: var(--text-1); }

.toggle { width: 36px; height: 20px; border-radius: 999px; background: rgba(255,255,255,.18);
  position: relative; transition: background var(--dur-base) var(--ease-out); }
.toggle::after { content: ""; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
  border-radius: 50%; background: #fff; transition: transform var(--dur-base) var(--ease-out); }
.toggle[aria-checked="true"] { background: var(--accent); }
.toggle[aria-checked="true"]::after { transform: translateX(16px); }
```

### 9.9 Foco, acessibilidade e movimento reduzido
```css
:where(button, [role="button"], a, input, select, [tabindex]):focus-visible {
  outline: 2px solid var(--accent-ring); outline-offset: 2px; border-radius: inherit;
}
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { transition-duration: 100ms !important; animation-duration: 1ms !important; }
  .sidebar, .cut-card { transform: none !important; }
}
```
Contraste: texto sobre vidro deve manter ≥ 4.5:1; se o vídeo atrás for claro, aumentar `--glass-bg` para `0.65–0.72` em vez de reduzir o blur.

---

## 10. Estados que precisam existir (tire screenshots de cada um)
1. Barra lateral **fixada**, dock expandido, nenhum corte selecionado.
2. Barra **oculta** + filete na borda + pílula de setas + engrenagem; dock expandido; um corte **selecionado** com Assistir/Aprovar/Descartar.
3. Barra **overlay** aberta por hover (flutuando sobre o vídeo).
4. **Modo imersivo**: corte tocando, pílula "Corte: …" + "Voltar ao vídeo original", dock recolhido.
5. Dock **recolhido** no vídeo original.
6. Painel de **Transcrição** aberto.
7. Item **processando** na lista (spinner, sem %), e estado de **erro** humano.
8. Estado **vazio** (nenhum vídeo): vídeo substituído por fundo `--bg-canvas` + área central discreta de vidro com "Adicione um vídeo" (URL ou arrastar e soltar).
9. Janela estreita (≥ 900px) e tela larga (≥ 1920px).

## 11. NÃO fazer
- Nada de **porcentagens** (progresso, uso, confiança), **"9:16"**, resolução, bitrate, nome de modelo, VRAM ou logs na tela principal.
- Nada de **semáforo/botões de janela do macOS**, ícones estilo macOS ou barra de título falsa.
- Nada de **card externo** em volta do app, nem moldura arredondada na página.
- Nada de **cartão, caixa, botão ou seta grande** como indicador da barra lateral oculta: somente o filete (4.4).
- Nada de **gradientes "de IA"** (roxo→rosa/azul), brilhos neon, glow forte, partículas, bounce.
- Nada de efeitos chamativos; efeitos só onde ajudam (blur, translucidez, pequenas transições).
- Nada de nome/logo do app.
- Nada de transcrição e blocos semânticos visíveis por padrão.
- Não mostrar configurações avançadas fora da engrenagem.
- Não renomear nem mover rotas, contratos de API, `shared/contracts.ts`, pipeline ou backend.

## 12. Artefatos das imagens para **IGNORAR**
As imagens foram geradas por IA e têm erros que **não** devem ser copiados:
- O **"0" solto** na régua da timeline entre 10:00 e 20:00 (a régua deve ter só marcas regulares).
- Texto cortado ou errado, como **"takay"** no lugar de "takeaway" no cartão "Conclusão e takeaway" (use o título real, com `line-clamp`).
- O **filete da borda esquerda ausente** na imagem 02 (deve existir sempre que a barra estiver oculta — seção 4.4).
- O **rosto/pessoa e o cenário** são só placeholder; as miniaturas e o vídeo reais vêm do arquivo do usuário. Rostos diferentes entre as imagens não significam nada.
- Qualquer outro texto que pareça embaralhado, ícones ligeiramente inconsistentes entre as imagens, e pequenas diferenças de alinhamento/tamanho entre os mockups. Siga **este documento** quando houver conflito com a imagem.
- Na imagem 03, os cantos arredondados da moldura em volta do vídeo: o app real é tela cheia, sem moldura.

## 13. Notas de implementação (para o Antigravity)
1. **Trabalhe nesta branch** (`design/redesign-arc`), em commits pequenos e descritivos. Dê **push na mesma branch** para o PR se atualizar.
2. **Não altere backend, `shared/contracts.ts` nem os contratos da API.** Só frontend.
3. Aproveite o que já existe (hooks de cortes, vídeos, renderização, upload, config). Troque a camada visual e componha os mesmos hooks na nova casca. Pode substituir/remover os componentes de layout antigos (`MainShell`, `Sidebar`, `Topbar`, listas em coluna) quando a nova versão cobrir a funcionalidade.
4. **Corrija o bug de front‑end já conhecido** (o que você já tinha identificado) enquanto estiver lá, e cite a correção na descrição do PR.
5. Preserve: aprovar/rejeitar/sugerido de cada corte, edição de início/fim (±1s) e título, "Pronto" via pasta de saída, download/abrir pasta/excluir de cortes prontos, upload por URL ou arrastar e soltar (vários arquivos), modo em lote com "Revisar antes", cancelamento, tratamento de erros (download, VRAM, Ollama fora, render concorrente), configurações (5 áreas).
6. Crie primeiro os **tokens e a classe `.glass`**, depois a casca (sidebar + dock + vídeo), depois cartões e ações, depois modo imersivo e polimento. Estados na ordem da seção 10.
7. Persistência de UI em `localStorage`: `ui.sidebarPinned`, `ui.dockCollapsed`.
8. Acessibilidade: tudo operável por teclado, `aria-current` no vídeo ativo, `aria-selected` no corte, `aria-expanded` nos recolhíveis, rótulos `aria-label` nos botões só com ícone.
9. Validação: `cd frontend && bun run build` sem erros e sem warnings novos de TypeScript.
10. Ao terminar, **tire screenshots de cada estado da seção 10**, salve em `docs/redesign/screenshots/` e comente no PR com um resumo do que foi feito, o que ficou de fora e qualquer divergência em relação às imagens de referência.
