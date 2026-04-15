import { useState } from "react";
import type { VideoItem } from "../hooks";
import { createJob, ingestJob, uploadVideoFile } from "../api";
import type { ActionState } from "../hooks/useAppAction";
import { AppButton } from "./shared";

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
        <div className="panel-header">
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
              color: "var(--muted)",
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
            <div className="view-tabs" style={{ marginBottom: "12px" }}>
              <button
                className={`tab ${uploadMode === "url" ? "active" : ""}`}
                onClick={() => {
                  setUploadMode("url");
                  setSelectedFiles([]);
                }}
              >
                <span className="button-with-icon">
                  <span className="material-icons" aria-hidden="true">
                    link
                  </span>
                  <span>URL do YouTube</span>
                </span>
              </button>
              <button
                className={`tab ${uploadMode === "file" ? "active" : ""}`}
                onClick={() => {
                  setUploadMode("file");
                  setYoutubeUrl("");
                }}
              >
                <span className="button-with-icon">
                  <span className="material-icons" aria-hidden="true">
                    folder
                  </span>
                  <span>Arquivo local</span>
                </span>
              </button>
            </div>

            {uploadMode === "url" ? (
              <>
                <label className="field">
                  Link do YouTube
                  <input
                    className="youtube-url-input"
                    value={youtubeUrl}
                    onChange={(event) => setYoutubeUrl(event.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                  />
                </label>
                <AppButton
                  variant="primary"
                  disabled={action.busy || youtubeUrl.length === 0}
                  fullWidth
                  style={{ padding: "14px 16px", marginTop: "8px" }}
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
                  <span className="button-with-icon">
                    <span className="material-icons" aria-hidden="true">
                      upload
                    </span>
                    <span>Fazer upload</span>
                  </span>
                </AppButton>
              </>
            ) : (
              <>
                <div
                  className={`upload-dropzone ${selectedFiles.length > 0 ? "active" : ""} ${isDraggingFile ? "dragging" : ""}`}
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
                      <div style={{ marginBottom: "12px" }}>
                        <span
                          className="material-icons"
                          aria-hidden="true"
                          style={{ fontSize: "2.5rem", color: "var(--ink)" }}
                        >
                          video_file
                        </span>
                      </div>
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
                          <div key={index} className="upload-file-item">
                            <div className="upload-file-info">
                              <div className="upload-file-name">{file.name}</div>
                              <div className="upload-file-size">
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
                                color: "var(--danger)",
                                cursor: "pointer",
                                fontSize: "1rem",
                                padding: "4px 8px",
                                borderRadius: "4px",
                              }}
                              onMouseEnter={(e) => {
                                e.currentTarget.style.background = "rgba(239, 68, 68, 0.14)";
                              }}
                              onMouseLeave={(e) => {
                                e.currentTarget.style.background = "transparent";
                              }}
                            >
                              <span className="material-icons" aria-hidden="true">
                                close
                              </span>
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
                          background: "rgba(239, 68, 68, 0.14)",
                          border: "1px solid rgba(239, 68, 68, 0.35)",
                          color: "var(--danger)",
                          padding: "6px 12px",
                          borderRadius: "4px",
                          cursor: "pointer",
                          fontSize: "0.85rem",
                          fontWeight: 600,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = "rgba(239, 68, 68, 0.2)";
                          e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.5)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = "rgba(239, 68, 68, 0.14)";
                          e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.35)";
                        }}
                      >
                        Remover todos
                      </button>
                    </div>
                  ) : (
                    <div>
                      <div style={{ marginBottom: "12px" }}>
                        <span
                          className="material-icons"
                          aria-hidden="true"
                          style={{ fontSize: "2.5rem", color: "var(--ink)" }}
                        >
                          upload_file
                        </span>
                      </div>
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

                <AppButton
                  variant="primary"
                  disabled={action.busy || selectedFiles.length === 0}
                  fullWidth
                  style={{ padding: "14px 16px", marginTop: "8px" }}
                  onClick={handleFileUpload}
                >
                  <span className="button-with-icon">
                    <span className="material-icons" aria-hidden="true">
                      upload
                    </span>
                    <span>Fazer upload</span>
                  </span>
                </AppButton>
              </>
            )}
          </>
        )}
      </div>
    </section>
  );
}
