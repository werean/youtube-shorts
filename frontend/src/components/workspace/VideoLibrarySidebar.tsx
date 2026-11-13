import { useState } from "react";
import { cn } from "../../lib/utils";
import { formatTimestamp } from "../../utils/formatters";
import { GlassBadge, GlassButton } from "../ui/glass";
import type { AttemptSummary, JobStatus } from "../../types";

export interface WorkspaceVideoItem {
  id: string;
  title: string;
  durationSeconds?: number | null;
  cutsCount?: number;
  status: JobStatus | string;
  isProcessing?: boolean;
  attemptsCount?: number;
  canArchive?: boolean;
}

export interface VideoLibrarySidebarProps {
  videos: WorkspaceVideoItem[];
  selectedVideoId?: string | null;
  onSelectVideo: (videoId: string) => void;
  onImportClick?: () => void;
  onTranscribeVideo?: (videoId: string) => void;
  onGenerateCuts?: (videoId: string) => void;
  attemptsByVideoId?: Record<string, AttemptSummary[]>;
  loadingAttemptsByVideoId?: Record<string, boolean>;
  selectedAttemptKey?: { jobId: string; attemptId: string } | null;
  onToggleAttemptsDrawer?: (videoId: string, expanded: boolean) => void;
  onSelectAttempt?: (jobId: string, attemptId: string) => void;
  onArchiveAndReset?: (videoId: string) => void;
  onArchiveCopy?: (videoId: string) => void;
  onDeleteAttempt?: (jobId: string, attemptId: string) => void;
  archivingVideoId?: string | null;
  className?: string;
}

function formatAttemptDate(iso?: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const mins = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${mins}`;
}

function getAttemptStatusLabel(status: string): string {
  const normalized = String(status || "").replace(/^JobStatus\./i, "").toUpperCase();
  switch (normalized) {
    case "DONE":
      return "Concluído";
    case "WAITING_APPROVAL":
      return "Aguardando";
    case "ERROR":
      return "Erro";
    case "DOWNLOADED":
      return "Pronto";
    default:
      return normalized || "Arquivado";
  }
}

function getStatusBadge(status: string) {
  switch (status) {
    case "DONE":
      return <GlassBadge variant="success" size="sm">Concluido</GlassBadge>;
    case "DOWNLOADING":
      return <GlassBadge variant="warning" size="sm" dot>Baixando</GlassBadge>;
    case "TRANSCRIBING":
      return <GlassBadge variant="warning" size="sm" dot>Transcrevendo</GlassBadge>;
    case "BUILDING_BLOCKS":
    case "BUILDING_TOPICS":
    case "ANALYZING":
      return <GlassBadge variant="warning" size="sm" dot>Analisando</GlassBadge>;
    case "WAITING_APPROVAL":
      return <GlassBadge variant="accent" size="sm">Aguardando</GlassBadge>;
    case "RENDERING":
      return <GlassBadge variant="warning" size="sm" dot>Renderizando</GlassBadge>;
    case "ERROR":
      return <GlassBadge variant="danger" size="sm">Erro</GlassBadge>;
    case "DOWNLOADED":
    default:
      return <GlassBadge variant="neutral" size="sm">Pronto</GlassBadge>;
  }
}

export function VideoLibrarySidebar({
  videos,
  selectedVideoId,
  onSelectVideo,
  onImportClick,
  onTranscribeVideo,
  onGenerateCuts,
  attemptsByVideoId = {},
  loadingAttemptsByVideoId = {},
  selectedAttemptKey = null,
  onToggleAttemptsDrawer,
  onSelectAttempt,
  onArchiveAndReset,
  onArchiveCopy,
  onDeleteAttempt,
  archivingVideoId = null,
  className,
}: VideoLibrarySidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [expandedDrawers, setExpandedDrawers] = useState<Record<string, boolean>>({});

  const filteredVideos = videos.filter((v) =>
    v.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const toggleDrawer = (videoId: string) => {
    setExpandedDrawers((prev) => {
      const nextExpanded = !prev[videoId];
      onToggleAttemptsDrawer?.(videoId, nextExpanded);
      return { ...prev, [videoId]: nextExpanded };
    });
  };

  return (
    <aside
      className={cn(
        "flex h-full w-[240px] flex-shrink-0 flex-col border-r border-white/[0.08] bg-[#0c0c0e]/70 backdrop-blur-xl select-none @container/sidebar",
        "shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.04)]",
        className,
      )}
    >
      {/* Cabecalho da biblioteca + Botao Importar */}
      <div className="flex flex-col gap-3 p-4 border-b border-white/[0.08] bg-white/[0.015]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-300">
            Biblioteca
          </span>
          <span className="text-xs font-sans font-medium text-zinc-400">
            {videos.length} {videos.length === 1 ? "vídeo" : "vídeos"}
          </span>
        </div>

        {/* Botao Primario + Importar Video */}
        <GlassButton
          variant="primary"
          size="sm"
          onClick={onImportClick}
          className="w-full justify-center shadow-[0_0_20px_rgba(255,255,255,0.15)] hover:shadow-[0_0_25px_rgba(255,255,255,0.25)] text-sm font-medium"
          icon={
            <svg
              className="h-4 w-4 mr-1.5"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          }
        >
          Importar Vídeo
        </GlassButton>

        {/* Campo de Busca Compacto */}
        {videos.length > 3 ? (
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-400"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar na biblioteca..."
              className="w-full rounded-xl border border-white/[0.08] bg-white/[0.03] py-2 pl-9 pr-3 text-xs text-white placeholder:text-zinc-500 outline-none transition-colors focus:border-white/[0.25] focus:bg-white/[0.06]"
            />
          </div>
        ) : null}
      </div>

      {/* Lista de Videos */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-stable">
        {filteredVideos.length === 0 ? (
          <div className="p-2">
            <div className="flex flex-col items-center justify-center p-6 text-center text-zinc-400 rounded-2xl border border-dashed border-white/10 bg-white/[0.015] space-y-3">
              <div className="w-11 h-11 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-center text-zinc-300">
                <svg
                  className="h-5 w-5 stroke-[1.5]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <polygon points="23 7 16 12 23 17 23 7" />
                  <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                </svg>
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-white">
                  {searchQuery ? "Nenhum resultado" : "Biblioteca Vazia"}
                </p>
                <p className="text-xs text-zinc-400 leading-relaxed max-w-[190px]">
                  {searchQuery
                    ? "Tente outro termo de busca na biblioteca."
                    : "Importe um vídeo do YouTube ou arquivo local para iniciar."}
                </p>
              </div>
              {onImportClick && !searchQuery && (
                <GlassButton
                  variant="glass"
                  size="sm"
                  onClick={onImportClick}
                  className="mt-1 text-xs"
                >
                  Importar Vídeo
                </GlassButton>
              )}
            </div>
          </div>
        ) : (
          filteredVideos.map((video) => {
            const isSelected = video.id === selectedVideoId;
            const isInspectingChildAttempt = selectedAttemptKey?.jobId === video.id;
            const isParentActive = isSelected && !isInspectingChildAttempt;
            const attempts = attemptsByVideoId[video.id] || [];
            const attemptsCount =
              typeof video.attemptsCount === "number" ? video.attemptsCount : attempts.length;
            const isDrawerOpen = Boolean(expandedDrawers[video.id] || isInspectingChildAttempt);
            const isLoadingAttempts = Boolean(loadingAttemptsByVideoId[video.id]);
            const isArchiving = archivingVideoId === video.id;
            const showArchiveActions = Boolean(
              video.canArchive && !video.isProcessing && (onArchiveAndReset || onArchiveCopy),
            );

            return (
              <div key={video.id} className="flex flex-col gap-1.5">
                <div
                  onClick={() => onSelectVideo(video.id)}
                  className={cn(
                    "group relative flex w-full flex-col gap-2 rounded-xl border p-3 text-left transition-all duration-150 cursor-pointer select-none",
                    isParentActive
                      ? "border-white/[0.25] bg-white/[0.08] shadow-[0_4px_20px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.15)]"
                      : isInspectingChildAttempt
                        ? "border-amber-400/25 bg-white/[0.04]"
                        : "border-transparent bg-transparent hover:border-white/[0.08] hover:bg-white/[0.04]",
                  )}
                >
                  {/* Linha superior: Titulo */}
                  <div className="flex items-start justify-between gap-1.5">
                    <span
                      className={cn(
                        "line-clamp-2 text-sm font-semibold transition-colors leading-snug",
                        isSelected ? "text-white" : "text-zinc-200 group-hover:text-white",
                      )}
                      title={video.title}
                    >
                      {video.title}
                    </span>
                  </div>

                  {/* Linha inferior: Duracao, Cortes e Status */}
                  <div className="flex items-center justify-between gap-1 pt-1.5 border-t border-white/[0.04]">
                    <div className="flex items-center gap-2">
                      {typeof video.durationSeconds === "number" && video.durationSeconds > 0 ? (
                        <span className="font-sans font-medium tabular-nums text-xs text-zinc-400">
                          {formatTimestamp(video.durationSeconds)}
                        </span>
                      ) : null}

                      {typeof video.cutsCount === "number" && video.cutsCount > 0 ? (
                        <span className="rounded bg-white/[0.06] px-2 py-0.5 font-sans font-medium text-xs text-zinc-300 border border-white/[0.08]">
                          {video.cutsCount} {video.cutsCount === 1 ? "corte" : "cortes"}
                        </span>
                      ) : null}
                    </div>

                    <div className="flex items-center">{getStatusBadge(video.status)}</div>
                  </div>

                  {/* Toggle Arquivados (N) */}
                  {(attemptsCount > 0 || isDrawerOpen) && (
                    <div
                      className="flex items-center pt-1 border-t border-white/[0.04]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        onClick={() => toggleDrawer(video.id)}
                        className={cn(
                          "w-full flex items-center justify-between gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
                          isDrawerOpen
                            ? "border-amber-400/35 bg-amber-400/10 text-amber-200"
                            : "border-white/[0.07] bg-white/[0.03] text-zinc-300 hover:border-amber-400/25 hover:bg-amber-400/[0.07] hover:text-amber-200",
                        )}
                        title="Expandir ou recolher tentativas arquivadas deste vídeo"
                      >
                        <span className="flex items-center gap-1.5">
                          <svg
                            className="w-3 h-3 text-amber-400 flex-shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="21 8 21 21 3 21 3 8" />
                            <rect x="1" y="3" width="22" height="5" />
                            <line x1="10" y1="12" x2="14" y2="12" />
                          </svg>
                          <span>Arquivados ({attemptsCount})</span>
                        </span>
                        <svg
                          className={cn(
                            "w-3 h-3 transition-transform duration-150",
                            isDrawerOpen ? "rotate-180" : "rotate-0",
                          )}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          aria-hidden="true"
                        >
                          <polyline points="6 9 12 15 18 9" />
                        </svg>
                      </button>
                    </div>
                  )}

                  {/* Ações de Arquivamento / Nova Tentativa */}
                  {showArchiveActions && (
                    <div
                      className={cn(
                        "flex items-center gap-1 pt-1 border-t border-white/[0.06] transition-opacity",
                        isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onArchiveAndReset && (
                        <button
                          type="button"
                          disabled={isArchiving}
                          onClick={() => onArchiveAndReset(video.id)}
                          title="Arquivar tentativa atual e reiniciar para uma nova tentativa (DOWNLOADED)"
                          className="flex-1 flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 text-amber-200 hover:text-amber-100 border border-amber-400/25 hover:border-amber-400/45 text-[11px] font-medium transition-colors disabled:opacity-50"
                        >
                          <svg
                            className="w-3 h-3 text-amber-300 flex-shrink-0"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <polyline points="21 8 21 21 3 21 3 8" />
                            <rect x="1" y="3" width="22" height="5" />
                            <line x1="12" y1="11" x2="12" y2="17" />
                            <line x1="9" y1="14" x2="15" y2="14" />
                          </svg>
                          <span className="truncate">
                            {isArchiving ? "Arquivando..." : "Arquivar / Nova tentativa"}
                          </span>
                        </button>
                      )}
                      {onArchiveCopy && (
                        <button
                          type="button"
                          disabled={isArchiving}
                          onClick={() => onArchiveCopy(video.id)}
                          title="Arquivar cópia mantendo a tentativa ativa no workspace"
                          className="flex items-center justify-center gap-1 py-1 px-2 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] text-zinc-300 hover:text-white border border-white/[0.08] text-[11px] font-medium transition-colors disabled:opacity-50"
                        >
                          Cópia
                        </button>
                      )}
                    </div>
                  )}

                  {/* Ações Rápidas Individuais no Hover / Seleção */}
                  {(onTranscribeVideo || onGenerateCuts) && (
                    <div
                      className={cn(
                        "flex items-center gap-1.5 pt-1.5 border-t border-white/[0.06] transition-opacity",
                        isSelected ? "opacity-100" : "opacity-0 group-hover:opacity-100",
                      )}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {onTranscribeVideo && (
                        <button
                          type="button"
                          onClick={() => onTranscribeVideo(video.id)}
                          title="Transcrever áudio deste vídeo (Whisper)"
                          className="flex-1 flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg bg-white/[0.04] hover:bg-cyan-500/20 text-zinc-300 hover:text-cyan-300 border border-white/[0.06] hover:border-cyan-500/30 text-[11px] font-medium transition-colors"
                        >
                          <svg className="w-3 h-3 text-cyan-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                          </svg>
                          Transcrever
                        </button>
                      )}
                      {onGenerateCuts && (
                        <button
                          type="button"
                          onClick={() => onGenerateCuts(video.id)}
                          title="Minerar cortes deste vídeo com IA (LLM)"
                          className="flex-1 flex items-center justify-center gap-1 py-1 px-1.5 rounded-lg bg-white/[0.04] hover:bg-amber-500/20 text-zinc-300 hover:text-amber-300 border border-white/[0.06] hover:border-amber-500/30 text-[11px] font-medium transition-colors"
                        >
                          <svg className="w-3 h-3 text-amber-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="6" cy="6" r="3" />
                            <circle cx="6" cy="18" r="3" />
                            <line x1="20" y1="4" x2="8.12" y2="15.88" />
                          </svg>
                          Cortes
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Lista aninhada de tentativas arquivadas logo abaixo do card pai */}
                {isDrawerOpen && (
                  <div className="ml-2.5 pl-2.5 border-l border-amber-400/25 space-y-1.5 py-0.5">
                    {isLoadingAttempts && attempts.length === 0 ? (
                      <div className="flex items-center gap-2 px-2 py-2 text-[11px] text-zinc-400">
                        <span className="h-3 w-3 rounded-full border-2 border-amber-400/30 border-t-amber-300 animate-spin" />
                        <span>Carregando arquivados...</span>
                      </div>
                    ) : attempts.length === 0 ? (
                      <div className="px-2 py-1.5 text-[11px] text-zinc-500">
                        Nenhuma tentativa arquivada.
                      </div>
                    ) : (
                      attempts.map((attempt) => {
                        const isAttemptSelected =
                          selectedAttemptKey?.jobId === video.id &&
                          selectedAttemptKey?.attemptId === attempt.attempt_id;
                        const dateStr = formatAttemptDate(attempt.archived_at || attempt.created_at);

                        return (
                          <div
                            key={attempt.attempt_id}
                            onClick={() => onSelectAttempt?.(video.id, attempt.attempt_id)}
                            className={cn(
                              "group/attempt flex flex-col gap-1 rounded-lg border px-2.5 py-2 cursor-pointer transition-all",
                              isAttemptSelected
                                ? "border-amber-400/50 bg-amber-400/15 shadow-[0_0_16px_rgba(251,191,36,0.12)]"
                                : "border-white/[0.07] bg-white/[0.025] hover:border-amber-400/30 hover:bg-white/[0.05]",
                            )}
                          >
                            <div className="flex items-center justify-between gap-1.5">
                              <span
                                className={cn(
                                  "text-xs font-semibold truncate",
                                  isAttemptSelected ? "text-amber-200" : "text-zinc-200",
                                )}
                                title={attempt.label}
                              >
                                {attempt.label}
                              </span>
                              {onDeleteAttempt && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteAttempt(video.id, attempt.attempt_id);
                                  }}
                                  title="Excluir tentativa arquivada"
                                  className="p-0.5 rounded text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 transition-colors opacity-70 group-hover/attempt:opacity-100"
                                >
                                  <svg
                                    className="w-3 h-3"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    aria-hidden="true"
                                  >
                                    <polyline points="3 6 5 6 21 6" />
                                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                  </svg>
                                </button>
                              )}
                            </div>

                            <div className="flex items-center justify-between gap-1 text-[10px] text-zinc-400">
                              <span className="truncate">{dateStr || "Arquivado"}</span>
                              <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] text-zinc-300 border border-white/[0.06]">
                                {getAttemptStatusLabel(attempt.status)}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                              <span className="rounded bg-white/[0.05] px-1.5 py-0.5 text-[10px] font-medium text-zinc-300 border border-white/[0.06]">
                                {attempt.cuts_count} {attempt.cuts_count === 1 ? "corte" : "cortes"}
                              </span>
                              <span className="rounded bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 border border-emerald-500/20">
                                {attempt.rendered_count} {attempt.rendered_count === 1 ? "render" : "renders"}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
