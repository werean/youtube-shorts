import {
  useRef,
  useState,
  useEffect,
  useCallback,
  useMemo,
  forwardRef,
  useImperativeHandle,
  type SyntheticEvent,
  type PointerEvent,
} from "react";
import { cn } from "../../lib/utils";
import { formatTimestamp } from "../../utils/formatters";
import { apiBaseUrl } from "../../api/client";
import type { Cut } from "../../types";

const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2] as const;

export interface VideoPlayerViewProps {
  src?: string;
  jobId?: string;
  poster?: string;
  title?: string;
  status?: string;
  archiveLabel?: string | null;
  cuts?: Cut[];
  selectedCutId?: string | null;
  onSelectCut?: (cutId: string) => void;
  onClearSelectedCut?: () => void;
  onTimeUpdate?: (currentTime: number) => void;
  onDurationChange?: (duration: number) => void;
  isExpanded?: boolean;
  onToggleExpanded?: () => void;
  className?: string;
}

export interface VideoPlayerViewHandle {
  seek: (seconds: number) => void;
  play: () => Promise<void>;
  pause: () => void;
  setPlaybackRate: (rate: number) => void;
  getCurrentTime: () => number;
  getVideoElement: () => HTMLVideoElement | null;
}

export const VideoPlayerView = forwardRef<VideoPlayerViewHandle, VideoPlayerViewProps>(
  function VideoPlayerView(
    {
      src,
      jobId,
      poster,
      title,
      status,
      archiveLabel,
      cuts = [],
      selectedCutId,
      onSelectCut,
      onClearSelectedCut,
      onTimeUpdate,
      onDurationChange,
      isExpanded = true,
      onToggleExpanded,
      className,
    },
    ref,
  ) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);
    const speedMenuRef = useRef<HTMLDivElement>(null);

    // Resolucao limpa da URL de video com suporte a HTTP 206 Range e CORS
    const effectiveSrc = (() => {
      if (src) {
        if (
          src.startsWith("http://") ||
          src.startsWith("https://") ||
          src.startsWith("blob:") ||
          src.startsWith("data:")
        ) {
          return src;
        }
        const cleanPath = src.startsWith("/") ? src : `/${src}`;
        return `${apiBaseUrl}${cleanPath}`;
      }
      if (jobId) {
        return `${apiBaseUrl}/media/videos/${jobId}`;
      }
      return undefined;
    })();

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [playbackRate, setPlaybackRateState] = useState<number>(1);
    const [isSpeedMenuOpen, setIsSpeedMenuOpen] = useState(false);
    const [isHoveringTimeline, setIsHoveringTimeline] = useState(false);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverCut, setHoverCut] = useState<Cut | null>(null);
    const [isScrubbing, setIsScrubbing] = useState(false);

    const selectedCut = selectedCutId
      ? cuts.find((c) => c.cut_id === selectedCutId) ?? null
      : null;

    const sortedCuts = useMemo(
      () => [...cuts].sort((a, b) => a.start - b.start || a.end - b.end),
      [cuts],
    );

    // Rastreamento de cruzamento de selectedCut.end para auto-pause preciso em qualquer velocidade
    const wasBeforeCutEndRef = useRef<boolean>(false);
    const justAutoPausedCutIdRef = useRef<string | null>(null);
    const suppressNextAutoPauseSeekRef = useRef<boolean>(false);
    const isScrubbingRef = useRef<boolean>(false);
    const pendingMarkerCutRef = useRef<{
      cut: Cut;
      startX: number;
      startY: number;
      pointerId: number;
    } | null>(null);
    const lastScrubTargetRef = useRef<number | null>(null);

    const applyPlaybackRate = useCallback((rate: number) => {
      const normalized = Number.isFinite(rate) ? Math.max(0.25, Math.min(4, rate)) : 1;
      setPlaybackRateState(normalized);
      if (videoRef.current) {
        videoRef.current.playbackRate = normalized;
      }
    }, []);

    // Garante persistencia da velocidade ao trocar de fonte, corte ou expandir/recolher
    useEffect(() => {
      if (videoRef.current) {
        videoRef.current.playbackRate = playbackRate;
      }
    }, [playbackRate, effectiveSrc, isExpanded]);

    // Fecha popover de velocidade ao clicar fora ou pressionar Escape
    useEffect(() => {
      if (!isSpeedMenuOpen) return;
      const handlePointerDown = (e: globalThis.MouseEvent) => {
        if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
          setIsSpeedMenuOpen(false);
        }
      };
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setIsSpeedMenuOpen(false);
        }
      };
      document.addEventListener("mousedown", handlePointerDown);
      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("mousedown", handlePointerDown);
        document.removeEventListener("keydown", handleKeyDown);
      };
    }, [isSpeedMenuOpen]);

    // Reseta rastreamento de cruzamento quando o corte selecionado muda
    useEffect(() => {
      justAutoPausedCutIdRef.current = null;
      suppressNextAutoPauseSeekRef.current = false;
      const video = videoRef.current;
      if (video && selectedCut) {
        wasBeforeCutEndRef.current = video.currentTime < selectedCut.end;
      } else {
        wasBeforeCutEndRef.current = false;
      }
    }, [selectedCut?.cut_id, selectedCut?.end]);

    const checkAndAutoPauseAtCutEnd = useCallback(
      (video: HTMLVideoElement): boolean => {
        if (!selectedCut || video.paused) return false;
        const cutEnd = selectedCut.end;
        if (!Number.isFinite(cutEnd) || cutEnd <= 0) return false;

        const time = video.currentTime;
        if (time < cutEnd) {
          wasBeforeCutEndRef.current = true;
          justAutoPausedCutIdRef.current = null;
          return false;
        }

        const wasInsideCut = time >= selectedCut.start && time <= cutEnd + 0.5;
        const shouldAutoPause =
          wasBeforeCutEndRef.current ||
          (wasInsideCut && justAutoPausedCutIdRef.current !== selectedCut.cut_id);

        if (!shouldAutoPause) {
          if (time > cutEnd + 0.5) {
            justAutoPausedCutIdRef.current = null;
          }
          return false;
        }

        wasBeforeCutEndRef.current = false;
        justAutoPausedCutIdRef.current = selectedCut.cut_id;
        video.pause();
        if (Math.abs(video.currentTime - cutEnd) > 0.0001) {
          suppressNextAutoPauseSeekRef.current = true;
          video.currentTime = cutEnd;
        }
        setCurrentTime(cutEnd);
        onTimeUpdate?.(cutEnd);
        return true;
      },
      [selectedCut, onTimeUpdate],
    );

    const checkAndAutoPauseRef = useRef(checkAndAutoPauseAtCutEnd);
    checkAndAutoPauseRef.current = checkAndAutoPauseAtCutEnd;

    // Monitor via requestAnimationFrame (~60Hz) para nao perder o fim do corte em 1.5x/2x
    useEffect(() => {
      if (!isPlaying || !selectedCut || !isExpanded) return;

      let rafId = 0;
      let cancelled = false;

      const tick = () => {
        if (cancelled) return;
        const video = videoRef.current;
        if (!video || video.paused) return;

        const didPause = checkAndAutoPauseRef.current(video);
        if (!didPause && !video.paused) {
          rafId = window.requestAnimationFrame(tick);
        }
      };

      rafId = window.requestAnimationFrame(tick);
      return () => {
        cancelled = true;
        window.cancelAnimationFrame(rafId);
      };
    }, [isPlaying, selectedCut?.cut_id, selectedCut?.start, selectedCut?.end, isExpanded]);

    useImperativeHandle(
      ref,
      () => ({
        seek: (seconds: number) => {
          if (videoRef.current) {
            const target = Math.max(0, Math.min(seconds, duration || seconds));
            suppressNextAutoPauseSeekRef.current = false;
            justAutoPausedCutIdRef.current = null;
            videoRef.current.currentTime = target;
            setCurrentTime(videoRef.current.currentTime);
            if (selectedCut) {
              wasBeforeCutEndRef.current = videoRef.current.currentTime < selectedCut.end;
            }
          }
        },
        play: async () => {
          if (videoRef.current) {
            videoRef.current.playbackRate = playbackRate;
            await videoRef.current.play();
          }
        },
        pause: () => {
          if (videoRef.current) {
            videoRef.current.pause();
          }
        },
        setPlaybackRate: applyPlaybackRate,
        getCurrentTime: () => videoRef.current?.currentTime || 0,
        getVideoElement: () => videoRef.current,
      }),
      [duration, playbackRate, applyPlaybackRate, selectedCut],
    );

    const togglePlay = () => {
      const el = videoRef.current;
      if (!el) return;
      if (el.paused) {
        el.playbackRate = playbackRate;
        el.play().catch(() => {});
      } else {
        el.pause();
      }
    };

    const handlePlay = (e: SyntheticEvent<HTMLVideoElement>) => {
      const video = e.currentTarget;
      video.playbackRate = playbackRate;
      setIsPlaying(true);

      if (selectedCut) {
        const isResumingFromAutoPause =
          justAutoPausedCutIdRef.current === selectedCut.cut_id &&
          Math.abs(video.currentTime - selectedCut.end) < 0.05;
        if (isResumingFromAutoPause) {
          wasBeforeCutEndRef.current = false;
        } else {
          justAutoPausedCutIdRef.current = null;
          wasBeforeCutEndRef.current = video.currentTime < selectedCut.end;
        }
      }
    };

    const handleSeeked = (e: SyntheticEvent<HTMLVideoElement>) => {
      if (isScrubbingRef.current && lastScrubTargetRef.current !== null) {
        setCurrentTime(lastScrubTargetRef.current);
        if (selectedCut) {
          wasBeforeCutEndRef.current = lastScrubTargetRef.current < selectedCut.end;
        }
        return;
      }

      const time = e.currentTarget.currentTime;
      setCurrentTime(time);

      if (
        suppressNextAutoPauseSeekRef.current &&
        selectedCut &&
        Math.abs(time - selectedCut.end) < 0.05
      ) {
        suppressNextAutoPauseSeekRef.current = false;
        return;
      }

      suppressNextAutoPauseSeekRef.current = false;
      justAutoPausedCutIdRef.current = null;
      if (selectedCut) {
        wasBeforeCutEndRef.current = time < selectedCut.end;
      }
    };

    const handleTimeUpdate = (e: SyntheticEvent<HTMLVideoElement>) => {
      if (isScrubbingRef.current) return;
      const video = e.currentTarget;
      if (checkAndAutoPauseAtCutEnd(video)) {
        return;
      }
      const time = video.currentTime;
      setCurrentTime(time);
      onTimeUpdate?.(time);
    };

    const handleLoadedMetadata = (e: SyntheticEvent<HTMLVideoElement>) => {
      const video = e.currentTarget;
      video.playbackRate = playbackRate;
      const dur = video.duration;
      setDuration(dur);
      onDurationChange?.(dur);
    };

    const getRawTimeFromClientX = useCallback(
      (clientX: number): number => {
        if (!timelineRef.current || duration <= 0) return 0;
        const rect = timelineRef.current.getBoundingClientRect();
        if (rect.width <= 0) return 0;
        const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return pct * duration;
      },
      [duration],
    );

    const clampTargetTime = useCallback(
      (rawTime: number): number => {
        const clampedToDuration = duration > 0 ? Math.max(0, Math.min(duration, rawTime)) : Math.max(0, rawTime);
        if (!selectedCut) return clampedToDuration;
        const cutStart = Math.min(selectedCut.start, selectedCut.end);
        const cutEnd = Math.max(selectedCut.start, selectedCut.end);
        const maxBound = duration > 0 ? Math.min(cutEnd, duration) : cutEnd;
        const minBound = Math.min(cutStart, maxBound);
        return Math.max(minBound, Math.min(maxBound, clampedToDuration));
      },
      [duration, selectedCut],
    );

    const seekToTimelineTime = useCallback(
      (targetTime: number) => {
        suppressNextAutoPauseSeekRef.current = false;
        justAutoPausedCutIdRef.current = null;
        if (selectedCut) {
          wasBeforeCutEndRef.current = targetTime < selectedCut.end;
        }
        if (videoRef.current) {
          videoRef.current.currentTime = targetTime;
        }
        setCurrentTime(targetTime);
        onTimeUpdate?.(targetTime);
      },
      [selectedCut, onTimeUpdate],
    );

    const handleSelectAndSeekCut = useCallback(
      (cut: Cut) => {
        onSelectCut?.(cut.cut_id);
        suppressNextAutoPauseSeekRef.current = false;
        justAutoPausedCutIdRef.current = null;
        wasBeforeCutEndRef.current = cut.start < cut.end;
        const clampedStart = duration > 0 ? Math.max(0, Math.min(duration, cut.start)) : Math.max(0, cut.start);
        if (videoRef.current) {
          videoRef.current.currentTime = clampedStart;
        }
        setCurrentTime(clampedStart);
        onTimeUpdate?.(clampedStart);
      },
      [duration, onSelectCut, onTimeUpdate],
    );

    const handleGoToStart = useCallback(() => {
      if (selectedCut) {
        onClearSelectedCut?.();
      }
      suppressNextAutoPauseSeekRef.current = false;
      justAutoPausedCutIdRef.current = null;
      wasBeforeCutEndRef.current = false;
      if (videoRef.current) {
        videoRef.current.currentTime = 0;
      }
      setCurrentTime(0);
      onTimeUpdate?.(0);
    }, [selectedCut, onClearSelectedCut, onTimeUpdate]);

    const handleExitCutMode = useCallback(() => {
      suppressNextAutoPauseSeekRef.current = false;
      justAutoPausedCutIdRef.current = null;
      wasBeforeCutEndRef.current = false;
      onClearSelectedCut?.();
    }, [onClearSelectedCut]);

    const prevCut = useMemo(() => {
      if (sortedCuts.length === 0) return null;
      if (selectedCut) {
        const idx = sortedCuts.findIndex((c) => c.cut_id === selectedCut.cut_id);
        return idx > 0 ? sortedCuts[idx - 1] : null;
      }
      for (let i = sortedCuts.length - 1; i >= 0; i -= 1) {
        if (sortedCuts[i].start < currentTime - 0.5) {
          return sortedCuts[i];
        }
      }
      return null;
    }, [sortedCuts, selectedCut, currentTime]);

    const nextCut = useMemo(() => {
      if (sortedCuts.length === 0) return null;
      if (selectedCut) {
        const idx = sortedCuts.findIndex((c) => c.cut_id === selectedCut.cut_id);
        return idx >= 0 && idx < sortedCuts.length - 1 ? sortedCuts[idx + 1] : null;
      }
      return sortedCuts.find((c) => c.start > currentTime + 0.5) ?? null;
    }, [sortedCuts, selectedCut, currentTime]);

    const updateHoverState = useCallback(
      (rawTime: number, displayTime: number) => {
        setHoverTime(displayTime);
        const matchingCut = cuts.find(
          (c) => rawTime >= c.start && rawTime <= c.end,
        );
        setHoverCut(matchingCut || null);
      },
      [cuts],
    );

    const handleTimelinePointerDown = (e: PointerEvent<HTMLDivElement>) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (!timelineRef.current || !videoRef.current || duration <= 0) return;

      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture is unsupported in synthetic environments
      }

      if (pendingMarkerCutRef.current && pendingMarkerCutRef.current.pointerId === e.pointerId) {
        lastScrubTargetRef.current = null;
        return;
      }

      isScrubbingRef.current = true;
      setIsScrubbing(true);

      const rawTime = getRawTimeFromClientX(e.clientX);
      const targetTime = clampTargetTime(rawTime);
      lastScrubTargetRef.current = targetTime;
      seekToTimelineTime(targetTime);
      updateHoverState(rawTime, selectedCut ? targetTime : rawTime);
    };

    const handleTimelinePointerMove = (e: PointerEvent<HTMLDivElement>) => {
      if (!timelineRef.current || duration <= 0) return;

      const rawTime = getRawTimeFromClientX(e.clientX);

      const pending = pendingMarkerCutRef.current;
      if (pending && pending.pointerId === e.pointerId) {
        const dist = Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY);
        if (dist <= 4) {
          updateHoverState(rawTime, rawTime);
          return;
        }
        pendingMarkerCutRef.current = null;
        isScrubbingRef.current = true;
        setIsScrubbing(true);
      }

      if (isScrubbingRef.current) {
        const targetTime = clampTargetTime(rawTime);
        lastScrubTargetRef.current = targetTime;
        seekToTimelineTime(targetTime);
        updateHoverState(rawTime, selectedCut ? targetTime : rawTime);
      } else {
        updateHoverState(rawTime, rawTime);
      }
    };

    const finishTimelinePointer = (e: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
      try {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      } catch {
        // Ignore
      }

      const pending = pendingMarkerCutRef.current;
      pendingMarkerCutRef.current = null;

      if (!cancelled && pending && pending.pointerId === e.pointerId) {
        isScrubbingRef.current = false;
        setIsScrubbing(false);
        lastScrubTargetRef.current = null;
        handleSelectAndSeekCut(pending.cut);
        return;
      }

      if (isScrubbingRef.current) {
        if (!cancelled && duration > 0 && videoRef.current) {
          const rawTime = getRawTimeFromClientX(e.clientX);
          const targetTime = clampTargetTime(rawTime);
          seekToTimelineTime(targetTime);
        }
        isScrubbingRef.current = false;
        setIsScrubbing(false);
        lastScrubTargetRef.current = null;
      }
    };

    const toggleMute = () => {
      if (!videoRef.current) return;
      videoRef.current.muted = !isMuted;
      setIsMuted(!isMuted);
    };

    const handleVolumeChange = (newVol: number) => {
      if (!videoRef.current) return;
      videoRef.current.volume = newVol;
      setVolume(newVol);
      setIsMuted(newVol === 0);
    };

    const toggleFullscreen = () => {
      if (!videoRef.current) return;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      } else {
        videoRef.current.parentElement?.requestFullscreen().catch(() => {});
      }
    };

    const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
    const trimmedArchiveLabel = archiveLabel?.trim() || null;

    return (
      <div
        className={cn(
          "relative flex flex-col rounded-2xl border border-white/[0.08] bg-[#0c0c0e]/80 shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all duration-300",
          isExpanded ? "p-3 h-full" : "p-3",
          className,
        )}
      >
        {/* Cabecalho Compacto com Toggle de Recolher/Expandir */}
        <div className="flex items-center justify-between pb-2.5 border-b border-white/[0.08] mb-2.5 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-200 font-sans">
              Monitor Master 16:9
            </span>
            {title && (
              <span className="text-xs text-zinc-300 truncate max-w-[280px]">
                • {title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {trimmedArchiveLabel && (
              <div
                title={`Inspecionando tentativa arquivada: ${trimmedArchiveLabel}`}
                className="flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-xs text-amber-200 font-sans font-medium backdrop-blur-md shadow-[0_0_12px_rgba(251,191,36,0.12)]"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                <span className="truncate max-w-[180px]">Arquivo: {trimmedArchiveLabel}</span>
              </div>
            )}
            {cuts.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-0.5 text-xs text-zinc-300 font-sans font-medium">
                <span>{cuts.length} {cuts.length === 1 ? "corte" : "cortes"}</span>
              </div>
            )}
            {onToggleExpanded && (
              <button
                type="button"
                onClick={onToggleExpanded}
                title={isExpanded ? "Ocultar / Recolher Player" : "Exibir Player"}
                className="flex items-center gap-1.5 text-xs font-sans font-medium text-zinc-300 hover:text-white px-2.5 py-1 rounded-md border border-white/10 hover:border-white/20 bg-white/[0.03] hover:bg-white/[0.08] transition-all"
              >
                <span>{isExpanded ? "Ocultar" : "Exibir"}</span>
                <svg
                  className={cn(
                    "h-3.5 w-3.5 transition-transform duration-200",
                    isExpanded ? "rotate-180" : "rotate-0",
                  )}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {isExpanded && (
          <>
            {/* Viewport 16:9 de Monitoramento */}
            <div className="group relative flex-1 min-h-[140px] aspect-video w-auto max-w-full mx-auto overflow-hidden rounded-xl bg-black border border-white/[0.06] shadow-inner flex items-center justify-center">
              {effectiveSrc ? (
                <video
                  ref={videoRef}
                  src={effectiveSrc}
                  poster={poster}
                  preload="metadata"
                  crossOrigin="anonymous"
                  playsInline
                  onPlay={handlePlay}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  onSeeked={handleSeeked}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onClick={togglePlay}
                  className="h-full w-full object-contain cursor-pointer"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-text-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02]">
                    {status === "DOWNLOADING" ? (
                      <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <svg
                        className="h-6 w-6 stroke-[1.5]"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polygon points="5 3 19 12 5 21 5 3" />
                      </svg>
                    )}
                  </div>
                  <p className="text-body-sm font-medium">
                    {status === "DOWNLOADING"
                      ? "Baixando vídeo fonte com yt-dlp..."
                      : "Nenhum vídeo carregado para reprodução"}
                  </p>
                </div>
              )}

              {/* Overlay de Play no Centro quando pausado */}
              {effectiveSrc && !isPlaying && (
                <button
                  type="button"
                  onClick={togglePlay}
                  aria-label="Reproduzir video"
                  className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex h-14 w-14 items-center justify-center rounded-full border border-white/20 bg-black/40 text-white backdrop-blur-md transition-all duration-200 hover:scale-105 hover:bg-black/60 shadow-[0_0_30px_rgba(0,0,0,0.6)]"
                >
                  <svg
                    className="h-6 w-6 translate-x-0.5 fill-current"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <polygon points="6 4 20 12 6 20 6 4" />
                  </svg>
                </button>
              )}
            </div>

            {/* Linha de Tempo com Marcadores de Cortes IA */}
            <div className="mt-2 flex flex-col gap-1.5">
              {/* Timeline Bar */}
              <div
                ref={timelineRef}
                onPointerDown={handleTimelinePointerDown}
                onPointerMove={handleTimelinePointerMove}
                onPointerUp={(e) => finishTimelinePointer(e, false)}
                onPointerCancel={(e) => {
                  finishTimelinePointer(e, true);
                  setIsHoveringTimeline(false);
                  setHoverTime(null);
                  setHoverCut(null);
                }}
                onPointerEnter={() => setIsHoveringTimeline(true)}
                onPointerLeave={() => {
                  if (!isScrubbingRef.current) {
                    setIsHoveringTimeline(false);
                    setHoverTime(null);
                    setHoverCut(null);
                  }
                }}
                className="group relative h-4 w-full cursor-pointer flex items-center select-none touch-none"
              >
                {/* Trilho base */}
                <div className="relative h-1.5 w-full rounded-full bg-white/[0.08] transition-all duration-150 group-hover:h-2">
                  {/* Progresso do video */}
                  <div
                    className={cn(
                      "absolute left-0 top-0 h-full rounded-full bg-white/70 shadow-[0_0_8px_rgba(255,255,255,0.4)]",
                      !isScrubbing && "transition-[width] duration-75",
                    )}
                    style={{ width: `${progressPct}%` }}
                  />

                  {/* Marcadores de cortes IA na timeline */}
                  {duration > 0 &&
                    cuts.map((cut) => {
                      const left = (cut.start / duration) * 100;
                      const width = Math.max(0.8, ((cut.end - cut.start) / duration) * 100);
                      const isCutSelected = cut.cut_id === selectedCutId;

                      return (
                        <div
                          key={cut.cut_id}
                          onPointerDown={(e) => {
                            if (isCutSelected) return;
                            if (e.pointerType === "mouse" && e.button !== 0) return;
                            pendingMarkerCutRef.current = {
                              cut,
                              startX: e.clientX,
                              startY: e.clientY,
                              pointerId: e.pointerId,
                            };
                          }}
                          title={cut.title || `Corte (${formatTimestamp(cut.start)} - ${formatTimestamp(cut.end)})`}
                          className={cn(
                            "absolute top-0 h-full rounded transition-all duration-150 z-10",
                            isCutSelected
                              ? "pointer-events-none bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)] opacity-100 ring-1 ring-white"
                              : "cursor-pointer bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.6)] opacity-85 hover:opacity-100 hover:scale-y-125",
                          )}
                          style={{
                            left: `${left}%`,
                            width: `${width}%`,
                          }}
                        />
                      );
                    })}

                  {/* Head / Scrubber Knob */}
                  <div
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full border border-white bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)] transition-opacity duration-150 z-20 pointer-events-none",
                      isScrubbing ? "opacity-100 scale-110" : "opacity-0 group-hover:opacity-100",
                    )}
                    style={{ left: `${progressPct}%` }}
                  />
                </div>

                {/* Tooltip de Hover */}
                {isHoveringTimeline && hoverTime !== null && (
                  <div
                    className="pointer-events-none absolute -top-9 -translate-x-1/2 rounded-lg border border-white/20 bg-[#141418]/95 px-2.5 py-1 text-xs font-mono text-white shadow-xl backdrop-blur-md z-30"
                    style={{
                      left: `${duration > 0 ? (hoverTime / duration) * 100 : 0}%`,
                    }}
                  >
                    {hoverCut ? (
                      <span className="text-amber-300 font-sans font-semibold mr-1.5">
                        {hoverCut.title || "Corte IA"}:
                      </span>
                    ) : null}
                    <span>{formatTimestamp(hoverTime)}</span>
                  </div>
                )}
              </div>

              {/* Barra de Controles de Reproducao */}
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 pt-1.5 border-t border-white/[0.04]">
                {/* Controles da esquerda: Transporte, Vol, Timecodes */}
                <div className="flex items-center gap-2.5">
                  <div className="flex items-center gap-1">
                    {/* Ir para o início (00:00) */}
                    <button
                      type="button"
                      onClick={handleGoToStart}
                      disabled={!effectiveSrc}
                      aria-label="Ir para o início do vídeo"
                      title="Ir para o início do vídeo (00:00)"
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-200 transition-all hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-white active:scale-95 disabled:opacity-35 disabled:pointer-events-none"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <line x1="5" y1="5" x2="5" y2="19" />
                        <polygon points="19 6 9 12 19 18 19 6" fill="currentColor" stroke="none" />
                      </svg>
                    </button>

                    {/* Corte anterior */}
                    <button
                      type="button"
                      onClick={() => prevCut && handleSelectAndSeekCut(prevCut)}
                      disabled={!prevCut}
                      aria-label="Corte anterior"
                      title={
                        prevCut
                          ? `Corte anterior: ${prevCut.title || formatTimestamp(prevCut.start)}`
                          : "Nenhum corte anterior"
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-200 transition-all hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-white active:scale-95 disabled:opacity-35 disabled:pointer-events-none"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="15 18 9 12 15 6" />
                      </svg>
                    </button>

                    {/* Play / Pause */}
                    <button
                      type="button"
                      onClick={togglePlay}
                      aria-label={isPlaying ? "Pausar" : "Reproduzir"}
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-white transition-all hover:border-white/[0.2] hover:bg-white/[0.08] active:scale-95"
                    >
                      {isPlaying ? (
                        <svg
                          className="h-3.5 w-3.5 fill-current"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <rect x="6" y="4" width="4" height="16" />
                          <rect x="14" y="4" width="4" height="16" />
                        </svg>
                      ) : (
                        <svg
                          className="h-3.5 w-3.5 fill-current translate-x-0.5"
                          viewBox="0 0 24 24"
                          aria-hidden="true"
                        >
                          <polygon points="5 3 19 12 5 21 5 3" />
                        </svg>
                      )}
                    </button>

                    {/* Próximo corte */}
                    <button
                      type="button"
                      onClick={() => nextCut && handleSelectAndSeekCut(nextCut)}
                      disabled={!nextCut}
                      aria-label="Próximo corte"
                      title={
                        nextCut
                          ? `Próximo corte: ${nextCut.title || formatTimestamp(nextCut.start)}`
                          : "Nenhum próximo corte"
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-zinc-200 transition-all hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-white active:scale-95 disabled:opacity-35 disabled:pointer-events-none"
                    >
                      <svg
                        className="h-3.5 w-3.5"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                    </button>
                  </div>

                  {/* Volume */}
                  <div className="flex items-center gap-1.5 text-text-2 hover:text-white transition-colors">
                    <button
                      type="button"
                      onClick={toggleMute}
                      aria-label={isMuted ? "Ativar som" : "Desativar som"}
                      className="flex h-7 w-7 items-center justify-center rounded hover:bg-white/[0.06]"
                    >
                      {isMuted || volume === 0 ? (
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <line x1="23" y1="9" x2="17" y2="15" />
                          <line x1="17" y1="9" x2="23" y2="15" />
                        </svg>
                      ) : (
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.75"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                          <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                        </svg>
                      )}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={isMuted ? 0 : volume}
                      onChange={(e) => handleVolumeChange(Number(e.target.value))}
                      className="w-16 h-1 accent-white bg-white/20 rounded cursor-pointer"
                      aria-label="Volume"
                    />
                  </div>

                  {/* Timecode Monospace */}
                  <div className="flex items-center font-mono text-sm text-zinc-300 tracking-tight">
                    <span className="text-white font-semibold">{formatTimestamp(currentTime)}</span>
                    <span className="mx-1.5 text-zinc-500">/</span>
                    <span>{formatTimestamp(duration)}</span>
                  </div>
                </div>

                {/* Controles da direita: Sair do corte (vídeo livre) + Velocidade + Tela Cheia */}
                <div className="flex items-center gap-2">
                  {selectedCut && (
                    <button
                      type="button"
                      onClick={handleExitCutMode}
                      aria-label="Assistir vídeo livre"
                      title="Sair do recorte selecionado e assistir o vídeo livremente mantendo o ponto atual"
                      className="flex h-8 items-center gap-1.5 rounded-lg border border-amber-400/35 bg-amber-400/10 px-2.5 text-xs font-medium text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.12)] backdrop-blur-md transition-all hover:border-amber-400/60 hover:bg-amber-400/20 hover:text-white active:scale-95"
                    >
                      <svg
                        className="h-3.5 w-3.5 text-amber-300"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.9"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                        <path d="M7 11V7a5 5 0 0 1 9.9-1" />
                      </svg>
                      <span>Assistir vídeo livre</span>
                    </button>
                  )}
                  {/* Seletor de Velocidade Liquid Glass */}
                  <div ref={speedMenuRef} className="relative">
                    <button
                      type="button"
                      onClick={() => setIsSpeedMenuOpen((prev) => !prev)}
                      aria-label={`Velocidade de reprodução: ${playbackRate}x`}
                      aria-expanded={isSpeedMenuOpen}
                      aria-haspopup="listbox"
                      title="Velocidade de reprodução"
                      className={cn(
                        "flex h-8 items-center gap-1 rounded-lg border px-2.5 font-mono text-xs font-medium transition-all active:scale-95",
                        playbackRate !== 1
                          ? "border-amber-400/40 bg-amber-400/15 text-amber-200 shadow-[0_0_12px_rgba(251,191,36,0.18)] hover:border-amber-400/60 hover:bg-amber-400/20"
                          : "border-white/[0.08] bg-white/[0.04] text-zinc-200 hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-white",
                      )}
                    >
                      <span>{playbackRate}x</span>
                      <svg
                        className={cn(
                          "h-3 w-3 text-zinc-400 transition-transform duration-150",
                          isSpeedMenuOpen && "rotate-180 text-white",
                        )}
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <polyline points="18 15 12 9 6 15" />
                      </svg>
                    </button>

                    {isSpeedMenuOpen && (
                      <div
                        role="listbox"
                        aria-label="Selecionar velocidade"
                        className="absolute bottom-full right-0 mb-2 z-40 min-w-[88px] rounded-xl border border-white/[0.14] bg-[#111216]/95 p-1 shadow-[0_12px_32px_rgba(0,0,0,0.65),inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-xl"
                      >
                        {PLAYBACK_SPEEDS.map((speed) => {
                          const isActive = Math.abs(playbackRate - speed) < 0.001;
                          return (
                            <button
                              key={speed}
                              type="button"
                              role="option"
                              aria-selected={isActive}
                              onClick={() => {
                                applyPlaybackRate(speed);
                                setIsSpeedMenuOpen(false);
                              }}
                              className={cn(
                                "flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition-colors",
                                isActive
                                  ? "bg-white/[0.12] text-white font-semibold"
                                  : "text-zinc-300 hover:bg-white/[0.06] hover:text-white",
                              )}
                            >
                              <span>{speed}x</span>
                              {isActive && (
                                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_6px_rgba(251,191,36,0.9)]" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={toggleFullscreen}
                    aria-label="Tela cheia"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04] text-text-2 transition-all hover:border-white/[0.2] hover:bg-white/[0.08] hover:text-white active:scale-95"
                  >
                    <svg
                      className="h-3.5 w-3.5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.75"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  },
);
