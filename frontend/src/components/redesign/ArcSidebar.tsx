import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowsLeftRight,
  CaretLeft,
  CaretRight,
  DotsThreeVertical,
  FileText,
  FilmStrip,
  Gear,
  Plus,
  PushPin,
  SpinnerGap,
  Trash,
} from "@phosphor-icons/react";
import type { VideoItem } from "../../utils/videoHelpers";

interface ArcSidebarProps {
  videos: VideoItem[];
  archivedVideos: VideoItem[];
  activeVideoId: string | null;
  videoView: "active" | "archived";
  apiBaseUrl: string;
  pinned: boolean;
  open: boolean;
  side: "left" | "right";
  transcriptAttached?: boolean;
  keepOpenForAttached?: boolean;
  immersiveIdle: boolean;
  activeVideoHasTranscription?: boolean;
  processingJobIds?: ReadonlySet<string>;
  onSetOpen: (open: boolean) => void;
  onTogglePin: () => void;
  onToggleSide: () => void;
  onSelectVideo: (jobId: string) => void;
  onSetView: (view: "active" | "archived") => void;
  onNewVideo: () => void;
  onOpenSettings: () => void;
  onOpenTranscript: (jobId: string) => void;
  onOpenFolder?: (jobId: string) => void;
  onRenameVideo?: (jobId: string, currentName: string) => void;
  onArchiveVideo?: (jobId: string) => void;
  onDeleteVideo: (jobId: string) => void;
}

interface FloatingMenuState {
  jobId: string;
  top: number;
  left: number;
}

const MENU_WIDTH = 160;

function videoHasTranscription(
  video: VideoItem,
  isActive: boolean,
  activeVideoHasTranscription?: boolean,
): boolean {
  return Boolean(
    video.hasTranscription ||
      (video.job as { has_transcription?: boolean }).has_transcription ||
      video.transcription ||
      (video.transcriptionSegments?.length ?? 0) > 0 ||
      (isActive && activeVideoHasTranscription),
  );
}

export function ArcSidebar({
  videos,
  archivedVideos,
  activeVideoId,
  videoView,
  apiBaseUrl,
  pinned,
  open,
  side = "left",
  transcriptAttached = false,
  keepOpenForAttached = false,
  immersiveIdle,
  activeVideoHasTranscription,
  processingJobIds,
  onSetOpen,
  onTogglePin,
  onToggleSide,
  onSelectVideo,
  onSetView,
  onNewVideo,
  onOpenSettings,
  onOpenTranscript,
  onDeleteVideo,
}: ArcSidebarProps) {
  const [menuState, setMenuState] = useState<FloatingMenuState | null>(null);
  const [edgeHover, setEdgeHover] = useState(false);
  const openTimerRef = useRef<number | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuOpenRef = useRef(false);
  menuOpenRef.current = menuState !== null;
  const keepOpenRef = useRef(Boolean(keepOpenForAttached));
  keepOpenRef.current = Boolean(keepOpenForAttached);
  const prevKeepOpenRef = useRef(Boolean(keepOpenForAttached));
  const prevPinnedRef = useRef(pinned);

  const displayedVideos = videoView === "active" ? videos : archivedVideos;
  const orderedVideos = displayedVideos.slice().reverse();
  const isRight = side === "right";

  const blurMenuTrigger = (jobId: string) => {
    if (pinned) return;
    const triggers = sidebarRef.current?.querySelectorAll<HTMLElement>("[data-arc-menu-trigger]");
    if (!triggers) return;
    for (const el of triggers) {
      if (el.getAttribute("data-arc-menu-trigger") === jobId && document.activeElement === el) {
        el.blur();
        break;
      }
    }
  };

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
    if (pinned || menuOpenRef.current || keepOpenRef.current) return;
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      if (menuOpenRef.current || keepOpenRef.current) return;
      setMenuState(null);
      if (
        sidebarRef.current &&
        document.activeElement instanceof HTMLElement &&
        sidebarRef.current.contains(document.activeElement)
      ) {
        document.activeElement.blur();
      }
      onSetOpen(false);
    }, 250);
  };

  useEffect(() => {
    const wasKeepOpen = prevKeepOpenRef.current;
    const isKeepOpen = Boolean(keepOpenForAttached);
    prevKeepOpenRef.current = isKeepOpen;

    if (isKeepOpen) {
      if (closeTimerRef.current) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      return;
    }

    if (
      wasKeepOpen &&
      !isKeepOpen &&
      !pinned &&
      open &&
      !menuOpenRef.current &&
      !sidebarRef.current?.matches(":hover")
    ) {
      scheduleClose();
    }
  }, [keepOpenForAttached, pinned, open]);

  useEffect(() => {
    const wasPinned = prevPinnedRef.current;
    prevPinnedRef.current = pinned;
    if (wasPinned && !pinned) {
      if (
        sidebarRef.current &&
        document.activeElement instanceof HTMLElement &&
        sidebarRef.current.contains(document.activeElement)
      ) {
        document.activeElement.blur();
      }
      if (!sidebarRef.current?.matches(":hover") && !menuOpenRef.current && !keepOpenRef.current) {
        clearTimers();
        onSetOpen(false);
      }
    }
  }, [pinned, onSetOpen]);

  useEffect(() => {
    return () => clearTimers();
  }, []);

  const isVisible = pinned || open;
  const hideHint = isVisible || immersiveIdle;

  useEffect(() => {
    if (!isVisible) {
      setMenuState(null);
    }
  }, [isVisible, side, videoView]);

  useEffect(() => {
    if (!menuState) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Element | null;
      if (menuRef.current && target && menuRef.current.contains(target)) {
        return;
      }
      const trigger = target?.closest("[data-arc-menu-trigger]");
      if (trigger && trigger.getAttribute("data-arc-menu-trigger") === menuState.jobId) {
        return;
      }
      blurMenuTrigger(menuState.jobId);
      setMenuState(null);
      if (!pinned && !keepOpenRef.current && (!sidebarRef.current || !target || !sidebarRef.current.contains(target))) {
        if (closeTimerRef.current) {
          window.clearTimeout(closeTimerRef.current);
          closeTimerRef.current = null;
        }
        onSetOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        blurMenuTrigger(menuState.jobId);
        setMenuState(null);
      }
    };
    const handleScrollOrResize = () => {
      blurMenuTrigger(menuState.jobId);
      setMenuState(null);
    };

    const listEl = listRef.current;
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleScrollOrResize);
    window.addEventListener("scroll", handleScrollOrResize, { capture: true, passive: true });
    listEl?.addEventListener("scroll", handleScrollOrResize, { passive: true });
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleScrollOrResize);
      window.removeEventListener("scroll", handleScrollOrResize, { capture: true });
      listEl?.removeEventListener("scroll", handleScrollOrResize);
    };
  }, [menuState, pinned, onSetOpen]);

  const menuVideo = menuState
    ? orderedVideos.find((v) => v.job.job_id === menuState.jobId) ?? null
    : null;
  const menuTitle = menuVideo
    ? menuVideo.job.video_name || menuVideo.job.source_file_name || "Vídeo sem título"
    : "";
  const menuIsActive = menuVideo ? activeVideoId === menuVideo.job.job_id : false;
  const menuHasTranscription = menuVideo
    ? videoHasTranscription(menuVideo, menuIsActive, activeVideoHasTranscription)
    : false;

  const sideSwitchLabel = isRight ? "Mover menu para a esquerda" : "Mover menu para a direita";

  return (
    <>
      {/* Zona ativa invisível na borda */}
      {!pinned && (
        <div
          className={`fixed inset-y-0 w-[8px] z-edge ${isRight ? "right-0" : "left-0"}`}
          onMouseEnter={handleEdgeEnter}
          onMouseLeave={handleEdgeLeave}
          aria-hidden="true"
        />
      )}

      {/* Ícone solto na borda quando a barra está oculta (sem card/fundo/pílula) */}
      {!pinned && (
        <button
          type="button"
          aria-label="Abrir barra lateral de vídeos"
          onMouseEnter={handleEdgeEnter}
          onMouseLeave={handleEdgeLeave}
          onClick={() => {
            clearTimers();
            onSetOpen(true);
          }}
          className={[
            "fixed top-1/2 -translate-y-1/2 z-edge bg-transparent border-0 p-0 cursor-pointer",
            "transition-[opacity,transform,color] duration-base ease-out",
            "drop-shadow-[0_2px_8px_rgba(0,0,0,0.75)]",
            isRight ? "right-2" : "left-2",
            edgeHover ? "text-white/95 scale-110" : "text-white/55 hover:text-white/95",
            hideHint ? "opacity-0 pointer-events-none" : "opacity-100 pointer-events-auto",
          ].join(" ")}
        >
          {isRight ? <CaretLeft size={20} weight="bold" /> : <CaretRight size={20} weight="bold" />}
        </button>
      )}

      <aside
        ref={sidebarRef}
        aria-label="Vídeos salvos"
        data-open={open ? "true" : "false"}
        data-pinned={pinned ? "true" : "false"}
        data-side={side}
        onMouseEnter={handleSidebarEnter}
        onMouseLeave={scheduleClose}
        onFocus={() => {
          if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
          }
          if (!pinned && !open) {
            onSetOpen(true);
          }
        }}
        onBlur={(e) => {
          const related = e.relatedTarget as Node | null;
          if (
            !pinned &&
            !menuOpenRef.current &&
            !sidebarRef.current?.contains(related) &&
            !menuRef.current?.contains(related)
          ) {
            scheduleClose();
          }
        }}
        className={[
          "fixed z-sidebar flex flex-col gap-2 p-3 glass transition-[opacity,transform,border-radius] duration-slow ease-out",
          "[&:has(:focus-visible)]:opacity-100 [&:has(:focus-visible)]:translate-x-0 [&:has(:focus-visible)]:pointer-events-auto",
          isRight
            ? "top-[12px] bottom-[12px] right-[12px]"
            : "top-[12px] bottom-[12px] left-[12px]",
          transcriptAttached && isVisible
            ? isRight
              ? "rounded-r-panel rounded-l-none border-l-0"
              : "rounded-l-panel rounded-r-none border-r-0"
            : "rounded-panel",
          !pinned && !open
            ? isRight
              ? "opacity-0 translate-x-3 pointer-events-none"
              : "opacity-0 -translate-x-3 pointer-events-none"
            : "opacity-100 translate-x-0 pointer-events-auto",
        ].join(" ")}
        style={{ width: "var(--sidebar-w)" }}
      >
        {/* Linha de navegação no topo */}
        <div className="flex items-center gap-1 pb-1">
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
            onClick={onToggleSide}
            aria-label={sideSwitchLabel}
            title={sideSwitchLabel}
            className="grid h-7 w-7 place-items-center rounded-pill text-text-2 transition-colors duration-fast hover:bg-glass-hover hover:text-text-1"
          >
            <ArrowsLeftRight size={16} weight="regular" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onTogglePin();
            }}
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
        <div ref={listRef} className="flex-1 overflow-y-auto arc-scroll space-y-0.5 pr-0.5">
          {orderedVideos.length === 0 ? (
            <div className="px-2.5 py-6 text-center text-sm text-text-3">
              {videoView === "active" ? "Nenhum vídeo salvo" : "Nenhum vídeo arquivado"}
            </div>
          ) : (
            orderedVideos.map((video) => {
              const jobId = video.job.job_id;
              const isActive = activeVideoId === jobId;
              const isMenuOpen = menuState?.jobId === jobId;
              const hasTranscription = videoHasTranscription(
                video,
                isActive,
                activeVideoHasTranscription,
              );
              const videoIsProcessing = (video as VideoItem & { is_processing?: boolean })
                .is_processing;
              const isProcessing =
                videoIsProcessing !== undefined
                  ? Boolean(video.isTranscribing) ||
                    Boolean(videoIsProcessing) ||
                    Boolean(processingJobIds?.has(jobId))
                  : Boolean(video.isTranscribing) || Boolean(processingJobIds?.has(jobId));
              const title = video.job.video_name || video.job.source_file_name || "Vídeo sem título";
              const thumbSrc = video.videoPath
                ? `${apiBaseUrl}${video.videoPath}#t=1`
                : video.job.status !== "CREATED"
                  ? `${apiBaseUrl}/media/videos/${jobId}#t=1`
                  : undefined;

              const menuButton = (
                <button
                  type="button"
                  data-arc-menu-trigger={jobId}
                  aria-label={`Ações de ${title}`}
                  aria-haspopup="menu"
                  aria-expanded={isMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isMenuOpen) {
                      if (!pinned) e.currentTarget.blur();
                      menuOpenRef.current = false;
                      setMenuState(null);
                      return;
                    }
                    const rowEl =
                      (e.currentTarget.closest("[data-video-row]") as HTMLElement | null) ??
                      e.currentTarget;
                    const rowRect = rowEl.getBoundingClientRect();
                    const sidebarRect = sidebarRef.current?.getBoundingClientRect();
                    const rawLeft = isRight
                      ? (sidebarRect ? sidebarRect.left : rowRect.left) - MENU_WIDTH - 8
                      : (sidebarRect ? sidebarRect.right : rowRect.right) + 8;
                    const left = Math.max(
                      8,
                      Math.min(rawLeft, window.innerWidth - MENU_WIDTH - 8),
                    );
                    const estHeight = hasTranscription ? 80 : 44;
                    const top = Math.max(
                      8,
                      Math.min(rowRect.top, window.innerHeight - estHeight - 8),
                    );
                    setMenuState({ jobId, top, left });
                  }}
                  className={[
                    "shrink-0 grid h-6 w-5 place-items-center rounded-pill transition-[opacity,background-color,color] duration-fast",
                    "hover:bg-glass-active hover:text-text-1",
                    isMenuOpen
                      ? "opacity-100 bg-glass-active text-text-1"
                      : isActive
                        ? "opacity-85 text-text-1 group-hover:opacity-100"
                        : "opacity-45 text-text-3 group-hover:opacity-100 group-hover:text-text-1 focus-visible:opacity-100",
                  ].join(" ")}
                >
                  <DotsThreeVertical size={16} weight="bold" />
                </button>
              );

              const spinnerEl = isProcessing ? (
                <SpinnerGap
                  size={14}
                  weight="regular"
                  className="shrink-0 text-text-1 animate-spin"
                  aria-label="Processando"
                />
              ) : null;

              return (
                <div
                  key={jobId}
                  data-video-row={jobId}
                  className={[
                    "group relative flex items-center gap-1 rounded-item transition-[background-color,color] duration-fast",
                    isRight ? "pl-2 pr-1" : "pl-1 pr-2",
                    isActive
                      ? "bg-glass-active text-text-1 shadow-[inset_0_0_0_1px_var(--glass-border-strong)]"
                      : "text-text-2 hover:bg-glass-hover hover:text-text-1",
                  ].join(" ")}
                >
                  {!isRight ? menuButton : null}

                  <button
                    type="button"
                    aria-current={isActive ? "true" : undefined}
                    onClick={() => {
                      if (videoView === "active") {
                        onSelectVideo(jobId);
                      }
                    }}
                    className={[
                      "flex-1 min-w-0 overflow-hidden flex items-center gap-2.5 py-2 text-left",
                      isRight ? "pl-0.5 pr-0" : "pr-0.5",
                    ].join(" ")}
                  >
                    {isRight ? spinnerEl : null}

                    <div className="w-9 h-9 rounded-lg overflow-hidden bg-black/40 border border-line shrink-0 grid place-items-center">
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

                    <span className="flex-1 min-w-0 text-base leading-snug line-clamp-2 break-all">
                      {title}
                    </span>

                    {!isRight ? spinnerEl : null}
                  </button>

                  {isRight ? menuButton : null}
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

      {menuState &&
        menuVideo &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            aria-label={`Ações de ${menuTitle}`}
            onMouseEnter={handleSidebarEnter}
            onMouseLeave={scheduleClose}
            onClick={(e) => e.stopPropagation()}
            className="fixed z-popover w-40 rounded-card glass--strong p-1 text-sm shadow-pop"
            style={{ top: menuState.top, left: menuState.left }}
          >
            {menuHasTranscription && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  const targetId = menuState.jobId;
                  menuOpenRef.current = false;
                  blurMenuTrigger(targetId);
                  setMenuState(null);
                  onOpenTranscript(targetId);
                }}
                className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-thumb text-text-2 hover:bg-glass-hover hover:text-text-1 text-left transition-colors duration-fast"
              >
                <FileText size={14} weight="regular" />
                <span>Transcrição</span>
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                const targetId = menuState.jobId;
                menuOpenRef.current = false;
                blurMenuTrigger(targetId);
                setMenuState(null);
                onDeleteVideo(targetId);
              }}
              className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-thumb text-danger hover:bg-[var(--danger-bg)] text-left transition-colors duration-fast"
            >
              <Trash size={14} weight="regular" />
              <span>Remover</span>
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}
