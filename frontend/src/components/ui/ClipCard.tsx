import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/utils";
import { Badge } from "./Badge";
import { StatusRow, type StatusRowState } from "./StatusRow";

export interface ClipCardProps extends HTMLAttributes<HTMLDivElement> {
  title: string;
  score: number;
  durationSeconds: number;
  timestampSeconds: number;
  thumbnailUrl?: string;
  status?: StatusRowState;
  scoreHint?: string;
  onPlay?: () => void;
  onExport?: () => void;
  onDownload?: () => void;
  onDelete?: () => void;
}

function StarIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-3 w-3" aria-hidden="true">
      <path
        d="M10 2.2L12.4 7l5.2.8-3.8 3.7.9 5.2L10 14.3l-4.7 2.4.9-5.2-3.8-3.7L7.6 7 10 2.2z"
        fill="currentColor"
      />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M8 6.5v11l9-5.5-9-5.5z" fill="currentColor" />
    </svg>
  );
}

function ExportIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M12 3l4 4h-3v6h-2V7H8l4-4zm-7 11h14v7H5v-7z" fill="currentColor" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M11 4h2v8h3l-4 4-4-4h3V4zm-6 13h14v3H5v-3z" fill="currentColor" />
    </svg>
  );
}

function DeleteIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M8 4h8l1 2h4v2H3V6h4l1-2zm1 6h2v8H9v-8zm4 0h2v8h-2v-8z" fill="currentColor" />
    </svg>
  );
}

function IconAction({
  label,
  icon,
  onClick,
  destructive = false,
}: {
  label: string;
  icon: ReactNode;
  onClick?: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        "inline-flex h-[26px] w-[26px] items-center justify-center rounded-[6px] border-[0.5px]",
        "border-border-1 text-text-2 ds-transition-color hover:bg-bg-3 hover:text-text-1",
        destructive ? "hover:border-danger hover:text-danger" : "",
      )}
    >
      {icon}
    </button>
  );
}

function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
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

function scoreVariant(score: number): "success" | "warning" | "default" {
  if (score >= 80) {
    return "success";
  }
  if (score >= 60) {
    return "warning";
  }
  return "default";
}

export function ClipCard({
  title,
  score,
  durationSeconds,
  timestampSeconds,
  thumbnailUrl,
  status = "ready",
  scoreHint = "Score estimates engagement potential using hook strength, pacing, and semantic density.",
  onPlay,
  onExport,
  onDownload,
  onDelete,
  className,
  ...rest
}: ClipCardProps) {
  return (
    <article
      className={cn(
        "flex items-start gap-3 rounded-lg border-[0.5px] border-border-1 bg-bg-2 p-3",
        "ds-transition-color hover:border-border-2",
        className,
      )}
      {...rest}
    >
      <div className="h-[30px] w-12 flex-none overflow-hidden rounded-[6px] border-[0.5px] border-border-1 bg-bg-3">
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="Clip thumbnail" className="h-full w-full object-cover" />
        ) : null}
      </div>

      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-body font-medium text-text-1">{title}</p>
        <p className="text-body-sm text-text-2">
          Duration {formatDuration(durationSeconds)} · Timestamp {formatTimestamp(timestampSeconds)}
        </p>
        <StatusRow state={status} text={`Clip ${status}`} tag={status} />
      </div>

      <div className="flex flex-col items-end gap-2">
        <Badge variant={scoreVariant(score)} title={scoreHint}>
          <span className="inline-flex items-center gap-1">
            <StarIcon />
            {score}
          </span>
        </Badge>

        <div className="flex items-center gap-1.5">
          <IconAction label="Play clip" icon={<PlayIcon />} onClick={onPlay} />
          <IconAction label="Export clip" icon={<ExportIcon />} onClick={onExport} />
          <IconAction label="Download clip" icon={<DownloadIcon />} onClick={onDownload} />
          {onDelete ? (
            <IconAction
              label="Delete clip"
              icon={<DeleteIcon />}
              destructive
              onClick={() => {
                const confirmed = window.confirm("Delete this clip?");
                if (confirmed) {
                  onDelete();
                }
              }}
            />
          ) : null}
        </div>
      </div>
    </article>
  );
}
