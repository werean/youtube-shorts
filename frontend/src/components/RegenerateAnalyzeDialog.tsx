import { useState } from "react";
import type { Cut } from "../types";
import type { ActionState } from "../hooks/useAppAction";

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

interface RegenerateAnalyzeDialogProps {
  suggestedCuts: Cut[];
  action: ActionState;
  onMaintainSelected: (keptCutIds: string[]) => void;
  onRegenerateAll: () => void;
  onCancel: () => void;
}

export function RegenerateAnalyzeDialog({
  suggestedCuts,
  action,
  onMaintainSelected,
  onRegenerateAll,
  onCancel,
}: RegenerateAnalyzeDialogProps) {
  const [keepCutIds, setKeepCutIds] = useState<string[]>([]);

  return (
    <div className="dialog-overlay" onClick={onCancel}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h3>Gerar nova análise</h3>
          <div className="dialog-actions">
            <button className="icon-btn close-btn" onClick={onCancel}>
              ✕
            </button>
          </div>
        </div>
        <div className="dialog-content">
          <p>Selecione os cortes que deseja manter:</p>
          <div style={{ display: "grid", gap: "8px", marginBottom: "16px" }}>
            {suggestedCuts.map((cut) => (
              <label key={cut.cut_id} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={keepCutIds.includes(cut.cut_id)}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setKeepCutIds((current) => [...current, cut.cut_id]);
                    } else {
                      setKeepCutIds((current) => current.filter((item) => item !== cut.cut_id));
                    }
                  }}
                />
                <span>
                  {formatTimestamp(cut.start)} - {formatTimestamp(cut.end)}
                </span>
              </label>
            ))}
          </div>
          <div className="dialog-actions" style={{ justifyContent: "flex-start" }}>
            <button
              className="primary"
              disabled={keepCutIds.length === 0 || action.busy}
              onClick={() => onMaintainSelected(keepCutIds)}
            >
              Manter os cortes selecionados e gerar novos
            </button>
            <button className="secondary" disabled={action.busy} onClick={onRegenerateAll}>
              Apagar cortes e gerar novos cortes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
