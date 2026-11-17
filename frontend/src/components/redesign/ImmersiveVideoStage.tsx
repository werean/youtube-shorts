import { useEffect, useRef, useState, type RefObject } from "react";
import { LinkSimple, Plus, UploadSimple } from "@phosphor-icons/react";
import { createJob, ingestJob, uploadVideoFile } from "../../api";
import type { VideoItem } from "../../utils/videoHelpers";

interface ImmersiveVideoStageProps {
  videoRef: RefObject<HTMLVideoElement>;
  videoSrc: string | null;
  sidebarPinned: boolean;
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
  hasActiveVideo,
  onTogglePlay,
  onVideoAdded,
  onLoadVideos,
  onError,
}: ImmersiveVideoStageProps) {
  const ambientVideoRef = useRef<HTMLVideoElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlValue, setUrlValue] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Mantém o vídeo ambiente desfocado sincronizado com o vídeo principal
  useEffect(() => {
    const main = videoRef.current;
    const ambient = ambientVideoRef.current;
    if (!main || !ambient || !videoSrc) return;

    const syncPlay = () => {
      ambient.currentTime = main.currentTime;
      ambient.playbackRate = main.playbackRate;
      void ambient.play().catch(() => {});
    };
    const syncPause = () => {
      ambient.pause();
      ambient.currentTime = main.currentTime;
    };
    const syncSeek = () => {
      ambient.currentTime = main.currentTime;
    };
    const syncRate = () => {
      ambient.playbackRate = main.playbackRate;
    };

    main.addEventListener("play", syncPlay);
    main.addEventListener("pause", syncPause);
    main.addEventListener("seeked", syncSeek);
    main.addEventListener("ratechange", syncRate);
    return () => {
      main.removeEventListener("play", syncPlay);
      main.removeEventListener("pause", syncPause);
      main.removeEventListener("seeked", syncSeek);
      main.removeEventListener("ratechange", syncRate);
    };
  }, [videoRef, videoSrc]);

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

  return (
    <main
      className="fixed inset-0 z-[var(--z-video)] bg-canvas overflow-hidden transition-[left] duration-slow ease-out"
      style={{
        left: sidebarPinned ? "calc(var(--sidebar-w) + var(--sidebar-gap))" : "0px",
      }}
    >
      {videoSrc && hasActiveVideo ? (
        <>
          {/* Quadro ambiente desfocado para preencher laterais com cor coerente */}
          <video
            ref={ambientVideoRef}
            src={videoSrc}
            muted
            playsInline
            aria-hidden="true"
            className="absolute inset-0 w-full h-full object-cover pointer-events-none select-none"
            style={{
              filter: "blur(60px) brightness(0.4)",
              transform: "scale(1.2)",
            }}
          />

          {/* Vídeo principal em tela cheia */}
          <video
            ref={videoRef}
            src={videoSrc}
            playsInline
            onClick={onTogglePlay}
            className="relative z-[1] w-full h-full object-contain cursor-pointer"
          />
        </>
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
