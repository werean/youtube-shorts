import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Archive,
  DotsThree,
  FilmStrip,
  FolderOpen,
  Gear,
  PencilSimple,
  Plus,
  PushPin,
  PushPinSlash,
  SpinnerGap,
  Trash,
} from "@phosphor-icons/react";
import type { VideoItem } from "../../utils/videoHelpers";
import { isJobProcessingStatus } from "./presets";

interface ArcSidebarProps {
  videos: VideoItem[];
  archivedVideos: VideoItem[];
  activeVideoId: string | null;
  videoView: "active" | "archived";
  apiBaseUrl: string;
  pinned: boolean;
  open: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  immersiveIdle: boolean;
  onSetOpen: (open: boolean) => void;
  onTogglePin: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onSelectVideo: (jobId: string) => void;
  onSetView: (view: "active" | "archived") => void;
  onNewVideo: () => void;
  onOpenSettings: () => void;
  onOpenFolder: (jobId: string) => void;
  onRenameVideo: (jobId: string, currentName: string) => void;
  onArchiveVideo: (jobId: string) => void;
  onDeleteVideo: (jobId: string) => void;
}

export function ArcSidebar({
  videos,
  archivedVideos,
  activeVideoId,
  videoView,
  apiBaseUrl,
  pinned,
  open,
  canGoBack,
  canGoForward,
  immersiveIdle,
  onSetOpen,
  onTogglePin,
  onGoBack,
  onGoForward,
  onSelectVideo,
  onSetView,
  onNewVideo,
  onOpenSettings,
  onOpenFolder,
  onRenameVideo,
  onArchiveVideo,
  onDeleteVideo,
}: ArcSidebarProps) {
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const [edgeHover, setEdgeHover] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);

  const displayedVideos = videoView === "active" ? videos : archivedVideos;
  const orderedVideos = displayedVideos.slice().reverse();

  const clearTimers = () => {
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const handleEdgeEnter = () => {
    if (pinned) return;
    setEdgeHover(true);
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    if (!open && !openTimerRef.current) {
      openTimerRef.current = window.setTimeout(() => {
        openTimerRef.current = null;
        onSetOpen(true);
      }, 80);
    }
  };

  const handleEdgeLeave = () => {
    setEdgeHover(false);
    if (openTimerRef.current) {
      window.clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    if (!pinned && open) {
      scheduleClose();
    }
  };

  const handleSidebarEnter = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    if (pinned) return;
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setMenuOpenId(null);
      onSetOpen(false);
    }, 250);
  };

  useEffect(() => {
    return () => clearTimers();
  }, []);

  useEffect(() => {
    if (!menuOpenId) return;
    const handlePointerDown = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpenId(null);
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpenId]);

  const isVisible = pinned || open;
  const hideHint = isVisible || immersiveIdle;

  return (
    <>
      {/* Zona ativa invisível na borda esquerda */}
      {!pinned && (
        <div
          className="fixed inset-y-0 left-0 w-[8px] z-edge"
          onMouseEnter={handleEdgeEnter}
          onMouseLeave={handleEdgeLeave}
          aria-hidden="true"
        />
      )}

      {/* Filete sutil — único indício quando oculta */}
      <div
        aria-hidden="true"
        className="fixed left-[6px] top-1/2 -translate-y-1/2 rounded-[1px] pointer-events-none z-edge transition-[height,background-color,opacity] duration-base ease-out"
        style={{
          width: "2px",
          height: edgeHover ? "56px" : "40px",
          backgroundColor: edgeHover ? "rgba(255, 255, 255, 0.55)" : "rgba(255, 255, 255, 0.20)",
          opacity: hideHint ? 0 : 1,
        }}
      />

      <aside
        ref={sidebarRef}
        aria-label="Vídeos salvos"
        data-open={open ? "true" : "false"}
        data-pinned={pinned ? "true" : "false"}
        onMouseEnter={handleSidebarEnter}
        onMouseLeave={scheduleClose}
        className={[
          "fixed z-sidebar flex flex-col gap-2 p-3 glass transition-[opacity,transform,border-radius] duration-slow ease-out",
          "focus-within:opacity-100 focus-within:translate-x-0 focus-within:pointer-events-auto",
          pinned
            ? "top-0 bottom-0 left-0 rounded-r-panel rounded-l-none opacity-100 translate-x-0 pointer-events-auto"
            : "top-[12px] bottom-[12px] left-[12px] rounded-panel",
          !pinned && !open
            ? "opacity-0 -translate-x-3 pointer-events-none"
            : "opacity-100 translate-x-0 pointer-events-auto",
        ].join(" ")}
        style={{ width: "var(--sidebar-w)" }}
      >
        {/* Linha de navegação no topo */}
        <div className="flex items-center gap-1 pb-1">
          <button
            type="button"
            onClick={onGoBack}
            disabled={!canGoBack}
            aria-label="Vídeo anterior no histórico"
            className="grid h-7 w-7 place-items-center rounded-pill text-text-2 transition-colors duration-fast hover:bg-glass-hover hover:text-text-1 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ArrowLeft size={16} weight="regular" />
          </button>
          <button
            type="button"
            onClick={onGoForward}
            disabled={!canGoForward}
            aria-label="Próximo vídeo no histórico"
            className="grid h-7 w-7 place-items-center rounded-pill text-text-2 transition-colors duration-fast hover:bg-glass-hover hover:text-text-1 disabled:opacity-30 disabled:pointer-events-none"
          >
            <ArrowRight size={16} weight="regular" />
          </button>

          <div className="flex-1" />

          {archivedVideos.length > 0 && (
            <button
              type="button"
              onClick={() => onSetView(videoView === "active" ? "archived" : "active")}
              className="px-2 h-7 rounded-pill text-xs text-text-2 hover:bg-glass-hover hover:text-text-1 transition-colors duration-fast"
            >
              {videoView === "active" ? "Arquivados" : "Ativos"}
            </button>
          )}

          <button
            type="button"
            onClick={onTogglePin}
            aria-label={pinned ? "Desafixar barra lateral" : "Fixar barra lateral"}
            aria-pressed={pinned}
            className={[
              "grid h-7 w-7 place-items-center rounded-pill transition-colors duration-fast",
              pinned
                ? "bg-accent/15 text-accent-soft"
                : "text-text-2 hover:bg-glass-hover hover:text-text-1",
            ].join(" ")}
          >
            <PushPin size={16} weight={pinned ? "fill" : "regular"} />
          </button>
        </div>

        {/* Lista de vídeos salvos */}
        <div className="flex-1 overflow-y-auto arc-scroll space-y-0.5 pr-0.5">
          {orderedVideos.length === 0 ? (
            <div className="px-2.5 py-6 text-center text-sm text-text-3">
              {videoView === "active" ? "Nenhum vídeo salvo" : "Nenhum vídeo arquivado"}
            </div>
          ) : (
            orderedVideos.map((video) => {
              const jobId = video.job.job_id;
              const isActive = activeVideoId === jobId;
              const isProcessing =
                Boolean(video.isTranscribing) || isJobProcessingStatus(video.job.status);
              const title = video.job.video_name || video.job.source_file_name || "Vídeo sem título";
              const thumbSrc = video.videoPath
                ? `${apiBaseUrl}${video.videoPath}#t=1`
                : video.job.status !== "CREATED"
                  ? `${apiBaseUrl}/media/videos/${jobId}#t=1`
                  : undefined;

              return (
                <div key={jobId} className="group relative">
                  <button
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => {
                      if (videoView === "active") {
                        onSelectVideo(jobId);
                      }
                    }}
                    className={[
                      "w-full flex items-center gap-2.5 px-2.5 py-2 rounded-item text-left transition-[background-color,color] duration-fast",
                      isActive
                        ? "bg-glass-active text-text-1 shadow-[inset_0_0_0_1px_var(--glass-border-strong)]"
                        : "text-text-2 hover:bg-glass-hover hover:text-text-1",
                    ].join(" ")}
                  >
                    <div className="h-9 aspect-[9/16] rounded-thumb overflow-hidden bg-black/40 border border-line shrink-0 grid place-items-center">
                      {thumbSrc ? (
                        <video
                          src={thumbSrc}
                          preload="metadata"
                          muted
                          playsInline
                          className="w-full h-full object-cover pointer-events-none"
                        />
                      ) : (
                        <FilmStrip size={13} weight="regular" className="text-text-3" />
                      )}
                    </div>

                    <span className="flex-1 min-w-0 text-base leading-snug line-clamp-2">
                      {title}
                    </span>

                    {isProcessing ? (
                      <SpinnerGap
                        size={14}
                        weight="regular"
                        className="shrink-0 text-text-1 animate-spin"
                        aria-label="Processando"
                      />
                    ) : null}
                  </button>

                  {/* Botão … no hover */}
                  <button
                    type="button"
                    aria-label={`Ações de ${title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setMenuOpenId((prev) => (prev === jobId ? null : jobId));
                    }}
                    className={[
                      "absolute right-1.5 top-1/2 -translate-y-1/2 grid h-6 w-6 place-items-center rounded-pill transition-opacity duration-fast",
                      "text-text-2 hover:bg-glass-active hover:text-text-1",
                      menuOpenId === jobId
                        ? "opacity-100 bg-glass-active"
                        : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                    ].join(" ")}
                  >
                    <DotsThree size={16} weight="regular" />
                  </button>

                  {menuOpenId === jobId && (
                    <div
                      role="menu"
                      className="absolute right-2 top-[calc(100%+2px)] z-popover w-40 rounded-card glass--strong p-1 text-sm shadow-pop"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpenId(null);
                          onOpenFolder(jobId);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-thumb text-text-2 hover:bg-glass-hover hover:text-text-1 text-left"
                      >
                        <FolderOpen size={14} weight="regular" />
                        <span>Abrir pasta</span>
                      </button>

                      {videoView === "active" && (
                        <>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuOpenId(null);
                              onRenameVideo(jobId, title);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-thumb text-text-2 hover:bg-glass-hover hover:text-text-1 text-left"
                          >
                            <PencilSimple size={14} weight="regular" />
                            <span>Renomear</span>
                          </button>

                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuOpenId(null);
                              onArchiveVideo(jobId);
                            }}
                            className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-thumb text-text-2 hover:bg-glass-hover hover:text-text-1 text-left"
                          >
                            <Archive size={14} weight="regular" />
                            <span>Arquivar</span>
                          </button>
                        </>
                      )}

                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          setMenuOpenId(null);
                          onDeleteVideo(jobId);
                        }}
                        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-thumb text-danger hover:bg-[var(--danger-bg)] text-left"
                      >
                        <Trash size={14} weight="regular" />
                        <span>Excluir</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Rodapé */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-line">
          <button
            type="button"
            onClick={onNewVideo}
            className="flex-1 flex items-center gap-2 h-8 px-2.5 rounded-item text-base text-text-2 hover:bg-glass-hover hover:text-text-1 transition-colors duration-fast"
          >
            <Plus size={16} weight="regular" />
            <span>Novo vídeo</span>
          </button>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Configurações"
            className="grid h-8 w-8 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 transition-colors duration-fast"
          >
            <Gear size={16} weight="regular" />
          </button>
        </div>
      </aside>
    </>
  );
}
