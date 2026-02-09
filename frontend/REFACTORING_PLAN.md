# 📋 Plano de Refatoração do App.tsx

O arquivo `App.tsx` está com muita lógica em um único lugar (3300 linhas). Esta é uma estrutura de refatoração recomendada para melhorar a manutenibilidade:

## ✅ Já Implementado

### Hooks Existentes

- `useVideoManagement` - Gerenciar vídeos e seleção
- `useUIState` - Gerenciar estado de UI (diálogos, etc)
- `useSettings` - Carregar e gerenciar configurações
- `useCuts` - Gerenciar cortes de análise
- `useRendering` - Gerenciar rendering e polling
- `useAppAction` - Gerenciar ações com loading/erro
- `useAnalysis` - Gerenciar análise e blocos (NOVO)

### Arquivo de Tipos

- `types/app.ts` - VideoItem, ActionState, constantes

### Utilities

- `utils/actions.ts` - Função genérica `runAction`
- `utils/helpers.ts` - Helpers para operações comuns
- `sections/DialogsSection.tsx` - NOVO: Extrai renderização de diálogos

## 🎯 Próximos Passos Recomendados

### 1. **Quebrar App.tsx em seções** (Impacto Alto)

Criar componentes para cada seção principal:

```
src/
  sections/
    HeaderSection.tsx       → <header className="hero">
    VideoPlayerSection.tsx  → Renomear VideoPlayerSection para refletir e extrair lógica
    CutsPanelSection.tsx    → <CutsPanel> com handlers
    RenderingSection.tsx    → <RenderingPanel>
    DialogsSection.tsx      → ✅ Já existe, precisa ser integrada
```

### 2. **Extrair lógica de diálogos** (Impacto Médio)

- Criar custom hooks para cada tipo de diálogo:
  - `useTranscriptionDialogs.ts`
  - `useAnalysisDialogs.ts`
  - `useConfigDialogs.ts`

### 3. **Centralizar API calls** (Impacto Médio)

Criar arquivo com todas as operações API:

```
src/
  api/
    operations/
      videoOperations.ts     → transcribe, render, rename
      analysisOperations.ts  → analyze, build blocks
      configOperations.ts    → save settings, install dependencies
```

### 4. **Reduzir App.tsx** (Impacto Alto)

Objetivo final: App.tsx com ~200-300 linhas

```typescript
// App.tsx - estrutura ideal
export default function App() {
  // Hooks (bem organizados)
  const videoMgmt = useVideoManagement();
  const uiState = useUIState();
  // ... etc

  useEffect(() => {
    // Carregar dados iniciais
  }, []);

  return (
    <div className="page">
      <HeaderSection />
      <ConfigurationPanel {...} />
      <UploadSection {...} />
      <VideoListSection {...} />
      {videoMgmt.activeVideo && <VideoPlayerSection {...} />}
      <CutsPanel {...} />
      <RenderingPanel {...} />
      <DialogsSection {...} />
      {action.error && <Toast error={action.error} />}
    </div>
  );
}
```

## 📊 Estrutura de Diretórios Proposta

```
frontend/src/
├── api/
│   ├── client.ts
│   ├── config.ts      ✅
│   ├── cuts.ts
│   ├── jobs.ts
│   ├── rendering.ts
│   ├── transcription.ts
│   ├── videos.ts
│   ├── operations/              🆕
│   │   ├── videoOperations.ts
│   │   ├── analysisOperations.ts
│   │   └── configOperations.ts
│   └── index.ts
│
├── hooks/
│   ├── index.ts                ✅
│   ├── useVideoManagement.ts   ✅
│   ├── useUIState.ts           ✅
│   ├── useSettings.ts          ✅
│   ├── useCuts.ts              ✅
│   ├── useRendering.ts         ✅
│   ├── useAppAction.ts         ✅
│   ├── useAnalysis.ts          ✅ (NOVO)
│   ├── dialogs/                🆕
│   │   ├── useTranscriptionDialogs.ts
│   │   ├── useAnalysisDialogs.ts
│   │   └── useConfigDialogs.ts
│   └── operations/             🆕
│       └── useVideoOperations.ts
│
├── types/
│   ├── index.ts                ✅
│   ├── app.ts                  ✅ (NOVO)
│   └── ...
│
├── utils/
│   ├── actions.ts              ✅ (NOVO)
│   ├── helpers.ts              ✅ (NOVO)
│   └── formatting.ts
│
├── sections/                   🆕
│   ├── HeaderSection.tsx
│   ├── VideoPlayerSection.tsx
│   ├── CutsPanelSection.tsx
│   ├── RenderingSection.tsx
│   ├── DialogsSection.tsx      ✅ (NOVO)
│   └── ToastSection.tsx
│
├── components/
│   ├── ... (componentes existentes)
│   └── README.md → Documentar cada componente
│
├── App.tsx                     🔧 200-300 linhas (atualmente 3300)
└── main.tsx
```

## 🔍 Benefícios da Refatoração

✅ **Manutenibilidade**: Lógica dividida por responsabilidade
✅ **Testabilidade**: Cada seção pode ser testada isoladamente
✅ **Reusabilidade**: Hooks e utilitários reutilizáveis
✅ **Escalabilidade**: Fácil adicionar novas features
✅ **Legibilidade**: App.tsx como documento de arquitetura

## 🛠️ Ordem de Implementação Recomendada

1. ✅ Criar `types/app.ts` com tipos compartilhados
2. ✅ Criar `utils/actions.ts` com `runAction`
3. ✅ Criar `utils/helpers.ts` com helpers de operações
4. ✅ Criar `hooks/useAnalysis.ts` para análise
5. 🔲 Criar componentes em `sections/`
6. 🔲 Criar `api/operations/` com função helpers de API
7. 🔲 Refatorar App.tsx para usar novos componentes
8. 🔲 Integrar `DialogsSection.tsx`

## ⚡ Quick Wins (Fáceis de implementar agora)

- [x] Extrair tipos em `types/app.ts`
- [x] Extrair `runAction` em `utils/actions.ts`
- [x] Criar `DialogsSection.tsx`
- [ ] Renomear componentes de seção existentes
- [ ] Adicionar comentários descritivos
- [ ] Criar README em `components/`

---

**Status Atual**: App.tsx com hooks bem organizados, alguns utilitários extraídos, pronto para próximas fases.
