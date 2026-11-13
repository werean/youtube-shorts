# FRONTEND_INTEGRATION_SPEC.md — Guia de Integração Frontend (Liquid Glass) com o Backend Python FastAPI

Guia técnico de integração para agentes de IA e desenvolvedores trabalhando no frontend (`frontend/` na branch `feature/frontend-liquid-glass`).

---

## 1. Visão Geral da Arquitetura e Estado Atual

O backend foi **100% reescrito em Python (`FastAPI`)**, operando na porta `8000` (`http://localhost:8000`).
Todo o código TypeScript legado do backend (`backend/src/`) foi removido.

### Premissas Inegociáveis Mantidas:
1. **100% de Compatibilidade de Rotas:** Todos os endpoints previamente consumidos pelo frontend foram preservados em método, rota, status HTTP e payloads (`shared/contracts.ts`).
2. **Streaming RFC 9110 HTTP Range 206:** Os endpoints de mídia suportam busca imediata de vídeo (*scrubbing/seek* suave).
3. **Novas Capacidades:** Suporte nativo a **Server-Sent Events (`SSE`)**, pipeline **1-Clique (`POST /jobs/:id/run`)**, **Batch Runner** com cancelamento em cascata e metadados aprofundados de IA (arcos narrativos e blocos semânticos).

---

## 2. Mapa de Rotas e Contratos da API (`src/api/`)

Abaixo está o mapa de todos os endpoints disponíveis no backend e seu status de integração com o frontend:

### 2.1 Jobs e Ingestão (`src/api/jobs.ts`)

| Método | Endpoint | Descrição | Observações de Integração |
| :--- | :--- | :--- | :--- |
| `POST` | `/jobs` | Cria um novo Job a partir de URL do YouTube | Payload: `{ youtube_url: string }`. Retorna `{ job: Job }`. |
| `POST` | `/jobs/upload` | Upload multipart de arquivo de vídeo local | `multipart/form-data` com campo `file`. Extrai metadados, calcula duração exata e extrai áudio PCM 16kHz. Retorna `{ job: Job }` com status `DOWNLOADED`. |
| `GET` | `/jobs/:job_id` | Consulta o estado e metadados do Job | Retorna o objeto `Job` completo (com `video_duration_seconds`, caminhos de artefatos e status). |
| `POST` / `PUT` | `/jobs/:job_id/rename` | Renomeia o vídeo fonte | Payload: `{ new_name: string }`. **Importante:** Retorna o objeto `Job` diretamente no top-level (e não aninhado). |
| `POST` | `/jobs/:job_id/ingest` | Executa o download via `yt-dlp` | Retorna `{ video_path: "/media/videos/:id", metadata_path: "...", full_path: "...", job_id: "...", status: "DOWNLOADED" }`. |
| `GET` | `/jobs/:job_id/logs/:task` | Logs de execução em tempo real | `task` $\in$ `ingest \| transcription \| render`. Retorna `{ logs: string[] }` (ring buffer de 400 linhas). |
| `GET` | `/jobs/:job_id/events` | **[NOVO]** Server-Sent Events em tempo real | `text/event-stream`. Transmite progresso, ETA e transições de estado (veja Seção 3). |
| `POST` | `/jobs/:job_id/run` | **[NOVO]** Pipeline Automático 1-Clique | Inicia execução automática de ponta a ponta (veja Seção 4). |

### 2.2 Transcrição (`src/api/transcription.ts`)

| Método | Endpoint | Descrição | Observações de Integração |
| :--- | :--- | :--- | :--- |
| `POST` | `/jobs/:job_id/transcribe` | Transcrição GPU (`faster-whisper`) | Retorna `{ transcription: string, segments: Segment[], available_formats: { segments: boolean, text: boolean, vtt: boolean }, job_id: string, status: "BUILDING_BLOCKS" }`. |
| `POST` | `/jobs/:job_id/transcribe/cancel` | Cancelamento cooperativo da transcrição | Cancela em $< 500\text{ms}$, libera VRAM e restaura status para `DOWNLOADED`. Retorna `{ ok: true, job_id: string }`. |
| `GET` | `/jobs/:job_id/transcription` | Consulta transcrição e formatos | Retorna `{ transcription: string, segments: Segment[], available_formats: {...} }`. |
| `DELETE` | `/jobs/:job_id/transcription` | Deleta todos os artefatos de transcrição | Reseta `job.status = "DOWNLOADED"`. Retorna `{ ok: true, job_id: string }`. |
| `DELETE` | `/jobs/:job_id/transcription/:format` | Deleta formato específico | Formatos aceitos: `segments \| text \| vtt` (e aliases `json \| txt`). Ao deletar `segments`, reseta status para `DOWNLOADED`. |

### 2.3 Blocos Semânticos, Segmentação e Cortes (`src/api/cuts.ts`)

| Método | Endpoint | Descrição | Observações de Integração |
| :--- | :--- | :--- | :--- |
| `POST` | `/jobs/:job_id/blocks` | Gera blocos semânticos e TextTiling | Gera `semantic.blocks.json` e `topic.segments.json`. Retorna `{ blocks: SemanticBlock[], topics: TopicSegment[], job_id: string }`. |
| `POST` | `/jobs/:job_id/analyze` | Mineração de cortes LLM em 3 fases | Auto-executa pré-requisitos se faltarem. Salva `cuts.suggested.json` e avança para `WAITING_APPROVAL`. Retorna `{ cuts: Cut[], raw_response?: string }`. |
| `GET` | `/jobs/:job_id/cuts` | Lista os cortes gerados para o vídeo | Retorna `Cut[]` com estrutura de arco narrativo completa. |
| `PUT` | `/jobs/:job_id/cuts` | Atualiza lista de cortes (curadoria manual) | Payload: `{ cuts: Cut[] }`. Retorna `{ ok: true, cuts: Cut[] }`. |
| `POST` | `/jobs/:job_id/cuts/:cut_id/approve` | Aprova um corte específico | Marca `approved: true, rejected: false`. Retorna o `Cut` atualizado. |
| `POST` | `/jobs/:job_id/cuts/:cut_id/reject` | Rejeita um corte específico | Marca `rejected: true, approved: false`. Retorna o `Cut` atualizado. |

### 2.4 Renderização 9:16 (`src/api/rendering.ts`)

| Método | Endpoint | Descrição | Observações de Integração |
| :--- | :--- | :--- | :--- |
| `POST` | `/jobs/:job_id/render` | Renderiza cortes verticais | Payload opcional: `{ cut_ids?: string[] }`. Se omitido, renderiza todos os cortes aprovados (ou todos se nenhum aprovado). Retorna `{ started: true, job_id: string }`. |
| `POST` | `/jobs/:job_id/render/cancel` | Cancela renderização em andamento | Mata árvore de subprocessos FFmpeg, remove arquivos `.mp4`/`.ass` parciais e restaura status para `DOWNLOADED`. Retorna `{ ok: true, job_id: string }`. |
| `GET` | `/jobs/:job_id/renders` | Lista URLs dos shorts renderizados | Retorna `string[]` no formato `["/media/shorts/:job_id/cut_00-01-20.000_to_00-02-30.000.mp4"]`. |
| `DELETE` | `/jobs/:job_id/renders/:file` | Deleta um short renderizado | Retorna `{ ok: true, file: string }`. |
| `POST` | `/jobs/:job_id/renders/:file/open-folder` | Abre a pasta no explorador do SO | Retorna `{ ok: true, path: string }`. |

### 2.5 Batch Pipeline (`src/api/batchPipeline.ts`)

| Método | Endpoint | Descrição | Observações de Integração |
| :--- | :--- | :--- | :--- |
| `POST` | `/jobs/batch/run` | Inicia processamento em lote | Payload: `{ job_ids: string[], options?: BatchPipelineOptions }`. Retorna `{ batch_id: string, status: "running" }`. |
| `GET` | `/jobs/batch/:batch_id/status` | Consulta status do lote | Retorna `BatchPipelineProgress` (`batch_id`, `total`, `completed`, `failed`, `current_job_id`, `is_running`, `jobs`). |
| `POST` | `/jobs/batch/:batch_id/cancel` | Cancela o lote com cascata cooperativa | **[IMPORTANTE]** Propaga cancelamento imediato para a tarefa ativa de `current_job_id`. Retorna `{ ok: true }`. |
| `POST` | `/jobs/batch/:batch_id/continue` | Continua lote pausado/interrompido | Retorna `{ ok: true, status: "resumed" }`. |

### 2.6 Streaming de Mídia (`/media/*`)

| Método | Endpoint | Descrição |
| :--- | :--- | :--- |
| `GET` | `/media/videos/:job_id` | Streaming de vídeo fonte com suporte total a HTTP `Range` (`206 Partial Content`). |
| `GET` | `/media/shorts/:job_id/:file` | Streaming do corte vertical 9:16 com suporte a HTTP `Range`. |

---

## 3. Guia de Adoção de Server-Sent Events (`/events`)

O endpoint `GET /jobs/:job_id/events` emite eventos em tempo real no formato `text/event-stream`. Usar SSE elimina a necessidade de polling com `setInterval` de 1s, proporcionando uma experiência de interface fluida.

### 3.1 Formato dos Eventos Emitidos pelo Backend

```text
event: progress
data: {"job_id": "...", "status": "TRANSCRIBING", "task": "transcription", "percent": 45.2, "eta_seconds": 12.5, "message": "Processando áudio chunk 2/5..."}

event: state_change
data: {"job_id": "...", "status": "WAITING_APPROVAL", "message": "Análise concluída. 5 cortes sugeridos."}
```

### 3.2 Exemplo de Hook React (`useJobEvents.ts`)

Crie em `frontend/src/hooks/useJobEvents.ts`:

```typescript
import { useEffect, useState, useRef } from "react";
import { apiBaseUrl } from "../api/client";
import type { JobStatus } from "../types";

export interface JobEventPayload {
  job_id: string;
  status: JobStatus;
  task?: "ingest" | "transcription" | "render";
  percent?: number;
  eta_seconds?: number;
  message?: string;
  timestamp?: string;
}

export function useJobEvents(jobId: string | null, onStatusChange?: (status: JobStatus) => void) {
  const [progress, setProgress] = useState<number>(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [currentMessage, setCurrentMessage] = useState<string>("");
  const [jobStatus, setJobStatus] = useState<JobStatus | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!jobId) return;

    const url = `${apiBaseUrl}/jobs/${jobId}/events`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.addEventListener("progress", (e) => {
      try {
        const data: JobEventPayload = JSON.parse(e.data);
        if (typeof data.percent === "number") setProgress(data.percent);
        if (typeof data.eta_seconds === "number") setEtaSeconds(data.eta_seconds);
        if (data.message) setCurrentMessage(data.message);
        if (data.status) {
          setJobStatus(data.status);
          onStatusChange?.(data.status);
        }
      } catch (err) {
        console.error("Erro ao decodificar evento SSE progress:", err);
      }
    });

    es.addEventListener("state_change", (e) => {
      try {
        const data: JobEventPayload = JSON.parse(e.data);
        if (data.status) {
          setJobStatus(data.status);
          onStatusChange?.(data.status);
        }
        if (data.message) setCurrentMessage(data.message);
      } catch (err) {
        console.error("Erro ao decodificar evento SSE state_change:", err);
      }
    });

    es.onerror = () => {
      // EventSource reconecta automaticamente no backend FastAPI
    };

    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [jobId]);

  return { progress, etaSeconds, currentMessage, jobStatus };
}
```

---

## 4. Guia de Integração do Pipeline 1-Clique (`POST /jobs/:id/run`)

Para a experiência de 1 clique destinada a usuários leigos:

1. **Adicionar função na API (`src/api/jobs.ts`):**
   ```typescript
   export async function runJobPipeline(
     jobId: string,
     options?: {
       language?: string;
       max_cuts?: number;
       vertical_mode?: "crop" | "blur" | "zoom" | "split_podcast";
       subtitle_style?: "word_highlight" | "sentence";
     }
   ): Promise<{ started: boolean; job_id: string; status: string }> {
     return request(`/jobs/${jobId}/run`, {
       method: "POST",
       headers: { "Content-Type": "application/json" },
       body: JSON.stringify(options || {}),
     });
   }
   ```
2. **Comportamento do Backend:**
   - Se o vídeo acabou de ser criado (`CREATED` ou `PENDING`), ele baixa o vídeo via `yt-dlp`, transcreve, gera blocos e tópicos, minera cortes e renderiza os cortes sugeridos.
   - Se o vídeo já foi baixado/enviado (`DOWNLOADED`), ele pula o download e inicia da transcrição em diante.
   - O status transiciona gradualmente: `INGESTING` $\to$ `TRANSCRIBING` $\to$ `BUILDING_BLOCKS` $\to$ `BUILDING_TOPICS` $\to$ `ANALYZING` $\to$ `RENDERING` $\to$ `DONE`.

---

## 5. Novos Metadados de IA no Workspace Liquid Glass

### 5.1 Arcos Narrativos nos Cortes (`Cut`)

Cada corte retornado por `GET /jobs/:id/cuts` possui a estrutura completa:

```typescript
export interface NarrativeArc {
  hook: string;         // Frase de impacto inicial do corte
  development: string;  // Desenvolvimento do raciocínio
  climax: string;       // Ponto alto / insight principal
  resolution: string;   // Conclusão que fecha o arco
}

export interface Cut {
  id: string;
  start: number;        // Início já com Snap Acústico em vale RMS + Zero-Crossing
  end: number;          // Fim com conclusão natural de fala
  duration: number;     // Duração em segundos (flexível ~90s)
  title: string;        // Título chamativo gerado pela IA
  summary?: string;
  reasoning?: string;   // Explicação do porquê esse trecho viraliza
  score: number;        // Score de engajamento (0 a 10)
  approved: boolean;    // Flag de curadoria
  rejected: boolean;    // Flag de rejeição
  narrative_arc?: NarrativeArc;
  block_ids?: string[]; // IDs dos blocos semânticos que compõem o corte
  vertical_mode?: "crop" | "blur" | "zoom" | "split_podcast";
}
```

No componente `ShortInspectorView.tsx`, exiba os 4 pilares do arco narrativo (`Hook`, `Desenvolvimento`, `Clímax`, `Conclusão`) em cartões de vidro (*GlassCard*) para que o usuário entenda o raciocínio da IA ao aprovar ou rejeitar o corte.

---

## 6. Player de Vídeo e Streaming HTTP 206 Range

Tanto o vídeo fonte original quanto os cortes verticais renderizados devem ser carregados via `<video>` usando a URL base do backend:

- **Vídeo Fonte:** `${apiBaseUrl}/media/videos/${jobId}`
- **Corte Renderizado:** `${apiBaseUrl}${cutRenderUrl}` (ex: `${apiBaseUrl}/media/shorts/${jobId}/cut_00-01-20.000_to_00-02-30.000.mp4`)

O backend responde automaticamente com cabeçalhos `Accept-Ranges: bytes` e `Content-Range: bytes START-END/TOTAL`. Não é necessária nenhuma biblioteca externa (como HLS/DASH) para seek instantâneo.

---

## 7. Checklist de Implementação para o Frontend

Use este checklist para acompanhar a implementação:

- [x] **1. API Client & Jobs:**
  - [x] Verificar `src/api/jobs.ts`: garantir que `renameVideo` receba o objeto `Job` direto (sem `.job`).
  - [x] Adicionar `runJobPipeline` em `src/api/jobs.ts`.
- [x] **2. Server-Sent Events (SSE):**
  - [x] Criar o hook `src/hooks/useJobEvents.ts`.
  - [x] Substituir o polling de status no Studio / Workspace pelo `useJobEvents`, mantendo fallback para polling se a conexão cair.
- [x] **3. Curadoria de Cortes & Arcos Narrativos:**
  - [x] Atualizar a tipagem de `Cut` em `src/types/` ou sincronizar com `shared/contracts.ts` incluindo `narrative_arc`.
  - [x] Renderizar `narrative_arc` em `ShortInspectorView.tsx` com estilo Liquid Glass.
- [x] **4. Controles de Pipeline 1-Clique & Lote:**
  - [x] Conectar o botão principal "1-Clique" para acionar `runJobPipeline`.
  - [x] Testar botões de cancelamento cooperativo: `cancelTranscription` (`/jobs/:id/transcribe/cancel`), `cancelRendering` (`/jobs/:id/render/cancel`) e `cancelBatchPipeline` (`/jobs/batch/:batch_id/cancel`).
- [x] **5. Player de Vídeo:**
  - [x] Garantir que o player em `VideoPlayerView.tsx` aponte para `${apiBaseUrl}/media/videos/${jobId}` e teste o seek na timeline.
