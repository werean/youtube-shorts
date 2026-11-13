import { useState } from "react";
import type { VideoItem } from "../hooks";
import type { JobStatus } from "../types";
import { createJob, getJob, ingestJob, uploadVideoFile } from "../api";
import type { ActionState } from "../hooks/useAppAction";
import { GlassButton, GlassCard } from "./ui/glass";

interface UploadSectionProps {
  action: ActionState;
  onVideoAdded: (video: VideoItem) => void;
  onLoadVideos: () => Promise<void>;
  appSettings: any;
  onShowMoveUploadDialog: () => void;
  isExpanded?: boolean;
  onToggle?: () => void;
}

export function UploadSection({
  action,
  onVideoAdded,
  onLoadVideos,
  appSettings,
  onShowMoveUploadDialog,
}: UploadSectionProps) {
  const [uploadMode, setUploadMode] = useState<"url" | "file">("url");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function runAction<T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) {
    try {
      setIsSubmitting(true);
      const result = await fn();
      onSuccess?.(result);
    } catch (error) {
      console.error("Error during upload action:", error);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFileUpload() {
    if (selectedFiles.length === 0) return;

    const shouldAsk = appSettings?.preferences?.ask_move_on_upload ?? true;
    if (shouldAsk) {
      onShowMoveUploadDialog();
      return;
    }

    startUploadSelectedFiles();
  }

  async function startUploadSelectedFiles() {
    setIsSubmitting(true);
    for (const file of selectedFiles) {
      try {
        const result = await uploadVideoFile(file);
        const title = String(
          result.job?.video_name ?? result.job?.source_file_name ?? file.name,
        ).trim();
        const newVideo: VideoItem = {
          job: {
            ...result.job,
            video_name: title,
          },
          transcriptionLogs: [],
          videoPath: result.video_path,
        };
        onVideoAdded(newVideo);
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
      }
    }

    setIsSubmitting(false);
    setSelectedFiles([]);
    const fileInput = document.getElementById("video-file-input") as HTMLInputElement;
    if (fileInput) fileInput.value = "";
    await onLoadVideos();
  }

  async function handleUrlSubmit() {
    const url = youtubeUrl.trim();
    if (!url || isSubmitting) return;

    setIsSubmitting(true);
    try {
      // 1. Cria o job no backend imediatamente
      const job = await createJob(url);
      setYoutubeUrl("");
      setIsSubmitting(false);

      // 2. Notifica a UI imediatamente:
      // - Adiciona à biblioteca com status DOWNLOADING
      // - Torna-o o vídeo ativo no workspace
      // - Fecha o modal de importação automaticamente
      const tempVideo: VideoItem = {
        job: {
          ...job,
          status: "DOWNLOADING" as JobStatus,
          video_name: job.video_name || job.source_file_name || url,
        },
        transcriptionLogs: [],
        videoPath: `/media/videos/${job.job_id}`,
      };
      onVideoAdded(tempVideo);

      // 3. Dispara a ingestão (download yt-dlp) em segundo plano
      void (async () => {
        try {
          const ingestResult = await ingestJob(job.job_id);
          const updatedJob = await getJob(job.job_id);
          const title = String(
            updatedJob?.video_name ?? updatedJob?.source_file_name ?? url,
          ).trim();
          const videoPath = String(ingestResult?.video_path ?? `/media/videos/${job.job_id}`).trim();

          const finalVideo: VideoItem = {
            job: {
              ...updatedJob,
              video_name: title,
            },
            transcriptionLogs: [],
            videoPath,
          };
          onVideoAdded(finalVideo);
          await onLoadVideos();
        } catch (err) {
          console.error("[UploadSection] Erro ao baixar vídeo do YouTube:", err);
          await onLoadVideos();
        }
      })();
    } catch (err: any) {
      console.error("[UploadSection] Erro ao criar job:", err);
      setIsSubmitting(false);
      alert(err?.message || "Falha ao iniciar importação do vídeo");
    }
  }

  return (
    <div className="space-y-4">
      {/* Segmented Mode Selector */}
      <div className="flex p-1 bg-white/[0.04] border border-white/[0.08] rounded-xl backdrop-blur-md">
        <button
          type="button"
          onClick={() => {
            setUploadMode("url");
            setSelectedFiles([]);
          }}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
            uploadMode === "url"
              ? "bg-white/[0.12] text-white shadow-sm border border-white/10"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
          URL do YouTube
        </button>

        <button
          type="button"
          onClick={() => {
            setUploadMode("file");
            setYoutubeUrl("");
          }}
          className={`flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-lg transition-all duration-200 ${
            uploadMode === "file"
              ? "bg-white/[0.12] text-white shadow-sm border border-white/10"
              : "text-zinc-400 hover:text-zinc-200"
          }`}
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
          Arquivo Local
        </button>
      </div>

      {uploadMode === "url" ? (
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">
              Link do Vídeo
            </label>
            <div className="relative">
              <input
                type="text"
                value={youtubeUrl}
                onChange={(e) => setYoutubeUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleUrlSubmit();
                  }
                }}
                placeholder="https://www.youtube.com/watch?v=..."
                className="w-full bg-white/[0.04] border border-white/10 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-white/30 focus:ring-1 focus:ring-white/20 transition-all font-mono"
              />
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">
              O pipeline fará download automático com resolução e áudio otimizados para transcrição.
            </p>
          </div>

          <GlassButton
            variant="primary"
            fullWidth
            loading={isSubmitting}
            disabled={isSubmitting || youtubeUrl.trim().length === 0}
            onClick={handleUrlSubmit}
            leadingIcon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            }
          >
            Baixar e Importar Vídeo
          </GlassButton>
        </div>
      ) : (
        <div className="space-y-4">
          <div
            onClick={() => {
              const fileInput = document.getElementById("video-file-input") as HTMLInputElement;
              fileInput?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingFile(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingFile(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setIsDraggingFile(false);

              const files = e.dataTransfer.files;
              if (files && files.length > 0) {
                const videoFiles = Array.from(files).filter((file) =>
                  file.type.startsWith("video/"),
                );
                if (videoFiles.length > 0) {
                  setSelectedFiles((current) => [...current, ...videoFiles]);
                } else {
                  alert("Por favor, selecione arquivo(s) de vídeo válido(s)");
                }
              }
            }}
            className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all cursor-pointer select-none ${
              isDraggingFile
                ? "border-white/50 bg-white/[0.08]"
                : selectedFiles.length > 0
                ? "border-white/30 bg-white/[0.03]"
                : "border-white/15 bg-white/[0.015] hover:border-white/30 hover:bg-white/[0.03]"
            }`}
          >
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="w-10 h-10 rounded-xl bg-white/[0.06] border border-white/10 flex items-center justify-center text-zinc-300">
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-semibold text-white">
                  {selectedFiles.length > 0
                    ? `${selectedFiles.length} arquivo(s) pronto(s) para upload`
                    : "Clique para selecionar ou arraste vídeos aqui"}
                </p>
                <p className="text-xs text-zinc-400 mt-1">
                  Formatos suportados: MP4, MOV, MKV, WebM
                </p>
              </div>
            </div>
          </div>

          <input
            id="video-file-input"
            type="file"
            accept="video/*"
            multiple
            className="hidden"
            onChange={(event) => {
              const files = event.target.files;
              if (files) {
                const videoFiles = Array.from(files).filter((file) =>
                  file.type.startsWith("video/"),
                );
                if (videoFiles.length > 0) {
                  setSelectedFiles((current) => [...current, ...videoFiles]);
                } else {
                  alert("Por favor, selecione arquivo(s) de vídeo válido(s)");
                }
              }
            }}
          />

          {/* Selected Files List */}
          {selectedFiles.length > 0 && (
            <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {selectedFiles.map((file, index) => (
                <GlassCard
                  key={index}
                  className="flex items-center justify-between p-2.5 bg-white/[0.03] border-white/10"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <svg className="w-4 h-4 text-zinc-400 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polygon points="23 7 16 12 23 17 23 7" />
                      <rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                    </svg>
                    <div className="truncate">
                      <p className="text-xs font-medium text-white truncate">{file.name}</p>
                      <p className="text-xs font-mono text-zinc-400">
                        {(file.size / (1024 * 1024)).toFixed(2)} MB
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFiles((current) => current.filter((_, i) => i !== index));
                    }}
                    className="p-1 rounded-md text-zinc-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                    title="Remover da lista"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </GlassCard>
              ))}
            </div>
          )}

          <GlassButton
            variant="primary"
            fullWidth
            loading={action.busy || isSubmitting}
            disabled={action.busy || isSubmitting || selectedFiles.length === 0}
            onClick={handleFileUpload}
            leadingIcon={
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
            }
          >
            Importar {selectedFiles.length > 0 ? `${selectedFiles.length} Arquivo(s)` : "Arquivos"}
          </GlassButton>
        </div>
      )}
    </div>
  );
}
