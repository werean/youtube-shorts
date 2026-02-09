import { useState } from "react";
import type { VideoItem } from "../hooks";
import { createJob, ingestJob, uploadVideoFile, apiBaseUrl } from "../api";
import type { ActionState } from "../hooks/useAppAction";

interface UploadSectionProps {
  action: ActionState;
  onVideoAdded: (video: VideoItem) => void;
  onLoadVideos: () => Promise<void>;
  appSettings: any;
  onShowMoveUploadDialog: () => void;
  isExpanded: boolean;
  onToggle: () => void;
}

export function UploadSection({
  action,
  onVideoAdded,
  onLoadVideos,
  appSettings,
  onShowMoveUploadDialog,
  isExpanded,
  onToggle,
}: UploadSectionProps) {
  const [uploadMode, setUploadMode] = useState<"url" | "file">("url");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [isDraggingFile, setIsDraggingFile] = useState(false);

  async function runAction<T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) {
    try {
      const result = await fn();
      onSuccess?.(result);
    } catch (error) {
      console.error("Error:", error);
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
    for (const file of selectedFiles) {
      try {
        const result = await uploadVideoFile(file);
        const newVideo: VideoItem = {
          job: result.job,
          transcriptionLogs: [],
          videoPath: result.video_path,
        };
        onVideoAdded(newVideo);
      } catch (error) {
        console.error(`Error uploading ${file.name}:`, error);
      }
    }

    setSelectedFiles([]);
    const fileInput = document.getElementById("video-file-input") as HTMLInputElement;
    if (fileInput) fileInput.value = "";
    await onLoadVideos();
  }

  return (
    <section className="grid" style={{ marginBottom: "24px" }}>
      <div className="panel">
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "16px",
          }}
        >
          <h2 style={{ margin: 0, flex: 1 }}>1. Faça upload de um vídeo</h2>
          <button
            onClick={onToggle}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "0",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#666",
            }}
            title={isExpanded ? "Recolher" : "Expandir"}
          >
            <i
              className="material-icons"
              style={{
                transform: isExpanded ? "rotate(0deg)" : "rotate(180deg)",
                transition: "transform 0.3s ease",
              }}
            >
              keyboard_arrow_down
            </i>
          </button>
        </div>

        {isExpanded && (
          <>
            <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
              <button
                className={uploadMode === "url" ? "primary" : "secondary"}
                onClick={() => {
                  setUploadMode("url");
                  setSelectedFiles([]);
                }}
                style={{ borderRadius: "8px" }}
              >
                📎 URL do YouTube
              </button>
              <button
                className={uploadMode === "file" ? "primary" : "secondary"}
                onClick={() => {
                  setUploadMode("file");
                  setYoutubeUrl("");
                }}
                style={{ borderRadius: "8px" }}
              >
                📁 Arquivo local
              </button>
            </div>

            {uploadMode === "url" ? (
              <>
                <label className="field">
                  Link do YouTube
                  <input
                    value={youtubeUrl}
                    onChange={(event) => setYoutubeUrl(event.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </label>
                <button
                  className="primary"
                  disabled={action.busy || youtubeUrl.length === 0}
                  style={{ borderRadius: "8px" }}
                  onClick={() => {
                    runAction(
                      () => createJob(youtubeUrl),
                      (jobResult: any) => {
                        const job = jobResult.job || jobResult;
                        const newVideo: VideoItem = {
                          job,
                          transcriptionLogs: [],
                        };
                        onVideoAdded(newVideo);
                        setYoutubeUrl("");

                        runAction(
                          () => ingestJob(job.job_id),
                          (ingestResult: any) => {
                            // ingestResult contains { video_path, metadata_path }
                            const updatedVideo: VideoItem = {
                              ...newVideo,
                              videoPath: ingestResult.video_path,
                            };
                            onVideoAdded(updatedVideo);
                            onLoadVideos();
                          },
                        );
                      },
                    );
                  }}
                >
                  🎥 Fazer upload
                </button>
              </>
            ) : (
              <>
                <div
                  style={{
                    background: selectedFiles.length > 0 ? "var(--panel)" : "var(--bg-contrast)",
                    border:
                      selectedFiles.length > 0
                        ? "1px solid var(--border)"
                        : "2px dashed var(--border)",
                    borderRadius: "8px",
                    padding: "32px 24px",
                    marginBottom: "12px",
                    textAlign: "center",
                    cursor: "pointer",
                    transition: "all 0.2s ease",
                    opacity: isDraggingFile ? 0.7 : 1,
                    transform: isDraggingFile ? "scale(1.02)" : "scale(1)",
                  }}
                  onClick={() => {
                    const fileInput = document.getElementById(
                      "video-file-input",
                    ) as HTMLInputElement;
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
                >
                  {selectedFiles.length > 0 ? (
                    <div>
                      <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>🎬</div>
                      <div style={{ fontWeight: 600, marginBottom: "16px", color: "var(--ink)" }}>
                        {selectedFiles.length} arquivo(s) selecionado(s)
                      </div>
                      <div
                        style={{
                          display: "grid",
                          gap: "8px",
                          marginBottom: "16px",
                          maxHeight: "200px",
                          overflowY: "auto",
                        }}
                      >
                        {selectedFiles.map((file, index) => (
                          <div
                            key={index}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              padding: "8px",
                              background: "var(--bg-contrast)",
                              borderRadius: "4px",
                            }}
                          >
                            <div style={{ flex: 1, textAlign: "left" }}>
                              <div
                                style={{
                                  fontSize: "0.85rem",
                                  fontWeight: 600,
                                  marginBottom: "2px",
                                }}
                              >
                                {file.name}
                              </div>
                              <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
                                {(file.size / 1024 / 1024).toFixed(2)} MB
                              </div>
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedFiles((current) =>
                                  current.filter((_, i) => i !== index),
                                );
                              }}
                              style={{
                                background: "transparent",
                                border: "none",
                                color: "#dc2626",
                                cursor: "pointer",
                                fontSize: "1rem",
                                padding: "4px 8px",
                                borderRadius: "4px",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "#fee";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent";
                              }}
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedFiles([]);
                          const fileInput = document.getElementById(
                            "video-file-input",
                          ) as HTMLInputElement;
                          if (fileInput) fileInput.value = "";
                        }}
                        style={{
                          background: "#fee",
                          border: "1px solid #fcc",
                          color: "#dc2626",
                          padding: "6px 12px",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                          fontWeight: 600,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "#fdd";
                          e.currentTarget.style.borderColor = "#f99";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "#fee";
                          e.currentTarget.style.borderColor = "#fcc";
                        }}
                      >
                        ✕ Remover todos
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: "2.5rem", marginBottom: "12px" }}>📹</div>
                      <div style={{ fontWeight: 600, marginBottom: "4px", color: "var(--ink)" }}>
                        Nenhum arquivo selecionado
                      </div>
                      <div style={{ fontSize: "0.85rem", color: "var(--muted)", marginTop: "4px" }}>
                        Clique ou arraste vídeos aqui
                      </div>
                    </div>
                  )}
                </div>

                <input
                  id="video-file-input"
                  type="file"
                  accept="video/*"
                  multiple
                  style={{ display: "none" }}
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

                <button
                  className="primary"
                  disabled={action.busy || selectedFiles.length === 0}
                  style={{ borderRadius: "8px", width: "100%" }}
                  onClick={handleFileUpload}
                >
                  🎥 Fazer upload ({selectedFiles.length})
                </button>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
