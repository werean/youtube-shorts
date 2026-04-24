import type { RefObject } from "react";
import type { Cut } from "../../types";
import type { VideoItem } from "../../utils/videoHelpers";
import { formatTimestamp } from "../../utils/formatters";
import { ActionCard } from "../ActionCard";
import { SuggestedCutsList } from "./SuggestedCutsList";
import { TaskLogPanel } from "./TaskLogPanel";

type TaskLogType = "transcription" | "render";
type CutHoverAction = "edit" | "delete";

interface ActionState {
  busy: boolean;
  error?: string;
}

interface SelectedVideoWorkspaceProps {
  activeVideo: VideoItem;
  videoRef: RefObject<HTMLVideoElement>;
  taskLogsContainerRef: RefObject<HTMLDivElement>;
  apiBaseUrl: string;
  isExpanded: boolean;
  onToggleExpanded: () => void;
  action: ActionState;
  isBatchProcessing: boolean;
  batchProcessingLogs: string[];
  activeTaskLogType: TaskLogType | null;
  activeTaskLogs: string[];
  expandTaskLogs: boolean;
  onShowMoreTaskLogs: () => void;
  onCancelTranscription: () => void | Promise<void>;
  onCancelRendering: () => void | Promise<void>;
  hasAnyTranscription: boolean;
  hasAnyBlocks: boolean;
  isAnalyzing: boolean;
  isRendering: boolean;
  cuts: Cut[];
  suggestedCuts: Cut[];
  selectedSuggestedCutId: string | null;
  hoveredCutId: string | null;
  hoveredCutAction: CutHoverAction | null;
  renderOutputs: string[];
  expectedRenderCount: number;
  showAiResponseOnAnalyze: boolean;
  isLoadingCuts: boolean;
  showContinueBatchPipeline: boolean;
  onTranscribeClick: () => void;
  onShowTranscriptionFormats: () => void;
  onBuildBlocksClick: () => void;
  onAnalyzeClick: () => void;
  onRenderClick: () => void;
  onAddManualCutClick: () => void;
  onBatchPipelineClick: () => void;
  onContinueBatchPipeline: () => void | Promise<void>;
  onShowAiResponseOnAnalyzeChange: (show: boolean) => void;
  onSelectSuggestedCut: (cut: Cut) => void;
  onEditSuggestedCut: (cut: Cut) => void;
  onDeleteSuggestedCut: (cutId: string) => void;
  onCutActionHover: (cutId: string, action: CutHoverAction) => void;
  onCutActionLeave: () => void;
}

export function SelectedVideoWorkspace({
  activeVideo,
  videoRef,
  taskLogsContainerRef,
  apiBaseUrl,
  isExpanded,
  onToggleExpanded,
  action,
  isBatchProcessing,
  batchProcessingLogs,
  activeTaskLogType,
  activeTaskLogs,
  expandTaskLogs,
  onShowMoreTaskLogs,
  onCancelTranscription,
  onCancelRendering,
  hasAnyTranscription,
  hasAnyBlocks,
  isAnalyzing,
  isRendering,
  cuts,
  suggestedCuts,
  selectedSuggestedCutId,
  hoveredCutId,
  hoveredCutAction,
  renderOutputs,
  expectedRenderCount,
  showAiResponseOnAnalyze,
  isLoadingCuts,
  showContinueBatchPipeline,
  onTranscribeClick,
  onShowTranscriptionFormats,
  onBuildBlocksClick,
  onAnalyzeClick,
  onRenderClick,
  onAddManualCutClick,
  onBatchPipelineClick,
  onContinueBatchPipeline,
  onShowAiResponseOnAnalyzeChange,
  onSelectSuggestedCut,
  onEditSuggestedCut,
  onDeleteSuggestedCut,
  onCutActionHover,
  onCutActionLeave,
}: SelectedVideoWorkspaceProps) {
  return (
    <div className="panel" style={{ marginBottom: "24px" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "16px",
        }}
      >
        <h2 style={{ margin: 0, flex: 1 }}>3. Vídeo selecionado</h2>
        <button
          onClick={onToggleExpanded}
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
        <div className="video-player-container">
          {activeVideo.videoPath ? (
            <>
              <div className="video-player-wrapper">
                <video
                  key={`video-${activeVideo.job.job_id}`}
                  ref={videoRef}
                  controls
                  width="100%"
                  src={`${apiBaseUrl}${activeVideo.videoPath}`}
                  className="video-player"
                  onLoadStart={() => {
                    console.log(`\n[video] Iniciando carregamento do vídeo:`);
                    console.log(`[video]   Job ID: ${activeVideo.job.job_id}`);
                    console.log(`[video]   Video Path: ${activeVideo.videoPath}`);
                    console.log(`[video]   URL completa: ${apiBaseUrl}${activeVideo.videoPath}`);
                  }}
                  onError={(e) => {
                    console.error(`\n[video] ERRO ao carregar vídeo:`);
                    console.error(`[video]   Job ID: ${activeVideo.job.job_id}`);
                    console.error(`[video]   Video Path: ${activeVideo.videoPath}`);
                    console.error(`[video]   URL tentada: ${apiBaseUrl}${activeVideo.videoPath}`);
                    console.error(`[video]   Erro completo:`, e);
                    console.error(`[video]   Event type: ${e.type}`);
                    if (e.target instanceof HTMLVideoElement) {
                      console.error(`[video]   Video networkState: ${e.target.networkState}`);
                      console.error(`[video]   Video readyState: ${e.target.readyState}`);
                      console.error(`[video]   Video error code: ${e.target.error?.code}`);
                      console.error(`[video]   Video error message: ${e.target.error?.message}`);
                    }
                  }}
                  onLoadedMetadata={() => {
                    console.log(`[video] Metadados carregados com sucesso`);
                  }}
                  onCanPlay={() => {
                    console.log(`[video] Vídeo pronto para reproduzir`);
                  }}
                />
              </div>

              {isBatchProcessing && batchProcessingLogs.length > 0 && (
                <div className="batch-logs">
                  <h4 className="batch-logs-title">Logs do Pipeline em Lote</h4>
                  <div className="batch-logs-content">
                    {batchProcessingLogs.map((log, idx) => (
                      <div key={idx}>{log}</div>
                    ))}
                  </div>
                </div>
              )}

              {activeTaskLogType && (
                <TaskLogPanel
                  taskLogsContainerRef={taskLogsContainerRef}
                  activeTaskLogType={activeTaskLogType}
                  activeTaskLogs={activeTaskLogs}
                  expandTaskLogs={expandTaskLogs}
                  showTranscriptionCancel={
                    activeTaskLogType === "transcription" && Boolean(activeVideo.isTranscribing)
                  }
                  showRenderCancel={activeTaskLogType === "render" && isRendering}
                  onShowMoreTaskLogs={onShowMoreTaskLogs}
                  onCancelTranscription={onCancelTranscription}
                  onCancelRendering={onCancelRendering}
                />
              )}

              <div className="action-cards-grid">
                <ActionCard description="Gera ou recria a transcrição do vídeo.">
                  <button
                    disabled={action.busy}
                    className="config-card-button green"
                    style={{
                      cursor: action.busy ? "not-allowed" : "pointer",
                      opacity: action.busy ? 0.5 : 1,
                    }}
                    onClick={onTranscribeClick}
                  >
                    {activeVideo.isTranscribing ? (
                      <span className="config-card-button-content">
                        <span className="button-spinner" aria-hidden="true" />
                        <span>Transcrevendo...</span>
                      </span>
                    ) : hasAnyTranscription ? (
                      "Gerar nova transcrição"
                    ) : (
                      "Transcrever"
                    )}
                  </button>
                </ActionCard>
                <ActionCard description="Abre a transcrição nos formatos disponíveis.">
                  <button
                    disabled={!hasAnyTranscription}
                    onClick={onShowTranscriptionFormats}
                    className="config-card-button blue"
                    style={{
                      cursor: hasAnyTranscription ? "pointer" : "not-allowed",
                      opacity: hasAnyTranscription ? 1 : 0.5,
                    }}
                  >
                    Visualizar transcrição
                  </button>
                </ActionCard>
                <ActionCard description="Agrupa a transcrição em blocos semânticos.">
                  <button
                    disabled={!hasAnyTranscription}
                    className="config-card-button purple"
                    onClick={onBuildBlocksClick}
                  >
                    Blocos
                  </button>
                </ActionCard>
                <div className="action-card">
                  <button
                    disabled={
                      isAnalyzing || (!hasAnyTranscription && !hasAnyBlocks && suggestedCuts.length === 0)
                    }
                    className="config-card-button orange"
                    onClick={onAnalyzeClick}
                  >
                    {isAnalyzing ? (
                      <span className="config-card-button-content">
                        <span className="button-spinner" aria-hidden="true" />
                        <span>Analisando...</span>
                      </span>
                    ) : suggestedCuts.length > 0 ? (
                      "Gerar nova análise"
                    ) : (
                      "Análise"
                    )}
                  </button>
                  <p className="config-card-description">Analisa com IA para encontrar hooks.</p>
                  <div className="checkbox-container">
                    <input
                      type="checkbox"
                      checked={showAiResponseOnAnalyze}
                      onChange={(event) => onShowAiResponseOnAnalyzeChange(event.target.checked)}
                    />
                    <span style={{ fontSize: "0.85rem" }}>exibir resultado da IA</span>
                  </div>
                </div>
                <div className="action-card">
                  <button
                    disabled={cuts.length === 0 || isRendering}
                    className="config-card-button pink"
                    onClick={onRenderClick}
                  >
                    {isRendering ? (
                      <span className="config-card-button-content">
                        <span className="button-spinner" aria-hidden="true" />
                        <span>Renderizando...</span>
                      </span>
                    ) : (
                      "Renderizar"
                    )}
                  </button>
                  {isRendering && (
                    <p
                      className="muted"
                      style={{ marginTop: "8px", fontSize: "0.8rem", textAlign: "center" }}
                    >
                      Gerando cortes: {renderOutputs.length}/{expectedRenderCount || "?"}
                    </p>
                  )}
                  <p className="config-card-description">Renderiza os cortes em vídeos verticals.</p>
                </div>
                <div className="action-card">
                  <button className="config-card-button green" onClick={onAddManualCutClick}>
                    Adicionar Corte Manual
                  </button>
                  <p className="config-card-description">
                    Cria um corte com timestamps específicos.
                  </p>
                </div>
                <div className="action-card">
                  <button className="config-card-button indigo" onClick={onBatchPipelineClick}>
                    Pipeline em Lote
                  </button>
                  <p className="config-card-description">
                    Processa múltiplos vídeos sequencialmente.
                  </p>
                </div>
              </div>

              {isLoadingCuts && (
                <div className="loading-container">
                  <div className="spinner" />
                  <span style={{ fontSize: "0.9rem" }}>Carregando cortes...</span>
                </div>
              )}

              {suggestedCuts.length > 0 && (
                <SuggestedCutsList
                  suggestedCuts={suggestedCuts}
                  selectedSuggestedCutId={selectedSuggestedCutId}
                  hoveredCutId={hoveredCutId}
                  hoveredCutAction={hoveredCutAction}
                  showContinueBatchPipeline={showContinueBatchPipeline}
                  onContinueBatchPipeline={onContinueBatchPipeline}
                  onSelectSuggestedCut={onSelectSuggestedCut}
                  onEditSuggestedCut={onEditSuggestedCut}
                  onDeleteSuggestedCut={onDeleteSuggestedCut}
                  onCutActionHover={onCutActionHover}
                  onCutActionLeave={onCutActionLeave}
                />
              )}
            </>
          ) : (
            <div className="loading-placeholder">
              <p>Aguardando download do vídeo...</p>
              <progress />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
