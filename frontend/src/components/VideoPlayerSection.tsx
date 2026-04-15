import { useRef, useState } from "react";
import type { VideoItem } from "../hooks";
import type { Cut } from "../types";
import { apiBaseUrl, getTranscription, deleteTranscription } from "../api";
import type { ActionState } from "../hooks/useAppAction";

interface VideoPlayerSectionProps {
  activeVideo: VideoItem;
  suggestedCuts: Cut[];
  selectedSuggestedCutId: string | null;
  isTranscribing: boolean;
  hasAnyTranscription: boolean;
  hasAnyBlocks: boolean;
  onPlayCut: (cutId: string) => void;
  onSelectCut: (cutId: string) => void;
  onShowTranscriptionDialog: () => void;
  onShowBlocksDialog: () => void;
  onShowAnalyzeDialog: () => void;
  onShowRegenerateDialog: () => void;
  onShowEditCutDialog: (cut: Cut) => void;
  onDeleteCut: (cutId: string) => void;
  onTranscribeClick: () => void;
  onRenderClick: () => void;
  onShowAiResponseOnAnalyze: boolean;
  onSetShowAiResponseOnAnalyze: (show: boolean) => void;
  isRendering: boolean;
  renderOutputCount: number;
  expectedRenderCount: number;
  action: ActionState;
  onRunAction: <T>(fn: () => Promise<T>, onSuccess?: (value: T) => void) => void;
}

function formatTimestamp(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function VideoPlayerSection({
  activeVideo,
  suggestedCuts,
  selectedSuggestedCutId,
  isTranscribing,
  hasAnyTranscription,
  hasAnyBlocks,
  onPlayCut,
  onSelectCut,
  onShowTranscriptionDialog,
  onShowBlocksDialog,
  onShowAnalyzeDialog,
  onShowRegenerateDialog,
  onShowEditCutDialog,
  onDeleteCut,
  onTranscribeClick,
  onRenderClick,
  onShowAiResponseOnAnalyze,
  onSetShowAiResponseOnAnalyze,
  isRendering,
  renderOutputCount,
  expectedRenderCount,
  action,
  onRunAction,
}: VideoPlayerSectionProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hoveredCutId, setHoveredCutId] = useState<string | null>(null);
  const [hoveredCutAction, setHoveredCutAction] = useState<"edit" | "delete" | null>(null);

  return (
    activeVideo && (
      <section className="panel">
        <h2>3. Vídeo selecionado</h2>
        <div className="video-player-container">
          {activeVideo.videoPath ? (
            <>
              <div
                className="video-player-wrapper"
                style={{
                  width: "100%",
                  background: "var(--bg)",
                  borderRadius: "12px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "400px",
                  position: "relative",
                }}
              >
                <video
                  key={`video-${activeVideo.job.job_id}`}
                  ref={videoRef}
                  controls
                  width="100%"
                  src={`${apiBaseUrl}${activeVideo.videoPath}`}
                  className="video-player"
                  style={{ maxHeight: "400px" }}
                  onLoadStart={() => {
                    console.log(`[video] Loading video`);
                  }}
                  onError={(e) => {
                    console.error(`[video] ERROR loading video:`, e);
                  }}
                />
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
                  gap: "12px",
                  marginTop: "12px",
                }}
              >
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "12px",
                    background: "var(--panel)",
                  }}
                >
                  <button
                    disabled={!hasAnyTranscription}
                    onClick={onShowTranscriptionDialog}
                    style={{
                      width: "100%",
                      borderRadius: "8px",
                      background: "var(--accent-2)",
                      color: "var(--ink)",
                      border: "none",
                      padding: "10px",
                      cursor: hasAnyTranscription ? "pointer" : "not-allowed",
                      opacity: hasAnyTranscription ? 1 : 0.5,
                    }}
                  >
                    Visualizar transcrição
                  </button>
                  <p
                    className="muted"
                    style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                  >
                    Abre a transcrição nos formatos disponíveis.
                  </p>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "12px",
                    background: "var(--panel)",
                  }}
                >
                  <button
                    disabled={action.busy}
                    style={{
                      width: "100%",
                      borderRadius: "8px",
                      background: "var(--success)",
                      color: "var(--ink)",
                      border: "none",
                      padding: "10px",
                      cursor: action.busy ? "not-allowed" : "pointer",
                      opacity: action.busy ? 0.5 : 1,
                    }}
                    onClick={onTranscribeClick}
                  >
                    {isTranscribing
                      ? "Transcrevendo..."
                      : hasAnyTranscription
                        ? "Gerar nova transcrição"
                        : "Transcrever"}
                  </button>
                  <p
                    className="muted"
                    style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                  >
                    Gera ou recria a transcrição do vídeo.
                  </p>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "12px",
                    background: "var(--panel)",
                  }}
                >
                  <button
                    disabled={!hasAnyTranscription}
                    style={{
                      width: "100%",
                      borderRadius: "8px",
                      background: "var(--bg-3)",
                      color: "var(--ink)",
                      border: "none",
                      padding: "10px",
                      cursor: !hasAnyTranscription ? "not-allowed" : "pointer",
                      opacity: !hasAnyTranscription ? 0.5 : 1,
                    }}
                    onClick={onShowBlocksDialog}
                  >
                    Blocos
                  </button>
                  <p
                    className="muted"
                    style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                  >
                    Agrupa a transcrição em blocos semânticos.
                  </p>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "12px",
                    background: "var(--panel)",
                  }}
                >
                  <button
                    disabled={!hasAnyBlocks && suggestedCuts.length === 0}
                    style={{
                      width: "100%",
                      borderRadius: "8px",
                      background: "var(--bg-3)",
                      color: "var(--ink)",
                      border: "none",
                      padding: "10px",
                      cursor:
                        !hasAnyBlocks && suggestedCuts.length === 0 ? "not-allowed" : "pointer",
                      opacity: !hasAnyBlocks && suggestedCuts.length === 0 ? 0.5 : 1,
                    }}
                    onClick={() => {
                      if (suggestedCuts.length > 0) {
                        onShowRegenerateDialog();
                      } else {
                        onShowAnalyzeDialog();
                      }
                    }}
                  >
                    {suggestedCuts.length > 0 ? "Gerar nova análise" : "Análise"}
                  </button>
                  <p
                    className="muted"
                    style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                  >
                    Analisa com IA para encontrar hooks.
                  </p>
                  <div
                    style={{
                      display: "flex",
                      gap: "8px",
                      alignItems: "center",
                      marginTop: "10px",
                      justifyContent: "center",
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={onShowAiResponseOnAnalyze}
                      onChange={(event) => onSetShowAiResponseOnAnalyze(event.target.checked)}
                    />
                    <span style={{ fontSize: "0.85rem" }}>exibir resultado da IA</span>
                  </div>
                </div>

                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "10px",
                    padding: "12px",
                    background: "var(--panel)",
                  }}
                >
                  <button
                    disabled={suggestedCuts.length === 0 || isRendering}
                    style={{
                      width: "100%",
                      borderRadius: "8px",
                      background: "var(--bg-3)",
                      color: "var(--ink)",
                      border: "none",
                      padding: "10px",
                      cursor: suggestedCuts.length === 0 || isRendering ? "not-allowed" : "pointer",
                      opacity: suggestedCuts.length === 0 || isRendering ? 0.5 : 1,
                    }}
                    onClick={onRenderClick}
                  >
                    {isRendering ? "Renderizando..." : "Renderizar"}
                  </button>
                  {isRendering && (
                    <p
                      className="muted"
                      style={{ marginTop: "8px", fontSize: "0.8rem", textAlign: "center" }}
                    >
                      Gerando cortes: {renderOutputCount}/{expectedRenderCount || "?"}
                    </p>
                  )}
                  <p
                    className="muted"
                    style={{ marginTop: "10px", fontSize: "0.75rem", textAlign: "center" }}
                  >
                    Renderiza os cortes em vídeos verticals.
                  </p>
                </div>
              </div>

              {suggestedCuts.length > 0 && (
                <div style={{ marginTop: "20px" }}>
                  <p style={{ marginBottom: "12px", fontWeight: "600" }}>
                    Cortes sugeridos ({suggestedCuts.length}):
                  </p>
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                    {suggestedCuts.map((cut) => (
                      <div
                        key={cut.cut_id}
                        style={{ position: "relative", display: "inline-flex" }}
                        onMouseEnter={() => setHoveredCutId(cut.cut_id)}
                        onMouseLeave={() => setHoveredCutId(null)}
                      >
                        <button
                          className="primary"
                          onClick={() => {
                            onSelectCut(cut.cut_id);
                            if (videoRef.current) {
                              videoRef.current.currentTime = cut.start;
                              videoRef.current.play();
                            }
                          }}
                          style={{
                            padding: "8px 12px",
                            backgroundColor:
                              selectedSuggestedCutId === cut.cut_id
                                ? "var(--accent-2)"
                                : "var(--border)",
                            color: selectedSuggestedCutId === cut.cut_id ? "white" : "black",
                            border: "none",
                            borderRadius: "8px",
                            cursor: "pointer",
                            fontSize: "0.85em",
                            fontWeight: selectedSuggestedCutId === cut.cut_id ? "600" : "400",
                            paddingRight: hoveredCutId === cut.cut_id ? "56px" : "12px",
                            transition: "padding 0.2s ease",
                          }}
                        >
                          {formatTimestamp(cut.start)} - {formatTimestamp(cut.end)}
                        </button>
                        {hoveredCutId === cut.cut_id && (
                          <div
                            style={{
                              position: "absolute",
                              right: "6px",
                              top: "50%",
                              transform: "translateY(-50%)",
                              display: "flex",
                              alignItems: "center",
                              gap: "6px",
                            }}
                          >
                            <button
                              className="icon-btn"
                              onClick={() => onShowEditCutDialog(cut)}
                              style={{
                                width: "14px",
                                height: "14px",
                                borderRadius: "4px",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                padding: 0,
                                fontSize: "12px",
                                lineHeight: "14px",
                                color:
                                  hoveredCutAction === "edit" ? "var(--accent-2)" : "var(--muted)",
                              }}
                              onMouseEnter={() => setHoveredCutAction("edit")}
                              onMouseLeave={() => setHoveredCutAction(null)}
                              aria-label="Editar timestamp"
                            >
                              <span
                                className="material-icons"
                                aria-hidden="true"
                                style={{ fontSize: "12px", lineHeight: 1 }}
                              >
                                edit
                              </span>
                            </button>
                            <button
                              className="icon-btn"
                              onClick={() => onDeleteCut(cut.cut_id)}
                              style={{
                                width: "14px",
                                height: "14px",
                                borderRadius: "4px",
                                background: "transparent",
                                border: "none",
                                cursor: "pointer",
                                padding: 0,
                                fontSize: "12px",
                                lineHeight: "14px",
                                color:
                                  hoveredCutAction === "delete" ? "var(--danger)" : "var(--muted)",
                              }}
                              onMouseEnter={() => setHoveredCutAction("delete")}
                              onMouseLeave={() => setHoveredCutAction(null)}
                              aria-label="Deletar timestamp"
                            >
                              <span
                                className="material-icons"
                                aria-hidden="true"
                                style={{ fontSize: "12px", lineHeight: 1 }}
                              >
                                delete
                              </span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="loading-placeholder">
              <p>Aguardando download do vídeo...</p>
              <progress />
            </div>
          )}
        </div>
      </section>
    )
  );
}
