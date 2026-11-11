import { useState } from "react";
import { cn } from "../../lib/utils";
import { formatTimestamp } from "../../utils/formatters";
import { GlassBadge, GlassButton } from "../ui/glass";
import type { JobStatus } from "../../types";

export interface WorkspaceVideoItem {
  id: string;
  title: string;
  durationSeconds?: number | null;
  cutsCount?: number;
  status: JobStatus | string;
  isProcessing?: boolean;
}

export interface VideoLibrarySidebarProps {
  videos: WorkspaceVideoItem[];
  selectedVideoId?: string | null;
  onSelectVideo: (videoId: string) => void;
  onImportClick?: () => void;
  className?: string;
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
  className,
}: VideoLibrarySidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredVideos = videos.filter((v) =>
    v.title.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  return (
    <aside
      className={cn(
        "flex h-full w-[240px] flex-shrink-0 flex-col border-r border-white/[0.08] bg-[#0c0c0e]/70 backdrop-blur-xl select-none",
        "shadow-[inset_-1px_0_0_0_rgba(255,255,255,0.04)]",
        className,
      )}
    >
      {/* Cabecalho da biblioteca + Botao Importar */}
      <div className="flex flex-col gap-3 p-3.5 border-b border-white/[0.06]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3">
            Biblioteca
          </span>
          <span className="text-[11px] font-mono text-text-3">
            {videos.length} {videos.length === 1 ? "video" : "videos"}
          </span>
        </div>

        {/* Botao Primario + Importar Video */}
        <GlassButton
          variant="primary"
          size="sm"
          onClick={onImportClick}
          className="w-full justify-center shadow-[0_0_20px_rgba(255,255,255,0.15)] hover:shadow-[0_0_25px_rgba(255,255,255,0.25)]"
          icon={
            <svg
              className="h-3.5 w-3.5 mr-1"
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
          Importar Video
        </GlassButton>

        {/* Campo de Busca Compacto */}
        {videos.length > 3 ? (
          <div className="relative">
            <svg
              className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-3"
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
              className="w-full rounded-lg border border-white/[0.08] bg-white/[0.03] py-1.5 pl-8 pr-2.5 text-body-sm text-text-1 placeholder:text-text-3 outline-none transition-colors focus:border-white/[0.2] focus:bg-white/[0.06]"
            />
          </div>
        ) : null}
      </div>

      {/* Lista de Videos */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5 scrollbar-thin scrollbar-thumb-white/10">
        {filteredVideos.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-6 text-center text-text-3">
            <svg
              className="h-8 w-8 text-text-3 mb-2 stroke-[1.2]"
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
            <p className="text-body-sm">
              {searchQuery ? "Nenhum video encontrado." : "Nenhum video na biblioteca."}
            </p>
          </div>
        ) : (
          filteredVideos.map((video) => {
            const isSelected = video.id === selectedVideoId;
            return (
              <button
                key={video.id}
                type="button"
                onClick={() => onSelectVideo(video.id)}
                className={cn(
                  "group relative flex w-full flex-col gap-2 rounded-xl border p-2.5 text-left transition-all duration-150",
                  isSelected
                    ? "border-white/[0.25] bg-white/[0.08] shadow-[0_4px_20px_rgba(0,0,0,0.3),inset_0_1px_0_0_rgba(255,255,255,0.15)]"
                    : "border-transparent bg-transparent hover:border-white/[0.08] hover:bg-white/[0.04]",
                )}
              >
                {/* Linha superior: Titulo */}
                <div className="flex items-start justify-between gap-1.5">
                  <span
                    className={cn(
                      "line-clamp-2 text-body-sm font-medium transition-colors",
                      isSelected ? "text-white" : "text-text-2 group-hover:text-text-1",
                    )}
                    title={video.title}
                  >
                    {video.title}
                  </span>
                </div>

                {/* Linha inferior: Duracao, Cortes e Status */}
                <div className="flex items-center justify-between gap-1 pt-1 border-t border-white/[0.04]">
                  <div className="flex items-center gap-2">
                    {typeof video.durationSeconds === "number" && video.durationSeconds > 0 ? (
                      <span className="font-mono text-[11px] text-text-3">
                        {formatTimestamp(video.durationSeconds)}
                      </span>
                    ) : null}

                    {typeof video.cutsCount === "number" && video.cutsCount > 0 ? (
                      <span className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[10px] text-text-2 border border-white/[0.06]">
                        {video.cutsCount} {video.cutsCount === 1 ? "corte" : "cortes"}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center">{getStatusBadge(video.status)}</div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
