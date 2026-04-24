import type { Cut } from "../../types";
import { formatTimestamp } from "../../utils/formatters";

type CutHoverAction = "edit" | "delete";

interface SuggestedCutsListProps {
  suggestedCuts: Cut[];
  selectedSuggestedCutId: string | null;
  hoveredCutId: string | null;
  hoveredCutAction: CutHoverAction | null;
  showContinueBatchPipeline: boolean;
  onContinueBatchPipeline: () => void | Promise<void>;
  onSelectSuggestedCut: (cut: Cut) => void;
  onEditSuggestedCut: (cut: Cut) => void;
  onDeleteSuggestedCut: (cutId: string) => void;
  onCutActionHover: (cutId: string, action: CutHoverAction) => void;
  onCutActionLeave: () => void;
}

export function SuggestedCutsList({
  suggestedCuts,
  selectedSuggestedCutId,
  hoveredCutId,
  hoveredCutAction,
  showContinueBatchPipeline,
  onContinueBatchPipeline,
  onSelectSuggestedCut,
  onEditSuggestedCut,
  onDeleteSuggestedCut,
  onCutActionHover,
  onCutActionLeave,
}: SuggestedCutsListProps) {
  return (
    <div style={{ marginTop: "20px" }}>
      <p style={{ marginBottom: "12px", fontWeight: "600" }}>
        Cortes sugeridos ({suggestedCuts.length}):
      </p>

      {showContinueBatchPipeline && (
        <div style={{ marginBottom: "16px", textAlign: "center" }}>
          <button
            className="secondary"
            onClick={() => {
              void onContinueBatchPipeline();
            }}
          >
            Continuar Pipeline
          </button>
        </div>
      )}

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        {suggestedCuts.map((cut) => (
          <div key={cut.cut_id} style={{ position: "relative", display: "inline-flex" }}>
            <button
              className="cut-timestamp-btn"
              onClick={() => onSelectSuggestedCut(cut)}
              style={{
                padding: "8px 12px",
                backgroundColor:
                  selectedSuggestedCutId === cut.cut_id ? "var(--bg-3)" : "var(--bg-contrast)",
                color: selectedSuggestedCutId === cut.cut_id ? "var(--ink)" : "var(--muted)",
                border: "none",
                borderRadius: "8px",
                cursor: "pointer",
                fontSize: "0.85em",
                fontWeight: selectedSuggestedCutId === cut.cut_id ? "600" : "400",
                paddingRight: "56px",
              }}
            >
              {formatTimestamp(cut.start)} - {formatTimestamp(cut.end)}
            </button>
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
                onClick={() => onEditSuggestedCut(cut)}
                onMouseEnter={() => onCutActionHover(cut.cut_id, "edit")}
                onMouseLeave={onCutActionLeave}
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
                    hoveredCutId === cut.cut_id && hoveredCutAction === "edit"
                      ? "var(--accent-2)"
                      : "var(--muted)",
                }}
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
                onClick={() => onDeleteSuggestedCut(cut.cut_id)}
                onMouseEnter={() => onCutActionHover(cut.cut_id, "delete")}
                onMouseLeave={onCutActionLeave}
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
                    hoveredCutId === cut.cut_id && hoveredCutAction === "delete"
                      ? "var(--danger)"
                      : "var(--muted)",
                }}
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
          </div>
        ))}
      </div>
    </div>
  );
}
