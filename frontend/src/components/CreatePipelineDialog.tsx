import { useState } from "react";

interface Video {
  id: string;
  title: string;
  hasTranscription: boolean;
  hasAnalysis: boolean;
}

export interface PipelineOptions {
  transcribe: boolean;
  analyze: boolean;
  render: boolean;
}

interface CreatePipelineDialogProps {
  videos: Video[];
  onClose: () => void;
  onStart: (selectedVideoIds: string[], options: PipelineOptions) => Promise<void>;
  isProcessing: boolean;
}

export function CreatePipelineDialog({
  videos,
  onClose,
  onStart,
  isProcessing,
}: CreatePipelineDialogProps) {
  const [selectedVideoIds, setSelectedVideoIds] = useState<string[]>([]);
  const [options, setOptions] = useState<PipelineOptions>({
    transcribe: true,
    analyze: false,
    render: false,
  });

  const handleVideoToggle = (videoId: string) => {
    setSelectedVideoIds((prev) =>
      prev.includes(videoId) ? prev.filter((id) => id !== videoId) : [...prev, videoId],
    );
  };

  const handleAnalyzeToggle = (checked: boolean) => {
    setOptions((prev) => ({
      ...prev,
      analyze: checked,
      render: checked ? prev.render : false,
    }));
  };

  const handleRenderToggle = (checked: boolean) => {
    setOptions((prev) => ({
      ...prev,
      render: checked,
    }));
  };

  const handleStart = async () => {
    if (selectedVideoIds.length === 0) {
      alert("Selecione pelo menos um vídeo");
      return;
    }
    await onStart(selectedVideoIds, options);
  };

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "600px", maxHeight: "80vh", overflowY: "auto" }}
      >
        <div className="dialog-header">
          <h3>Criar Pipeline</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onClose} disabled={isProcessing}>
              ✕
            </button>
          </div>
        </div>

        <div className="dialog-content">
          {/* Card 1: Seus vídeos */}
          <div style={{ marginBottom: "24px" }}>
            <h4 style={{ marginBottom: "6px", fontSize: "0.95rem", fontWeight: "600" }}>
              Seus vídeos
            </h4>
            <p
              style={{
                fontSize: "0.8rem",
                color: "#666",
                marginBottom: "12px",
                fontStyle: "italic",
                margin: "0 0 12px 0",
              }}
            >
              Selecione um ou vários vídeos para processar
            </p>

            <div
              style={{
                border: "1px solid #ddd",
                borderRadius: "6px",
                padding: "10px",
                backgroundColor: "#fafafa",
                maxHeight: "280px",
                overflowY: "auto",
              }}
            >
              {videos.length === 0 ? (
                <p style={{ textAlign: "center", color: "#999", padding: "20px" }}>
                  Nenhum vídeo disponível
                </p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {videos.map((video) => {
                    const hasWarning = video.hasTranscription || video.hasAnalysis;
                    const warnings = [];
                    if (video.hasTranscription) warnings.push("esse vídeo já possui transcrição");
                    if (video.hasAnalysis)
                      warnings.push("esse vídeo já possui análise gerada por IA");

                    return (
                      <label
                        key={video.id}
                        style={{
                          display: "flex",
                          gap: "8px",
                          padding: "8px",
                          borderRadius: "4px",
                          backgroundColor: selectedVideoIds.includes(video.id)
                            ? "#e3f2fd"
                            : "white",
                          cursor: "pointer",
                          border: selectedVideoIds.includes(video.id)
                            ? "1px solid #90caf9"
                            : "1px solid transparent",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedVideoIds.includes(video.id)}
                          onChange={() => handleVideoToggle(video.id)}
                          style={{ marginTop: "2px", cursor: "pointer" }}
                        />
                        <div
                          style={{ flex: 1, display: "flex", flexDirection: "column", gap: "2px" }}
                        >
                          <div style={{ fontWeight: "500", fontSize: "0.9rem" }}>{video.title}</div>
                          {hasWarning && (
                            <div
                              style={{
                                fontSize: "0.75rem",
                                color: "#d97706",
                                lineHeight: "1.3",
                              }}
                            >
                              ⚠️ {warnings.join(" — ")}. Prosseguir irá apagar e sobrescrever.
                            </div>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* Card 2: O que pretende fazer */}
          <div>
            <h4 style={{ marginBottom: "6px", fontSize: "0.95rem", fontWeight: "600" }}>
              O que pretende fazer
            </h4>
            <p
              style={{
                fontSize: "0.8rem",
                color: "#666",
                marginBottom: "12px",
                fontStyle: "italic",
                margin: "0 0 12px 0",
              }}
            >
              Algumas opções só estão liberadas quando você seleciona outras
            </p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3, 1fr)",
                gap: "10px",
              }}
            >
              {/* Transcrever */}
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "10px",
                  borderRadius: "6px",
                  backgroundColor: "#e8f5e9",
                  border: "1px solid #a5d6a7",
                  cursor: "not-allowed",
                  opacity: 0.7,
                }}
              >
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={true}
                    disabled
                    style={{ cursor: "not-allowed" }}
                  />
                  <span style={{ fontWeight: "500", fontSize: "0.85rem" }}>Transcrever</span>
                </div>
                <span style={{ fontSize: "0.7rem", color: "#555" }}>(obrigatório)</span>
              </label>

              {/* Gerar Análise */}
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "10px",
                  borderRadius: "6px",
                  backgroundColor: options.analyze ? "#fff3e0" : "#f5f5f5",
                  border: options.analyze ? "1px solid #ffb74d" : "1px solid #e0e0e0",
                  cursor: "pointer",
                }}
              >
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={options.analyze}
                    onChange={(e) => handleAnalyzeToggle(e.target.checked)}
                    style={{ cursor: "pointer" }}
                  />
                  <span style={{ fontWeight: "500", fontSize: "0.85rem" }}>Gerar Análise</span>
                </div>
                <span style={{ fontSize: "0.7rem", color: "#666" }}>com IA</span>
              </label>

              {/* Renderizar */}
              <label
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "6px",
                  padding: "10px",
                  borderRadius: "6px",
                  backgroundColor: options.analyze ? "#f3e5f5" : "#f5f5f5",
                  border: options.analyze ? "1px solid #ce93d8" : "1px solid #e0e0e0",
                  cursor: options.analyze ? "pointer" : "not-allowed",
                  opacity: options.analyze ? 1 : 0.6,
                }}
              >
                <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={options.render}
                    onChange={(e) => handleRenderToggle(e.target.checked)}
                    disabled={!options.analyze}
                    style={{ cursor: options.analyze ? "pointer" : "not-allowed" }}
                  />
                  <span style={{ fontWeight: "500", fontSize: "0.85rem" }}>Renderizar</span>
                </div>
                <span style={{ fontSize: "0.7rem", color: "#666" }}>
                  {options.analyze ? "vídeos" : "(requer análise)"}
                </span>
              </label>
            </div>
          </div>
        </div>

        <div className="dialog-actions" style={{ justifyContent: "flex-end", gap: "8px" }}>
          <button
            className="secondary"
            onClick={onClose}
            disabled={isProcessing}
            style={{
              opacity: isProcessing ? 0.5 : 1,
              cursor: isProcessing ? "not-allowed" : "pointer",
            }}
          >
            Cancelar
          </button>
          <button
            className="primary"
            onClick={handleStart}
            disabled={isProcessing || selectedVideoIds.length === 0}
            style={{
              opacity: isProcessing || selectedVideoIds.length === 0 ? 0.5 : 1,
              cursor: isProcessing || selectedVideoIds.length === 0 ? "not-allowed" : "pointer",
            }}
          >
            {isProcessing ? "⏳ Processando..." : "Iniciar Pipeline"}
          </button>
        </div>
      </div>
    </div>
  );
}
