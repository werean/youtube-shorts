# Estrutura de Estilos

Esta pasta contém todos os estilos CSS da aplicação organizados de forma modular.

## Arquivos

### 📋 `index.css`

Arquivo principal que importa todos os módulos CSS. Este é o único arquivo que deve ser importado no `main.tsx`.

### 🎨 `variables.css`

Define as variáveis CSS customizadas (custom properties) e o tema da aplicação:

- Cores (background, text, accent, etc.)
- Sombras
- Fonte padrão

### 🔄 `reset.css`

Estilos base e reset:

- Box-sizing
- Estilos do body
- Tipografia base (h1, h2, h3)

### ✨ `animations.css`

Animações e keyframes:

- `spin` - rotação contínua
- `fadeIn` - fade in com translate
- `pulse` - pulsação de opacidade

### 📐 `layout.css`

Estrutura e layout da página:

- `.page` - container principal
- `.hero` - seção hero
- `.grid` - layouts em grid
- `.pipeline`, `.pipeline-grid` - grids específicos
- `.shorts-grid` - grid de vídeos

### 🧩 `components.css`

Componentes reutilizáveis:

- Botões (`.primary`, `.secondary`, `.accent`, etc.)
- Cards (`.status-card`, `.cut-card`, `.short-card`)
- Panels (`.panel`)
- Tabs (`.tab`)
- Menu (`.menu-popover`)
- Video player (`.video-player`)
- Toast (`.toast`)
- Utilities (`.flex`, `.hidden`, `.text-center`, etc.)

### 📝 `forms.css`

Elementos de formulário:

- Inputs
- Fields

### 💬 `dialogs.css`

Diálogos e modais:

- `.dialog-overlay` - overlay de fundo
- `.dialog` - container do diálogo
- `.dialog-header` - cabeçalho
- `.dialog-content` - conteúdo
- `.dialog-footer` - rodapé
- `.info-box` - caixas de informação

### 📱 `media.css`

Media queries para responsividade:

- Adaptações para mobile (<720px)

## Como usar

Para importar os estilos, adicione no seu arquivo principal (main.tsx):

\`\`\`tsx
import "./styles/index.css";
\`\`\`

## Convenções

- Use classes semânticas ao invés de estilos inline
- Prefira utility classes (`.flex`, `.gap-md`) para layouts simples
- Mantenha os estilos específicos de componentes nos arquivos dos componentes quando forem muito únicos
- Use variáveis CSS para cores e valores reutilizáveis
