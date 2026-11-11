import {
  useRef,
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
  type SyntheticEvent,
  type MouseEvent,
} from "react";
import { cn } from "../../lib/utils";
import { formatTimestamp } from "../../utils/formatters";
import type { Cut } from "../../types";

export interface VideoPlayerViewProps {
  src?: string;
  poster?: string;
  title?: string;
  cuts?: Cut[];
  selectedCutId?: string | null;
  onSelectCut?: (cutId: string) => void;
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
  getCurrentTime: () => number;
  getVideoElement: () => HTMLVideoElement | null;
}

export const VideoPlayerView = forwardRef<VideoPlayerViewHandle, VideoPlayerViewProps>(
  function VideoPlayerView(
    {
      src,
      poster,
      title,
      cuts = [],
      selectedCutId,
      onSelectCut,
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

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isMuted, setIsMuted] = useState(false);
    const [volume, setVolume] = useState(1);
    const [isHoveringTimeline, setIsHoveringTimeline] = useState(false);
    const [hoverTime, setHoverTime] = useState<number | null>(null);
    const [hoverCut, setHoverCut] = useState<Cut | null>(null);

    useImperativeHandle(
      ref,
      () => ({
        seek: (seconds: number) => {
          if (videoRef.current) {
            videoRef.current.currentTime = Math.max(0, Math.min(seconds, duration || seconds));
            setCurrentTime(videoRef.current.currentTime);
          }
        },
        play: async () => {
          if (videoRef.current) {
            await videoRef.current.play();
          }
        },
        pause: () => {
          if (videoRef.current) {
            videoRef.current.pause();
          }
        },
        getCurrentTime: () => videoRef.current?.currentTime || 0,
        getVideoElement: () => videoRef.current,
      }),
      [duration],
    );

    const togglePlay = () => {
      const el = videoRef.current;
      if (!el) return;
      if (el.paused) {
        el.play().catch(() => {});
      } else {
        el.pause();
      }
    };

    const handleTimeUpdate = (e: SyntheticEvent<HTMLVideoElement>) => {
      const time = e.currentTarget.currentTime;
      setCurrentTime(time);
      onTimeUpdate?.(time);
    };

    const handleLoadedMetadata = (e: SyntheticEvent<HTMLVideoElement>) => {
      const dur = e.currentTarget.duration;
      setDuration(dur);
      onDurationChange?.(dur);
    };

    const handleTimelineClick = (e: MouseEvent<HTMLDivElement>) => {
      if (!timelineRef.current || !videoRef.current || duration <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, clickX / rect.width));
      const targetTime = pct * duration;
      videoRef.current.currentTime = targetTime;
      setCurrentTime(targetTime);
    };

    const handleTimelineMouseMove = (e: MouseEvent<HTMLDivElement>) => {
      if (!timelineRef.current || duration <= 0) return;
      const rect = timelineRef.current.getBoundingClientRect();
      const moveX = e.clientX - rect.left;
      const pct = Math.max(0, Math.min(1, moveX / rect.width));
      const targetTime = pct * duration;
      setHoverTime(targetTime);

      const matchingCut = cuts.find(
        (c) => targetTime >= c.start && targetTime <= c.end,
      );
      setHoverCut(matchingCut || null);
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

    return (
      <div
        className={cn(
          "relative flex flex-col rounded-2xl border border-white/[0.08] bg-[#0c0c0e]/80 shadow-[0_12px_40px_rgba(0,0,0,0.5),inset_0_1px_0_0_rgba(255,255,255,0.08)] backdrop-blur-xl transition-all duration-300",
          isExpanded ? "p-3 h-full" : "p-3",
          className,
        )}
      >
        {/* Cabecalho Compacto com Toggle de Recolher/Expandir */}
        <div className="flex items-center justify-between pb-2 border-b border-white/[0.06] mb-2 select-none">
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.8)]" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-text-3 font-mono">
              Monitor Master 16:9
            </span>
            {title && (
              <span className="text-xs text-text-2 truncate max-w-[260px]">
                • {title}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            {cuts.length > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-0.5 text-[10px] text-text-2 font-mono">
                <span>{cuts.length} cortes</span>
              </div>
            )}
            {onToggleExpanded && (
              <button
                type="button"
                onClick={onToggleExpanded}
                title={isExpanded ? "Ocultar / Recolher Player" : "Exibir Player"}
                className="flex items-center gap-1 text-[11px] font-mono text-zinc-400 hover:text-white px-2 py-0.5 rounded border border-white/[0.08] hover:border-white/20 bg-white/[0.02] hover:bg-white/[0.06] transition-all"
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
              {src ? (
                <video
                  ref={videoRef}
                  src={src}
                  poster={poster}
                  preload="metadata"
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onTimeUpdate={handleTimeUpdate}
                  onLoadedMetadata={handleLoadedMetadata}
                  onClick={togglePlay}
                  className="h-full w-full object-contain cursor-pointer"
                />
              ) : (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-text-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-white/[0.02]">
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
                  </div>
                  <p className="text-body-sm font-medium">Nenhum video carregado para reproducao</p>
                </div>
              )}

              {/* Overlay de Play no Centro quando pausado */}
              {src && !isPlaying && (
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
                onClick={handleTimelineClick}
                onMouseEnter={() => setIsHoveringTimeline(true)}
                onMouseLeave={() => {
                  setIsHoveringTimeline(false);
                  setHoverTime(null);
                  setHoverCut(null);
                }}
                onMouseMove={handleTimelineMouseMove}
                className="group relative h-4 w-full cursor-pointer flex items-center select-none"
              >
                {/* Trilho base */}
                <div className="relative h-1.5 w-full rounded-full bg-white/[0.08] transition-all duration-150 group-hover:h-2">
                  {/* Progresso do video */}
                  <div
                    className="absolute left-0 top-0 h-full rounded-full bg-white/70 shadow-[0_0_8px_rgba(255,255,255,0.4)] transition-[width] duration-75"
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
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectCut?.(cut.cut_id);
                            if (videoRef.current) {
                              videoRef.current.currentTime = cut.start;
                              setCurrentTime(cut.start);
                            }
                          }}
                          title={cut.title || `Corte (${formatTimestamp(cut.start)} - ${formatTimestamp(cut.end)})`}
                          className={cn(
                            "absolute top-0 h-full rounded transition-all duration-150 z-10",
                            isCutSelected
                              ? "bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.9)] opacity-100 ring-1 ring-white"
                              : "bg-emerald-400/80 shadow-[0_0_6px_rgba(52,211,153,0.6)] opacity-85 hover:opacity-100 hover:scale-y-125",
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
                    className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-3.5 w-3.5 rounded-full border border-white bg-white shadow-[0_0_10px_rgba(255,255,255,0.8)] opacity-0 transition-opacity duration-150 group-hover:opacity-100 z-20 pointer-events-none"
                    style={{ left: `${progressPct}%` }}
                  />
                </div>

                {/* Tooltip de Hover */}
                {isHoveringTimeline && hoverTime !== null && (
                  <div
                    className="pointer-events-none absolute -top-8 -translate-x-1/2 rounded-md border border-white/[0.12] bg-[#141418] px-2 py-0.5 text-[10px] font-mono text-white shadow-xl backdrop-blur-md z-30"
                    style={{
                      left: `${duration > 0 ? (hoverTime / duration) * 100 : 0}%`,
                    }}
                  >
                    {hoverCut ? (
                      <span className="text-amber-300 font-sans font-medium mr-1.5">
                        {hoverCut.title || "Corte IA"}:
                      </span>
                    ) : null}
                    <span>{formatTimestamp(hoverTime)}</span>
                  </div>
                )}
              </div>

              {/* Barra de Controles de Reproducao */}
              <div className="flex items-center justify-between gap-4 pt-1 border-t border-white/[0.04]">
                {/* Controles da esquerda: Play/Pause, Vol, Timecodes */}
                <div className="flex items-center gap-3">
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
                  <div className="flex items-center font-mono text-body-sm text-text-2 tracking-tight">
                    <span className="text-white font-medium">{formatTimestamp(currentTime)}</span>
                    <span className="mx-1 text-text-3">/</span>
                    <span>{formatTimestamp(duration)}</span>
                  </div>
                </div>

                {/* Controles da direita: Tela Cheia */}
                <div className="flex items-center gap-2.5">
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
