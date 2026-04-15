import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type HTMLAttributes,
} from "react";
import { cn } from "../../lib/utils";
import { Button } from "./Button";
import { Progress } from "./Progress";
import { StatusRow } from "./StatusRow";

export type UploadZoneState = "idle" | "drag-over" | "uploading" | "success" | "error";

export interface UploadZoneProps extends HTMLAttributes<HTMLDivElement> {
  acceptedFormats?: string[];
  maxFiles?: number;
  onUpload?: (files: File[]) => Promise<void> | void;
  state?: UploadZoneState;
  progress?: number;
  errorMessage?: string;
  disabled?: boolean;
}

export function UploadZone({
  acceptedFormats = ["mp4", "mov", "mkv", "webm"],
  maxFiles = 1,
  onUpload,
  state,
  progress,
  errorMessage,
  disabled = false,
  className,
  ...rest
}: UploadZoneProps) {
  const inputId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const progressTimerRef = useRef<number | null>(null);
  const [localState, setLocalState] = useState<UploadZoneState>("idle");
  const [localProgress, setLocalProgress] = useState(0);
  const [localError, setLocalError] = useState<string | null>(null);

  const currentState = state ?? localState;
  const currentProgress = progress ?? localProgress;
  const currentError = errorMessage ?? localError;

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) {
        window.clearInterval(progressTimerRef.current);
      }
    };
  }, []);

  const isUploading = currentState === "uploading";
  const isError = currentState === "error";
  const isDragOver = currentState === "drag-over";

  const accept = useMemo(
    () => acceptedFormats.map((format) => `.${format}`).join(","),
    [acceptedFormats],
  );

  function stopProgressTimer() {
    if (progressTimerRef.current) {
      window.clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  async function handleFiles(files: File[]) {
    if (disabled || files.length === 0) {
      return;
    }

    setLocalError(null);
    setLocalState("uploading");
    setLocalProgress(3);

    stopProgressTimer();
    progressTimerRef.current = window.setInterval(() => {
      setLocalProgress((current) => (current >= 88 ? current : current + 6));
    }, 120);

    try {
      await onUpload?.(files.slice(0, maxFiles));
      stopProgressTimer();
      setLocalProgress(100);
      setLocalState("success");

      window.setTimeout(() => {
        setLocalState("idle");
        setLocalProgress(0);
      }, 900);
    } catch (error) {
      stopProgressTimer();
      setLocalState("error");
      setLocalError(error instanceof Error ? error.message : "Upload failed");
    }
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (disabled) {
      return;
    }

    const dropped = Array.from(event.dataTransfer.files);
    void handleFiles(dropped);
  }

  function onDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled && !isUploading) {
      setLocalState("drag-over");
    }
  }

  function onDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (!disabled && !isUploading) {
      setLocalState("idle");
    }
  }

  return (
    <div
      className={cn(
        "rounded-lg border-[0.5px] border-dashed bg-bg-1 p-6 text-center ds-transition-color",
        isDragOver ? "border-border-3" : "border-border-2",
        disabled ? "opacity-60" : "",
        className,
      )}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      {...rest}
    >
      <input
        id={inputId}
        ref={fileRef}
        className="hidden"
        type="file"
        accept={accept}
        multiple={maxFiles > 1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          void handleFiles(files);
        }}
      />

      <div className="space-y-3">
        <p className="text-heading-sm font-medium text-text-1">
          Drop media to start clip generation
        </p>
        <p className="text-body-sm text-text-2">
          Upload begins immediately and processing state stays visible.
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2">
          {acceptedFormats.map((format) => (
            <span
              key={format}
              className="rounded-[5px] border-[0.5px] border-border-1 bg-bg-2 px-2 py-[2px] text-label text-text-2"
            >
              {format}
            </span>
          ))}
        </div>

        {isUploading ? <Progress label="Uploading" value={currentProgress} /> : null}

        {currentState === "success" ? (
          <StatusRow state="ready" text="Upload complete" tag="ready" className="justify-center" />
        ) : null}

        {isError ? (
          <StatusRow
            state="error"
            text={currentError || "Upload failed"}
            tag="error"
            className="justify-center"
          />
        ) : null}

        <div className="flex justify-center">
          <Button
            variant="ghost"
            size="md"
            loading={isUploading}
            loadingLabel="Uploading"
            onClick={() => fileRef.current?.click()}
            disabled={disabled}
          >
            Select file
          </Button>
        </div>
      </div>
    </div>
  );
}
