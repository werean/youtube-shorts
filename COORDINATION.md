# Frontend & Backend Worktree Coordination

> Documento de alinhamento entre as sessões de desenvolvimento do repositório `youtube-shorts`.

---

## 1. Sessão Frontend (Esta Sessão)
- **Objetivo:** Implementação da nova interface **Linear Studio (Liquid Glass Edition - Apple Style)** com arquitetura modular de componentes.
- **Diretório de Atuação:** Estritamente `frontend/`.
- **Branch / Worktree:** `feature/frontend-liquid-glass`.
- **Contratos de API:** Preservação integral das rotas atuais (`/jobs`, `/jobs/:job_id/transcribe`, `/jobs/:job_id/run`, etc.) e tipos compartilhados em `@youtube-shorts/contracts`.

---

## 2. Sessão Backend (Sua Sessão)
- **Objetivo:** Evolução e manutenção dos serviços e pipelines do backend.
- **Diretório de Atuação:** `backend/` e `data/`.
- **Branch / Worktree Sugerida:** `feature/backend-<tarefa>` em uma worktree separada (ex: `../youtube-shorts-backend`) para isolar locks (`bun.lock`) e execuções concorrentes.

---

## 3. Protocolo de Convivência e Sincronização
1. Nenhuma sessão altera diretamente os arquivos de código-fonte da outra pasta sem alinhamento prévio.
2. Qualquer nova rota ou alteração em `@youtube-shorts/contracts` deve ser documentada aqui ou mantida retrocompatível com a API existente.
3. Testes do frontend serão validados com `bun run --cwd frontend build` e testes do backend com `bun run --cwd backend test`.
