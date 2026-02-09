import type React from "react";

interface VideoItem {
  job: {
    job_id: string;
    video_name: string;
    status: string;
  };
  hasTranscription?: boolean;
  hasAnalysis?: boolean;
}

interface BatchPipelineOptions {
  transcription: boolean;
  analysis: boolean;
  render: boolean;
  preApprove: boolean;
}

interface BatchPipelineDialogProps {
  videos: VideoItem[];
  selectedVideosForBatch: string[];
  batchPipelineOptions: BatchPipelineOptions;
  isBatchProcessing: boolean;
  activeBatchId: string | null;
  onClose: () => void;
  onVideoToggle: (videoId: string) => void;
  onOptionChange: (options: Partial<BatchPipelineOptions>) => void;
  onCancel: () => Promise<void>;
  onStart: () => Promise<void>;
}

export function BatchPipelineDialog({
  videos,
  selectedVideosForBatch,
  batchPipelineOptions,
  isBatchProcessing,
  activeBatchId,
  onClose,
  onVideoToggle,
  onOptionChange,
  onCancel,
  onStart,
}: BatchPipelineDialogProps) {
  return (
    <div
      className="dialog-overlay"
      onClick={() => {
        if (!isBatchProcessing) {
          onClose();
        }
      }}
    >
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "900px", maxHeight: "90vh" }}
      >
        <div className="dialog-header">
          <h3>🚀 Pipeline em Lote</h3>
          <div className="dialog-actions">
            <button
              className="icon-btn close-btn"
              onClick={() => {
                if (!isBatchProcessing) {
                  onClose();
                }
              }}
              disabled={isBatchProcessing}
            >
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content" style={{ padding: "20px" }}>
          {/* Seção de seleção de vídeos */}
          <div style={{ marginBottom: "24px" }}>
            <h4 style={{ marginBottom: "12px", fontSize: "16px", fontWeight: "600" }}>
              Seus Vídeos
            </h4>
            <p style={{ fontSize: "13px", color: "#666", marginBottom: "12px" }}>
              Selecione um ou mais vídeos para processar sequencialmente.
            </p>
            <div
              style={{
                maxHeight: "250px",
                overflowY: "auto",
                border: "1px solid #e5e5e5",
                borderRadius: "8px",
                padding: "12px",
                background: "#f9fafb",
              }}
            >
              {videos.length === 0 ? (
                <p style={{ textAlign: "center", color: "#999", padding: "20px" }}>
                  Nenhum vídeo disponível
                </p>
              ) : (
                videos.map((video) => (
                  <div
                    key={video.job.job_id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      padding: "8px 12px",
                      marginBottom: "8px",
                      background: selectedVideosForBatch.includes(video.job.job_id)
                        ? "#e0f2fe"
                        : "#fff",
                      border: "1px solid #e5e5e5",
                      borderRadius: "6px",
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onClick={() => {
                      if (!isBatchProcessing) {
                        onVideoToggle(video.job.job_id);
                      }
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={selectedVideosForBatch.includes(video.job.job_id)}
                      onChange={() => {}}
                      disabled={isBatchProcessing}
                      style={{ marginRight: "12px", cursor: "pointer" }}
                    />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: "500", fontSize: "14px" }}>
                        {video.job.video_name || video.job.job_id}
                        {selectedVideosForBatch.includes(video.job.job_id) &&
                        ((video.hasTranscription && batchPipelineOptions.transcription) ||
                          (video.hasAnalysis && batchPipelineOptions.analysis)) ? (
                          <span style={{ color: "#f59e0b", marginLeft: "8px" }}>
                            —{" "}
                            {video.hasTranscription &&
                            batchPipelineOptions.transcription &&
                            video.hasAnalysis &&
                            batchPipelineOptions.analysis
                              ? "Transcrição e Análise existentes serão sobrescritas"
                              : video.hasTranscription && batchPipelineOptions.transcription
                                ? "Transcrição existente será sobrescrita"
                                : "Análise existente será sobrescrita"}
                          </span>
                        ) : null}
                      </div>
                      <div style={{ fontSize: "12px", color: "#666", marginTop: "4px" }}>
                        Status: {video.job.status}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Seção de opções de pipeline */}
          <div style={{ marginBottom: "24px" }}>
            <h4 style={{ marginBottom: "12px", fontSize: "16px", fontWeight: "600" }}>
              O que você deseja fazer?
            </h4>
            <p style={{ fontSize: "13px", color: "#666", marginBottom: "12px" }}>
              Análise requer Transcrição. Renderizar e Revisar antes requerem Análise.
            </p>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(2, 1fr)",
                gap: "12px",
              }}
            >
              {/* Transcrição */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "16px",
                  border: "2px solid #e5e5e5",
                  borderRadius: "12px",
                  background: "#f0fdf4",
                  cursor: "not-allowed",
                  opacity: 0.8,
                }}
              >
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎙️</div>
                <div style={{ fontWeight: "600", marginBottom: "4px" }}>Transcrição</div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#666",
                    textAlign: "center",
                    marginTop: "4px",
                  }}
                >
                  Obrigatória
                </div>
              </div>

              {/* Análise com IA */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "16px",
                  border: `2px solid ${batchPipelineOptions.analysis ? "#3b82f6" : "#e5e5e5"}`,
                  borderRadius: "12px",
                  background: batchPipelineOptions.analysis ? "#eff6ff" : "#fff",
                  cursor: isBatchProcessing ? "not-allowed" : "pointer",
                  transition: "all 0.2s",
                }}
                onClick={() => {
                  if (!isBatchProcessing) {
                    const newAnalysis = !batchPipelineOptions.analysis;
                    onOptionChange({
                      analysis: newAnalysis,
                      render: newAnalysis ? batchPipelineOptions.render : false,
                      preApprove: newAnalysis ? batchPipelineOptions.preApprove : false,
                    });
                  }
                }}
              >
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>🤖</div>
                <div style={{ fontWeight: "600", marginBottom: "4px" }}>Análise com IA</div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#666",
                    textAlign: "center",
                    marginTop: "4px",
                  }}
                >
                  Identifica hooks
                </div>
                <input
                  type="checkbox"
                  checked={batchPipelineOptions.analysis}
                  onChange={() => {}}
                  disabled={isBatchProcessing}
                  style={{ marginTop: "8px", cursor: "pointer" }}
                />
              </div>

              {/* Renderizar */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "16px",
                  border: `2px solid ${
                    batchPipelineOptions.render && batchPipelineOptions.analysis
                      ? "#ec4899"
                      : "#e5e5e5"
                  }`,
                  borderRadius: "12px",
                  background:
                    batchPipelineOptions.render && batchPipelineOptions.analysis
                      ? "#fce7f3"
                      : "#fff",
                  cursor:
                    isBatchProcessing || !batchPipelineOptions.analysis ? "not-allowed" : "pointer",
                  opacity: !batchPipelineOptions.analysis ? 0.5 : 1,
                  transition: "all 0.2s",
                }}
                onClick={() => {
                  if (!isBatchProcessing && batchPipelineOptions.analysis) {
                    onOptionChange({ render: !batchPipelineOptions.render });
                  }
                }}
              >
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>🎬</div>
                <div style={{ fontWeight: "600", marginBottom: "4px" }}>Renderizar</div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#666",
                    textAlign: "center",
                    marginTop: "4px",
                  }}
                >
                  Gera vídeos
                </div>
                <input
                  type="checkbox"
                  checked={batchPipelineOptions.render}
                  onChange={() => {}}
                  disabled={isBatchProcessing || !batchPipelineOptions.analysis}
                  style={{ marginTop: "8px", cursor: "pointer" }}
                />
              </div>

              {/* Revisar antes */}
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  padding: "16px",
                  border: `2px solid ${
                    batchPipelineOptions.preApprove && batchPipelineOptions.analysis
                      ? "#10b981"
                      : "#e5e5e5"
                  }`,
                  borderRadius: "12px",
                  background:
                    batchPipelineOptions.preApprove && batchPipelineOptions.analysis
                      ? "#f0fdf4"
                      : "#fff",
                  cursor:
                    isBatchProcessing || !batchPipelineOptions.analysis ? "not-allowed" : "pointer",
                  opacity: !batchPipelineOptions.analysis ? 0.5 : 1,
                  transition: "all 0.2s",
                }}
                onClick={() => {
                  if (!isBatchProcessing && batchPipelineOptions.analysis) {
                    onOptionChange({ preApprove: !batchPipelineOptions.preApprove });
                  }
                }}
              >
                <div style={{ fontSize: "32px", marginBottom: "8px" }}>✅</div>
                <div style={{ fontWeight: "600", marginBottom: "4px" }}>Revisar antes</div>
                <div
                  style={{
                    fontSize: "11px",
                    color: "#666",
                    textAlign: "center",
                    marginTop: "4px",
                  }}
                >
                  Pausa para revisar
                </div>
                <input
                  type="checkbox"
                  checked={batchPipelineOptions.preApprove}
                  onChange={() => {}}
                  disabled={isBatchProcessing || !batchPipelineOptions.analysis}
                  style={{ marginTop: "8px", cursor: "pointer" }}
                />
              </div>
            </div>
          </div>

          {/* Botões de ação */}
          <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
            <button
              onClick={onCancel}
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
                border: "1px solid #e5e5e5",
                background: "#fff",
                cursor: "pointer",
              }}
            >
              {isBatchProcessing ? "Cancelar Processamento" : "Fechar"}
            </button>
            <button
              onClick={onStart}
              disabled={isBatchProcessing || selectedVideosForBatch.length === 0}
              className="primary"
              style={{
                padding: "10px 20px",
                borderRadius: "8px",
                opacity: isBatchProcessing || selectedVideosForBatch.length === 0 ? 0.5 : 1,
                cursor:
                  isBatchProcessing || selectedVideosForBatch.length === 0
                    ? "not-allowed"
                    : "pointer",
              }}
            >
              {isBatchProcessing ? "⏳ Processando..." : "Iniciar Pipeline"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
