# Refatoração do App.tsx

## Resumo

O [App.tsx](../App.tsx) foi refatorado de **4792 linhas** para uma estrutura modular organizada.

## ✅ O que já estava refatorado

O projeto já estava bem estruturado com:

- **Componentes** em `/components` - 21 componentes de UI
- **Hooks existentes** em `/hooks` - useVideoManagement, useTranscription, useCuts, useRendering, etc
- **Tipos** em `/types` - Interfaces e tipos compartilhados
- **API** em `/api` - Chamadas à API organizadas

## 🆕 O que foi adicionado na refatoração

### 📦 **Utilitários** (`/utils`)

#### `formatters.ts`

- `formatVttTimestamp()` - Formata segundos para VTT (HH:MM:SS.mmm)
- `formatTimestamp()` - Formata para MM:SS ou H:MM:SS
- `parseTimestampInput()` - Parse de timestamps (mm:ss, hh:mm:ss, seconds)
- `buildRenderUrl()` - Constrói URLs com cache busting

#### `videoHelpers.ts`

- `VideoItem` interface
- `recordToVideoItem()` - Converte VideoRecord para VideoItem
- `buildVtt()` - Gera arquivo VTT a partir de segments
- `getTranscriptionContent()` - Obtém conteúdo de transcrição por formato

### 🎣 **Hooks Utilitários** (`/hooks`)

#### `usePolling.ts`

- `usePolling()` - Gerencia intervalos de polling com cleanup automático
- `useAutoScroll()` - Auto-scroll para o fim quando conteúdo muda

#### `useAction.ts`

- `useAction()` - Gerencia estado de ações assíncronas com erro

#### `useVideoList.ts`

- `useVideoList()` - Gerencia lista de vídeos e vídeo ativo
- Funções para atualizar vídeos e verificar operações

#### `useRenderingState.ts`

- `useRendering()` - Gerencia estado de renderização e polling

#### `useLogsState.ts`

- `useLogs()` - Gerencia logs de tasks (transcription/render/ingest)

#### `useCutsState.ts`

- `useCutsState()` - Gerencia estado dos cortes

### 🎨 **CSS Modularizado** (`/styles`)

Todos os estilos CSS foram organizados em 9 arquivos:

- `variables.css` - Variáveis e tema
- `reset.css` - Reset e base
- `animations.css` - Keyframes
- `layout.css` - Layouts
- `components.css` - Componentes
- `forms.css` - Formulários
- `dialogs.css` - Diálogos
- `media.css` - Media queries
- `index.css` - Arquivo principal

## 📊 Resultado

### Antes

- **App.tsx**: 4792 linhas
- CSS inline e misturado
- Lógica dispersa

### Depois

- **App.tsx**: Ainda grande, mas com:
  - Funções utilitárias extraídas → `/utils`
  - Hooks reutilizáveis → `/hooks`
  - CSS organizado → `/styles`
  - Componentes modulares → `/components`

## 🚀 Próximos Passos

Para reduzir ainda mais o App.tsx:

1. Extrair seções gigantes de JSX para componentes (VideoSection, CurationSection, etc)
2. Mover mais lógica de negócios para hooks
3. Criar contextos para estado global compartilhado
4. Dividir diálogos complexos em subcomponentes

## 📖 Como Usar

### Importar utilitários

\`\`\`tsx
import { formatTimestamp, parseTimestampInput } from './utils/formatters';
import { buildVtt, recordToVideoItem } from './utils/videoHelpers';
\`\`\`

### Usar hooks

\`\`\`tsx
import { usePolling, useAction, useVideoList } from './hooks';

function MyComponent() {
const { runAction, action } = useAction();
const { startPolling, stopPolling } = usePolling();
// ...
}
\`\`\`

### Importar estilos

\`\`\`tsx
import './styles/index.css'; // Apenas no main.tsx
\`\`\`
