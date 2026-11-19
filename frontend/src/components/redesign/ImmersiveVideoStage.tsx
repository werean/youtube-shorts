import { useEffect, useRef, useState, type RefObject } from "react";
import { LinkSimple, Plus, UploadSimple } from "@phosphor-icons/react";
import { createJob, ingestJob, uploadVideoFile } from "../../api";
import type { VideoItem } from "../../utils/videoHelpers";

interface ImmersiveVideoStageProps {
  videoRef: RefObject<HTMLVideoElement>;
  videoSrc: string | null;
  sidebarPinned: boolean;
  transcriptPinned?: boolean;
  pinnedTranscriptSide?: "left" | "right" | null;
  pinnedTranscriptWithSidebar?: boolean;
  pinnedTranscriptHorizontal?: "above-dock" | null;
  sidebarSide?: "left" | "right";
  dockCollapsed?: boolean;
  dockHidden?: boolean;
  hasActiveVideo: boolean;
  onTogglePlay: () => void;
  onVideoAdded: (video: VideoItem) => void;
  onLoadVideos: () => Promise<void>;
  onError: (message: string) => void;
}

export function ImmersiveVideoStage({
  videoRef,
  videoSrc,
  sidebarPinned,
  transcriptPinned = false,
  pinnedTranscriptSide,
  pinnedTranscriptWithSidebar = false,
  pinnedTranscriptHorizontal = null,
  sidebarSide = "left",
  dockCollapsed = false,
  hasActiveVideo,
  onTogglePlay,
  onVideoAdded,
  onLoadVideos,
  onError,
}: ImmersiveVideoStageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlValue, setUrlValue] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isPortraitVideo, setIsPortraitVideo] = useState(false);

  useEffect(() => {
    setIsPortraitVideo(false);
  }, [videoSrc]);

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = urlValue.trim();
    if (!url || submitting) return;

    setSubmitting(true);
    try {
      const created = await createJob(url);
      setUrlValue("");
      await onLoadVideos();
      await ingestJob(created.job_id);
      await onLoadVideos();
    } catch (err: any) {
      onError(err?.message || "Não foi possível adicionar o vídeo por essa URL.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (list.length === 0 || submitting) return;

    setSubmitting(true);
    try {
      for (const file of list) {
        const result = await uploadVideoFile(file);
        const title = String(
          result.job?.video_name ?? result.job?.source_file_name ?? file.name,
        ).trim();
        onVideoAdded({
          job: { ...result.job, video_name: title },
          transcriptionLogs: [],
          videoPath: result.video_path,
        });
      }
      await onLoadVideos();
    } catch (err: any) {
      onError(err?.message || "Não foi possível enviar o arquivo.");
    } finally {
      setSubmitting(false);
    }
  };

  const showMaximizedStageMargins = hasActiveVideo && Boolean(videoSrc) && !dockCollapsed;
  const stageEdge = showMaximizedStageMargins ? "12px" : "0px";
  const legacyTranscriptOnSidebar = pinnedTranscriptSide === undefined && transcriptPinned;
  const stageTop = showMaximizedStageMargins ? "12px" : "0px";
  const stageLeft =
    pinnedTranscriptSide === "left"
      ? pinnedTranscriptWithSidebar
        ? "calc(var(--sidebar-w) + var(--transcript-w) + 24px)"
        : "calc(var(--transcript-w) + 12px)"
      : (sidebarPinned || legacyTranscriptOnSidebar) && sidebarSide !== "right"
        ? legacyTranscriptOnSidebar
          ? "calc(var(--sidebar-w) + var(--transcript-w) + 24px)"
          : "calc(var(--sidebar-w) + 24px)"
        : stageEdge;
  const stageRight =
    pinnedTranscriptSide === "right"
      ? pinnedTranscriptWithSidebar
        ? "calc(var(--sidebar-w) + var(--transcript-w) + 24px)"
        : "calc(var(--transcript-w) + 12px)"
      : (sidebarPinned || legacyTranscriptOnSidebar) && sidebarSide === "right"
        ? legacyTranscriptOnSidebar
          ? "calc(var(--sidebar-w) + var(--transcript-w) + 24px)"
          : "calc(var(--sidebar-w) + 24px)"
        : stageEdge;
  const stageBottom =
    pinnedTranscriptHorizontal === "above-dock"
      ? showMaximizedStageMargins
        ? "calc(var(--dock-h) + var(--transcript-h) + 24px)"
        : "calc(var(--dock-h-collapsed) + var(--transcript-h) + 24px)"
      : showMaximizedStageMargins
        ? "calc(var(--dock-h) + 24px)"
        : "0px";
  const stageRadiusClass = showMaximizedStageMargins ? "rounded-panel" : "rounded-none";
  const videoObjectFitClass = isPortraitVideo ? "object-contain" : "object-cover";

  return (
    <main
      data-video-stage="true"
      className={`fixed z-[var(--z-video)] bg-canvas ${stageRadiusClass} overflow-hidden transition-[top,left,right,bottom,border-radius] duration-slow ease-out`}
      style={{
        top: stageTop,
        left: stageLeft,
        right: stageRight,
        bottom: stageBottom,
      }}
    >
      {videoSrc && hasActiveVideo ? (
        /* Vídeo principal no espaço útil sobre bg-canvas limpo */
        <video
          ref={videoRef}
          src={videoSrc}
          playsInline
          onClick={onTogglePlay}
          onLoadedMetadata={(e) => {
            const isPortrait =
              e.currentTarget.videoHeight > e.currentTarget.videoWidth;
            setIsPortraitVideo(isPortrait);
          }}
          className={`w-full h-full ${stageRadiusClass} ${videoObjectFitClass} cursor-pointer transition-[border-radius] duration-slow ease-out`}
        />
      ) : (
        /* Estado vazio discreto em vidro */
        <div
          className="w-full h-full grid place-items-center p-6"
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            if (e.dataTransfer.files?.length) {
              void handleFiles(e.dataTransfer.files);
            }
          }}
        >
          <div
            className={[
              "w-full max-w-[440px] rounded-panel glass p-6 space-y-5 transition-[border-color,background-color] duration-base",
              isDragging ? "border-accent bg-glass-strong" : "",
            ].join(" ")}
          >
            <div className="space-y-1">
              <h2 className="text-md font-medium text-text-1">Adicione um vídeo</h2>
              <p className="text-sm text-text-2">
                Cole um link ou arraste arquivos de vídeo para começar.
              </p>
            </div>

            <form onSubmit={handleUrlSubmit} className="flex items-center gap-2">
              <div className="relative flex-1">
                <LinkSimple
                  size={15}
                  weight="regular"
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-text-3 pointer-events-none"
                />
                <input
                  type="url"
                  value={urlValue}
                  onChange={(e) => setUrlValue(e.target.value)}
                  placeholder="https://youtube.com/watch?v=..."
                  aria-label="Link do vídeo"
                  disabled={submitting}
                  className="w-full h-9 pl-9 pr-3 rounded-pill bg-white/[0.06] border border-line text-base text-text-1 placeholder:text-text-3 focus:border-line-strong focus-visible:ring-2 focus-visible:ring-accent-ring"
                />
              </div>
              <button
                type="submit"
                disabled={!urlValue.trim() || submitting}
                className="h-9 px-4 rounded-pill bg-accent text-accent-fg text-base font-medium hover:bg-accent-hover active:bg-accent-active disabled:opacity-45 transition-colors duration-fast shrink-0"
              >
                {submitting ? "Adicionando…" : "Adicionar"}
              </button>
            </form>

            <div className="relative">
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    void handleFiles(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
              <button
                type="button"
                disabled={submitting}
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex flex-col items-center justify-center gap-2 py-6 px-4 rounded-card border border-dashed border-line-strong bg-white/[0.02] hover:bg-glass-hover text-text-2 hover:text-text-1 transition-colors duration-fast"
              >
                <UploadSimple size={20} weight="regular" />
                <span className="text-sm">
                  {isDragging
                    ? "Solte os arquivos aqui"
                    : "Arraste vídeos aqui ou clique para escolher"}
                </span>
              </button>
            </div>

            <div className="flex items-center justify-center gap-1.5 text-xs text-text-3">
              <Plus size={12} weight="regular" />
              <span>Você também pode adicionar vídeos pela barra lateral</span>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
