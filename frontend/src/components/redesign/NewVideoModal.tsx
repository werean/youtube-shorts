import { useEffect, useRef, useState } from "react";
import { FilmStrip, LinkSimple, Plus, UploadSimple, X } from "@phosphor-icons/react";
import { createJob, ingestJob, uploadVideoFile } from "../../api";
import type { VideoItem } from "../../utils/videoHelpers";

interface NewVideoModalProps {
  open: boolean;
  onClose: () => void;
  onVideoAdded: (video: VideoItem) => void;
  onLoadVideos: () => Promise<void>;
  onError: (message: string) => void;
}

export function NewVideoModal({
  open,
  onClose,
  onVideoAdded,
  onLoadVideos,
  onError,
}: NewVideoModalProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [urlValue, setUrlValue] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, submitting, onClose]);

  if (!open) return null;

  const handleUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = urlValue.trim();
    if (!url || submitting) return;

    setSubmitting(true);
    try {
      const created = await createJob(url);
      setUrlValue("");
      onClose();
      await onLoadVideos();
      await ingestJob(created.job_id);
      await onLoadVideos();
    } catch (err: any) {
      onError(err?.message || "Não foi possível adicionar o vídeo por essa URL.");
    } finally {
      setSubmitting(false);
    }
  };

  const addValidFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const valid = Array.from(fileList).filter((f) => f.type.startsWith("video/"));
    if (valid.length === 0) {
      onError("Selecione arquivos de vídeo válidos.");
      return;
    }
    setSelectedFiles((prev) => [...prev, ...valid]);
  };

  const handleUploadFiles = async () => {
    if (selectedFiles.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      for (const file of selectedFiles) {
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
      setSelectedFiles([]);
      onClose();
      await onLoadVideos();
    } catch (err: any) {
      onError(err?.message || "Não foi possível enviar o arquivo de vídeo.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-modal flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
      onClick={() => {
        if (!submitting) onClose();
      }}
    >
      <div
        role="dialog"
        aria-label="Novo vídeo"
        className="w-full max-w-[460px] rounded-panel glass--strong p-5 shadow-panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-base font-medium text-text-1">Novo vídeo</h2>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            aria-label="Fechar"
            className="grid h-7 w-7 place-items-center rounded-pill text-text-2 hover:bg-glass-hover hover:text-text-1 disabled:opacity-40 transition-colors duration-fast"
          >
            <X size={15} weight="regular" />
          </button>
        </div>

        <form onSubmit={handleUrlSubmit} className="flex items-center gap-2 mb-4">
          <div className="flex-1 flex items-center gap-2 h-10 px-3 rounded-pill bg-glass border border-line focus-within:border-accent/60 transition-colors duration-fast">
            <LinkSimple size={15} weight="regular" className="text-text-3 shrink-0" />
            <input
              type="url"
              value={urlValue}
              onChange={(e) => setUrlValue(e.target.value)}
              placeholder="Cole um link do YouTube..."
              disabled={submitting}
              className="w-full bg-transparent text-sm text-text-1 placeholder:text-text-3 focus-visible:ring-2 focus-visible:ring-accent-ring rounded-pill"
            />
          </div>
          <button
            type="submit"
            disabled={!urlValue.trim() || submitting}
            className="h-10 px-4 rounded-pill bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40 disabled:pointer-events-none transition-colors duration-fast inline-flex items-center gap-1.5 shrink-0"
          >
            <Plus size={15} weight="regular" />
            <span>Adicionar</span>
          </button>
        </form>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            addValidFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={[
            "rounded-item border border-dashed p-5 text-center cursor-pointer transition-colors duration-fast",
            isDragging
              ? "border-accent bg-accent/10"
              : "border-line hover:border-line-strong hover:bg-glass-hover",
          ].join(" ")}
        >
          <UploadSimple size={22} weight="regular" className="mx-auto text-text-2 mb-2" />
          <p className="text-sm text-text-1">
            Arraste vídeos aqui ou clique para escolher
          </p>
          <p className="text-xs text-text-3 mt-1">
            Você pode enviar um ou vários arquivos
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addValidFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>

        {selectedFiles.length > 0 && (
          <div className="mt-3 space-y-1.5 max-h-[140px] overflow-y-auto arc-scroll">
            {selectedFiles.map((file, idx) => (
              <div
                key={`${file.name}-${idx}`}
                className="flex items-center justify-between gap-2 px-3 py-2 rounded-item bg-glass text-xs"
              >
                <div className="flex items-center gap-2 min-w-0">
                  <FilmStrip size={14} weight="regular" className="text-text-2 shrink-0" />
                  <span className="truncate text-text-1">{file.name}</span>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    setSelectedFiles((prev) => prev.filter((_, i) => i !== idx))
                  }
                  aria-label="Remover arquivo"
                  className="text-text-3 hover:text-text-1 shrink-0"
                >
                  <X size={13} weight="regular" />
                </button>
              </div>
            ))}
          </div>
        )}

        {selectedFiles.length > 0 && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              disabled={submitting}
              onClick={handleUploadFiles}
              className="h-9 px-4 rounded-pill bg-accent hover:bg-accent-hover text-white text-sm font-medium disabled:opacity-40 transition-colors duration-fast"
            >
              {submitting ? "Enviando..." : `Enviar (${selectedFiles.length})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
