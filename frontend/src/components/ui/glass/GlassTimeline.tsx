import React, {
  forwardRef,
  useCallback,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { cn } from "../../../lib/utils";

export interface TimelineMarker {
  id: string;
  time: number;
  label?: string;
  active?: boolean;
}

export interface GlassTimelineProps extends Omit<HTMLAttributes<HTMLDivElement>, "onChange"> {
  /** Current playback time in seconds */
  currentTime: number;
  /** Total video duration in seconds */
  duration: number;
  /** Callback fired when user seeks to a new timestamp */
  onSeek?: (time: number) => void;
  /** Suggested cuts or chapters displayed on the timeline track */
  markers?: TimelineMarker[];
  /** Whether to show the numeric time labels (00:00 / 00:00) */
  showTimeLabels?: boolean;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;

  if (hrs > 0) {
    return `${hrs.toString().padStart(2, "0")}:${remMins.toString().padStart(2, "0")}:${secs
      .toString()
      .padStart(2, "0")}`;
  }
  return `${remMins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export const GlassTimeline = forwardRef<HTMLDivElement, GlassTimelineProps>(function GlassTimeline(
  {
    currentTime,
    duration,
    onSeek,
    markers = [],
    showTimeLabels = true,
    className,
    ...rest
  },
  ref,
) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isHovering, setIsHovering] = useState(false);
  const [hoverPosition, setHoverPosition] = useState<{ percent: number; time: number } | null>(null);
  const [activeHoverMarker, setActiveHoverMarker] = useState<TimelineMarker | null>(null);

  const safeDuration = duration > 0 ? duration : 1;
  const progressPercent = Math.min(Math.max((currentTime / safeDuration) * 100, 0), 100);

  const calculateTimeFromEvent = useCallback(
    (e: MouseEvent<HTMLDivElement> | globalThis.MouseEvent): number => {
      if (!trackRef.current) return 0;
      const rect = trackRef.current.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const percentage = x / rect.width;
      return percentage * safeDuration;
    },
    [safeDuration],
  );

  const handleMouseMove = (e: MouseEvent<HTMLDivElement>) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = (x / rect.width) * 100;
    const time = (x / rect.width) * safeDuration;
    setHoverPosition({ percent, time });
  };

  const handleSeek = (e: MouseEvent<HTMLDivElement>) => {
    const newTime = calculateTimeFromEvent(e);
    onSeek?.(newTime);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!onSeek) return;
    const step = 5; // 5 second step
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      onSeek(Math.max(0, currentTime - step));
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      onSeek(Math.min(safeDuration, currentTime + step));
    }
  };

  return (
    <div
      ref={ref}
      className={cn("w-full select-none space-y-2", className)}
      {...rest}
    >
      {/* Interactive Track Area */}
      <div
        className="relative py-2 cursor-pointer group"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => {
          setIsHovering(false);
          setHoverPosition(null);
          setActiveHoverMarker(null);
        }}
        onMouseMove={handleMouseMove}
        onClick={handleSeek}
        tabIndex={0}
        role="slider"
        aria-label="Video timeline progress"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
        aria-valuetext={`${formatTime(currentTime)} of ${formatTime(duration)}`}
        onKeyDown={handleKeyDown}
      >
        {/* Recessed Glass Track */}
        <div
          ref={trackRef}
          className={cn(
            "relative h-2 w-full rounded-full transition-all duration-150 ease-out",
            "bg-white/[0.06] backdrop-blur-md",
            "border border-white/[0.08]",
            "shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]",
            "group-hover:h-2.5",
          )}
        >
          {/* Progress Bar Fill with Specular Highlight */}
          <div
            className="absolute top-0 bottom-0 left-0 rounded-full bg-gradient-to-r from-zinc-200 to-white transition-[width] duration-75 ease-linear shadow-[0_0_12px_rgba(255,255,255,0.45)]"
            style={{ width: `${progressPercent}%` }}
          >
            {/* Scrubber Knob */}
            <div
              className={cn(
                "absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2",
                "h-3.5 w-3.5 rounded-full bg-white",
                "border border-black/20 shadow-[0_2px_8px_rgba(0,0,0,0.4),0_0_0_2px_rgba(255,255,255,0.3)]",
                "opacity-0 group-hover:opacity-100 transition-opacity duration-150 scale-100 group-hover:scale-110",
              )}
            />
          </div>

          {/* Cut Markers along Track */}
          {markers.map((marker) => {
            const markerPercent = Math.min(Math.max((marker.time / safeDuration) * 100, 0), 100);
            return (
              <div
                key={marker.id}
                role="button"
                tabIndex={-1}
                aria-label={marker.label ?? `Cut at ${formatTime(marker.time)}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek?.(marker.time);
                }}
                onMouseEnter={() => setActiveHoverMarker(marker)}
                onMouseLeave={() => setActiveHoverMarker(null)}
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 -translate-x-1/2 z-10",
                  "cursor-pointer transition-transform duration-150 hover:scale-125",
                )}
                style={{ left: `${markerPercent}%` }}
              >
                <div
                  className={cn(
                    "h-3.5 w-1 rounded-full transition-all",
                    marker.active
                      ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)] scale-y-110"
                      : "bg-white/60 hover:bg-white shadow-[0_0_4px_rgba(255,255,255,0.5)]",
                  )}
                />
              </div>
            );
          })}
        </div>

        {/* Hover Floating Tooltip */}
        {isHovering && hoverPosition && (
          <div
            className="pointer-events-none absolute -top-8 -translate-x-1/2 z-20 transition-transform duration-75"
            style={{ left: `${hoverPosition.percent}%` }}
          >
            <div className="flex flex-col items-center">
              <div className="rounded-md border border-white/[0.14] bg-[#121318]/90 px-2 py-0.5 text-[11px] font-mono text-white backdrop-blur-md shadow-[0_4px_16px_rgba(0,0,0,0.6)]">
                {activeHoverMarker?.label ? (
                  <span className="flex items-center gap-1.5">
                    <span className="text-emerald-400 font-semibold">{activeHoverMarker.label}</span>
                    <span className="text-zinc-400">({formatTime(hoverPosition.time)})</span>
                  </span>
                ) : (
                  formatTime(hoverPosition.time)
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Timestamp Display */}
      {showTimeLabels && (
        <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400 select-none">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      )}
    </div>
  );
});
