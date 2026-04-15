import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";
import { Button } from "./Button";

export interface TranscriptLine {
  id: string;
  startSeconds: number;
  endSeconds?: number;
  text: string;
  highlighted?: boolean;
}

export interface TranscriptViewerProps extends HTMLAttributes<HTMLDivElement> {
  lines: TranscriptLine[];
  activeLineId?: string;
  onSeek: (timestamp: number) => void;
  onEmptyAction?: () => void;
  emptyActionLabel?: string;
}

function formatTimestamp(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function TranscriptViewer({
  lines,
  activeLineId,
  onSeek,
  onEmptyAction,
  emptyActionLabel = "Start transcription",
  className,
  ...rest
}: TranscriptViewerProps) {
  if (lines.length === 0) {
    return (
      <div
        className={cn(
          "rounded-lg border-[0.5px] border-border-1 bg-bg-2 p-4 text-center text-text-2",
          className,
        )}
        {...rest}
      >
        <p className="text-body">Transcript unavailable.</p>
        {onEmptyAction ? (
          <div className="mt-3 flex justify-center">
            <Button variant="ghost" onClick={onEmptyAction}>
              {emptyActionLabel}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "max-h-[320px] overflow-y-auto rounded-lg border-[0.5px] border-border-1 bg-bg-2 p-3",
        "font-mono text-body-sm leading-[1.7]",
        className,
      )}
      {...rest}
    >
      <ul className="space-y-1">
        {lines.map((line) => {
          const active = line.id === activeLineId;
          const highlighted = line.highlighted || active;

          return (
            <li
              key={line.id}
              className={cn(
                "rounded-[6px] px-2 py-1 ds-transition-color",
                active ? "bg-bg-3" : "hover:bg-bg-3/60",
              )}
            >
              <button
                type="button"
                onClick={() => onSeek(line.startSeconds)}
                className="mr-2 inline-flex text-caption text-text-3 underline-offset-2 hover:text-text-1 hover:underline"
              >
                {formatTimestamp(line.startSeconds)}
              </button>
              <span className={highlighted ? "text-text-1" : "text-text-2"}>{line.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
