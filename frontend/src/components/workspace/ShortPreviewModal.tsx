import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";

export interface ShortPreviewDubTrack {
  lang: string;
  src: string;
  label?: string;
}

export interface ShortPreviewModalProps {
  isOpen: boolean;
  src: string;
  title?: string;
  dubbedTracks?: ShortPreviewDubTrack[];
  initialAudioMode?: "original" | "dubbed";
  initialDubLang?: string | null;
  onClose: () => void;
}

const SPEED_OPTIONS = [0.5, 1, 1.25, 1.5, 2] as const;

export function ShortPreviewModal({
  isOpen,
  src,
  title,
  dubbedTracks = [],
  initialAudioMode = "original",
  initialDubLang = null,
  onClose,
}: ShortPreviewModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [audioMode, setAudioMode] = useState<"original" | "dubbed">(initialAudioMode);
  const [selectedDubLang, setSelectedDubLang] = useState<string | null>(initialDubLang);

  useEffect(() => {
    if (!isOpen) return;
    const hasDubbed = dubbedTracks.length > 0;
    const nextMode = initialAudioMode === "dubbed" && hasDubbed ? "dubbed" : "original";
    setAudioMode(nextMode);
    if (initialDubLang && dubbedTracks.some((t) => t.lang === initialDubLang)) {
      setSelectedDubLang(initialDubLang);
    } else {
      setSelectedDubLang(dubbedTracks[0]?.lang ?? null);
    }
  }, [isOpen, initialAudioMode, initialDubLang, dubbedTracks]);

  const activeDubbedTrack =
    dubbedTracks.find((t) => t.lang === selectedDubLang) ?? dubbedTracks[0] ?? null;
  const effectiveAudioMode =
    audioMode === "dubbed" && activeDubbedTrack ? "dubbed" : "original";
  const activeSrc =
    effectiveAudioMode === "dubbed" && activeDubbedTrack ? activeDubbedTrack.src : src;

  // Lock background page scroll while modal is open
  useEffect(() => {
    if (!isOpen || typeof document === "undefined") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen || typeof document === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  // Sync volume, mute, and playback speed onto the video element
  useEffect(() => {
    const video = videoRef.current;
    if (!isOpen || !video) return;

    video.volume = volume;
    video.muted = isMuted;
    video.playbackRate = playbackRate;
  }, [isOpen, activeSrc, volume, isMuted, playbackRate]);

  if (!isOpen || !activeSrc || typeof document === "undefined") {
    return null;
  }

  const togglePlayPause = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused || video.ended) {
      void video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const handleToggleMute = () => {
    if (isMuted) {
      setIsMuted(false);
      if (volume === 0) {
        setVolume(1);
      }
    } else {
      setIsMuted(true);
    }
  };

  const handleVolumeChange = (nextVolume: number) => {
    setVolume(nextVolume);
    if (nextVolume > 0 && isMuted) {
      setIsMuted(false);
    } else if (nextVolume === 0 && !isMuted) {
      setIsMuted(true);
    }
  };

  const effectiveVolume = isMuted ? 0 : volume;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title || "Pré-visualização do Short"}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md overscroll-contain"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      onWheel={(event) => event.stopPropagation()}
    >
      <div
        className={cn(
          "relative flex flex-col items-center gap-3 w-full max-w-[440px] max-h-[94vh]",
          "rounded-3xl border border-white/[0.14] bg-[#0c0c10]/90 backdrop-blur-2xl p-4",
          "shadow-[0_24px_80px_rgba(0,0,0,0.85),inset_0_1px_0_0_rgba(255,255,255,0.12)]",
        )}
      >
        {/* Header with optional title and Close button */}
        <div className="flex w-full items-center justify-between gap-3">
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-white">
            {title || "Short Renderizado 9:16"}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium",
              "bg-white/[0.08] text-zinc-200 border border-white/[0.12]",
              "hover:bg-white/[0.16] hover:text-white transition-colors",
            )}
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
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
            <span>Fechar</span>
          </button>
        </div>

        {/* Optional Original / Dubbed switcher */}
        {dubbedTracks.length > 0 && (
          <div
            className="flex w-full flex-wrap items-center justify-center gap-1 rounded-xl border border-white/[0.1] bg-white/[0.04] p-1"
            role="group"
            aria-label="Alternar versão do Short"
          >
            <button
              type="button"
              onClick={() => setAudioMode("original")}
              className={cn(
                "rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
                effectiveAudioMode === "original"
                  ? "bg-white/[0.16] text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.2)]"
                  : "text-zinc-400 hover:text-white",
              )}
            >
              Original (.mp4)
            </button>
            {dubbedTracks.map((track) => {
              const isSelected =
                effectiveAudioMode === "dubbed" && activeDubbedTrack?.lang === track.lang;
              return (
                <button
                  key={track.lang}
                  type="button"
                  onClick={() => {
                    setSelectedDubLang(track.lang);
                    setAudioMode("dubbed");
                  }}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-medium transition-all cursor-pointer",
                    isSelected
                      ? "border border-cyan-400/45 bg-cyan-500/25 text-cyan-100 shadow-[0_0_12px_rgba(34,211,238,0.2)]"
                      : "text-zinc-400 hover:text-cyan-200",
                  )}
                >
                  {track.label || `Dublado (${track.lang.toUpperCase()})`}
                </button>
              );
            })}
          </div>
        )}

        {/* Clean 9:16 video player without native controls clutter */}
        <div className="relative flex w-full justify-center overflow-hidden rounded-2xl border border-white/[0.12] bg-black">
          <video
            key={activeSrc}
            ref={videoRef}
            src={activeSrc}
            autoPlay
            loop
            playsInline
            disablePictureInPicture
            controlsList="nodownload noplaybackrate noremoteplayback"
            onClick={togglePlayPause}
            onPlay={() => setIsPlaying(true)}
            onPause={() => setIsPlaying(false)}
            onEnded={() => setIsPlaying(false)}
            onLoadedMetadata={() => {
              const video = videoRef.current;
              if (!video) return;
              video.volume = volume;
              video.muted = isMuted;
              video.playbackRate = playbackRate;
            }}
            className={cn(
              "aspect-[9/16] w-auto cursor-pointer object-contain bg-black",
              dubbedTracks.length > 0 ? "max-h-[62vh]" : "max-h-[68vh]",
            )}
          />
        </div>

        {/* Strict Minimal Controls: Play/Pause, Volume, Playback Speed */}
        <div className="w-full space-y-2.5 rounded-2xl border border-white/[0.08] bg-white/[0.04] p-3">
          <div className="flex items-center justify-between gap-3">
            {/* Play / Pause */}
            <button
              type="button"
              onClick={togglePlayPause}
              aria-label={isPlaying ? "Pausar" : "Reproduzir"}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold",
                "bg-white text-zinc-950 hover:bg-zinc-200 transition-colors",
              )}
            >
              {isPlaying ? (
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg
                  className="h-3.5 w-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <polygon points="6 4 20 12 6 20 6 4" />
                </svg>
              )}
              <span>{isPlaying ? "Pausar" : "Reproduzir"}</span>
            </button>

            {/* Volume Control (Mute Toggle + Slider) */}
            <div className="flex flex-1 items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleToggleMute}
                aria-label={isMuted || volume === 0 ? "Ativar som" : "Silenciar"}
                className={cn(
                  "inline-flex h-7 w-7 items-center justify-center rounded-lg",
                  "bg-white/[0.06] border border-white/[0.08] text-zinc-200",
                  "hover:bg-white/[0.12] hover:text-white transition-colors",
                )}
              >
                {isMuted || volume === 0 ? (
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
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : (
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
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                  </svg>
                )}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={effectiveVolume}
                onChange={(event) => handleVolumeChange(Number(event.target.value))}
                aria-label="Volume"
                className="w-24 accent-white cursor-pointer"
              />
            </div>
          </div>

          {/* Playback Speed Controls */}
          <div className="flex items-center justify-between gap-2 pt-1 border-t border-white/[0.06]">
            <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">
              Velocidade
            </span>
            <div className="flex items-center gap-1">
              {SPEED_OPTIONS.map((rate) => {
                const isActive = playbackRate === rate;
                return (
                  <button
                    key={rate}
                    type="button"
                    onClick={() => setPlaybackRate(rate)}
                    className={cn(
                      "rounded-lg px-2 py-1 text-xs font-semibold tabular-nums transition-colors",
                      isActive
                        ? "bg-white text-zinc-950 shadow-sm"
                        : "bg-white/[0.06] text-zinc-300 border border-white/[0.08] hover:bg-white/[0.12] hover:text-white",
                    )}
                  >
                    {rate}x
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
