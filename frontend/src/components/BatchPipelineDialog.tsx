import type React from "react";
import { AppButton, AppDialog } from "./shared";

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
    <AppDialog
      title="Pipeline em Lote"
      onClose={() => {
        if (!isBatchProcessing) {
          onClose();
        }
      }}
      showHeaderClose={false}
      onOverlayClick={() => {
        if (!isBatchProcessing) {
          onClose();
        }
      }}
      disableClose={isBatchProcessing}
      wide
      scrollable
      footer={
        <>
          <AppButton variant="primary" onClick={onCancel}>
            {isBatchProcessing ? "Cancelar Processamento" : "Fechar"}
          </AppButton>
          <AppButton
            variant="secondary"
            onClick={onStart}
            disabled={isBatchProcessing || selectedVideosForBatch.length === 0}
          >
            {isBatchProcessing ? "Processando..." : "Iniciar Pipeline"}
          </AppButton>
        </>
      }
    >
      <div className="ds-dialog-stack">
        <section className="ds-dialog-stack">
          <h4 className="ds-dialog-section-title">Seus Vídeos</h4>
          <p className="muted">Selecione um ou mais vídeos para processar sequencialmente.</p>
          <div className="ds-video-list-box">
            {videos.length === 0 ? (
              <p className="muted ds-empty-state">Nenhum vídeo disponível</p>
            ) : (
              videos.map((video) => (
                <label key={video.job.job_id} className="ds-batch-video-item">
                  <input
                    type="checkbox"
                    checked={selectedVideosForBatch.includes(video.job.job_id)}
                    disabled={isBatchProcessing}
                    onChange={() => {
                      if (!isBatchProcessing) {
                        onVideoToggle(video.job.job_id);
                      }
                    }}
                  />
                  <div>
                    <p className="ds-batch-video-title">
                      {video.job.video_name || video.job.job_id}
                    </p>
                    {selectedVideosForBatch.includes(video.job.job_id) &&
                    ((video.hasTranscription && batchPipelineOptions.transcription) ||
                      (video.hasAnalysis && batchPipelineOptions.analysis)) ? (
                      <p className="ds-batch-video-warning">
                        {video.hasTranscription &&
                        batchPipelineOptions.transcription &&
                        video.hasAnalysis &&
                        batchPipelineOptions.analysis
                          ? "Transcrição e Análise existentes serão sobrescritas"
                          : video.hasTranscription && batchPipelineOptions.transcription
                            ? "Transcrição existente será sobrescrita"
                            : "Análise existente será sobrescrita"}
                      </p>
                    ) : null}
                    <p className="ds-batch-video-status">Status: {video.job.status}</p>
                  </div>
                </label>
              ))
            )}
          </div>
        </section>

        <section className="ds-dialog-stack">
          <h4 className="ds-dialog-section-title">O que você deseja fazer?</h4>
          <p className="muted">
            Análise requer Transcrição. Renderizar e Revisar antes requerem Análise.
          </p>
          <div className="ds-batch-options-grid">
            <article className="ds-batch-option-card ds-batch-option-card--locked">
              <h5>Transcrição</h5>
              <p className="muted">Obrigatória</p>
            </article>

            <article
              className={`ds-batch-option-card ${batchPipelineOptions.analysis ? "is-active" : ""}`}
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
              <h5>Análise com IA</h5>
              <p className="muted">Identifica hooks</p>
              <input
                type="checkbox"
                checked={batchPipelineOptions.analysis}
                onChange={() => {}}
                disabled={isBatchProcessing}
              />
            </article>

            <article
              className={`ds-batch-option-card ${
                batchPipelineOptions.render && batchPipelineOptions.analysis ? "is-active" : ""
              } ${!batchPipelineOptions.analysis ? "is-disabled" : ""}`}
              onClick={() => {
                if (!isBatchProcessing && batchPipelineOptions.analysis) {
                  onOptionChange({ render: !batchPipelineOptions.render });
                }
              }}
            >
              <h5>Renderizar</h5>
              <p className="muted">Gera vídeos</p>
              <input
                type="checkbox"
                checked={batchPipelineOptions.render}
                onChange={() => {}}
                disabled={isBatchProcessing || !batchPipelineOptions.analysis}
              />
            </article>

            <article
              className={`ds-batch-option-card ${
                batchPipelineOptions.preApprove && batchPipelineOptions.analysis ? "is-active" : ""
              } ${!batchPipelineOptions.analysis ? "is-disabled" : ""}`}
              onClick={() => {
                if (!isBatchProcessing && batchPipelineOptions.analysis) {
                  onOptionChange({ preApprove: !batchPipelineOptions.preApprove });
                }
              }}
            >
              <h5>Revisar antes</h5>
              <p className="muted">Pausa para revisar</p>
              <input
                type="checkbox"
                checked={batchPipelineOptions.preApprove}
                onChange={() => {}}
                disabled={isBatchProcessing || !batchPipelineOptions.analysis}
              />
            </article>
          </div>
        </section>
      </div>
    </AppDialog>
  );
}

